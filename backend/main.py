import json
import logging
import os
import re
from typing import Literal, get_args
from urllib.parse import urlencode

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from pydantic_core import PydanticCustomError

from database import engine, get_db, Base, SessionLocal
from models import UserModel, ProjectModel, TaskModel, FileModel, MessageModel, CodeFileModel, TASK_STATUSES
from auth import hash_password, verify_password, create_access_token, decode_access_token, create_oauth_state, verify_oauth_state
from ai import generate_code, detect_bugs, generate_docs, AIQuotaExceededError, AIServiceBusyError
from files import upload_file_to_cloudinary
from websocket_manager import manager, video_manager
from github_oauth import get_github_authorize_url, exchange_code_for_token, create_github_repo, push_file_to_repo, GitHubAPIError

load_dotenv()

logger = logging.getLogger("nexuscode")

# Where the React app lives (e.g. https://nexus-code-chi.vercel.app). Used for
# CORS and for redirecting back after GitHub OAuth.
FRONTEND_URL = (os.getenv("FRONTEND_URL") or "").rstrip("/")
if not FRONTEND_URL:
    raise RuntimeError("FRONTEND_URL environment variable is not set (e.g. http://localhost:5173).")

DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

# This creates all tables in Postgres, if they don't exist yet.
Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys([FRONTEND_URL, *DEV_ORIGINS])),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# This tells FastAPI to look for a token in the Authorization header.
# tokenUrl just tells the /docs page which route issues tokens (for its "Authorize" button).
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    username = decode_access_token(token)
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = db.query(UserModel).filter(UserModel.username == username).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    return user

def get_current_admin(current_user: UserModel = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

# Pydantic models — these define the shape of data going in/out of the API
USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,30}$")

class UserCreate(BaseModel):
    username: str
    password: str

    # PydanticCustomError keeps the message clean (no "Value error, " prefix)
    # so the frontend can show it as-is.
    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        if not USERNAME_PATTERN.fullmatch(value):
            raise PydanticCustomError(
                "username_invalid",
                "Username must be 3-30 characters using only lowercase letters, numbers and _",
            )
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        # bcrypt only looks at the first 72 bytes, so cap there instead of
        # silently ignoring the rest.
        if not 8 <= len(value.encode("utf-8")) <= 72:
            raise PydanticCustomError("password_invalid", "Password must be between 8 and 72 bytes long")
        return value

class Token(BaseModel):
    access_token: str
    token_type: str

class ProjectCreate(BaseModel):
    name: str
    description: str | None = None

class TaskCreate(BaseModel):
    title: str
    description: str | None = None

TaskStatus = Literal["todo", "in_progress", "done"]
# The API schema and the DB CHECK constraint must allow exactly the same values
assert get_args(TaskStatus) == TASK_STATUSES

class TaskUpdate(BaseModel):
    status: TaskStatus

class CodeGenRequest(BaseModel):
    prompt: str

class CodeReviewRequest(BaseModel):
    code: str

class CodeFileUpdate(BaseModel):
    content: str
    language: str = "python"

class PushToGithubRequest(BaseModel):
    repo_name: str = Field(pattern=r"^[A-Za-z0-9._-]{1,100}$")
    private: bool = True

@app.get("/")
def read_root():
    return {"message": "Hello! Your FastAPI server is running."}

@app.get("/health")
def health():
    """Liveness + database check for Docker HEALTHCHECK and Render health checks."""
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Health check: database unreachable")
        return JSONResponse(status_code=503, content={"status": "error", "database": "unreachable"})
    return {"status": "ok", "database": "ok"}

@app.post("/signup", status_code=201)
def signup(user: UserCreate, db: Session = Depends(get_db)):
    existing_user = db.query(UserModel).filter(UserModel.username == user.username).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="Username already taken")

    new_user = UserModel(
        username=user.username,
        hashed_password=hash_password(user.password)
    )
    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        # Two sign-ups for the same name at the same moment: the unique index wins
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already taken")
    db.refresh(new_user)
    return {"message": "User created successfully", "username": new_user.username}

