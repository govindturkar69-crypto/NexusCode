"""File version history: snapshots, throttling, retention, restore (live too) and who may do what."""
import threading
from datetime import UTC, datetime, timedelta

import pytest
from collab_client import YClient
from conftest import add_member, auth

from app.core.database import SessionLocal
from app.models import ActivityModel, CodeFileVersionModel
from app.routers import collab as collab_router
from app.services import collab as collab_service
from app.services import versions as versions_service

ROOMS = collab_router.collab.rooms


def receive_until(yclient, predicate, tries=50):
    """Reads messages until the predicate holds (the server pushes asynchronously)."""
    for _ in range(tries):
        if predicate():
            return
        yclient.receive()
    raise AssertionError("condition never became true")


@pytest.fixture(autouse=True)
def fast_saves(monkeypatch):
    monkeypatch.setattr(collab_service, "SAVE_DELAY_SECONDS", 0.01)
    yield
    ROOMS.clear()


@pytest.fixture
def owner(make_user):
    return make_user("olivia")


@pytest.fixture
def editor(make_user, project):
    token = make_user("eddie")
    add_member("eddie", project, "editor")
    return token


@pytest.fixture
def viewer(make_user, project):
    token = make_user("vic")
    add_member("vic", project, "viewer")
    return token


@pytest.fixture
def project(owner, project_of):
    return project_of(owner)


def new_file(client, token, project, path="main.py", content="v1\n"):
    r = client.post(f"/projects/{project}/code/files", json={"path": path, "content": content}, headers=auth(token))
    assert r.status_code == 201, r.text
    return r.json()["code_file"]["id"]


@pytest.fixture
def code_file(client, owner, project):
    return new_file(client, owner, project)


def save(client, token, file_id, content, expect=200):
    r = client.put(f"/code-files/{file_id}", json={"content": content}, headers=auth(token))
    assert r.status_code == expect, r.text


def rows(file_id):
    with SessionLocal() as db:
        return (
            db.query(CodeFileVersionModel)
            .filter(CodeFileVersionModel.file_id == file_id)
            .order_by(CodeFileVersionModel.created_at.desc(), CodeFileVersionModel.id.desc())
            .all()
        )


def age_versions(file_id, seconds=120):
    """Pretend the existing snapshots are older, so the throttle window has passed."""
    with SessionLocal() as db:
        then = datetime.now(UTC) - timedelta(seconds=seconds)
        db.query(CodeFileVersionModel).filter(CodeFileVersionModel.file_id == file_id).update({"created_at": then})
        db.commit()


def listed(client, token, file_id, query="", expect=200):
    r = client.get(f"/code-files/{file_id}/versions{query}", headers=auth(token))
    assert r.status_code == expect, r.text
    return r.json() if expect == 200 else None


# ---------------- snapshots

def test_creating_a_file_with_content_starts_its_history(client, owner, project, code_file):
    (version,) = rows(code_file)
    assert (version.source, version.content, version.project_id) == ("save", "v1\n", project)
    assert version.content_hash == versions_service.content_hash("v1\n")
    with SessionLocal() as db:
        author = db.get(CodeFileVersionModel, version.id).author.username
    assert author == "olivia"


def test_a_save_snapshots_once_the_window_has_passed_and_never_duplicates(client, owner, code_file):
    save(client, owner, code_file, "v2\n")  # within 60 s of creation: throttled
    assert [v.content for v in rows(code_file)] == ["v1\n"]
    age_versions(code_file)
    save(client, owner, code_file, "v3\n")
    assert [v.content for v in rows(code_file)] == ["v3\n", "v1\n"]
    age_versions(code_file)
    save(client, owner, code_file, "v3\n")  # same hash: no new row, however old
    assert [v.content for v in rows(code_file)] == ["v3\n", "v1\n"]


