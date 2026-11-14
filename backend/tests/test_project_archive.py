"""Project ZIP export (any member) and import (owner/editor), with every safety check."""
import io
import json
import os
import stat
import zipfile

import pytest
from conftest import add_member, auth

from app.core.database import SessionLocal
from app.models import ActivityModel, CodeFileModel, UserModel
from app.routers import archive as archive_router
from app.services import project_archive


def make_zip(files: dict, *, symlinks=(), compression=zipfile.ZIP_DEFLATED) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=compression) as z:
        for name, content in files.items():
            z.writestr(name, content)
        for name, target in symlinks:
            info = zipfile.ZipInfo(name)
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(info, target)
    return buffer.getvalue()


@pytest.fixture
def owner(make_user):
    return make_user("olivia")


@pytest.fixture
def project(owner, project_of):
    return project_of(owner, "Weather CLI")


def paths(project_id):
    with SessionLocal() as db:
        return sorted(p for (p,) in db.query(CodeFileModel.path).filter(CodeFileModel.project_id == project_id).all())


def content(project_id, path):
    with SessionLocal() as db:
        return db.query(CodeFileModel.content).filter(CodeFileModel.project_id == project_id, CodeFileModel.path == path).scalar()


def create_file(client, token, project_id, path, text="x"):
    r = client.post(f"/projects/{project_id}/code/files", json={"path": path, "content": text}, headers=auth(token))
    assert r.status_code == 201, r.text


def upload(client, token, project_id, data, *, dry_run=True, decisions=None, name="code.zip"):
    form = {"dry_run": "true" if dry_run else "false", "decisions": json.dumps(decisions or {})}
    return client.post(f"/projects/{project_id}/code/import", files={"file": (name, data, "application/zip")}, data=form, headers=auth(token))


def by_path(report):
    return {e["path"]: e for e in report["entries"]}


# ---------------- export

def test_export_contains_code_tasks_and_readme_but_no_secrets(client, owner, project):
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == "olivia").one().email = "olivia@example.test"
        db.commit()
    create_file(client, owner, project, "src/main.py", "print('hi')\n")
    create_file(client, owner, project, "README.md", "# docs")
    client.post(f"/projects/{project}/tasks", json={"title": "Write tests"}, headers=auth(owner))
    r = client.get(f"/projects/{project}/export", headers=auth(owner))
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"].startswith('attachment; filename="Weather-CLI-')
    assert r.headers["cache-control"] == "no-store"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert sorted(z.namelist()) == ["README.md", "code/README.md", "code/src/main.py", "tasks.json"]
    assert z.read("code/src/main.py").decode() == "print('hi')\n"
    tasks = json.loads(z.read("tasks.json"))
    assert [t["title"] for t in tasks["tasks"]] == ["Write tests"]
    assert set(tasks["tasks"][0]) == {"id", "title", "description", "status", "priority", "due_date", "assignee", "created_at", "updated_at"}
    readme = z.read("README.md").decode()
    assert readme.startswith("# Weather CLI") and "2 code files" in readme and "1 task " in readme
    everything = b"".join(z.read(n) for n in z.namelist())
    assert b"olivia@example.test" not in everything
    assert b"hashed_password" not in everything and b"github_token" not in everything


@pytest.mark.parametrize("role", ["viewer", "editor"])
def test_any_member_can_export(client, make_user, project, role):
    token = make_user(f"m_{role}")
    add_member(f"m_{role}", project, role)
    assert client.get(f"/projects/{project}/export", headers=auth(token)).status_code == 200


def test_export_needs_membership(client, make_user, project):
    assert client.get(f"/projects/{project}/export").status_code == 401
    assert client.get(f"/projects/{project}/export", headers=auth(make_user("stranger"))).status_code == 404
    assert client.get("/projects/999999/export", headers=auth(make_user("other"))).status_code == 404


# ---------------- import: who may

def test_viewer_cannot_import(client, make_user, project):
    viewer = make_user("vic")
    add_member("vic", project, "viewer")
    r = upload(client, viewer, project, make_zip({"a.py": "x"}), dry_run=False)
    assert r.status_code == 403
    assert paths(project) == []


def test_non_member_and_anonymous_cannot_import(client, make_user, project):
    assert upload(client, make_user("stranger"), project, make_zip({"a.py": "x"})).status_code == 404
    r = client.post(f"/projects/{project}/code/import", files={"file": ("a.zip", make_zip({"a.py": "x"}), "application/zip")})
    assert r.status_code == 401


def test_editor_can_import(client, make_user, project):
    editor = make_user("eddie")
    add_member("eddie", project, "editor")
    r = upload(client, editor, project, make_zip({"a.py": "print(1)"}), dry_run=False)
    assert r.status_code == 200, r.text
    assert paths(project) == ["a.py"]


# ---------------- import: preview, then create

