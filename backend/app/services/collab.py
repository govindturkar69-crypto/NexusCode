"""
Real-time collaborative editing: one Yjs document per code file, kept on the
server with pycrdt (the Python binding of Yrs, the Rust port of Yjs).

Browsers talk the standard y-websocket protocol (y-protocols sync and awareness)
over /ws/code-files/{id}. Because the server holds a real document it can answer
sync requests itself, check every update before it's applied (editors only, size
limits), and write the text back to code_files.content so everything else that
reads files (GitHub push, the AI, the agent, Run) sees the latest version.

Rooms live in this process's memory and are loaded on first use: from the file's
saved Yjs state (code_file_yjs), or, the first time a file is opened, from
code_files.content. That's the lazy backfill. A room is saved 2 s after the last
change, when the last person leaves (and then unloaded), and on shutdown. Saving
the Yjs state, not just the text, is what lets a browser that was offline, or
connected across a restart, merge its changes into the same document instead of
a rebuilt one.

Other writers (the REST save used when live editing isn't available, the legacy
single-file API) go through replace_text, so their change lands in the document
and reaches everyone who's live. Everything here runs on the event loop; database
work goes to a worker thread.
"""
import asyncio
import json
import logging
import re
from dataclasses import dataclass, field

from fastapi import WebSocket
from pycrdt import (
    Decoder,
    Doc,
    Text,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)
from starlette.concurrency import run_in_threadpool

from app.schemas.project import MAX_CODE_FILE_CHARS

logger = logging.getLogger("nexuscode")

TEXT_NAME = "content"  # the Y.Text the editor binds to

# Our own message type, next to y-protocols' sync (0), awareness (1), auth (2) and
# query-awareness (3): tells the browser its role and user name.
MESSAGE_AUTH = 2
MESSAGE_QUERY_AWARENESS = 3
MESSAGE_SESSION = 100

SAVE_DELAY_SECONDS = 2.0  # quiet time before the text is written to the database

# Close codes the browser understands (4000-4999 are for applications)
CLOSE_NO_ACCESS = 4001
CLOSE_BAD_MESSAGE = 4002
CLOSE_ROLE_CHANGED = 4003
CLOSE_FILE_DELETED = 4004
CLOSE_RATE_LIMITED = 4008
CLOSE_TOO_LARGE = 4009
CLOSE_TOO_MANY = 4013
CLOSE_GOING_AWAY = 1001


# ---- y-protocols encoding (lib0 variable-length integers and strings) ----

def write_var_uint(value: int) -> bytes:
    out = bytearray()
    while value > 0x7F:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    out.append(value)
    return bytes(out)


def write_var_bytes(data: bytes) -> bytes:
    return write_var_uint(len(data)) + data


def write_var_string(text: str) -> bytes:
    return write_var_bytes(text.encode("utf-8"))


def session_message(role: str, username: str) -> bytes:
    return write_var_uint(MESSAGE_SESSION) + write_var_string(json.dumps({"role": role, "username": username}))


# ---- awareness (who is here, their cursor) ----

def decode_awareness(update: bytes) -> list[tuple[int, int, str]]:
    """[(client id, clock, state JSON)] from an awareness update."""
    decoder = Decoder(update)
    count = decoder.read_var_uint()
    return [(decoder.read_var_uint(), decoder.read_var_uint(), decoder.read_var_string()) for _ in range(count)]


def encode_awareness(entries: list[tuple[int, int, str]]) -> bytes:
    body = write_var_uint(len(entries))
    for client_id, clock, state in entries:
        body += write_var_uint(client_id) + write_var_uint(clock) + write_var_string(state)
    return body


def awareness_message(update: bytes) -> bytes:
    return write_var_uint(YMessageType.AWARENESS) + write_var_bytes(update)


HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

# The client id that writes a file's starting text into its new document
BACKFILL_CLIENT_ID = 1


