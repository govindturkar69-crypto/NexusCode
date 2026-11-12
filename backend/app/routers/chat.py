"""Chat history and the chat WebSocket. (Video meetings are on LiveKit: see meetings.py.)"""
import json
import logging
import time

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
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
from app.core.rate_limit import WS_TICKET_LIMIT, limiter, user_or_ip
from app.core.security import WS_TICKET_TTL_SECONDS, consume_ws_ticket, create_ws_ticket
from app.models import MessageModel, ProjectMemberModel, ProjectModel, UserModel
from app.schemas.project import MessageListResponse, WsTicketRequest, WsTicketResponse
from app.services.realtime import manager

logger = logging.getLogger("nexuscode")

router = APIRouter(tags=["chat"])

MAX_CHAT_MESSAGE_LENGTH = 2000
TYPING_MIN_INTERVAL_SECONDS = 2.0


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
    page = rows[:limit]
    next_cursor = page[-1].id if len(rows) > limit else None
    member_ids = {
        user_id
        for (user_id,) in db.query(ProjectMemberModel.user_id).filter(ProjectMemberModel.project_id == project.id)
    }
    messages = [
        {
            "id": m.id,
            "username": m.username,
            "content": m.content,
            "user_id": m.user_id,
            "project_id": m.project_id,
            "created_at": m.created_at,
            "author_removed": m.user_id not in member_ids,
        }
        for m in page
    ]
    return {"messages": messages, "next_cursor": next_cursor}


def _ws_member(ticket: str | None, project_id: int) -> tuple[int, str] | None:
    """
    (user id, username) behind a valid, unused ticket for this project, if that
    user is still a member (any role: viewers can read the chat); otherwise
    None. Runs in a worker thread: it touches the database.
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
@limiter.limit(WS_TICKET_LIMIT, key_func=user_or_ip)
def issue_ws_ticket(request: Request, body: WsTicketRequest, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
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
        return {
            "type": "message",
            "id": message.id,
            "username": message.username,
            "user_id": message.user_id,
            "content": message.content,
            "project_id": message.project_id,
            "created_at": message.created_at.isoformat(),
            "author_removed": False,
        }


def _can_post(project_id: int, user_id: int) -> bool:
    with SessionLocal() as db:
        return role_at_least(project_role(db, project_id, user_id), "editor")


@router.websocket("/ws/projects/{project_id}/chat")
async def chat_websocket(websocket: WebSocket, project_id: int):
    member = await _authorize_websocket(websocket, project_id)
    if member is None:
        return
    user_id, username = member

    await manager.connect(websocket, project_id, user_id, username)
    last_typing = 0.0
    try:
        await manager.broadcast_presence(project_id)
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue

            if data.get("type") == "typing":
                # Clients send this while typing; at most one every couple of seconds counts
                now = time.monotonic()
                if now - last_typing >= TYPING_MIN_INTERVAL_SECONDS:
                    last_typing = now
                    if await run_in_threadpool(_can_post, project_id, user_id):
                        await manager.broadcast_except(project_id, websocket, {"type": "typing", "user_id": user_id, "username": username})
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
        await manager.broadcast_presence(project_id)