def test_opening_a_file_live_for_the_first_time_is_not_a_version(client, owner, project, code_file):
    """The lazy backfill (saved text -> first live document) changes nothing, so it
    must neither add a version nor start the throttle window for the next real save."""
    age_versions(code_file)
    before = [v.id for v in rows(code_file)]
    YClient(client, owner, project, code_file).close()
    assert [v.id for v in rows(code_file)] == before
    save(client, owner, code_file, "a real change\n")
    newest = rows(code_file)[0]
    assert (newest.source, newest.content) == ("save", "a real change\n")


def test_live_editing_snapshots_when_the_room_empties_even_inside_the_window(client, owner, project, code_file):
    with YClient(client, owner, project, code_file) as alice:
        alice.edit(0, "# typed live\n")
        alice.set_awareness(1, 1, {})
        alice.receive()
    # Leaving flushed with final=True: the throttle was skipped, the state kept
    newest = rows(code_file)[0]
    assert newest.source == "autosnapshot"
    assert newest.content == "# typed live\nv1\n"
    with SessionLocal() as db:
        from app.models import UserModel
        olivia = db.query(UserModel.id).filter(UserModel.username == "olivia").scalar()
    assert newest.author_user_id == olivia


def test_a_failing_snapshot_never_breaks_the_save(client, owner, code_file, monkeypatch):
    def boom(db, file_id, project_id, text, request):
        raise RuntimeError("snapshot exploded")

    monkeypatch.setattr(collab_router.versions_service, "take_snapshot", boom)
    age_versions(code_file)
    save(client, owner, code_file, "still saved\n")
    r = client.get(f"/code-files/{code_file}", headers=auth(owner))
    assert r.json()["code_file"]["content"] == "still saved\n"
    assert [v.content for v in rows(code_file)] == ["v1\n"]  # no snapshot, but saved


def test_retention_keeps_only_the_newest_versions(client, owner, code_file, monkeypatch):
    monkeypatch.setattr(versions_service, "MAX_VERSIONS_PER_FILE", 3)
    for i in range(2, 8):
        age_versions(code_file)
        save(client, owner, code_file, f"v{i}\n")
    assert [v.content for v in rows(code_file)] == ["v7\n", "v6\n", "v5\n"]


