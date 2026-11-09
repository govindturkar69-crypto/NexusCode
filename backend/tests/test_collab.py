"""Collaborative editing over /ws/code-files/{id}: auth, roles, sync, presence."""
import json

import pytest
from collab_client import YClient, ticket_for
from conftest import add_member, auth
from pycrdt import Doc, Text, create_update_message
from starlette.websockets import WebSocketDisconnect

from app.core.database import SessionLocal
from app.models import CodeFileModel
from app.routers import collab as collab_router
from app.services import collab as collab_service


@pytest.fixture(autouse=True)
def fast_saves(monkeypatch):
    monkeypatch.setattr(collab_service, "SAVE_DELAY_SECONDS", 0.01)
    yield
    collab_router.collab.rooms.clear()


@pytest.fixture
def owner(make_user):
    return make_user("olivia")


@pytest.fixture
def project(owner, project_of):
    return project_of(owner)


@pytest.fixture
def code_file(client, owner, project):
    r = client.post(f"/projects/{project}/code/files", json={"path": "main.py", "content": "print('hi')\n"}, headers=auth(owner))
    assert r.status_code == 201, r.text
    return r.json()["code_file"]["id"]


def member(client, make_user, project, username, role):
    from conftest import DEFAULT_PASSWORD

    make_user(username)
    add_member(username, project, role)
    return client.post("/login", data={"username": username, "password": DEFAULT_PASSWORD}).json()["access_token"]


def content_of(file_id):
    with SessionLocal() as db:
        return db.get(CodeFileModel, file_id).content


def refused(client, path):
    with pytest.raises(WebSocketDisconnect) as info:
        with client.websocket_connect(path) as ws:
            ws.receive_bytes()
    return info.value.code


# ---- getting in ----

