"""Collaborative editing: limits, isolation, and access changes on open connections."""
import json

import pytest
from collab_client import YClient
from conftest import DEFAULT_PASSWORD, add_member, auth
from pycrdt import Decoder
from starlette.websockets import WebSocketDisconnect

from app.core.database import SessionLocal
from app.models import CodeFileModel, ProjectMemberModel, UserModel
from app.routers import collab as collab_router
from app.services import collab as collab_service

ROOMS = collab_router.collab.rooms


@pytest.fixture(autouse=True)
def fast_saves(monkeypatch):
    monkeypatch.setattr(collab_service, "SAVE_DELAY_SECONDS", 0.01)
    yield
    ROOMS.clear()


@pytest.fixture
def owner(make_user):
    return make_user("olivia")


@pytest.fixture
def project(owner, project_of):
    return project_of(owner)


def new_file(client, token, project, path="main.py", content="print('hi')\n"):
    r = client.post(f"/projects/{project}/code/files", json={"path": path, "content": content}, headers=auth(token))
    assert r.status_code == 201, r.text
    return r.json()["code_file"]["id"]


@pytest.fixture
def code_file(client, owner, project):
    return new_file(client, owner, project)


def member(client, make_user, project, username, role):
    make_user(username)
    add_member(username, project, role)
    return client.post("/login", data={"username": username, "password": DEFAULT_PASSWORD}).json()["access_token"]


def user_id(username):
    with SessionLocal() as db:
        return db.query(UserModel.id).filter(UserModel.username == username).scalar()


def content_of(file_id):
    with SessionLocal() as db:
        return db.get(CodeFileModel, file_id).content


def closed_with(client_like):
    with pytest.raises(WebSocketDisconnect) as info:
        for _ in range(20):
            client_like.receive()
    return info.value.code


def session_role(message):
    assert message[0] == collab_service.MESSAGE_SESSION
    return json.loads(Decoder(message[1:]).read_var_string())["role"]


# ---- sizes ----

def test_a_document_can_not_grow_past_the_limit(client, owner, project, code_file, monkeypatch):
    monkeypatch.setattr(collab_service, "MAX_CODE_FILE_CHARS", 40)
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "x" * 60)
        assert closed_with(alice) == collab_service.CLOSE_TOO_LARGE
    assert content_of(code_file) == "print('hi')\n"


def test_an_update_near_the_limit_is_checked_exactly(client, owner, project, code_file, monkeypatch):
    # Text + update bytes is over the limit, but the text itself stays under it
    monkeypatch.setattr(collab_service, "MAX_CODE_FILE_CHARS", 40)
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "y" * 20)
        alice.set_awareness(1, 1, {})
        alice.receive()
    assert content_of(code_file) == "y" * 20 + "print('hi')\n"


def test_an_oversized_message_closes_the_connection(client, owner, project, code_file, monkeypatch):
    monkeypatch.setattr(collab_service, "MAX_MESSAGE_BYTES", 100)
    with YClient(client, owner, project, code_file) as alice:
        alice.ws.send_bytes(b"\x01" + b"\x00" * 200)
        assert closed_with(alice) == collab_service.CLOSE_TOO_LARGE


# ---- rates ----

def test_flooding_messages_closes_the_connection(client, owner, project, code_file, monkeypatch):
    monkeypatch.setattr(collab_service, "RATE_MESSAGES_BURST", 8)
    monkeypatch.setattr(collab_service, "RATE_MESSAGES_PER_SECOND", 0.001)
    with YClient(client, owner, project, code_file) as alice:
        for i in range(12):
            alice.set_awareness(1, i + 1, {"n": i})
        assert closed_with(alice) == collab_service.CLOSE_RATE_LIMITED


def test_flooding_bytes_closes_the_connection(client, owner, project, code_file, monkeypatch):
    monkeypatch.setattr(collab_service, "RATE_BYTES_BURST", 3000)
    monkeypatch.setattr(collab_service, "RATE_BYTES_PER_SECOND", 1)
    with YClient(client, owner, project, code_file) as alice:
        for _ in range(5):
            alice.edit(0, "z" * 1000)
        assert closed_with(alice) == collab_service.CLOSE_RATE_LIMITED


