"""Multi-file projects: paths, folders, languages, permissions."""
import pytest
from conftest import add_member, auth

from app.core.database import SessionLocal
from app.models import ActivityModel, CodeFileModel
from app.routers import code as code_router
from app.services.code_paths import language_for_path, path_conflict, path_problem


@pytest.fixture
def team(client, make_user, project_of):
    tokens = {name: make_user(name) for name in ("olivia", "eddie", "vera", "oscar")}
    pid = project_of(tokens["olivia"], "Apollo")
    add_member("eddie", pid, "editor")
    add_member("vera", pid, "viewer")
    return {
        "pid": pid,
        "other_pid": project_of(tokens["oscar"], "Other"),
        "owner": auth(tokens["olivia"]),
        "editor": auth(tokens["eddie"]),
        "viewer": auth(tokens["vera"]),
        "outsider": auth(tokens["oscar"]),
    }


def _create(client, team, path, content="", who="editor"):
    return client.post(f"/projects/{team['pid']}/code/files", json={"path": path, "content": content}, headers=team[who])


def _paths(client, team, who="viewer"):
    r = client.get(f"/projects/{team['pid']}/code/files", headers=team[who])
    assert r.status_code == 200, r.text
    return [f["path"] for f in r.json()["code_files"]]


# ---- files ----

def test_create_read_save_and_list(client, team):
    r = _create(client, team, "src/app.py", "print(1)")
    assert r.status_code == 201, r.text
    created = r.json()["code_file"]
    assert (created["path"], created["language"], created["content"]) == ("src/app.py", "python", "print(1)")
    assert created["created_at"] and created["updated_at"]

    r = client.put(f"/code-files/{created['id']}", json={"content": "print(2)"}, headers=team["editor"])
    assert r.status_code == 200, r.text
    assert "content" not in r.json()["code_file"]
    assert client.get(f"/code-files/{created['id']}", headers=team["viewer"]).json()["code_file"]["content"] == "print(2)"


def test_list_is_sorted_and_leaves_out_content(client, team):
    for path in ("z.py", "a/b.js", "m.md"):
        _create(client, team, path, "secret body")
    r = client.get(f"/projects/{team['pid']}/code/files", headers=team["viewer"]).json()["code_files"]
    assert [f["path"] for f in r] == ["a/b.js", "m.md", "z.py"]
    assert all("content" not in f for f in r)


def test_a_project_can_start_with_no_files(client, team):
    assert _paths(client, team) == []


def test_same_path_is_fine_in_another_project(client, team):
    assert _create(client, team, "main.py").status_code == 201
    r = client.post(f"/projects/{team['other_pid']}/code/files", json={"path": "main.py"}, headers=team["outsider"])
    assert r.status_code == 201


@pytest.mark.parametrize("first,second", [
    ("a.py", "a.py"),      # same file
    ("a", "a/b.py"),       # a file can't contain files
    ("a/b.py", "a"),       # a folder can't become a file
    ("a/b/c.py", "a/b"),
])
def test_conflicting_paths_are_refused(client, team, first, second):
    assert _create(client, team, first).status_code == 201
    r = _create(client, team, second)
    assert r.status_code == 409, r.text
    assert _paths(client, team) == [first]


@pytest.mark.parametrize("path", [
    "", " ", "/a.py", "a.py/", "a//b.py", "../a.py", "a/../b.py", "./a.py", ".git/config", "a/.git/x",
    "a\\b.py", "a:b.py", "a*.py", "a?.py", 'a".py', "a<b.py", "a|b.py", " a.py", "a.py ", "a /b.py", "a\nb.py",
    "x" * 101, "/".join(["abcdefgh"] * 40),
])
def test_invalid_paths_are_refused(client, team, path):
    r = _create(client, team, path)
    assert r.status_code == 422, r.text
    assert _paths(client, team) == []


@pytest.mark.parametrize("path", ["README", ".gitignore", "src/my file.py", "dir.v2/a-b_c.js", "ünï/cödé.py", "100%_done.py"])
def test_valid_paths_are_accepted(client, team, path):
    assert _create(client, team, path).status_code == 201