def backfill_update(content: str) -> bytes:
    """The update that puts `content` into an empty document. Always made by the same
    client id, so it's the same bytes for the same text: if a document had to be
    rebuilt from the text (its saved state lost), a browser still holding the old
    one sees items it already has, and the text isn't doubled."""
    doc = Doc(client_id=BACKFILL_CLIENT_ID)
    doc.get(TEXT_NAME, type=Text).insert(0, content)
    return doc.get_update()


@dataclass(eq=False)
class Connection:
    websocket: WebSocket
    user_id: int
    username: str
    project_id: int
    file_id: int
    role: str  # "editor" (also owners) or "viewer"
    client_ids: set[int] = field(default_factory=set)

    @property
    def can_edit(self) -> bool:
        return self.role == "editor"


@dataclass(eq=False)
class Room:
    file_id: int
    project_id: int
    doc: Doc
    connections: set[Connection] = field(default_factory=set)
    # client id -> (clock, state JSON, owning connection)
    awareness: dict[int, tuple[int, str, Connection]] = field(default_factory=dict)
    dirty: bool = False
    save_task: asyncio.Task | None = None

    @property
    def text(self) -> Text:
        return self.doc.get(TEXT_NAME, type=Text)


class CollabError(Exception):
    """A message that ends the connection. code is the close code to use."""

    def __init__(self, code: int, reason: str):
        super().__init__(reason)
        self.code = code
        self.reason = reason


