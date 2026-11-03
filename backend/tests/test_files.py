"""Upload hardening: unique ids, validation, size limits, Cloudinary cleanup."""
import inspect
import io
import re

import pytest
from conftest import auth

from app.core.database import SessionLocal
from app.models import FileModel
from app.routers import files as files_router

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
TEN_MB = 10 * 1024 * 1024


@pytest.fixture
def owner(make_user, project_of):
    token = make_user("alice")
    return token, project_of(token)


def _upload(client, token, pid, name, data, content_type):
    return client.post(f"/projects/{pid}/files", files={"file": (name, io.BytesIO(data), content_type)}, headers=auth(token))


def test_upload_route_is_sync_so_it_runs_in_a_thread():
    assert not inspect.iscoroutinefunction(files_router.upload_file)


def test_upload_stores_unique_public_id_and_metadata(client, owner, fake_cloudinary):
    token, pid = owner
    first = _upload(client, token, pid, "logo.png", PNG, "image/png").json()["file"]
    second = _upload(client, token, pid, "logo.png", PNG, "image/png").json()["file"]

    ids = [u["public_id"] for u in fake_cloudinary["uploads"]]
    assert all(re.fullmatch(rf"projects/{pid}/[0-9a-f]{{32}}", i) for i in ids)
    assert ids[0] != ids[1]  # same filename no longer collides
    assert first["url"] != second["url"]
    assert fake_cloudinary["uploads"][0]["overwrite"] is False

    with SessionLocal() as db:
        row = db.query(FileModel).filter(FileModel.id == first["id"]).one()
        assert (row.public_id, row.resource_type, row.content_type, row.size_bytes) == (ids[0], "image", "image/png", len(PNG))


def test_raw_files_keep_their_extension(client, owner, fake_cloudinary):
    token, pid = owner
    assert _upload(client, token, pid, "main.py", b"print(1)", "application/octet-stream").status_code == 201
    upload = fake_cloudinary["uploads"][0]
    assert upload["resource_type"] == "raw" and upload["public_id"].endswith(".py")


@pytest.mark.parametrize("name,data,content_type,status", [
    ("x.svg", b"<svg/>", "image/svg+xml", 415),
    ("x.html", b"<html>", "text/html", 415),
    ("fake.png", b"<script>alert(1)</script>", "image/png", 415),
    ("empty.txt", b"", "text/plain", 400),
])
def test_rejected_uploads_never_reach_cloudinary(client, owner, fake_cloudinary, name, data, content_type, status):
    token, pid = owner
    r = _upload(client, token, pid, name, data, content_type)
    assert r.status_code == status, r.text
    assert fake_cloudinary["uploads"] == []
    assert client.get(f"/projects/{pid}/files", headers=auth(token)).json()["files"] == []


def test_oversized_upload_rejected_by_header_before_reading_body(client, owner, fake_cloudinary):
    token, pid = owner
    r = _upload(client, token, pid, "big.txt", b"x" * (TEN_MB + 200 * 1024), "text/plain")
    assert r.status_code == 413 and r.json()["detail"] == "Files can be at most 10 MB."
    assert fake_cloudinary["uploads"] == []


def test_slightly_oversized_file_caught_by_route_check(client, owner, fake_cloudinary):
    """Within the middleware's framing allowance, but the file itself is too big."""
    token, pid = owner
    r = _upload(client, token, pid, "big.txt", b"x" * (TEN_MB + 100), "text/plain")
    assert r.status_code == 413
    assert fake_cloudinary["uploads"] == []


def test_exactly_ten_megabytes_is_allowed(client, owner, fake_cloudinary):
    token, pid = owner
    assert _upload(client, token, pid, "big.txt", b"x" * TEN_MB, "text/plain").status_code == 201


def test_upload_without_content_length_is_411(client, owner):
    token, pid = owner

    def chunked_body():
        yield b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\n\r\nhi\r\n--b--\r\n"

    r = client.post(
        f"/projects/{pid}/files",
        content=chunked_body(),
        headers={**auth(token), "Content-Type": "multipart/form-data; boundary=b"},
    )
    assert r.status_code == 411


def test_size_errors_still_carry_cors_headers(client, owner):
    token, pid = owner
    r = client.post(
        f"/projects/{pid}/files",
        files={"file": ("big.txt", io.BytesIO(b"x" * (TEN_MB + 200 * 1024)), "text/plain")},
        headers={**auth(token), "Origin": "http://frontend.test"},
    )
    assert r.status_code == 413
    assert r.headers.get("access-control-allow-origin") == "http://frontend.test"


def test_cloudinary_outage_is_502_and_saves_nothing(client, owner, fake_cloudinary):
    token, pid = owner
    fake_cloudinary["fail_upload"] = True
    assert _upload(client, token, pid, "a.png", PNG, "image/png").status_code == 502
    assert client.get(f"/projects/{pid}/files", headers=auth(token)).json()["files"] == []


def test_delete_removes_asset_from_cloudinary(client, owner, fake_cloudinary):
    token, pid = owner
    file = _upload(client, token, pid, "a.png", PNG, "image/png").json()["file"]
    assert client.delete(f"/files/{file['id']}", headers=auth(token)).status_code == 204
    assert fake_cloudinary["destroyed"] == [(fake_cloudinary["uploads"][0]["public_id"], "image")]


def test_delete_already_gone_asset_still_succeeds(client, owner, fake_cloudinary):
    token, pid = owner
    file = _upload(client, token, pid, "a.png", PNG, "image/png").json()["file"]
    fake_cloudinary["destroy_result"] = "not found"
    assert client.delete(f"/files/{file['id']}", headers=auth(token)).status_code == 204


def test_failed_cloudinary_delete_keeps_the_row(client, owner, fake_cloudinary):
    token, pid = owner
    file = _upload(client, token, pid, "a.png", PNG, "image/png").json()["file"]
    fake_cloudinary["destroy_result"] = "error"
    assert client.delete(f"/files/{file['id']}", headers=auth(token)).status_code == 502
    assert len(client.get(f"/projects/{pid}/files", headers=auth(token)).json()["files"]) == 1


def test_legacy_file_without_public_id_is_deleted_locally(client, owner, fake_cloudinary):
    token, pid = owner
    with SessionLocal() as db:
        legacy = FileModel(filename="old.pdf", url="https://res.cloudinary.test/old.pdf", project_id=pid)
        db.add(legacy)
        db.commit()
        legacy_id = legacy.id
    assert client.delete(f"/files/{legacy_id}", headers=auth(token)).status_code == 204
    assert fake_cloudinary["destroyed"] == []


def test_deleting_a_project_removes_its_assets(client, owner, fake_cloudinary):
    token, pid = owner
    _upload(client, token, pid, "a.png", PNG, "image/png")
    _upload(client, token, pid, "b.txt", b"hi", "text/plain")
    fake_cloudinary["destroy_result"] = "error"  # one failure must not block the project delete
    assert client.delete(f"/projects/{pid}", headers=auth(token)).status_code == 204
    assert len(fake_cloudinary["destroyed"]) == 2
