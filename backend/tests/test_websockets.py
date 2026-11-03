import pytest
from starlette.websockets import WebSocketDisconnect

import websocket_manager
from conftest import auth


@pytest.fixture
def setup(make_user, project_of):
    alice = make_user("alice")
    bob = make_user("bob")
    return {"alice": alice, "bob": bob, "pid": project_of(alice)}


def _rejected_code(client, path):
    try:
        with client.websocket_connect(path):
            return None
    except WebSocketDisconnect as e:
        return e.code


@pytest.mark.parametrize("kind", ["chat", "meeting"])
def test_socket_requires_valid_token_and_project_access(client, setup, kind):
    pid, alice, bob = setup["pid"], setup["alice"], setup["bob"]
    assert _rejected_code(client, f"/ws/projects/{pid}/{kind}") == 1008
    assert _rejected_code(client, f"/ws/projects/{pid}/{kind}?token=garbage") == 1008
    assert _rejected_code(client, f"/ws/projects/{pid}/{kind}?token={bob}") == 1008
    assert _rejected_code(client, f"/ws/projects/99999/{kind}?token={alice}") == 1008


def test_chat_username_comes_from_token(client, setup):
    with client.websocket_connect(f"/ws/projects/{setup['pid']}/chat?token={setup['alice']}") as ws:
        ws.send_json({"username": "mallory", "content": "  hi  "})
        message = ws.receive_json()
    assert message["username"] == "alice"
    assert message["content"] == "hi"


def test_chat_ignores_bad_frames_and_enforces_length(client, setup):
    with client.websocket_connect(f"/ws/projects/{setup['pid']}/chat?token={setup['alice']}") as ws:
        ws.send_text("not json")
        ws.send_json(["not", "an", "object"])
        ws.send_json({"content": "   "})
        ws.send_json({"content": "x" * 2001})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"content": "x" * 2000})
        assert len(ws.receive_json()["content"]) == 2000


def test_chat_broadcasts_to_every_socket_in_the_project(client, setup):
    url = f"/ws/projects/{setup['pid']}/chat?token={setup['alice']}"
    with client.websocket_connect(url) as first, client.websocket_connect(url) as second:
        first.send_json({"content": "to everyone"})
        assert first.receive_json()["content"] == "to everyone"
        assert second.receive_json()["content"] == "to everyone"


def test_meeting_relays_only_signals_and_never_to_chat(client, setup):
    pid, alice = setup["pid"], setup["alice"]
    with client.websocket_connect(f"/ws/projects/{pid}/chat?token={alice}") as chat, \
            client.websocket_connect(f"/ws/projects/{pid}/meeting?token={alice}") as peer_a, \
            client.websocket_connect(f"/ws/projects/{pid}/meeting?token={alice}") as peer_b:
        peer_a.send_json({"type": "not-a-signal"})
        peer_a.send_text("{bad json")
        peer_a.send_json({"type": "offer", "sdp": "v=0"})
        assert peer_b.receive_json() == {"type": "offer", "sdp": "v=0"}
        chat.send_json({"content": "after the offer"})
        assert chat.receive_json()["content"] == "after the offer"
        assert len(websocket_manager.video_manager.active_connections[pid]) == 2
        assert len(websocket_manager.manager.active_connections[pid]) == 1
    assert pid not in websocket_manager.manager.active_connections
    assert pid not in websocket_manager.video_manager.active_connections


def test_meeting_drops_oversized_frames(client, setup):
    pid, alice = setup["pid"], setup["alice"]
    url = f"/ws/projects/{pid}/meeting?token={alice}"
    with client.websocket_connect(url) as peer_a, client.websocket_connect(url) as peer_b:
        peer_a.send_json({"type": "offer", "sdp": "x" * (70 * 1024)})
        peer_a.send_json({"type": "answer", "sdp": "small"})
        assert peer_b.receive_json() == {"type": "answer", "sdp": "small"}


def test_chat_messages_are_persisted(client, setup):
    pid, alice = setup["pid"], setup["alice"]
    with client.websocket_connect(f"/ws/projects/{pid}/chat?token={alice}") as ws:
        ws.send_json({"content": "saved"})
        ws.receive_json()
    messages = client.get(f"/projects/{pid}/messages", headers=auth(alice)).json()["messages"]
    assert [(m["username"], m["content"]) for m in messages] == [("alice", "saved")]
