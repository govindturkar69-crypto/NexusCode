"""
A Yjs client for tests: a pycrdt document talking the same y-websocket protocol
a browser does (y-protocols sync and awareness), over the test client's WebSocket.
"""
import json

from conftest import auth
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

from app.routers import collab as collab_router
from app.services.collab import (
    MESSAGE_SESSION,
    TEXT_NAME,
    awareness_message,
    decode_awareness,
    encode_awareness,
)


def ticket_for(client, token, project_id):
    r = client.post("/ws-ticket", json={"project_id": project_id}, headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()["ticket"]


class YClient:
    def __init__(self, client, token, project_id, file_id, *, ticket=None, sync=True):
        self._client = client
        ticket = ticket or ticket_for(client, token, project_id)
        self._context = client.websocket_connect(f"/ws/code-files/{file_id}?ticket={ticket}")
        self.ws = self._context.__enter__()
        self.doc = Doc()
        self.text = self.doc.get(TEXT_NAME, type=Text)
        self.updates = []
        self.awareness = {}
        self.doc.observe(lambda event: self.updates.append(event.update))
        try:
            first = self.ws.receive_bytes()
            assert first[0] == MESSAGE_SESSION, first[:4]
            self.session = json.loads(Decoder(first[1:]).read_var_string())
            if sync:
                self.handshake()
        except BaseException:
            # Refused or closed straight away: leave the socket's context, or the
            # test client waits for it forever
            self._context.__exit__(None, None, None)
            self.settle()
            raise

    def handshake(self):
        # The server asks for what it's missing; then we ask for everything it has
        server_step1 = self.ws.receive_bytes()
        assert server_step1[:2] == bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP1])
        self.ws.send_bytes(handle_sync_message(server_step1[1:], self.doc))
        self.ws.send_bytes(create_sync_message(self.doc))
        self.receive_until_synced()

    def receive_until_synced(self):
        while True:
            message = self.receive()
            if message[:2] == bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP2]):
                return

    def receive(self):
        """Reads one message and applies it."""
        message = self.ws.receive_bytes()
        if message[0] == YMessageType.SYNC and message[1] != YSyncMessageType.SYNC_STEP1:
            handle_sync_message(message[1:], self.doc)
        elif message[0] == YMessageType.AWARENESS:
            for client_id, _clock, state in decode_awareness(Decoder(message[1:]).read_message()):
                self.awareness[client_id] = json.loads(state)
        return message

    def edit(self, index, text):
        """Types locally and sends the change, as y-monaco + y-websocket would."""
        start = len(self.updates)
        self.text.insert(index, text)
        for update in self.updates[start:]:
            self.ws.send_bytes(create_update_message(update))

    def round_trip(self):
        """Waits until the server has handled everything this client sent. It reads
        one socket's messages in order, so once it answers a sync request sent after
        them, they've all been applied."""
        self.ws.send_bytes(create_sync_message(self.doc))
        self.receive_until_synced()

    def delete(self, index, length):
        start = len(self.updates)
        del self.text[index:index + length]
        for update in self.updates[start:]:
            self.ws.send_bytes(create_update_message(update))

    def set_awareness(self, client_id, clock, state):
        self.ws.send_bytes(awareness_message(encode_awareness([(client_id, clock, json.dumps(state))])))

    def close(self):
        self._context.__exit__(None, None, None)
        self.settle()

    def settle(self):
        """The test client cancels the server's handler when a socket closes, which
        uvicorn doesn't. Wait for its clean-up (saving included) to finish, as it
        would in a real server, before the test looks at the database."""
        self._client.portal.call(collab_router.collab.settle)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
