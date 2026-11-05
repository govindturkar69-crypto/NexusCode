from fastapi import WebSocket


class _RoomManager:
    """Tracks open WebSockets per project and sends to them safely."""

    def __init__(self):
        # Maps project_id -> list of currently connected WebSocket clients
        self.active_connections: dict[int, list[WebSocket]] = {}
        # Which user each socket belongs to
        self.socket_users: dict[WebSocket, int] = {}

    async def connect(self, websocket: WebSocket, project_id: int, user_id: int):
        await websocket.accept()
        self.active_connections.setdefault(project_id, []).append(websocket)
        self.socket_users[websocket] = user_id

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


# --- VIDEO MEETING (WebRTC SIGNALING) MANAGER ---
class VideoMeetingManager(_RoomManager):
    def join_if_room(self, websocket: WebSocket, project_id: int, user_id: int, max_peers: int) -> int | None:
        """Adds an already-accepted socket to the room unless it is full.
        Returns how many peers were already there, or None if full. No await
        between the check and the add, so two joiners can't both squeeze in."""
        room = self.active_connections.setdefault(project_id, [])
        if len(room) >= max_peers:
            return None
        room.append(websocket)
        self.socket_users[websocket] = user_id
        return len(room) - 1

    async def broadcast_to_peer(self, project_id: int, sender_ws: WebSocket, message: dict):
        """Sends WebRTC signals (offer, answer, candidates) only to the OTHER peer"""
        await self._send_all(project_id, message, skip=sender_ws)


manager = ConnectionManager()
video_manager = VideoMeetingManager()