def test_size_limits(client, team, monkeypatch):
    assert _create(client, team, "big.py", "x" * 1_000_001).status_code == 422
    created = _create(client, team, "ok.py", "x" * 1_000_000)
    assert created.status_code == 201
    r = client.put(f"/code-files/{created.json()['code_file']['id']}", json={"content": "x" * 1_000_001}, headers=team["editor"])
    assert r.status_code == 422

    monkeypatch.setattr(code_router, "MAX_FILES_PER_PROJECT", 1)
    r = _create(client, team, "second.py")
    assert r.status_code == 409 and "at most 1" in r.json()["detail"]


# ---- languages ----

@pytest.mark.parametrize("path,language", [
    ("a.py", "python"), ("a.PY", "python"), ("x/y/a.js", "javascript"), ("a.tsx", "typescript"), ("a.cpp", "cpp"),
    ("a.md", "markdown"), ("Dockerfile", "dockerfile"), ("a.yml", "yaml"), ("README", "plaintext"),
    (".gitignore", "plaintext"), ("a.unknown", "plaintext"),
])
def test_language_comes_from_the_extension(path, language):
    assert language_for_path(path) == language


def test_path_helpers_directly():
    assert path_problem("a/b.py") is None
    assert "already exists" in path_conflict("a.py", ["a.py"])
    assert path_conflict("ab/c.py", ["a"]) is None  # a shared prefix isn't a parent folder
    assert path_conflict("a", ["ab/c.py"]) is None


# ---- rename and delete ----

def test_rename_moves_and_updates_language(client, team):
    file_id = _create(client, team, "a.py", "body").json()["code_file"]["id"]
    r = client.patch(f"/code-files/{file_id}", json={"path": "src/a.js"}, headers=team["editor"])
    assert r.status_code == 200, r.text
    assert (r.json()["code_file"]["path"], r.json()["code_file"]["language"]) == ("src/a.js", "javascript")
    assert client.get(f"/code-files/{file_id}", headers=team["viewer"]).json()["code_file"]["content"] == "body"


def test_rename_to_the_same_path_changes_nothing(client, team):
    file_id = _create(client, team, "a.py").json()["code_file"]["id"]
    assert client.patch(f"/code-files/{file_id}", json={"path": "a.py"}, headers=team["editor"]).status_code == 200
    with SessionLocal() as db:
        assert db.query(ActivityModel).filter(ActivityModel.action == "code_renamed").count() == 0


@pytest.mark.parametrize("target", ["b.py", "dir", "b.py/c.py"])
def test_rename_conflicts_are_refused(client, team, target):
    file_id = _create(client, team, "a.py").json()["code_file"]["id"]
    _create(client, team, "b.py")
    _create(client, team, "dir/c.py")
    assert client.patch(f"/code-files/{file_id}", json={"path": target}, headers=team["editor"]).status_code == 409
    assert "a.py" in _paths(client, team)


def test_delete_a_file(client, team):
    file_id = _create(client, team, "a.py").json()["code_file"]["id"]
    assert client.delete(f"/code-files/{file_id}", headers=team["editor"]).status_code == 204
    assert client.get(f"/code-files/{file_id}", headers=team["editor"]).status_code == 404


# ---- folders ----

def test_rename_folder_moves_everything_inside(client, team):
    for path in ("src/a.py", "src/deep/b.js", "srcfoo/c.py", "top.md"):
        _create(client, team, path)
    r = client.post(f"/projects/{team['pid']}/code/folders/rename", json={"path": "src", "new_path": "lib/core"}, headers=team["editor"])
    assert r.status_code == 200, r.text
    assert [f["path"] for f in r.json()["code_files"]] == ["lib/core/a.py", "lib/core/deep/b.js"]
    assert _paths(client, team) == ["lib/core/a.py", "lib/core/deep/b.js", "srcfoo/c.py", "top.md"]


def test_rename_folder_is_all_or_nothing(client, team):
    for path in ("src/a.py", "src/b.py", "lib/b.py"):
        _create(client, team, path)
    r = client.post(f"/projects/{team['pid']}/code/folders/rename", json={"path": "src", "new_path": "lib"}, headers=team["editor"])
    assert r.status_code == 409, r.text
    assert _paths(client, team) == ["lib/b.py", "src/a.py", "src/b.py"]


