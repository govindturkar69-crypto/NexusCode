"""Live documents are saved: they survive restarts, and other writers go through them."""
import pytest
from collab_client import YClient
from conftest import auth
from pycrdt import Doc, Text
from starlette.websockets import WebSocketDisconnect

from app.core.database import SessionLocal
from app.models import CodeFileModel, CodeFileYjsModel
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


def new_file(client, owner, project, path="main.py", content="print('hi')\n"):
    r = client.post(f"/projects/{project}/code/files", json={"path": path, "content": content}, headers=auth(owner))
    assert r.status_code == 201, r.text
    return r.json()["code_file"]["id"]


@pytest.fixture
def code_file(client, owner, project):
    return new_file(client, owner, project)


def content_of(file_id):
    with SessionLocal() as db:
        return db.get(CodeFileModel, file_id).content


def saved_state(file_id):
    with SessionLocal() as db:
        row = db.get(CodeFileYjsModel, file_id)
        return row.state if row else None


def text_of_state(state):
    doc = Doc()
    doc.apply_update(state)
    return str(doc.get("content", type=Text))


# ---- saving and unloading ----

def test_a_file_has_no_document_until_someone_opens_it(client, owner, project, code_file):
    assert saved_state(code_file) is None
    YClient(client, owner, project, code_file).close()
    # The lazy backfill: its content became a document, which was saved
    assert text_of_state(saved_state(code_file)) == "print('hi')\n"


def test_the_room_is_saved_and_unloaded_when_the_last_person_leaves(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "# hi\n")
        assert code_file in ROOMS
    assert code_file not in ROOMS
    assert content_of(code_file) == "# hi\nprint('hi')\n"
    assert text_of_state(saved_state(code_file)) == "# hi\nprint('hi')\n"


def test_reopening_continues_the_same_document(client, owner, project, code_file):
    YClient(client, owner, project, code_file).close()
    first_state = saved_state(code_file)
    with YClient(client, owner, project, code_file) as again:
        assert str(again.text) == "print('hi')\n"
    assert saved_state(code_file) == first_state


def test_offline_edits_merge_after_the_room_was_unloaded(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as first:
        offline = Doc()
        offline.apply_update(first.doc.get_update())
    assert code_file not in ROOMS
    offline.get("content", type=Text).insert(0, "# offline\n")
    with YClient(client, owner, project, code_file, sync=False) as again:
        again.doc.apply_update(offline.get_update())
        again.handshake()
        # One copy of the text, with the offline line: no duplicate from a rebuilt document
        assert str(again.text) == "# offline\nprint('hi')\n"
    assert content_of(code_file) == "# offline\nprint('hi')\n"


def test_a_server_restart_loses_nothing(client, owner, project, code_file):
    """A browser stays open across a restart: it reconnects and sends what the
    server hadn't saved yet."""
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "saved ")
        browser = Doc()
        browser.apply_update(alice.doc.get_update())
        ROOMS.clear()  # the process restarts; its memory is gone
    browser.get("content", type=Text).insert(0, "unsaved ")
    with YClient(client, owner, project, code_file, sync=False) as reconnected:
        reconnected.doc.apply_update(browser.get_update())
        reconnected.handshake()
        assert str(reconnected.text) == "unsaved saved print('hi')\n"
    assert content_of(code_file) == "unsaved saved print('hi')\n"


def test_an_empty_file_starts_an_empty_document(client, owner, project):
    file_id = new_file(client, owner, project, "empty.py", "")
    with YClient(client, owner, project, file_id) as alice:
        assert str(alice.text) == ""
        alice.edit(0, "x = 1\n")
    assert content_of(file_id) == "x = 1\n"


# ---- other writers go through the document ----

