"""Chat history, the chat WebSocket and the video-meeting signaling WebSocket."""
import json
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.deps import get_owned_project
from app.core.security import decode_access_token
from app.models import MessageModel, ProjectModel, UserModel
from app.schemas.project import MessageListResponse
from app.services.realtime import manager, video_manager

logger = logging.getLogger("nexuscode")

router = APIRouter(tags=["chat"])

MAX_CHAT_MESSAGE_LENGTH = 2000
MAX_SIGNAL_FRAME_BYTES = 64 * 1024  # SDP offers are a few KB; this is generous
SIGNAL_TYPES = {"offer", "answer", "ice-candidate"}


@router.get("/projects/{project_id}/messages", response_model=MessageListResponse)
def get_project_messages(project: ProjectModel = Depends(get_owned_project), db: Session = Depends(get_db)):
    # Oldest first; the auto-increment id follows insertion order
    messages = (
        db.query(MessageModel)
        .filter(MessageModel.project_id == project.id)
        .order_by(MessageModel.id.asc())
        .all()
    )
    return {"messages": messages}


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
            ProjectModel.owner_id == user.id,
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
        user_id = db.query(UserModel.id).filter(UserModel.username == username).scalar()
        message = MessageModel(content=content, username=username, user_id=user_id, project_id=project_id)
        db.add(message)
        db.commit()
        db.refresh(message)
        return {"id": message.id, "username": message.username, "content": message.content}


@router.websocket("/ws/projects/{project_id}/chat")
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


@router.websocket("/ws/projects/{project_id}/meeting")
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
