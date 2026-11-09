"""
Real-time collaborative editing of code files (see app/services/collab.py).

  WS /ws/code-files/{code_file_id}?ticket=...

The ticket is the usual single-use, 30-second WebSocket ticket from POST /ws-ticket,
and it has to be for the file's own project. Members get in: editors and owners
can edit, viewers receive the document read-only. Anyone else, and any file id
that doesn't exist, gets the same refusal (close code 1008 before the socket is
accepted), so file ids can't be probed.
"""
import logging

import anyio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.core.database import SessionLocal
from app.core.deps import project_role, role_at_least
from app.core.security import consume_ws_ticket
from app.models import CodeFileModel, CodeFileYjsModel, UserModel
from app.services.collab import (
    CLOSE_FILE_DELETED,
    CLOSE_GOING_AWAY,
    CLOSE_TOO_MANY,
    CollabError,
    CollabManager,
    Connection,
)

logger = logging.getLogger("nexuscode")
router = APIRouter(tags=["collab"])


def load_file(file_id: int):
    """(project id, saved Yjs state or None, content) for a room, or None if the file is gone."""
    with SessionLocal() as db:
        code_file = db.get(CodeFileModel, file_id)
        if code_file is None:
            return None
        saved = db.get(CodeFileYjsModel, file_id)
        return code_file.project_id, (saved.state if saved else None), code_file.content or ""


def save_file(file_id: int, text: str, state: bytes) -> None:
    """Writes the document and its text together, so they never disagree."""
    with SessionLocal() as db:
        code_file = db.get(CodeFileModel, file_id)
        if code_file is None:
            return  # deleted meanwhile
        saved = db.get(CodeFileYjsModel, file_id)
        if saved is None:
            db.add(CodeFileYjsModel(code_file_id=file_id, state=state))
        else:
            saved.state = state
        if code_file.content != text:
            code_file.content = text
        db.commit()


def current_roles(pairs: set[tuple[int, int]]) -> dict[tuple[int, int], str | None]:
    """The live role ("editor" or "viewer") of each (project, user), or None if they
    aren't a member any more."""
    with SessionLocal() as db:
        out = {}
        for project_id, user_id in pairs:
            role = project_role(db, project_id, user_id)
            out[(project_id, user_id)] = None if role is None else live_role(role)
        return out


def live_role(role: str) -> str:
    return "editor" if role_at_least(role, "editor") else "viewer"


collab = CollabManager(load_file, save_file, current_roles)


# For plain `def` routes, which run in a worker thread: these hop onto the event loop

def replace_text(file_id: int, text: str) -> bool:
    return anyio.from_thread.run(collab.replace_text, file_id, text)


def flush_project(project_id: int) -> None:
    anyio.from_thread.run(collab.flush_project, project_id)


def flush_file(file_id: int) -> None:
    anyio.from_thread.run(collab.flush_file, file_id)


def drop_files(file_ids: list[int]) -> None:
    anyio.from_thread.run(collab.drop_files, file_ids)


def drop_project(project_id: int) -> None:
    anyio.from_thread.run(collab.drop_project, project_id)


def set_role(project_id: int, user_id: int, role: str | None) -> None:
    """After a member's role changes (role) or they're removed (None)."""
    anyio.from_thread.run(collab.set_role, project_id, user_id, None if role is None else live_role(role))


def remove_user(user_id: int) -> None:
    anyio.from_thread.run(collab.remove_user, user_id)


def _authorize(ticket: str | None, file_id: int) -> tuple[int, str, int, str] | None:
    """(user id, username, project id, role) for a valid ticket of a member of the
    file's project, or None. role is "editor" (editors and owners) or "viewer"."""
    if not ticket:
        return None
    with SessionLocal() as db:
        code_file = db.get(CodeFileModel, file_id)
        if code_file is None:
            return None
        username = consume_ws_ticket(ticket, code_file.project_id)
        if username is None:
            return None
        user = db.query(UserModel).filter(UserModel.username == username).first()
        role = project_role(db, code_file.project_id, user.id) if user else None
        if role is None:
            return None
        return user.id, user.username, code_file.project_id, live_role(role)


@router.websocket("/ws/code-files/{code_file_id}")
async def collab_socket(websocket: WebSocket, code_file_id: int):
    member = await run_in_threadpool(_authorize, websocket.query_params.get("ticket"), code_file_id)
    if member is None:
        await websocket.close(code=1008)
        return
    user_id, username, project_id, role = member
    await websocket.accept()
    # Accepted first, so the browser can read why it's turned away
    too_many = collab.too_many(user_id, project_id)
    if too_many:
        await websocket.close(code=CLOSE_TOO_MANY, reason=too_many)
        return
    room = await collab.room(code_file_id)
    if room is None:
        await websocket.close(code=CLOSE_FILE_DELETED, reason="This file was deleted.")
        return
    conn = Connection(websocket=websocket, user_id=user_id, username=username, project_id=project_id, file_id=code_file_id, role=role)
    await collab.join(room, conn)
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            data = message.get("bytes")
            if data is None:
                raise CollabError(4002, "Only binary messages are accepted.")
            await collab.receive(room, conn, data)
    except WebSocketDisconnect:
        pass
    except CollabError as e:
        await collab.close(conn, e.code, e.reason)
    finally:
        await collab.leave(room, conn)


async def shutdown() -> None:
    """Saves every open document and tells browsers to reconnect later."""
    await collab.flush_all()
    await collab.close_where(lambda room, conn: True, CLOSE_GOING_AWAY, "The server is restarting.")
