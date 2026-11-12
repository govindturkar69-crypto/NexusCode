import pytest
from conftest import auth, open_socket, ws_path
from starlette.websockets import WebSocketDisconnect

from app.core import security


@pytest.fixture
def setup(make_user, project_of):
    alice = make_user("alice")
    bob = make_user("bob")
    return {"alice": alice, "bob": bob, "pid": project_of(alice), "bob_pid": project_of(bob)}


def _rejected_code(client, path):
    try:
        with client.websocket_connect(path):
            return None
    except WebSocketDisconnect as e:
        return e.code


def test_ticket_requires_login_and_project_ownership(client, setup):
    assert client.post("/ws-ticket", json={"project_id": setup["pid"]}).status_code == 401
    r = client.post("/ws-ticket", json={"project_id": setup["pid"]}, headers=auth(setup["bob"]))
    assert r.status_code == 404
    r = client.post("/ws-ticket", json={"project_id": setup["pid"]}, headers=auth(setup["alice"]))
    assert r.status_code == 200 and r.json()["expires_in"] == 30


def test_socket_refuses_missing_bad_or_foreign_credentials(client, setup):
    pid, alice = setup["pid"], setup["alice"]
    kind = "chat"
    assert _rejected_code(client, f"/ws/projects/{pid}/{kind}") == 1008
    assert _rejected_code(client, f"/ws/projects/{pid}/{kind}?ticket=garbage") == 1008
    # The long-lived login token is no longer accepted in the URL
    assert _rejected_code(client, f"/ws/projects/{pid}/{kind}?token={alice}") == 1008
    assert _rejected_code(client, f"/ws/projects/{pid}/{kind}?ticket={alice}") == 1008
    # A valid ticket for bob's project can't open alice's
    bob_path = ws_path(client, setup["bob"], setup["bob_pid"], kind)
    assert _rejected_code(client, bob_path.replace(f"/projects/{setup['bob_pid']}/", f"/projects/{pid}/")) == 1008


def test_ticket_works_once(client, setup):
    path = ws_path(client, setup["alice"], setup["pid"])
    with client.websocket_connect(path):
        pass
    assert _rejected_code(client, path) == 1008


def test_expired_ticket_is_refused(client, setup, monkeypatch):
    monkeypatch.setattr(security, "WS_TICKET_TTL_SECONDS", -1)
    path = ws_path(client, setup["alice"], setup["pid"])
    assert _rejected_code(client, path) == 1008


def test_ticket_refused_after_ownership_is_lost(client, setup):
    path = ws_path(client, setup["alice"], setup["pid"])
    client.delete(f"/projects/{setup['pid']}", headers=auth(setup["alice"]))
    assert _rejected_code(client, path) == 1008


def test_chat_username_comes_from_ticket(client, setup):
    with open_socket(client, setup["alice"], setup["pid"]) as ws:
        ws.send_json({"username": "mallory", "content": "  hi  "})
        message = ws.receive_json()
    assert message["username"] == "alice"
    assert message["content"] == "hi"


def test_chat_ignores_bad_frames_and_enforces_length(client, setup):
    with open_socket(client, setup["alice"], setup["pid"]) as ws:
        ws.send_text("not json")
        ws.send_json(["not", "an", "object"])
        ws.send_json({"content": "   "})
        ws.send_json({"content": "x" * 2001})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"content": "x" * 2000})
        assert len(ws.receive_json()["content"]) == 2000


def test_chat_broadcasts_to_every_socket_in_the_project(client, setup):
    alice, pid = setup["alice"], setup["pid"]
    with open_socket(client, alice, pid) as first, open_socket(client, alice, pid) as second:
        first.send_json({"content": "to everyone"})
        assert first.receive_json()["content"] == "to everyone"
        assert second.receive_json()["content"] == "to everyone"


def test_the_old_meeting_socket_is_gone(client, setup):
    """Video moved to LiveKit (POST /projects/{id}/meeting/token); the backend no
    longer relays WebRTC signals, even for a member with a valid ticket."""
    path = ws_path(client, setup["alice"], setup["pid"]).replace("/chat?", "/meeting?")
    assert _rejected_code(client, path) is not None


def test_chat_messages_are_persisted(client, setup):
    pid, alice = setup["pid"], setup["alice"]
    with open_socket(client, alice, pid) as ws:
        ws.send_json({"content": "saved"})
        ws.receive_json()
    messages = client.get(f"/projects/{pid}/messages", headers=auth(alice)).json()["messages"]
    assert [(m["username"], m["content"]) for m in messages] == [("alice", "saved")]


def test_ws_ticket_is_rate_limited(client, setup, rate_limits):
    from app.core.rate_limit import WS_TICKET_LIMIT

    limit = int(WS_TICKET_LIMIT.split("/")[0])
    codes = [client.post("/ws-ticket", json={"project_id": setup["pid"]}, headers=auth(setup["alice"])).status_code for _ in range(limit + 1)]
    assert codes[:limit] == [200] * limit
    assert codes[-1] == 429
