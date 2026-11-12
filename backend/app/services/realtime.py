from fastapi import WebSocket


class _RoomManager:
    """Tracks open WebSockets per project and sends to them safely."""

    def __init__(self):
        # Maps project_id -> list of currently connected WebSocket clients
        self.active_connections: dict[int, list[WebSocket]] = {}
        # Which user each socket belongs to, and their display name
        self.socket_users: dict[WebSocket, int] = {}
        self.usernames: dict[int, str] = {}

    async def connect(self, websocket: WebSocket, project_id: int, user_id: int, username: str = ""):
        await websocket.accept()
        self.active_connections.setdefault(project_id, []).append(websocket)
        self.socket_users[websocket] = user_id
        self.usernames[user_id] = username

    def online_users(self, project_id: int) -> list[dict]:
        """Everyone with at least one open socket here (several tabs count once)."""
        ids = {self.socket_users.get(c) for c in self.active_connections.get(project_id, [])} - {None}
        return sorted(({"user_id": i, "username": self.usernames.get(i, "")} for i in ids), key=lambda u: u["username"])

    def disconnect(self, websocket: WebSocket, project_id: int):
        self.socket_users.pop(websocket, None)
        connections = self.active_connections.get(project_id)
        if connections is None:
            return
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            del self.active_connections[project_id]

    async def kick(self, project_id: int, user_id: int):
        """Closes the user's sockets in this project (they lost access)."""
        for connection in list(self.active_connections.get(project_id, [])):
            if self.socket_users.get(connection) == user_id:
                self.disconnect(connection, project_id)
                try:
                    await connection.close(code=1008)
                except Exception:
                    pass  # already gone

    async def _send_all(self, project_id: int, message: dict, skip: WebSocket | None = None):
        # Copy the list: disconnect() may modify it while we're sending.
        for connection in list(self.active_connections.get(project_id, [])):
            if connection is skip:
                continue
            try:
                await connection.send_json(message)
            except Exception:
                # A dead socket shouldn't break delivery to everyone else
                self.disconnect(connection, project_id)


# --- CHAT MANAGER ---
class ConnectionManager(_RoomManager):
    async def broadcast(self, project_id: int, message: dict):
        await self._send_all(project_id, message)

    async def broadcast_except(self, project_id: int, sender_ws: WebSocket, message: dict):
        await self._send_all(project_id, message, skip=sender_ws)

    async def broadcast_presence(self, project_id: int):
        await self._send_all(project_id, {"type": "presence", "users": self.online_users(project_id)})

    async def kick(self, project_id: int, user_id: int):
        await super().kick(project_id, user_id)
        await self.broadcast_presence(project_id)


manager = ConnectionManager()
