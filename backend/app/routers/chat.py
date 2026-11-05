"""Chat history, the chat WebSocket and the video-meeting signaling WebSocket."""
import json
import logging

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.deps import (
    get_current_user,
    project_role,
    require_project_role,
    role_at_least,
)
from app.core.security import WS_TICKET_TTL_SECONDS, consume_ws_ticket, create_ws_ticket
from app.models import MessageModel, ProjectModel, UserModel
from app.schemas.project import MessageListResponse, WsTicketRequest, WsTicketResponse
from app.services.realtime import manager, video_manager

logger = logging.getLogger("nexuscode")

router = APIRouter(tags=["chat"])

MAX_CHAT_MESSAGE_LENGTH = 2000
MAX_SIGNAL_FRAME_BYTES = 64 * 1024  # SDP offers are a few KB; this is generous
SIGNAL_TYPES = {"offer", "answer", "ice-candidate"}
MAX_MEETING_PEERS = 2  # the meeting UI is a 1:1 call


@router.get("/projects/{project_id}/messages", response_model=MessageListResponse)
def get_project_messages(
    limit: int = Query(50, ge=1, le=200, description="Messages per page (max 200)"),
    before: int | None = Query(None, description="Only messages older than this id (the previous page's next_cursor)"),
    project: ProjectModel = Depends(require_project_role("viewer")),
    db: Session = Depends(get_db),
):
    """Newest first. The id is the cursor: it is unique and follows insertion order."""
    query = db.query(MessageModel).filter(MessageModel.project_id == project.id)
    if before is not None:
        query = query.filter(MessageModel.id < before)
    # Fetch one extra row to know whether an older page exists
    rows = query.order_by(MessageModel.id.desc()).limit(limit + 1).all()
    messages = rows[:limit]
    next_cursor = messages[-1].id if len(rows) > limit else None
    return {"messages": messages, "next_cursor": next_cursor}


def _ws_member(ticket: str | None, project_id: int) -> tuple[int, str] | None:
    """
    (user id, username) behind a valid, unused ticket for this project, if that
    user is still a member (any role: viewers can read the chat and join
    meetings); otherwise None. Runs in a worker thread: it touches the database.
    """
    username = consume_ws_ticket(ticket, project_id) if ticket else None
    if username is None:
        return None
    with SessionLocal() as db:
        user = db.query(UserModel).filter(UserModel.username == username).first()
        if user is None or project_role(db, project_id, user.id) is None:
            return None
        return user.id, user.username


async def _authorize_websocket(websocket: WebSocket, project_id: int) -> tuple[int, str] | None:
    """Checks ?ticket= before accept(); closes with 1008 (policy violation) if not allowed."""
    member = await run_in_threadpool(_ws_member, websocket.query_params.get("ticket"), project_id)
    if member is None:
        await websocket.close(code=1008)
    return member


@router.post("/ws-ticket", response_model=WsTicketResponse)
def issue_ws_ticket(body: WsTicketRequest, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """Trade the login token for a 30-second, single-use ticket for one project's sockets."""
    if project_role(db, body.project_id, current_user.id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ticket": create_ws_ticket(current_user.username, body.project_id), "expires_in": WS_TICKET_TTL_SECONDS}


def _save_chat_message(project_id: int, user_id: int, username: str, content: str) -> dict:
    """Saves the message if the sender may still post. The role is checked on
    every message, so a change takes effect on an already open socket."""
    with SessionLocal() as db:
        role = project_role(db, project_id, user_id)
        if role is None:
            return {"type": "removed"}
        if not role_at_least(role, "editor"):
            return {"type": "error", "detail": "Viewers can read the chat but not post in it."}
        message = MessageModel(content=content, username=username, user_id=user_id, project_id=project_id)
        db.add(message)
        db.commit()
        db.refresh(message)
        return {"id": message.id, "username": message.username, "content": message.content}


@router.websocket("/ws/projects/{project_id}/chat")
async def chat_websocket(websocket: WebSocket, project_id: int):
    member = await _authorize_websocket(websocket, project_id)
    if member is None:
        return
    user_id, username = member

    await manager.connect(websocket, project_id, user_id)
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

            message = await run_in_threadpool(_save_chat_message, project_id, user_id, username, content)
            if message.get("type") == "removed":
                await websocket.close(code=1008)
                break
            if message.get("type") == "error":
                await websocket.send_json(message)
                continue
            await manager.broadcast(project_id, message)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Chat socket error (project %s, user %s)", project_id, username)
    finally:
        manager.disconnect(websocket, project_id)


@router.websocket("/ws/projects/{project_id}/meeting")
async def meeting_websocket(websocket: WebSocket, project_id: int):
    member = await _authorize_websocket(websocket, project_id)
    if member is None:
        return
    user_id, username = member

    # Separate room from chat, so signaling never shows up in the chat box
    await websocket.accept()
    already_there = video_manager.join_if_room(websocket, project_id, user_id, MAX_MEETING_PEERS)
    if already_there is None:
        await websocket.send_json({"type": "room-full"})
        await websocket.close(code=1013)  # "try again later"
        return

    try:
        # Exactly one side makes the WebRTC offer: the newcomer, towards the
        # peer already waiting. The waiting peer just learns someone joined.
        await websocket.send_json({"type": "role", "initiator": already_there > 0})
        if already_there:
            await video_manager.broadcast_to_peer(project_id, websocket, {"type": "peer-joined"})
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
        # Lets the remaining peer reset and wait for the next one to join
        await video_manager.broadcast_to_peer(project_id, websocket, {"type": "peer-left"})