def test_two_saves_at_once_stay_consistent(client, owner, code_file, monkeypatch):
    monkeypatch.setattr(versions_service, "SNAPSHOT_EVERY_SECONDS", 0)
    outcomes = []

    def put(text):
        r = client.put(f"/code-files/{code_file}", json={"content": text}, headers=auth(owner))
        outcomes.append(r.status_code)

    threads = [threading.Thread(target=put, args=(f"race {i}\n",)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert outcomes == [200, 200]
    r = client.get(f"/code-files/{code_file}", headers=auth(owner))
    final = r.json()["code_file"]["content"]
    # The document merged both writes in some order; the newest snapshot is the saved text
    versions = rows(code_file)
    assert versions[0].content == final
    hashes = [v.content_hash for v in versions]
    assert len(hashes) == len(set(hashes)), "duplicate snapshots"


def test_import_snapshots_each_created_file(client, owner, project):
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("a.py", "print('a')\n")
        z.writestr("b.py", "print('b')\n")
    r = client.post(
        f"/projects/{project}/code/import",
        files={"file": ("starter.zip", buffer.getvalue(), "application/zip")},
        data={"dry_run": "false", "decisions": "{}"},
        headers=auth(owner),
    )
    assert r.status_code == 200, r.text
    with SessionLocal() as db:
        sources = [v.source for v in db.query(CodeFileVersionModel).filter(CodeFileVersionModel.project_id == project).all()]
    assert sources.count("import") == 2


# ---------------- listing and reading

def test_listing_is_newest_first_without_content_and_paginated(client, owner, code_file):
    for i in range(2, 5):
        age_versions(code_file)
        save(client, owner, code_file, f"v{i}\n")
    body = listed(client, owner, code_file, "?limit=2")
    assert body["total"] == 4
    assert len(body["versions"]) == 2
    assert [v["size"] for v in body["versions"]] == [3, 3]
    assert "content" not in body["versions"][0]
    assert body["versions"][0]["author"] == "olivia"
    page2 = listed(client, owner, code_file, "?limit=2&offset=2")
    assert len(page2["versions"]) == 2
    assert {v["id"] for v in body["versions"]}.isdisjoint({v["id"] for v in page2["versions"]})


def test_reading_one_version_returns_its_content(client, owner, viewer, code_file):
    version_id = listed(client, owner, code_file)["versions"][0]["id"]
    r = client.get(f"/code-files/{code_file}/versions/{version_id}", headers=auth(viewer))
    assert r.status_code == 200
    assert r.json()["content"] == "v1\n"


# ---------------- who may do what

def test_viewers_browse_but_never_restore_or_label(client, owner, viewer, code_file):
    version_id = listed(client, viewer, code_file)["versions"][0]["id"]
    r = client.post(f"/code-files/{code_file}/versions/{version_id}/restore", headers=auth(viewer))
    assert r.status_code == 403
    r = client.patch(f"/code-files/{code_file}/versions/{version_id}", json={"label": "nope"}, headers=auth(viewer))
    assert r.status_code == 403


def test_non_members_and_anonymous_get_404_or_401(client, owner, make_user, code_file):
    stranger = make_user("stranger")
    version_id = listed(client, owner, code_file)["versions"][0]["id"]
    for path in (f"/code-files/{code_file}/versions", f"/code-files/{code_file}/versions/{version_id}"):
        assert client.get(path, headers=auth(stranger)).status_code == 404
        assert client.get(path).status_code == 401
    assert client.post(f"/code-files/{code_file}/versions/{version_id}/restore", headers=auth(stranger)).status_code == 404
    assert client.get("/code-files/999999/versions", headers=auth(stranger)).status_code == 404


def test_a_version_of_another_file_or_project_is_404(client, owner, make_user, project, code_file, project_of):
    other_file = new_file(client, owner, project, "other.py", "other\n")
    other_version = listed(client, owner, other_file)["versions"][0]["id"]
    # Right project, wrong file
    assert client.get(f"/code-files/{code_file}/versions/{other_version}", headers=auth(owner)).status_code == 404
    # A member of a different project can't reach it through their own file either
    mallory = make_user("mallory")
    their_project = project_of(mallory, "Theirs")
    their_file = new_file(client, mallory, their_project, "mine.py", "mine\n")
    assert client.get(f"/code-files/{their_file}/versions/{other_version}", headers=auth(mallory)).status_code == 404
    assert client.post(f"/code-files/{their_file}/versions/{other_version}/restore", headers=auth(mallory)).status_code == 404


# ---------------- labels

def test_editors_can_label_and_unlabel(client, editor, code_file):
    version_id = listed(client, editor, code_file)["versions"][0]["id"]
    r = client.patch(f"/code-files/{code_file}/versions/{version_id}", json={"label": "Works!"}, headers=auth(editor))
    assert r.status_code == 200 and r.json()["version"]["label"] == "Works!"
    assert listed(client, editor, code_file)["versions"][0]["label"] == "Works!"
    r = client.patch(f"/code-files/{code_file}/versions/{version_id}", json={"label": None}, headers=auth(editor))
    assert r.json()["version"]["label"] is None


# ---------------- restore

def test_restore_adds_a_version_keeps_history_and_records_activity(client, owner, editor, project, code_file):
    age_versions(code_file)
    save(client, editor, code_file, "v2\n")
    old_id = listed(client, owner, code_file)["versions"][1]["id"]  # the v1 snapshot
    r = client.post(f"/code-files/{code_file}/versions/{old_id}/restore", headers=auth(editor))
    assert r.status_code == 200, r.text
    assert r.json()["restored_to_version_id"] == old_id
    r = client.get(f"/code-files/{code_file}", headers=auth(editor))
    assert r.json()["code_file"]["content"] == "v1\n"
    body = listed(client, owner, code_file)
    assert body["total"] == 3  # v1, v2, and the restore: nothing deleted
    newest = body["versions"][0]
    assert newest["source"] == "restore"
    assert newest["author"] == "eddie"
    assert "Restored the version from" in newest["label"]
    with SessionLocal() as db:
        entry = db.query(ActivityModel).filter(ActivityModel.project_id == project, ActivityModel.action == "code_restored").one()
        assert entry.target.startswith("main.py")


def test_restoring_identical_content_still_writes_the_restore_version(client, owner, code_file):
    version_id = listed(client, owner, code_file)["versions"][0]["id"]
    r = client.post(f"/code-files/{code_file}/versions/{version_id}/restore", headers=auth(owner))
    assert r.status_code == 200
    body = listed(client, owner, code_file)
    assert body["total"] == 2
    assert body["versions"][0]["source"] == "restore"


def test_restore_reaches_two_live_collaborators_and_nobody_writes_it_back(client, owner, editor, project, code_file):
    """Two people are editing live; a third restores. Both see the restored text
    instantly, and the editor holding unsaved keystrokes merges them on top
    instead of overwriting the restore."""
    age_versions(code_file)
    with YClient(client, owner, project, code_file) as alice, YClient(client, editor, project, code_file) as bob:
        alice.edit(0, "alice was here\n")
        receive_until(bob, lambda: "alice was here" in str(bob.text))
        # Save so a version of this state exists, then keep editing
        save(client, owner, code_file, str(alice.text))
        old_id = listed(client, owner, code_file)["versions"][0]["id"]
        assert "alice" in client.get(f"/code-files/{code_file}/versions/{old_id}", headers=auth(owner)).json()["content"]
        age_versions(code_file)
        alice.edit(0, "scribble 1\n")
        alice_before = str(alice.text)
        assert alice_before.startswith("scribble 1\n")
        # The owner restores the saved state while both are connected
        r = client.post(f"/code-files/{code_file}/versions/{old_id}/restore", headers=auth(owner))
        assert r.status_code == 200, r.text
        # Both clients receive the change as a normal document update
        receive_until(alice, lambda: "scribble" not in str(alice.text))
        receive_until(bob, lambda: str(bob.text) == str(alice.text))
        assert str(alice.text) == "alice was here\nv1\n"
        # Bob types after the restore: his keystrokes merge on top, no rollback
        bob.edit(0, "bob after restore\n")
        receive_until(alice, lambda: "bob after restore" in str(alice.text))
        assert str(alice.text) == "bob after restore\nalice was here\nv1\n"
    # Everyone left: the final text is saved and snapshotted, the restore kept
    sources = [v.source for v in rows(code_file)]
    assert "restore" in sources
    r = client.get(f"/code-files/{code_file}", headers=auth(owner))
    assert r.json()["code_file"]["content"] == "bob after restore\nalice was here\nv1\n"


def test_restore_is_rate_limited(client, owner, code_file, rate_limits):
    version_id = listed(client, owner, code_file)["versions"][0]["id"]
    statuses = [
        client.post(f"/code-files/{code_file}/versions/{version_id}/restore", headers=auth(owner)).status_code
        for _ in range(11)
    ]
    assert statuses.count(429) >= 1


# ---------------- deleting

def test_deleting_a_file_deletes_its_versions(client, owner, code_file):
    assert len(rows(code_file)) == 1
    r = client.delete(f"/code-files/{code_file}", headers=auth(owner))
    assert r.status_code in (200, 204), r.text
    assert rows(code_file) == []


def test_deleting_a_folder_deletes_its_files_versions(client, owner, project):
    inside = new_file(client, owner, project, "pkg/mod.py", "x\n")
    r = client.post(f"/projects/{project}/code/folders/delete", json={"path": "pkg"}, headers=auth(owner))
    assert r.status_code in (200, 204), r.text
    assert rows(inside) == []
