from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import engine, get_db, Base
from models import TodoModel, UserModel, ProjectModel, TaskModel, FileModel, MessageModel, CodeFileModel
from auth import hash_password, verify_password, create_access_token, decode_access_token
from ai import generate_code, detect_bugs, generate_docs, AIQuotaExceededError, AIServiceBusyError
from files import upload_file_to_cloudinary
from websocket_manager import manager
from github_oauth import get_github_authorize_url, exchange_code_for_token, create_github_repo, push_file_to_repo

# This creates all tables in Postgres, if they don't exist yet.
Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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

# Pydantic models — these define the shape of data going in/out of the API
class Todo(BaseModel):
    task: str
    done: bool = False

class TodoUpdate(BaseModel):
    done: bool

class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class ProjectCreate(BaseModel):
    name: str
    description: str | None = None

class TaskCreate(BaseModel):
    title: str
    description: str | None = None

class TaskUpdate(BaseModel):
    status: str

class CodeGenRequest(BaseModel):
    prompt: str

class CodeReviewRequest(BaseModel):
    code: str

class CodeFileUpdate(BaseModel):
    content: str
    language: str = "python"

class PushToGithubRequest(BaseModel):
    repo_name: str

@app.get("/")
def read_root():
    return {"message": "Hello! Your FastAPI server is running."}

@app.get("/todos")
def get_todos(db: Session = Depends(get_db)):
    todos = db.query(TodoModel).all()
    return {"todos": todos}

@app.post("/todos")
def add_todo(todo: Todo, db: Session = Depends(get_db)):
    new_todo = TodoModel(task=todo.task, done=todo.done)
    db.add(new_todo)
    db.commit()
    db.refresh(new_todo)
    return {"message": "Todo added", "todo": new_todo}

@app.delete("/todos/{todo_id}")
def delete_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(TodoModel).filter(TodoModel.id == todo_id).first()
    if not todo:
        return {"error": "Todo not found"}
    db.delete(todo)
    db.commit()
    return {"message": "Todo removed"}

@app.put("/todos/{todo_id}")
def update_todo(todo_id: int, update: TodoUpdate, db: Session = Depends(get_db)):
    todo = db.query(TodoModel).filter(TodoModel.id == todo_id).first()
    if not todo:
        return {"error": "Todo not found"}
    todo.done = update.done
    db.commit()
    db.refresh(todo)
    return {"message": "Todo updated", "todo": todo}

@app.post("/signup")
def signup(user: UserCreate, db: Session = Depends(get_db)):
    existing_user = db.query(UserModel).filter(UserModel.username == user.username).first()
    if existing_user:
        return {"error": "Username already taken"}

    new_user = UserModel(
        username=user.username,
        hashed_password=hash_password(user.password)
    )
    db.add(new_user)
    db.commit()
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
    return {"id": current_user.id, "username": current_user.username}

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

@app.websocket("/ws/projects/{project_id}/chat")
async def chat_websocket(websocket: WebSocket, project_id: int):
    await manager.connect(websocket, project_id)
    db = next(get_db())

    try:
        while True:
            data = await websocket.receive_json()
            username = data.get("username", "Unknown")
            content = data.get("content", "")

            new_message = MessageModel(content=content, username=username, project_id=project_id)
            db.add(new_message)
            db.commit()
            db.refresh(new_message)

            await manager.broadcast(project_id, {
                "id": new_message.id,
                "username": new_message.username,
                "content": new_message.content,
            })
    except WebSocketDisconnect:
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

@app.get("/auth/github/login")
def github_login(current_user: UserModel = Depends(get_current_user)):
    url = get_github_authorize_url()
    return {"url": url}

@app.get("/auth/github/callback")
def github_callback(code: str, db: Session = Depends(get_db)):
    access_token = exchange_code_for_token(code)

    # NOTE: for simplicity, we're attaching this token to our test user directly.
    # A more complete version would track *which* user initiated this request
    # (e.g. via a temporary session/state parameter) before reaching this point.
    user = db.query(UserModel).filter(UserModel.username == "govind").first()
    if user:
        user.github_token = access_token
        db.commit()

    # Redirect back to the frontend once linking is complete
    return RedirectResponse(url="http://localhost:5173/projects")

@app.post("/projects/{project_id}/push-to-github")
def push_to_github(project_id: int, request: PushToGithubRequest, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    if not current_user.github_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected")

    code_file = db.query(CodeFileModel).filter(CodeFileModel.project_id == project_id).first()
    if not code_file:
        raise HTTPException(status_code=404, detail="No code file found for this project")

    repo_result = create_github_repo(current_user.github_token, request.repo_name)
    if "full_name" not in repo_result:
        raise HTTPException(status_code=400, detail=repo_result.get("message", "Failed to create repository"))

    extension = {"python": "py", "javascript": "js", "java": "java", "cpp": "cpp", "html": "html"}.get(code_file.language, "txt")
    filename = f"main.{extension}"

    push_result = push_file_to_repo(current_user.github_token, repo_result["full_name"], filename, code_file.content)

    return {
        "message": "Pushed to GitHub successfully",
        "repo_url": repo_result.get("html_url"),
    }