def test_normal_typing_is_well_within_the_limits(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        for i, ch in enumerate("def add(a, b):\n    return a + b\n"):
            alice.edit(i, ch)
            alice.set_awareness(1, i + 1, {"cursor": i})
        alice.set_awareness(1, 999, {})
        while True:
            message = alice.receive()
            if message[0] == 1 and alice.awareness.get(1) == {"user": {"name": "olivia", "color": "#888888", "role": "editor"}}:
                break
    assert content_of(code_file).startswith("def add(a, b):")


# ---- connections ----

def test_a_user_can_only_have_so_many_files_open_live(client, owner, project, monkeypatch):
    monkeypatch.setattr(collab_service, "MAX_CONNECTIONS_PER_USER", 2)
    files = [new_file(client, owner, project, f"f{i}.py") for i in range(3)]
    with YClient(client, owner, project, files[0]), YClient(client, owner, project, files[1]):
        with pytest.raises(WebSocketDisconnect) as info:
            YClient(client, owner, project, files[2])
        assert info.value.code == collab_service.CLOSE_TOO_MANY
    # Closing one makes room again
    YClient(client, owner, project, files[2]).close()


def test_a_project_can_only_have_so_many_live_connections(client, owner, project, code_file, make_user, monkeypatch):
    monkeypatch.setattr(collab_service, "MAX_CONNECTIONS_PER_PROJECT", 2)
    eddie = member(client, make_user, project, "eddie", "editor")
    frank = member(client, make_user, project, "frank", "editor")
    with YClient(client, owner, project, code_file), YClient(client, eddie, project, code_file):
        with pytest.raises(WebSocketDisconnect) as info:
            YClient(client, frank, project, code_file)
        assert info.value.code == collab_service.CLOSE_TOO_MANY


def test_leaving_is_clean(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file):
        YClient(client, eddie, project, code_file).close()
        room = ROOMS[code_file]
        assert {c.username for c in room.connections} == {"olivia"}
    assert code_file not in ROOMS


# ---- isolation ----

def test_nothing_crosses_between_files_or_projects(client, owner, project, code_file, project_of):
    other_project = project_of(owner, "Other")
    other_file = new_file(client, owner, other_project, "secret.py", "token = 'x'\n")
    with YClient(client, owner, project, code_file) as here, YClient(client, owner, other_project, other_file) as there:
        here.edit(0, "# here\n")
        here.set_awareness(10, 1, {"cursor": "here"})
        # A message of our own, echoed back: anything from the other room would have come first
        there.set_awareness(20, 1, {"cursor": "there"})
        message = there.receive()
        assert message[0] == 1 and set(there.awareness) == {20}
        assert str(there.text) == "token = 'x'\n"
    assert content_of(other_file) == "token = 'x'\n"


# ---- access changing while connected ----

def test_a_demoted_editor_becomes_read_only_at_once(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, eddie, project, code_file) as bob:
        r = client.patch(f"/projects/{project}/members/{user_id('eddie')}", json={"role": "viewer"}, headers=auth(owner))
        assert r.status_code == 200
        assert session_role(bob.ws.receive_bytes()) == "viewer"
        # Typed before the browser noticed: refused, and the browser is told to reload
        bob.edit(0, "ignored ")
        assert closed_with(bob) == collab_service.CLOSE_RESYNC
    assert content_of(code_file) == "print('hi')\n"
    # Promoted again, a fresh copy edits normally
    client.patch(f"/projects/{project}/members/{user_id('eddie')}", json={"role": "editor"}, headers=auth(owner))
    with YClient(client, eddie, project, code_file) as bob:
        assert bob.session["role"] == "editor" and str(bob.text) == "print('hi')\n"
        bob.edit(0, "ok ")
    assert content_of(code_file) == "ok print('hi')\n"


def test_role_changes_reach_open_connections(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "viewer")
    with YClient(client, eddie, project, code_file) as bob:
        client.patch(f"/projects/{project}/members/{user_id('eddie')}", json={"role": "editor"}, headers=auth(owner))
        assert session_role(bob.ws.receive_bytes()) == "editor"
        bob.edit(0, "now I can ")
    assert content_of(code_file) == "now I can print('hi')\n"


def test_a_viewers_ordinary_sync_reply_is_not_a_change(client, owner, project, code_file, make_user):
    """A viewer whose copy has history (deletions) still syncs without being reloaded."""
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "abc")
        alice.delete(0, 2)
    vera = member(client, make_user, project, "vera", "viewer")
    with YClient(client, vera, project, code_file) as viewer:
        assert str(viewer.text) == "cprint('hi')\n"
        viewer.set_awareness(5, 1, {})
        viewer.receive()  # still connected


def test_a_removed_member_is_disconnected(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, eddie, project, code_file) as bob:
        assert client.delete(f"/projects/{project}/members/{user_id('eddie')}", headers=auth(owner)).status_code == 204
        assert closed_with(bob) == collab_service.CLOSE_NO_ACCESS


def test_a_deleted_account_is_disconnected(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, eddie, project, code_file) as bob:
        assert client.post("/me/delete", json={"password": DEFAULT_PASSWORD}, headers=auth(eddie)).status_code == 204
        assert closed_with(bob) == collab_service.CLOSE_NO_ACCESS


def test_role_changes_made_elsewhere_are_caught_by_the_recheck(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, eddie, project, code_file) as bob:
        with SessionLocal() as db:
            db.query(ProjectMemberModel).filter(ProjectMemberModel.user_id == user_id("eddie")).update({"role": "viewer"})
            db.commit()
        client.portal.call(collab_router.collab.recheck_roles)
        assert session_role(bob.ws.receive_bytes()) == "viewer"
        with SessionLocal() as db:
            db.query(ProjectMemberModel).filter(ProjectMemberModel.user_id == user_id("eddie")).delete()
            db.commit()
        client.portal.call(collab_router.collab.recheck_roles)
        assert closed_with(bob) == collab_service.CLOSE_NO_ACCESS


def test_other_people_are_not_affected_by_someone_elses_role_change(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file) as alice, YClient(client, eddie, project, code_file):
        client.patch(f"/projects/{project}/members/{user_id('eddie')}", json={"role": "viewer"}, headers=auth(owner))
        alice.edit(0, "still mine ")
        alice.set_awareness(1, 1, {})
        while alice.receive()[0] != 1:
            pass
        assert str(ROOMS[code_file].text).startswith("still mine ")


# ---- shutdown ----

def test_shutdown_saves_and_tells_browsers_to_come_back(client, owner, project, code_file, monkeypatch):
    monkeypatch.setattr(collab_service, "SAVE_DELAY_SECONDS", 3600)
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "# before restart\n")
        alice.set_awareness(1, 1, {})
        alice.receive()
        client.portal.call(collab_router.shutdown)
        assert closed_with(alice) == collab_service.CLOSE_GOING_AWAY
    assert content_of(code_file) == "# before restart\nprint('hi')\n"