class CollabManager:
    """
    The rooms of this process. Storage is plugged in, so tests and the router
    can share one manager:
      load(file_id)                 -> (project id, Yjs state bytes or None, content) or None
      save(file_id, text, state)    writes the text (and the state) to the database
    """

    def __init__(self, load, save):
        self._load = load
        self._save = save
        self.rooms: dict[int, Room] = {}
        self._loading: dict[int, asyncio.Lock] = {}

    # ---- rooms ----

    async def room(self, file_id: int) -> Room | None:
        if file_id in self.rooms:
            return self.rooms[file_id]
        lock = self._loading.setdefault(file_id, asyncio.Lock())
        async with lock:
            if file_id in self.rooms:
                return self.rooms[file_id]
            loaded = await run_in_threadpool(self._load, file_id)
            if loaded is None:
                return None
            project_id, state, content = loaded
            doc = Doc()
            room = Room(file_id=file_id, project_id=project_id, doc=doc)
            if state:
                doc.apply_update(state)
            elif content:
                # First open: the saved text becomes the start of the document, and is
                # saved straight away
                doc.apply_update(backfill_update(content))
                room.dirty = True
            self.rooms[file_id] = room
            await self.flush(room)
            return room

    def connections_for_user(self, user_id: int) -> int:
        return sum(1 for room in self.rooms.values() for conn in room.connections if conn.user_id == user_id)

    def connections_for_project(self, project_id: int) -> int:
        return sum(len(room.connections) for room in self.rooms.values() if room.project_id == project_id)

    async def join(self, room: Room, conn: Connection) -> None:
        room.connections.add(conn)
        await self._send(conn, session_message(conn.role, conn.username))
        # Our state vector, so the browser sends what we're missing (edits made offline)
        await self._send(conn, create_sync_message(room.doc))
        if room.awareness:
            await self._send(conn, awareness_message(encode_awareness([(cid, clock, state) for cid, (clock, state, _) in room.awareness.items()])))

    async def leave(self, room: Room, conn: Connection) -> None:
        room.connections.discard(conn)
        gone = [(cid, clock + 1, "null") for cid, (clock, _state, owner) in room.awareness.items() if owner is conn]
        for cid, _clock, _state in gone:
            room.awareness.pop(cid, None)
        if gone:
            await self._broadcast(room, awareness_message(encode_awareness(gone)), skip=conn)
        if not room.connections:
            await self.flush(room)
            self._unload_if_idle(room)

    # ---- messages ----

    async def receive(self, room: Room, conn: Connection, message: bytes) -> None:
        if not message:
            raise CollabError(CLOSE_BAD_MESSAGE, "Empty message.")
        kind = message[0]
        try:
            if kind == YMessageType.SYNC:
                await self._sync(room, conn, message)
            elif kind == YMessageType.AWARENESS:
                await self._awareness(room, conn, Decoder(message[1:]).read_message())
            elif kind == MESSAGE_QUERY_AWARENESS:
                entries = [(cid, clock, state) for cid, (clock, state, _) in room.awareness.items()]
                await self._send(conn, awareness_message(encode_awareness(entries)))
            elif kind == MESSAGE_AUTH:
                pass
            else:
                raise CollabError(CLOSE_BAD_MESSAGE, "Unknown message type.")
        except CollabError:
            raise
        except Exception as e:
            raise CollabError(CLOSE_BAD_MESSAGE, "That message couldn't be read.") from e

    async def _sync(self, room: Room, conn: Connection, message: bytes) -> None:
        sync_type = message[1]
        if sync_type == YSyncMessageType.SYNC_STEP1:
            reply = handle_sync_message(message[1:], room.doc)
            if reply:
                await self._send(conn, reply)
            return
        if sync_type not in (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE):
            raise CollabError(CLOSE_BAD_MESSAGE, "Unknown sync message.")
        update = Decoder(message[2:]).read_message()
        if not conn.can_edit:
            # A viewer's browser answers our sync request too; there's nothing to take from it
            return
        before = room.doc.get_state()
        self.check_size(room, update)
        room.doc.apply_update(update)
        if room.doc.get_state() == before:
            return  # nothing new (already had it)
        room.dirty = True
        self._schedule_save(room)
        await self._broadcast(room, create_update_message(update), skip=conn)

    def check_size(self, room: Room, update: bytes) -> None:
        """Refuses an update that would make the text too long. An update can't add
        more characters than it has bytes, so most are cleared without trying."""
        if len(room.text) + len(update) <= MAX_CODE_FILE_CHARS:
            return
        trial = Doc()
        trial.apply_update(room.doc.get_update())
        trial.apply_update(update)
        if len(trial.get(TEXT_NAME, type=Text)) > MAX_CODE_FILE_CHARS:
            raise CollabError(CLOSE_TOO_LARGE, f"Files can be at most {MAX_CODE_FILE_CHARS:,} characters.")

    async def _awareness(self, room: Room, conn: Connection, update: bytes) -> None:
        entries = []
        for client_id, clock, state in decode_awareness(update):
            owner = room.awareness.get(client_id)
            if owner is not None and owner[2] is not conn:
                continue  # another connection's client: can't be changed from here
            if state == "null":
                room.awareness.pop(client_id, None)
                conn.client_ids.discard(client_id)
            else:
                state = self._stamp(state, conn)
                room.awareness[client_id] = (clock, state, conn)
                conn.client_ids.add(client_id)
            entries.append((client_id, clock, state))
        if entries:
            # To everyone, the sender included, like the reference y-websocket server:
            # browsers renew their state every 15 s, and a browser that hears nothing
            # for 30 s assumes the connection is dead and reconnects
            await self._broadcast(room, awareness_message(encode_awareness(entries)))

    @staticmethod
    def _stamp(state: str, conn: Connection) -> str:
        """The name shown on a cursor is the signed-in user's, whatever the browser sent."""
        try:
            data = json.loads(state)
        except ValueError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        user = data.get("user") if isinstance(data.get("user"), dict) else {}
        # It ends up in other people's CSS, so only a plain #rrggbb gets through
        color = user.get("color") if isinstance(user.get("color"), str) and HEX_COLOR.match(user["color"]) else "#888888"
        data["user"] = {"name": conn.username, "color": color, "role": conn.role}
        return json.dumps(data)

    # ---- sending ----

    async def _send(self, conn: Connection, data: bytes) -> bool:
        try:
            await conn.websocket.send_bytes(data)
            return True
        except Exception:
            return False

    async def _broadcast(self, room: Room, data: bytes, skip: Connection | None = None) -> None:
        for other in list(room.connections):
            if other is not skip:
                await self._send(other, data)

    # ---- saving ----

    def _schedule_save(self, room: Room) -> None:
        if room.save_task and not room.save_task.done():
            room.save_task.cancel()
        room.save_task = asyncio.get_running_loop().create_task(self._save_later(room))

    async def _save_later(self, room: Room) -> None:
        try:
            await asyncio.sleep(SAVE_DELAY_SECONDS)
        except asyncio.CancelledError:
            return
        await self.flush(room)

    async def flush(self, room: Room) -> None:
        """Writes the room's text (and state) now, if it changed."""
        if not room.dirty:
            return
        room.dirty = False
        text, state = str(room.text), room.doc.get_update()
        try:
            await run_in_threadpool(self._save, room.file_id, text, state)
        except Exception:
            room.dirty = True
            logger.exception("Couldn't save collaborative file %s", room.file_id)

    async def flush_all(self) -> None:
        for room in list(self.rooms.values()):
            await self.flush(room)

    async def flush_file(self, file_id: int) -> None:
        room = self.rooms.get(file_id)
        if room is not None:
            await self.flush(room)

    async def flush_project(self, project_id: int) -> None:
        """Before something reads the project's files from the database."""
        for room in list(self.rooms.values()):
            if room.project_id == project_id:
                await self.flush(room)

    def _unload_if_idle(self, room: Room) -> None:
        if room.connections or room.dirty or self.rooms.get(room.file_id) is not room:
            return
        if room.save_task and not room.save_task.done():
            room.save_task.cancel()
        del self.rooms[room.file_id]

    # ---- changes from outside the editor ----

    async def replace_text(self, file_id: int, text: str) -> bool:
        """Makes the file's text `text`, through its document, changing only the part
        that differs so other people's cursors stay put. Saved before returning.
        False if the file doesn't exist."""
        room = await self.room(file_id)
        if room is None:
            return False
        current = str(room.text)
        if current != text:
            start = 0
            while start < len(current) and start < len(text) and current[start] == text[start]:
                start += 1
            end = 0
            while end < len(current) - start and end < len(text) - start and current[-1 - end] == text[-1 - end]:
                end += 1
            before = room.doc.get_state()
            with room.doc.transaction(origin="server"):
                if len(current) - start - end > 0:
                    del room.text[start:len(current) - end]
                inserted = text[start:len(text) - end]
                if inserted:
                    room.text.insert(start, inserted)
            room.dirty = True
            await self._broadcast(room, create_update_message(room.doc.get_update(before)))
        await self.flush(room)
        self._unload_if_idle(room)
        return True

    # ---- files that went away ----

    async def drop_files(self, file_ids: list[int]) -> None:
        """The files were deleted: their editors are told, and nothing more is saved."""
        for file_id in file_ids:
            room = self.rooms.pop(file_id, None)
            if room is None:
                continue
            room.dirty = False
            if room.save_task and not room.save_task.done():
                room.save_task.cancel()
            for conn in list(room.connections):
                await self.close(conn, CLOSE_FILE_DELETED, "This file was deleted.")

    async def drop_project(self, project_id: int) -> None:
        await self.drop_files([file_id for file_id, room in self.rooms.items() if room.project_id == project_id])

    # ---- closing ----

    async def close(self, conn: Connection, code: int, reason: str = "") -> None:
        try:
            await conn.websocket.close(code=code, reason=reason[:120])
        except Exception:
            pass

    async def close_where(self, predicate, code: int, reason: str) -> int:
        closed = 0
        for room in list(self.rooms.values()):
            for conn in list(room.connections):
                if predicate(room, conn):
                    await self.close(conn, code, reason)
                    closed += 1
        return closed

