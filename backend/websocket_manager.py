from fastapi import WebSocket
from typing import Dict, List

# --- CHAT MANAGER ---
class ConnectionManager:
    def __init__(self):
        # Maps project_id -> list of currently connected WebSocket clients
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: int):
        await websocket.accept()
        if project_id not in self.active_connections:
            self.active_connections[project_id] = []
        self.active_connections[project_id].append(websocket)

    def disconnect(self, websocket: WebSocket, project_id: int):
        if project_id in self.active_connections:
            if websocket in self.active_connections[project_id]:
                self.active_connections[project_id].remove(websocket)

    async def broadcast(self, project_id: int, message: dict):
        if project_id in self.active_connections:
            for connection in self.active_connections[project_id]:
                await connection.send_json(message)


# --- VIDEO MEETING (WebRTC SIGNALING) MANAGER ---
class VideoMeetingManager:
    def __init__(self):
        # Maps project_id -> list of active WebSockets in meeting room
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: int):
        await websocket.accept()
        if project_id not in self.active_connections:
            self.active_connections[project_id] = []
        self.active_connections[project_id].append(websocket)

    def disconnect(self, websocket: WebSocket, project_id: int):
        if project_id in self.active_connections:
            if websocket in self.active_connections[project_id]:
                self.active_connections[project_id].remove(websocket)
            if not self.active_connections[project_id]:
                del self.active_connections[project_id]

    async def broadcast_to_peer(self, project_id: int, sender_ws: WebSocket, message: dict):
        """Sends WebRTC signals (offer, answer, candidates) only to the OTHER peer"""
        if project_id in self.active_connections:
            for connection in self.active_connections[project_id]:
                if connection != sender_ws:
                    await connection.send_json(message)


manager = ConnectionManager()
video_manager = VideoMeetingManager()