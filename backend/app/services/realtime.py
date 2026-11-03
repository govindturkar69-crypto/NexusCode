
from fastapi import WebSocket


class _RoomManager:
    """Tracks open WebSockets per project and sends to them safely."""

    def __init__(self):
        # Maps project_id -> list of currently connected WebSocket clients
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: int):
        await websocket.accept()
        self.active_connections.setdefault(project_id, []).append(websocket)

    def disconnect(self, websocket: WebSocket, project_id: int):
        connections = self.active_connections.get(project_id)
        if connections is None:
            return
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            del self.active_connections[project_id]

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
    def join_if_room(self, websocket: WebSocket, project_id: int, max_peers: int) -> int | None:
        """Adds an already-accepted socket to the room unless it is full.
        Returns how many peers were already there, or None if full. No await
        between the check and the add, so two joiners can't both squeeze in."""
        room = self.active_connections.setdefault(project_id, [])
        if len(room) >= max_peers:
            if not room:
                del self.active_connections[project_id]
            return None
        room.append(websocket)
        return len(room) - 1

    async def broadcast_to_peer(self, project_id: int, sender_ws: WebSocket, message: dict):
        """Sends WebRTC signals (offer, answer, candidates) only to the OTHER peer"""
        await self._send_all(project_id, message, skip=sender_ws)


manager = ConnectionManager()
video_manager = VideoMeetingManager()