@pytest.mark.parametrize("new_path", ["src", "src/inner"])
def test_a_folder_cannot_move_into_itself(client, team, new_path):
    _create(client, team, "src/a.py")
    r = client.post(f"/projects/{team['pid']}/code/folders/rename", json={"path": "src", "new_path": new_path}, headers=team["editor"])
    assert r.status_code == 409


def test_folder_rename_length_limit_applies_to_the_result(client, team):
    _create(client, team, "s/" + "a" * 100)
    new_path = "/".join(["b" * 50] * 4)
    r = client.post(f"/projects/{team['pid']}/code/folders/rename", json={"path": "s", "new_path": new_path}, headers=team["editor"])
    assert r.status_code == 422, r.text


def test_delete_folder_only_touches_that_folder(client, team):
    for path in ("src/a.py", "src/deep/b.js", "srcfoo/c.py", "top.md"):
        _create(client, team, path)
    r = client.post(f"/projects/{team['pid']}/code/folders/delete", json={"path": "src"}, headers=team["editor"])
    assert r.status_code == 200, r.text
    assert len(r.json()["deleted"]) == 2
    assert _paths(client, team) == ["srcfoo/c.py", "top.md"]


def test_folder_names_with_wildcards_are_taken_literally(client, team):
    for path in ("a_b/x.py", "axb/y.py"):
        _create(client, team, path)
    client.post(f"/projects/{team['pid']}/code/folders/delete", json={"path": "a_b"}, headers=team["editor"])
    assert _paths(client, team) == ["axb/y.py"]


@pytest.mark.parametrize("action,body", [
    ("rename", {"path": "nope", "new_path": "x"}),
    ("delete", {"path": "nope"}),
])
def test_missing_folder_is_404(client, team, action, body):
    assert client.post(f"/projects/{team['pid']}/code/folders/{action}", json=body, headers=team["editor"]).status_code == 404


def test_folder_routes_validate_paths(client, team):
    _create(client, team, "src/a.py")
    pid = team["pid"]
    assert client.post(f"/projects/{pid}/code/folders/rename", json={"path": "src", "new_path": "../x"}, headers=team["editor"]).status_code == 422
    assert client.post(f"/projects/{pid}/code/folders/delete", json={"path": "src/"}, headers=team["editor"]).status_code == 422


# ---- permissions ----

@pytest.fixture
def seeded(client, team):
    team["file_id"] = _create(client, team, "src/a.py", "secret", "owner").json()["code_file"]["id"]
    return team


def _routes(team):
    pid, file_id = team["pid"], team["file_id"]
    return [
        ("GET", f"/projects/{pid}/code/files", None, "viewer"),
        ("GET", f"/code-files/{file_id}", None, "viewer"),
        ("POST", f"/projects/{pid}/code/files", {"path": "new.py"}, "editor"),
        ("PUT", f"/code-files/{file_id}", {"content": "changed"}, "editor"),
        ("PATCH", f"/code-files/{file_id}", {"path": "src/renamed.py"}, "editor"),
        ("POST", f"/projects/{pid}/code/folders/rename", {"path": "src", "new_path": "lib"}, "editor"),
        ("POST", f"/projects/{pid}/code/folders/delete", {"path": "src"}, "editor"),
        ("DELETE", f"/code-files/{file_id}", None, "editor"),
    ]


ROUTE_COUNT = 8


@pytest.mark.parametrize("index", range(ROUTE_COUNT))
def test_viewer_is_read_only(client, seeded, index):
    method, path, body, min_role = _routes(seeded)[index]
    r = client.request(method, path, json=body, headers=seeded["viewer"])
    if min_role == "viewer":
        assert r.status_code == 200, r.text
    else:
        assert r.status_code == 403, r.text
    assert client.get(f"/code-files/{seeded['file_id']}", headers=seeded["owner"]).json()["code_file"]["content"] == "secret"