def test_a_rest_save_reaches_people_editing_live(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(len(alice.text), "# mine\n")
        r = client.put(f"/code-files/{code_file}", json={"content": "print('hello')\n# mine\n"}, headers=auth(owner))
        assert r.status_code == 200
        alice.receive()
        assert str(alice.text) == "print('hello')\n# mine\n"
    assert content_of(code_file) == "print('hello')\n# mine\n"
    assert text_of_state(saved_state(code_file)) == "print('hello')\n# mine\n"


def test_a_rest_save_changes_only_what_differs(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        before = len(alice.updates)
        client.put(f"/code-files/{code_file}", json={"content": "print('hi')\nprint('bye')\n"}, headers=auth(owner))
        message = alice.receive()
        # A small insert at the end, not the whole file deleted and retyped
        assert len(message) < 60
        assert len(alice.updates) == before + 1


def test_a_rest_save_with_nobody_live_keeps_the_document_and_text_together(client, owner, project, code_file):
    YClient(client, owner, project, code_file).close()
    client.put(f"/code-files/{code_file}", json={"content": "x = 2\n"}, headers=auth(owner))
    assert code_file not in ROOMS
    assert content_of(code_file) == "x = 2\n"
    assert text_of_state(saved_state(code_file)) == "x = 2\n"


def test_a_rest_save_to_a_never_opened_file_creates_its_document(client, owner, project, code_file):
    client.put(f"/code-files/{code_file}", json={"content": "y = 3\n"}, headers=auth(owner))
    assert content_of(code_file) == "y = 3\n"
    assert text_of_state(saved_state(code_file)) == "y = 3\n"


def test_the_legacy_single_file_save_goes_through_the_document(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        r = client.put(f"/projects/{project}/code", json={"content": "legacy = True\n", "language": "python"}, headers=auth(owner))
        assert r.status_code == 200 and r.json()["code_file"]["content"] == "legacy = True\n"
        alice.receive()
        assert str(alice.text) == "legacy = True\n"


def test_viewers_still_can_not_save_over_rest(client, owner, project, code_file, make_user):
    from conftest import DEFAULT_PASSWORD, add_member

    make_user("vera")
    add_member("vera", project, "viewer")
    vera = client.post("/login", data={"username": "vera", "password": DEFAULT_PASSWORD}).json()["access_token"]
    assert client.put(f"/code-files/{code_file}", json={"content": "x"}, headers=auth(vera)).status_code == 403
    assert content_of(code_file) == "print('hi')\n"


# ---- readers see the latest text ----

def test_reading_a_file_includes_unsaved_live_edits(client, owner, project, code_file, monkeypatch):
    monkeypatch.setattr(collab_service, "SAVE_DELAY_SECONDS", 3600)
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "# just typed\n")
        alice.set_awareness(1, 1, {})
        alice.receive()
        assert content_of(code_file) == "print('hi')\n"  # not saved yet
        r = client.get(f"/code-files/{code_file}", headers=auth(owner))
        assert r.json()["code_file"]["content"] == "# just typed\nprint('hi')\n"


def test_project_wide_readers_flush_first(client, owner, project, code_file, monkeypatch):
    monkeypatch.setattr(collab_service, "SAVE_DELAY_SECONDS", 3600)
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "# pushed\n")
        alice.set_awareness(1, 1, {})
        alice.receive()
        client.portal.call(collab_router.collab.flush_project, project)
        assert content_of(code_file) == "# pushed\nprint('hi')\n"


# ---- deleted files ----

def test_deleting_a_live_file_closes_its_editors(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        assert client.delete(f"/code-files/{code_file}", headers=auth(owner)).status_code == 204
        with pytest.raises(WebSocketDisconnect) as info:
            alice.receive()
        assert info.value.code == collab_service.CLOSE_FILE_DELETED
    assert code_file not in ROOMS
    with SessionLocal() as db:
        assert db.get(CodeFileYjsModel, code_file) is None


def test_deleting_a_folder_or_project_cleans_up_documents(client, owner, project):
    a = new_file(client, owner, project, "pkg/a.py", "a = 1\n")
    b = new_file(client, owner, project, "pkg/b.py", "b = 1\n")
    for file_id in (a, b):
        YClient(client, owner, project, file_id).close()
    assert client.post(f"/projects/{project}/code/folders/delete", json={"path": "pkg"}, headers=auth(owner)).status_code == 200
    assert saved_state(a) is None and saved_state(b) is None
    c = new_file(client, owner, project, "c.py", "c = 1\n")
    with YClient(client, owner, project, c) as alice:
        assert client.delete(f"/projects/{project}", headers=auth(owner)).status_code in (200, 204)
        with pytest.raises(WebSocketDisconnect):
            alice.receive()
    with SessionLocal() as db:
        assert db.query(CodeFileYjsModel).count() == 0


def test_a_document_rebuilt_from_the_same_text_does_not_double_it(client, owner, project, code_file):
    """If a document's saved state were ever lost, a browser holding the old one
    must not end up with two copies of the text."""
    with YClient(client, owner, project, code_file) as first:
        browser = Doc()
        browser.apply_update(first.doc.get_update())
    with SessionLocal() as db:
        db.query(CodeFileYjsModel).delete()
        db.commit()
    with YClient(client, owner, project, code_file, sync=False) as again:
        again.doc.apply_update(browser.get_update())
        again.handshake()
        assert str(again.text) == "print('hi')\n"
    assert content_of(code_file) == "print('hi')\n"


def test_the_starting_document_is_saved_as_soon_as_a_file_is_opened(client, owner, project, code_file, monkeypatch):
    monkeypatch.setattr(collab_service, "SAVE_DELAY_SECONDS", 3600)
    with YClient(client, owner, project, code_file):
        # Before any edit, and long before the save delay
        assert text_of_state(saved_state(code_file)) == "print('hi')\n"


def test_backfill_is_the_same_for_the_same_text():
    assert collab_service.backfill_update("abc") == collab_service.backfill_update("abc")
    assert collab_service.backfill_update("abc") != collab_service.backfill_update("abd")


# ---- a save already in progress ----

@pytest.fixture
def slow_saves(monkeypatch):
    """Every save takes a while, so a debounced save is still writing when the next
    flush comes along (what a slow CI runner did by chance)."""
    import time

    manager = collab_router.collab
    real_save = manager._save

    def slow(file_id, text, state):
        time.sleep(0.3)
        real_save(file_id, text, state)

    monkeypatch.setattr(manager, "_save", slow)


def test_leaving_waits_for_a_save_already_in_progress(client, owner, project, code_file, slow_saves):
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "# typed\n")
        # A round trip, then a pause: the debounced save starts and is still writing
        alice.set_awareness(1, 1, {})
        alice.receive()
        client.portal.call(asyncio_sleep, 0.05)
    # Leaving finished only once the text was saved
    assert content_of(code_file) == "# typed\nprint('hi')\n"
    assert text_of_state(saved_state(code_file)) == "# typed\nprint('hi')\n"


def test_shutdown_waits_for_a_save_already_in_progress(client, owner, project, code_file, slow_saves):
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "# before shutdown\n")
        alice.set_awareness(1, 1, {})
        alice.receive()
        client.portal.call(asyncio_sleep, 0.05)
        client.portal.call(collab_router.shutdown)
        assert content_of(code_file) == "# before shutdown\nprint('hi')\n"


async def asyncio_sleep(seconds):
    import asyncio

    await asyncio.sleep(seconds)