def test_dry_run_reports_and_writes_nothing(client, owner, project):
    create_file(client, owner, project, "src/main.py")
    data = make_zip({"src/main.py": "new", "src/util.py": "u", "logo.png": "\x89PNG"})
    r = upload(client, owner, project, data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    entries = by_path(body)
    assert entries["src/main.py"]["status"] == "duplicate"
    assert entries["src/util.py"]["status"] == "new"
    assert entries["logo.png"]["status"] == "skipped" and "Binary" in entries["logo.png"]["reason"]
    assert body["summary"] == {"new": 1, "duplicate": 1, "skipped": 1}
    assert body["capacity"] == 499
    assert paths(project) == ["src/main.py"]


def test_import_creates_files_and_records_activity(client, owner, project):
    r = upload(client, owner, project, make_zip({"src/app.py": "print('app')\n", "docs/notes.md": "# hi"}), dry_run=False, name="starter.zip")
    assert r.status_code == 200, r.text
    assert r.json()["created"] == ["src/app.py", "docs/notes.md"]
    assert paths(project) == ["docs/notes.md", "src/app.py"]
    assert content(project, "src/app.py") == "print('app')\n"
    with SessionLocal() as db:
        entry = db.query(ActivityModel).filter(ActivityModel.project_id == project, ActivityModel.action == "code_created").one()
        assert entry.target == "2 files from starter.zip"
        assert db.query(CodeFileModel.language).filter(CodeFileModel.path == "src/app.py").scalar() == "python"


def test_duplicates_skip_by_default_or_rename(client, owner, project):
    create_file(client, owner, project, "main.py", "old")
    create_file(client, owner, project, "lib/util.py", "old util")
    data = make_zip({"main.py": "new main", "lib/util.py": "new util"})
    r = upload(client, owner, project, data, dry_run=False, decisions={"main.py": "rename"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == ["main-2.py"]
    assert body["renamed"] == ["main.py"]
    assert [s["path"] for s in body["skipped"]] == ["lib/util.py"]
    assert content(project, "main.py") == "old"
    assert content(project, "main-2.py") == "new main"
    assert content(project, "lib/util.py") == "old util"


def test_rename_finds_the_next_free_name(client, owner, project):
    for path in ["a.py", "a-2.py"]:
        create_file(client, owner, project, path)
    r = upload(client, owner, project, make_zip({"a.py": "third"}), dry_run=False, decisions={"a.py": "rename"})
    assert r.json()["created"] == ["a-3.py"]


@pytest.mark.parametrize("decisions", ["not json", '["a.py"]', '{"a.py": "overwrite"}', '{"a.py": 1}'])
def test_bad_decisions_are_rejected(client, owner, project, decisions):
    r = client.post(
        f"/projects/{project}/code/import",
        files={"file": ("a.zip", make_zip({"a.py": "x"}), "application/zip")},
        data={"dry_run": "false", "decisions": decisions},
        headers=auth(owner),
    )
    assert r.status_code == 422
    assert paths(project) == []


# ---------------- import: hostile archives

@pytest.mark.parametrize(
    "name",
    [
        "../evil.py",
        "src/../../evil.py",
        "a/./b.py",
        "a//b.py",
        "/etc/passwd",
        "C:/Windows/evil.py",
        "c:evil.py",
        "dir\\evil.py",
        "..\\evil.py",
        ".git/config",
        "a/.git/hooks/pre-commit",
    ],
)
def test_zip_slip_and_absolute_paths_are_refused(client, owner, project, name):
    r = upload(client, owner, project, make_zip({name: "pwned", "ok.py": "fine"}), dry_run=False)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == ["ok.py"]
    assert len(body["skipped"]) == 1 and body["skipped"][0]["reason"]
    assert paths(project) == ["ok.py"]


def test_symlinks_are_refused(client, owner, project):
    data = make_zip({"ok.py": "fine"}, symlinks=[("link.py", "/etc/passwd")])
    body = upload(client, owner, project, data, dry_run=False).json()
    assert body["created"] == ["ok.py"]
    assert body["skipped"][0]["path"] == "link.py" and "link" in body["skipped"][0]["reason"]


def test_binaries_and_non_text_are_skipped(client, owner, project):
    data = make_zip({"notes.txt": "hello\x00world", "latin1.py": "caf\xe9".encode("latin-1"), "pic.JPG": "x", "ok.md": "fine"})
    body = upload(client, owner, project, data).json()
    entries = by_path(body)
    assert "Binary" in entries["notes.txt"]["reason"]
    assert "UTF-8" in entries["latin1.py"]["reason"]
    assert "Binary" in entries["pic.JPG"]["reason"]
    assert entries["ok.md"]["status"] == "new"


def test_junk_files_are_skipped(client, owner, project):
    data = make_zip({"__MACOSX/._a.py": "x", ".DS_Store": "x", "node_modules/x/index.js": "x", "a.py": "ok"})
    body = upload(client, owner, project, data).json()
    assert body["summary"] == {"new": 1, "duplicate": 0, "skipped": 3}


def test_per_file_size_limit(client, owner, project, monkeypatch):
    monkeypatch.setattr(project_archive, "MAX_FILE_BYTES", 1000)
    data = make_zip({"big.py": "x" * 1001, "small.py": "x" * 1000})
    entries = by_path(upload(client, owner, project, data).json())
    assert entries["big.py"]["status"] == "skipped" and "Larger" in entries["big.py"]["reason"]
    assert entries["small.py"]["status"] == "new"


def test_lying_size_header_is_caught_while_reading(monkeypatch):
    """A header claiming a small size can't smuggle in more: entries are read through a limit."""
    data = make_zip({"a.py": "x" * 5000})
    archive = zipfile.ZipFile(io.BytesIO(data))
    info = archive.getinfo("a.py")
    assert project_archive._read_limited(archive, info, 4999) is None
    assert project_archive._read_limited(archive, info, 5000) == b"x" * 5000


def test_zip_bomb_is_stopped(client, owner, project, monkeypatch):
    # Highly compressible: tiny compressed, huge uncompressed
    monkeypatch.setattr(project_archive, "MAX_FILE_BYTES", 10_000_000)
    data = make_zip({"bomb.txt": "0" * 3_000_000})
    assert len(data) < 20_000
    entry = by_path(upload(client, owner, project, data).json())["bomb.txt"]
    assert entry["status"] == "skipped" and "zip bomb" in entry["reason"]


def test_total_uncompressed_limit(client, owner, project, monkeypatch):
    monkeypatch.setattr(project_archive, "MAX_TOTAL_BYTES", 2000)
    data = make_zip({f"f{i}.py": os.urandom(400).hex()[:800] for i in range(4)})
    r = upload(client, owner, project, data)
    assert r.status_code == 422
    assert "unpack" in r.json()["detail"]


def test_too_many_entries(client, owner, project):
    data = make_zip({f"f{i}.py": "x" for i in range(project_archive.MAX_ENTRIES + 1)})
    r = upload(client, owner, project, data)
    assert r.status_code == 422
    assert "entries" in r.json()["detail"]


def test_project_file_limit(client, owner, project, monkeypatch):
    monkeypatch.setattr(archive_router, "MAX_FILES_PER_PROJECT", 3)
    create_file(client, owner, project, "one.py")
    r = upload(client, owner, project, make_zip({"a.py": "x", "b.py": "x", "c.py": "x"}), dry_run=False)
    assert r.status_code == 422
    assert "room for 2 more" in r.json()["detail"]
    assert paths(project) == ["one.py"]


def test_oversized_upload_is_rejected_from_its_header(client, owner, project):
    data = b"PK" + os.urandom(project_archive.MAX_ARCHIVE_BYTES + 100 * 1024)
    r = upload(client, owner, project, data)
    assert r.status_code == 413


def test_not_a_zip(client, owner, project):
    r = upload(client, owner, project, b"this is not a zip")
    assert r.status_code == 422
    assert "valid ZIP" in r.json()["detail"]


def test_file_folder_clash_and_repeats(client, owner, project):
    create_file(client, owner, project, "src")  # a file called src
    data = make_zip({"src/a.py": "x", "b.py": "1"})
    entries = by_path(upload(client, owner, project, data).json())
    assert entries["src/a.py"]["status"] == "skipped" and "is a file" in entries["src/a.py"]["reason"]
    assert entries["b.py"]["status"] == "new"


def test_single_top_folder_is_dropped(client, owner, project):
    body = upload(client, owner, project, make_zip({"my-repo/src/a.py": "x", "my-repo/README.md": "y"})).json()
    assert sorted(by_path(body)) == ["README.md", "src/a.py"]


def test_round_trip_from_a_nexuscode_export(client, owner, project, project_of):
    create_file(client, owner, project, "src/main.py", "print('round trip')\n")
    create_file(client, owner, project, "README.md", "# project readme")
    exported = client.get(f"/projects/{project}/export", headers=auth(owner)).content
    other = project_of(owner, "Copy")
    body = upload(client, owner, other, exported, dry_run=False).json()
    assert sorted(body["created"]) == ["README.md", "src/main.py"]
    # The export's own README.md and tasks.json are reported, not imported
    assert sorted(s["path"] for s in body["skipped"]) == ["README.md", "tasks.json"]
    assert content(other, "src/main.py") == "print('round trip')\n"
    assert content(other, "README.md") == "# project readme"


def test_every_check_runs_again_on_the_real_import(client, owner, project):
    """The preview is advice only: the real run analyses the ZIP afresh."""
    data = make_zip({"../evil.py": "x", "ok.py": "y"})
    body = upload(client, owner, project, data, dry_run=False, decisions={"../evil.py": "rename"}).json()
    assert body["created"] == ["ok.py"]
    assert paths(project) == ["ok.py"]