@pytest.mark.parametrize("who", ["editor", "owner"])
@pytest.mark.parametrize("index", range(ROUTE_COUNT))
def test_editors_and_owners_can_do_all_of_it(client, seeded, who, index):
    method, path, body, _ = _routes(seeded)[index]
    r = client.request(method, path, json=body, headers=seeded[who])
    assert r.status_code < 300, r.text


@pytest.mark.parametrize("index", range(ROUTE_COUNT))
def test_outsiders_get_404_and_change_nothing(client, seeded, index):
    method, path, body, _ = _routes(seeded)[index]
    assert client.request(method, path, json=body, headers=seeded["outsider"]).status_code == 404
    file = client.get(f"/code-files/{seeded['file_id']}", headers=seeded["owner"]).json()["code_file"]
    assert (file["path"], file["content"]) == ("src/a.py", "secret")


@pytest.mark.parametrize("index", range(ROUTE_COUNT))
def test_login_is_required(client, seeded, index):
    method, path, body, _ = _routes(seeded)[index]
    assert client.request(method, path, json=body).status_code == 401


def test_a_removed_member_loses_access(client, seeded):
    me = client.get("/me", headers=seeded["editor"]).json()["id"]
    client.delete(f"/projects/{seeded['pid']}/members/{me}", headers=seeded["owner"])
    assert client.get(f"/code-files/{seeded['file_id']}", headers=seeded["editor"]).status_code == 404


# ---- activity ----

def test_activity_is_recorded_but_not_for_autosave(client, seeded):
    file_id, pid = seeded["file_id"], seeded["pid"]
    client.put(f"/code-files/{file_id}", json={"content": "x"}, headers=seeded["editor"])
    client.patch(f"/code-files/{file_id}", json={"path": "src/b.py"}, headers=seeded["editor"])
    client.post(f"/projects/{pid}/code/folders/rename", json={"path": "src", "new_path": "lib"}, headers=seeded["editor"])
    client.post(f"/projects/{pid}/code/folders/delete", json={"path": "lib"}, headers=seeded["editor"])
    feed = client.get(f"/projects/{pid}/activity", headers=seeded["viewer"]).json()["activity"]
    assert [(e["action"], e["target"]) for e in feed] == [
        ("code_deleted", "lib/"),
        ("code_renamed", "src/ → lib/"),
        ("code_renamed", "src/a.py → src/b.py"),
        ("code_created", "src/a.py"),
    ]


def test_refused_changes_log_nothing(client, seeded):
    _create(client, seeded, "src/a.py")
    feed = client.get(f"/projects/{seeded['pid']}/activity", headers=seeded["viewer"]).json()["activity"]
    assert [e["action"] for e in feed] == ["code_created"]


# ---- single-file API, for tabs on the previous frontend ----

def test_legacy_api_works_on_the_oldest_file(client, team):
    first = _create(client, team, "first.py", "one").json()["code_file"]
    _create(client, team, "second.py", "two")
    legacy = client.get(f"/projects/{team['pid']}/code", headers=team["viewer"]).json()["code_file"]
    assert legacy["id"] == first["id"] and legacy["content"] == "one"
    client.put(f"/projects/{team['pid']}/code", json={"content": "edited", "language": "python"}, headers=team["editor"])
    assert client.get(f"/code-files/{first['id']}", headers=team["viewer"]).json()["code_file"]["content"] == "edited"
    assert _paths(client, team) == ["first.py", "second.py"]


@pytest.mark.parametrize("language,path", [("javascript", "main.js"), ("python", "main.py"), ("ruby", "main.txt")])
def test_legacy_put_names_a_new_file_like_it_always_did(client, team, language, path):
    client.put(f"/projects/{team['pid']}/code", json={"content": "x", "language": language}, headers=team["editor"])
    assert _paths(client, team) == [path]


def test_deleting_a_project_removes_all_its_files(client, seeded):
    _create(client, seeded, "other.py")
    assert client.delete(f"/projects/{seeded['pid']}", headers=seeded["owner"]).status_code == 204
    with SessionLocal() as db:
        assert db.query(CodeFileModel).filter(CodeFileModel.project_id == seeded["pid"]).count() == 0
