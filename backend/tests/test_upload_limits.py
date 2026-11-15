"""
Upload limits (review M3): 30 uploads a minute per user, and at most
MAX_UPLOADED_FILES_PER_PROJECT uploaded files per project, enforced so that
uploads running at the same time can't overshoot it.
"""
import io
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import add_member, auth

from app.core.database import SessionLocal
from app.models import FileModel
from app.routers import files as files_router
from app.services import storage


def upload(client, token, pid, name="notes.txt"):
    return client.post(f"/projects/{pid}/files", files={"file": (name, io.BytesIO(b"hello"), "text/plain")}, headers=auth(token))


def stored_count(pid):
    with SessionLocal() as db:
        return db.query(FileModel).filter(FileModel.project_id == pid).count()


@pytest.fixture
def small_limit(monkeypatch):
    monkeypatch.setattr(files_router, "MAX_UPLOADED_FILES_PER_PROJECT", 3)
    monkeypatch.setattr(files_router, "PROJECT_FILE_LIMIT_MESSAGE", "This project already has 3 uploaded files")
    return 3


def test_the_31st_upload_in_a_minute_is_429(client, make_user, project_of, fake_cloudinary, rate_limits):
    owner = make_user("owner")
    pid = project_of(owner)
    rate_limits.reset()
    codes = [upload(client, owner, pid, f"f{i}.txt").status_code for i in range(31)]
    assert codes == [201] * 30 + [429]
    r = upload(client, owner, pid)
    assert r.status_code == 429 and r.json()["detail"].startswith("Too many requests")
    assert "Retry-After" in r.headers


def test_the_upload_limit_is_per_user(client, make_user, project_of, fake_cloudinary, rate_limits):
    owner, other = make_user("owner"), make_user("other")
    pid = project_of(owner)
    add_member("other", pid, "editor")
    rate_limits.reset()
    for i in range(30):
        assert upload(client, owner, pid, f"f{i}.txt").status_code == 201
    assert upload(client, owner, pid).status_code == 429
    assert upload(client, other, pid).status_code == 201


def test_a_full_project_refuses_with_409_before_calling_cloudinary(client, make_user, project_of, fake_cloudinary, small_limit):
    owner = make_user("owner")
    pid = project_of(owner)
    for i in range(small_limit):
        assert upload(client, owner, pid, f"f{i}.txt").status_code == 201
    sent = len(fake_cloudinary["uploads"])
    r = upload(client, owner, pid)
    assert r.status_code == 409
    assert r.json()["detail"].startswith("This project already has 3 uploaded files")
    assert len(fake_cloudinary["uploads"]) == sent  # nothing was sent
    assert stored_count(pid) == small_limit


def test_the_real_limit_is_200_and_its_message_says_how_to_free_space():
    assert files_router.MAX_UPLOADED_FILES_PER_PROJECT == 200
    assert "200" in files_router.PROJECT_FILE_LIMIT_MESSAGE and "Delete" in files_router.PROJECT_FILE_LIMIT_MESSAGE


def test_deleting_a_file_frees_its_slot(client, make_user, project_of, fake_cloudinary, small_limit):
    owner = make_user("owner")
    pid = project_of(owner)
    ids = [upload(client, owner, pid, f"f{i}.txt").json()["file"]["id"] for i in range(small_limit)]
    assert upload(client, owner, pid).status_code == 409
    assert client.delete(f"/files/{ids[0]}", headers=auth(owner)).status_code == 204
    assert upload(client, owner, pid).status_code == 201
    assert upload(client, owner, pid).status_code == 409


def test_the_limit_is_per_project(client, make_user, project_of, fake_cloudinary, small_limit):
    owner = make_user("owner")
    full, other = project_of(owner, "Full"), project_of(owner, "Other")
    for i in range(small_limit):
        upload(client, owner, full, f"f{i}.txt")
    assert upload(client, owner, full).status_code == 409
    assert upload(client, owner, other).status_code == 201


def test_uploads_at_the_same_time_never_overshoot_the_limit(client, make_user, project_of, fake_cloudinary, small_limit, monkeypatch):
    """Eight uploads race for the last two slots. Each one passes the early check
    (Cloudinary is held until all have), so only the final, locked check decides."""
    owner = make_user("owner")
    pid = project_of(owner)
    upload(client, owner, pid, "first.txt")  # one slot used, two left
    racers = 8
    barrier = threading.Barrier(racers, timeout=20)
    real_upload = storage.upload_project_file

    def slow_upload(*args, **kwargs):
        barrier.wait()  # everyone has passed the early check before anyone stores
        return real_upload(*args, **kwargs)

    monkeypatch.setattr(storage, "upload_project_file", slow_upload)
    with ThreadPoolExecutor(racers) as pool:
        codes = list(pool.map(lambda i: upload(client, owner, pid, f"race{i}.txt").status_code, range(racers)))
    assert sorted(codes) == [201, 201] + [409] * (racers - 2)
    assert stored_count(pid) == small_limit
    # The losers' assets were uploaded, then removed again: nothing is orphaned
    kept = {row for (row,) in SessionLocal().query(FileModel.public_id).filter(FileModel.project_id == pid)}
    uploaded = {u["public_id"] for u in fake_cloudinary["uploads"]}
    destroyed = {public_id for public_id, _ in fake_cloudinary["destroyed"]}
    assert uploaded - destroyed == kept
    assert len(destroyed) == racers - 2


def test_viewers_and_non_members_still_cant_upload(client, make_user, project_of, fake_cloudinary):
    owner, viewer, stranger = make_user("owner"), make_user("viewer"), make_user("stranger")
    pid = project_of(owner)
    add_member("viewer", pid, "viewer")
    assert upload(client, viewer, pid).status_code == 403
    assert upload(client, stranger, pid).status_code == 404
    assert len(fake_cloudinary["uploads"]) == 0