def test_an_editor_gets_the_file_as_a_yjs_document(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        assert alice.session == {"role": "editor", "username": "olivia"}
        assert str(alice.text) == "print('hi')\n"


def test_viewers_get_it_read_only(client, owner, project, code_file, make_user):
    viewer = member(client, make_user, project, "vera", "viewer")
    with YClient(client, viewer, project, code_file) as vera:
        assert vera.session["role"] == "viewer"
        assert str(vera.text) == "print('hi')\n"


@pytest.mark.parametrize("ticket", [None, "", "not-a-ticket"])
def test_no_valid_ticket_no_entry(client, code_file, ticket):
    path = f"/ws/code-files/{code_file}" + (f"?ticket={ticket}" if ticket is not None else "")
    assert refused(client, path) == 1008


def test_a_ticket_works_once(client, owner, project, code_file):
    ticket = ticket_for(client, owner, project)
    YClient(client, owner, project, code_file, ticket=ticket).close()
    assert refused(client, f"/ws/code-files/{code_file}?ticket={ticket}") == 1008


def test_a_ticket_for_another_project_is_refused(client, owner, project, code_file, project_of):
    other_project = project_of(owner, "Other")
    ticket = ticket_for(client, owner, other_project)
    assert refused(client, f"/ws/code-files/{code_file}?ticket={ticket}") == 1008


def test_non_members_and_missing_files_look_the_same(client, owner, project, code_file, make_user, project_of):
    stranger = make_user("stan")
    own_project = project_of(stranger, "Mine")
    # A stranger's valid ticket for their own project can't open this project's file
    assert refused(client, f"/ws/code-files/{code_file}?ticket={ticket_for(client, stranger, own_project)}") == 1008
    # And a file id that doesn't exist gets the same answer
    assert refused(client, f"/ws/code-files/999999?ticket={ticket_for(client, owner, project)}") == 1008


def test_a_removed_member_can_not_use_an_old_ticket(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    ticket = ticket_for(client, eddie, project)
    assert client.delete(f"/projects/{project}/members/{_user_id('eddie')}", headers=auth(owner)).status_code in (200, 204)
    assert refused(client, f"/ws/code-files/{code_file}?ticket={ticket}") == 1008


def _user_id(username):
    from app.models import UserModel

    with SessionLocal() as db:
        return db.query(UserModel.id).filter(UserModel.username == username).scalar()


# ---- editing together ----

def test_edits_reach_the_other_editor_and_the_database(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file) as alice, YClient(client, eddie, project, code_file) as bob:
        alice.edit(0, "# by alice\n")
        bob.receive()
        assert str(bob.text) == "# by alice\nprint('hi')\n"
    assert content_of(code_file) == "# by alice\nprint('hi')\n"


def test_simultaneous_edits_converge(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file) as alice, YClient(client, eddie, project, code_file) as bob:
        # Both type before seeing the other's change
        alice.edit(0, "A")
        bob.edit(len(bob.text), "B")
        alice.receive()
        bob.receive()
        assert str(alice.text) == str(bob.text) == "Aprint('hi')\nB"
    assert content_of(code_file) == "Aprint('hi')\nB"


def test_a_viewers_changes_are_refused(client, owner, project, code_file, make_user):
    viewer = member(client, make_user, project, "vera", "viewer")
    with YClient(client, owner, project, code_file) as alice, YClient(client, viewer, project, code_file) as vera:
        vera.edit(0, "HACKED ")
        # Refused, and the viewer's browser is told to reload its copy
        with pytest.raises(WebSocketDisconnect) as info:
            vera.receive()
        assert info.value.code == collab_service.CLOSE_RESYNC
        alice.edit(0, "ok ")
        room = collab_router.collab.rooms[code_file]
        assert str(room.text) == "ok print('hi')\n"
    assert content_of(code_file) == "ok print('hi')\n"


def test_edits_made_while_offline_arrive_on_reconnect(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as first:
        offline = Doc()
        offline.apply_update(first.doc.get_update())
    # Typed while disconnected, then the browser reconnects with its document
    offline.get("content", type=Text).insert(0, "# offline\n")
    with YClient(client, owner, project, code_file, sync=False) as again:
        again.doc.apply_update(offline.get_update())
        again.handshake()
        assert str(again.text) == "# offline\nprint('hi')\n"
    assert content_of(code_file) == "# offline\nprint('hi')\n"


# ---- presence ----

def test_cursors_carry_the_real_user_name(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file) as alice, YClient(client, eddie, project, code_file) as bob:
        bob.set_awareness(4242, 1, {"user": {"name": "olivia (not really)", "color": "#ff0000"}, "cursor": {"anchor": 1}})
        alice.receive()
        assert alice.awareness[4242]["user"] == {"name": "eddie", "color": "#ff0000", "role": "editor"}
        assert alice.awareness[4242]["cursor"] == {"anchor": 1}


def test_one_connection_can_not_change_anothers_cursor(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file) as alice, YClient(client, eddie, project, code_file) as bob:
        alice.set_awareness(1, 1, {"user": {"name": "x"}})
        bob.receive()
        bob.set_awareness(1, 2, {"user": {"name": "x"}, "cursor": "stolen"})
        alice.set_awareness(2, 1, {"user": {"name": "y"}})  # a message we'll see, after bob's
        bob.receive()
        room = collab_router.collab.rooms[code_file]
        assert room.awareness[1][0] == 1 and room.awareness[1][2].username == "olivia"


def test_leaving_removes_your_cursor_for_everyone(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file) as alice:
        bob = YClient(client, eddie, project, code_file)
        bob.set_awareness(77, 3, {"user": {"name": "eddie"}})
        alice.receive()
        assert 77 in alice.awareness
        bob.close()
        alice.receive()
        assert alice.awareness[77] is None


def test_a_newcomer_sees_who_is_already_here(client, owner, project, code_file, make_user):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file) as alice:
        alice.set_awareness(5, 1, {"user": {"name": "olivia"}})
        with YClient(client, eddie, project, code_file, sync=False) as bob:
            # The server's sync request, then the current awareness
            bob.ws.receive_bytes()
            bob.receive()
            assert bob.awareness[5]["user"]["name"] == "olivia"


# ---- bad input ----

def test_text_frames_close_the_connection(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        alice.ws.send_text("hello")
        with pytest.raises(WebSocketDisconnect) as info:
            alice.ws.receive_bytes()
    assert info.value.code == 4002


@pytest.mark.parametrize("payload", [b"\x07", b"\x00\x09", b"\x00\x02\xff\xff\xff", b"\x01\x05garbage"])
def test_malformed_messages_close_the_connection(client, owner, project, code_file, payload):
    with YClient(client, owner, project, code_file) as alice:
        alice.ws.send_bytes(payload)
        with pytest.raises(WebSocketDisconnect) as info:
            alice.ws.receive_bytes()
    assert info.value.code == 4002
    assert content_of(code_file) == "print('hi')\n"


def test_an_update_for_another_document_does_nothing_harmful(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        other = Doc()
        updates = []
        other.observe(lambda e: updates.append(e.update))
        other.get("elsewhere", type=Text).insert(0, "x")
        alice.ws.send_bytes(create_update_message(updates[0]))
        alice.edit(0, "#")
    assert content_of(code_file) == "#print('hi')\n"


def test_session_message_format():
    data = collab_service.session_message("viewer", "vera")
    assert data[0] == collab_service.MESSAGE_SESSION
    from pycrdt import Decoder

    assert json.loads(Decoder(data[1:]).read_var_string()) == {"role": "viewer", "username": "vera"}


@pytest.mark.parametrize("color,expected", [
    ("#16a34a", "#16a34a"),
    ("red; } body { display: none", "#888888"),
    ("#fff", "#888888"),
    (None, "#888888"),
    (12, "#888888"),
])
def test_only_plain_hex_colours_reach_other_people(client, owner, project, code_file, make_user, color, expected):
    eddie = member(client, make_user, project, "eddie", "editor")
    with YClient(client, owner, project, code_file) as alice, YClient(client, eddie, project, code_file) as bob:
        bob.set_awareness(55, 1, {"user": {"name": "eddie", "color": color}})
        alice.receive()
        assert alice.awareness[55]["user"]["color"] == expected


def test_awareness_comes_back_to_the_sender_too(client, owner, project, code_file):
    """Browsers treat 30 s of silence as a dead connection, so a lone editor's own
    awareness renewals are echoed back."""
    with YClient(client, owner, project, code_file) as alice:
        alice.set_awareness(66, 1, {"user": {"name": "olivia"}})
        alice.receive()
        assert alice.awareness[66]["user"]["name"] == "olivia"