@app.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    db_user = db.query(UserModel).filter(UserModel.username == form_data.username).first()

    if not db_user or not verify_password(form_data.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    access_token = create_access_token(data={"sub": db_user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/me")
def read_current_user(current_user: UserModel = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username, "is_admin": current_user.is_admin}

@app.post("/projects")
def create_project(project: ProjectCreate, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    new_project = ProjectModel(
        name=project.name,
        description=project.description,
        owner_id=current_user.id
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return {"message": "Project created", "project": new_project}

@app.get("/projects")
def get_my_projects(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    projects = db.query(ProjectModel).filter(ProjectModel.owner_id == current_user.id).all()
    return {"projects": projects}

@app.get("/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": project}

@app.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}

@app.post("/projects/{project_id}/tasks")
def create_task(project_id: int, task: TaskCreate, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    new_task = TaskModel(
        title=task.title,
        description=task.description,
        project_id=project_id
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return {"message": "Task created", "task": new_task}

@app.get("/projects/{project_id}/tasks")
def get_project_tasks(project_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    tasks = db.query(TaskModel).filter(TaskModel.project_id == project_id).all()
    return {"tasks": tasks}

@app.put("/tasks/{task_id}")
def update_task_status(task_id: int, update: TaskUpdate, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    task = db.query(TaskModel).join(ProjectModel).filter(
        TaskModel.id == task_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = update.status
    db.commit()
    db.refresh(task)
    return {"message": "Task updated", "task": task}

@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    task = db.query(TaskModel).join(ProjectModel).filter(
        TaskModel.id == task_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(task)
    db.commit()
    return {"message": "Task deleted"}

@app.post("/ai/generate-code")
def ai_generate_code(request: CodeGenRequest, current_user: UserModel = Depends(get_current_user)):
    try:
        result = generate_code(request.prompt)
        return {"result": result}
    except (AIQuotaExceededError, AIServiceBusyError) as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.post("/ai/detect-bugs")
def ai_detect_bugs(request: CodeReviewRequest, current_user: UserModel = Depends(get_current_user)):
    try:
        result = detect_bugs(request.code)
        return {"result": result}
    except (AIQuotaExceededError, AIServiceBusyError) as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.post("/ai/generate-docs")
def ai_generate_docs(request: CodeReviewRequest, current_user: UserModel = Depends(get_current_user)):
    try:
        result = generate_docs(request.code)
        return {"result": result}
    except (AIQuotaExceededError, AIServiceBusyError) as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.post("/projects/{project_id}/files")
async def upload_file(project_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    file_bytes = await file.read()
    url = upload_file_to_cloudinary(file_bytes, file.filename)

    new_file = FileModel(filename=file.filename, url=url, project_id=project_id)
    db.add(new_file)
    db.commit()
    db.refresh(new_file)
    return {"message": "File uploaded", "file": new_file}

@app.get("/projects/{project_id}/files")
def get_project_files(project_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    files = db.query(FileModel).filter(FileModel.project_id == project_id).all()
    return {"files": files}

@app.delete("/files/{file_id}")
def delete_file(file_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    file = db.query(FileModel).join(ProjectModel).filter(
        FileModel.id == file_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    db.delete(file)
    db.commit()
    return {"message": "File deleted"}

@app.get("/projects/{project_id}/messages")
def get_project_messages(project_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    messages = db.query(MessageModel).filter(MessageModel.project_id == project_id).all()
    return {"messages": messages}

MAX_CHAT_MESSAGE_LENGTH = 2000
MAX_SIGNAL_FRAME_BYTES = 64 * 1024  # SDP offers are a few KB; this is generous
SIGNAL_TYPES = {"offer", "answer", "ice-candidate"}

def _ws_user_for_project(token: str | None, project_id: int) -> str | None:
    """
    Returns the username behind `token` if that user may access the project,
    otherwise None. Runs in a worker thread because it touches the database.
    """
    username = decode_access_token(token) if token else None
    if username is None:
        return None
    with SessionLocal() as db:
        user = db.query(UserModel).filter(UserModel.username == username).first()
        if user is None:
            return None
        project = db.query(ProjectModel).filter(
            ProjectModel.id == project_id,
            ProjectModel.owner_id == user.id
        ).first()
        return user.username if project else None

async def _authorize_websocket(websocket: WebSocket, project_id: int) -> str | None:
    """Checks ?token= before accept(); closes with 1008 (policy violation) if not allowed."""
    username = await run_in_threadpool(_ws_user_for_project, websocket.query_params.get("token"), project_id)
    if username is None:
        await websocket.close(code=1008)
    return username

def _save_chat_message(project_id: int, username: str, content: str) -> dict:
    with SessionLocal() as db:
        message = MessageModel(content=content, username=username, project_id=project_id)
        db.add(message)
        db.commit()
        db.refresh(message)
        return {"id": message.id, "username": message.username, "content": message.content}

@app.websocket("/ws/projects/{project_id}/chat")
async def chat_websocket(websocket: WebSocket, project_id: int):
    username = await _authorize_websocket(websocket, project_id)
    if username is None:
        return

    await manager.connect(websocket, project_id)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue

            # The sender's name always comes from their token, never the client
            content = str(data.get("content", "")).strip()
            if not content:
                continue
            if len(content) > MAX_CHAT_MESSAGE_LENGTH:
                await websocket.send_json({"type": "error", "detail": f"Messages can be at most {MAX_CHAT_MESSAGE_LENGTH} characters."})
                continue

            message = await run_in_threadpool(_save_chat_message, project_id, username, content)
            await manager.broadcast(project_id, message)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Chat socket error (project %s, user %s)", project_id, username)
    finally:
        manager.disconnect(websocket, project_id)

@app.get("/projects/{project_id}/code")
def get_code_file(project_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    code_file = db.query(CodeFileModel).filter(CodeFileModel.project_id == project_id).first()

    if not code_file:
        code_file = CodeFileModel(content="", language="python", project_id=project_id)
        db.add(code_file)
        db.commit()
        db.refresh(code_file)

    return {"code_file": code_file}

@app.put("/projects/{project_id}/code")
def update_code_file(project_id: int, update: CodeFileUpdate, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    code_file = db.query(CodeFileModel).filter(CodeFileModel.project_id == project_id).first()
    if not code_file:
        code_file = CodeFileModel(project_id=project_id)
        db.add(code_file)

    code_file.content = update.content
    code_file.language = update.language
    db.commit()
    db.refresh(code_file)
    return {"message": "Code saved", "code_file": code_file}

def _github_result_redirect(result: str) -> RedirectResponse:
    """Sends the browser back to the projects page with ?github=connected|error."""
    return RedirectResponse(url=f"{FRONTEND_URL}/projects?{urlencode({'github': result})}")

@app.get("/auth/github/login")
def github_login(current_user: UserModel = Depends(get_current_user)):
    state = create_oauth_state(current_user.id)
    url = get_github_authorize_url(state)
    return {"url": url}

@app.get("/auth/github/callback")
def github_callback(code: str | None = None, state: str | None = None, db: Session = Depends(get_db)):
    # The signed state tells us which user started the flow. Without a valid
    # one we can't safely attach a token to anybody.
    user_id = verify_oauth_state(state) if state else None
    if not code or user_id is None:
        return _github_result_redirect("error")

    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if user is None:
        return _github_result_redirect("error")

    access_token = exchange_code_for_token(code)
    if not access_token:
        # Keep any token the user already had
        return _github_result_redirect("error")

    user.github_token = access_token
    db.commit()
    return _github_result_redirect("connected")

@app.post("/projects/{project_id}/push-to-github")
def push_to_github(project_id: int, request: PushToGithubRequest, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not current_user.github_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected")

    code_file = db.query(CodeFileModel).filter(CodeFileModel.project_id == project.id).first()
    if not code_file:
        raise HTTPException(status_code=404, detail="No code file found for this project")

    extension = {"python": "py", "javascript": "js", "java": "java", "cpp": "cpp", "html": "html"}.get(code_file.language, "txt")
    filename = f"main.{extension}"

    try:
        repo_result = create_github_repo(current_user.github_token, request.repo_name, request.private)
    except GitHubAPIError as e:
        raise _github_http_error(e, "Could not create the repository")

    try:
        push_file_to_repo(current_user.github_token, repo_result["full_name"], filename, code_file.content or "")
    except GitHubAPIError as e:
        raise _github_http_error(e, f"Repository {repo_result['full_name']} was created, but pushing {filename} failed")

    return {
        "message": "Pushed to GitHub successfully",
        "repo_url": repo_result.get("html_url"),
        "private": repo_result.get("private", request.private),
    }

def _github_http_error(error: GitHubAPIError, context: str) -> HTTPException:
    if error.status_code == 401:
        return HTTPException(status_code=400, detail="Your GitHub authorization has expired or was revoked. Please reconnect GitHub.")
    if error.status_code in (400, 403, 404, 422):
        return HTTPException(status_code=400, detail=f"{context}: {error.message}")
    return HTTPException(status_code=502, detail=f"{context}: {error.message}")

@app.get("/analytics")
def get_analytics(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    # Get all of this user's projects
    project_ids = [p.id for p in db.query(ProjectModel).filter(ProjectModel.owner_id == current_user.id).all()]

    total_projects = len(project_ids)

    if not project_ids:
        return {
            "total_projects": 0,
            "total_tasks": 0,
            "tasks_by_status": {status: 0 for status in TASK_STATUSES},
            "total_files": 0,
            "total_messages": 0,
        }

    tasks = db.query(TaskModel).filter(TaskModel.project_id.in_(project_ids)).all()
    total_tasks = len(tasks)

    tasks_by_status = {status: len([t for t in tasks if t.status == status]) for status in TASK_STATUSES}

    total_files = db.query(FileModel).filter(FileModel.project_id.in_(project_ids)).count()
    total_messages = db.query(MessageModel).filter(MessageModel.project_id.in_(project_ids)).count()

    return {
        "total_projects": total_projects,
        "total_tasks": total_tasks,
        "tasks_by_status": tasks_by_status,
        "total_files": total_files,
        "total_messages": total_messages,
    }

@app.get("/admin/users")
def admin_get_all_users(db: Session = Depends(get_db), admin: UserModel = Depends(get_current_admin)):
    users = db.query(UserModel).all()
    return {
        "users": [
            {"id": u.id, "username": u.username, "is_admin": u.is_admin, "project_count": len(u.projects)}
            for u in users
        ]
    }

@app.get("/admin/projects")
def admin_get_all_projects(db: Session = Depends(get_db), admin: UserModel = Depends(get_current_admin)):
    projects = db.query(ProjectModel).all()
    return {
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "owner_username": p.owner.username,
                "task_count": len(p.tasks),
            }
            for p in projects
        ]
    }

@app.get("/admin/stats")
def admin_get_platform_stats(db: Session = Depends(get_db), admin: UserModel = Depends(get_current_admin)):
    return {
        "total_users": db.query(UserModel).count(),
        "total_projects": db.query(ProjectModel).count(),
        "total_tasks": db.query(TaskModel).count(),
        "total_files": db.query(FileModel).count(),
        "total_messages": db.query(MessageModel).count(),
    }

@app.websocket("/ws/projects/{project_id}/meeting")
async def meeting_websocket(websocket: WebSocket, project_id: int):
    username = await _authorize_websocket(websocket, project_id)
    if username is None:
        return

    # Separate room from chat, so signaling never shows up in the chat box
    await video_manager.connect(websocket, project_id)
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode()) > MAX_SIGNAL_FRAME_BYTES:
                continue
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(data, dict) or data.get("type") not in SIGNAL_TYPES:
                continue
            await video_manager.broadcast_to_peer(project_id, websocket, data)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Meeting socket error (project %s, user %s)", project_id, username)
    finally:
        video_manager.disconnect(websocket, project_id)