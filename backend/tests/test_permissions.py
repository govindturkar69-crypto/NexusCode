"""
The permission matrix: every project-scoped route, for every role.
viewer = read only; editor = also tasks/files/code/chat; owner = everything.
Non-members get 404 (see test_ownership.py), too-low roles get 403.
"""
import io

import pytest
from conftest import add_member, auth, open_socket, set_github_token, ws_path
from starlette.websockets import WebSocketDisconnect

from app.core.database import SessionLocal
from app.core.deps import require_project_role, role_at_least
from app.models import ProjectMemberModel, TaskModel

# (method, path, json body, multipart, lowest role allowed)
ROUTES = [
    ("GET", "/projects/{pid}", None, False, "viewer"),
    ("GET", "/projects/{pid}/tasks", None, False, "viewer"),
    ("GET", "/projects/{pid}/files", None, False, "viewer"),
    ("GET", "/projects/{pid}/messages", None, False, "viewer"),
    ("GET", "/projects/{pid}/code", None, False, "viewer"),
    ("GET", "/projects/{pid}/code/files", None, False, "viewer"),
    ("GET", "/code-files/{code_file_id}", None, False, "viewer"),
    ("POST", "/projects/{pid}/tasks", {"title": "x"}, False, "editor"),
    ("PUT", "/tasks/{task_id}", {"status": "done"}, False, "editor"),
    ("DELETE", "/tasks/{task_id}", None, False, "editor"),
    ("POST", "/projects/{pid}/files", None, True, "editor"),
    ("DELETE", "/files/{file_id}", None, False, "editor"),
    ("PUT", "/projects/{pid}/code", {"content": "new", "language": "python"}, False, "editor"),
    ("POST", "/projects/{pid}/code/files", {"path": "new.py"}, False, "editor"),
    ("PUT", "/code-files/{code_file_id}", {"content": "new"}, False, "editor"),
    ("PATCH", "/code-files/{code_file_id}", {"path": "moved.py"}, False, "editor"),
    ("DELETE", "/code-files/{code_file_id}", None, False, "editor"),
    ("POST", "/projects/{pid}/push-to-github", {"repo_name": "repo"}, False, "owner"),
    ("DELETE", "/projects/{pid}", None, False, "owner"),
]
ROLES = ("viewer", "editor", "owner")
CASES = [(role, *route) for role in ROLES for route in ROUTES]


@pytest.fixture
def team(client, make_user, project_of, fake_cloudinary, fake_github_http):
    tokens = {"owner": make_user("olivia"), "editor": make_user("eddie"), "viewer": make_user("vera")}
    pid = project_of(tokens["owner"], "team-project")
    add_member("eddie", pid, "editor")
    add_member("vera", pid, "viewer")
    owner = auth(tokens["owner"])
    task_id = client.post(f"/projects/{pid}/tasks", json={"title": "t"}, headers=owner).json()["task"]["id"]
    file_id = client.post(
        f"/projects/{pid}/files", files={"file": ("n.txt", io.BytesIO(b"hi"), "text/plain")}, headers=owner
    ).json()["file"]["id"]
    code_file_id = client.put(f"/projects/{pid}/code", json={"content": "x", "language": "python"}, headers=owner).json()["code_file"]["id"]
    for name in ("olivia", "eddie", "vera"):
        set_github_token(name, f"gho_{name}")
    return {"tokens": tokens, "pid": pid, "task_id": task_id, "file_id": file_id, "code_file_id": code_file_id, "github": fake_github_http}


@pytest.mark.parametrize(
    "role,method,path,body,multipart,min_role", CASES, ids=[f"{c[0]}-{c[1]} {c[2]}" for c in CASES]
)
def test_role_matrix(client, team, role, method, path, body, multipart, min_role):
    kwargs = {"headers": auth(team["tokens"][role])}
    if multipart:
        kwargs["files"] = {"file": ("a.txt", io.BytesIO(b"x"), "text/plain")}
    elif body is not None:
        kwargs["json"] = body
    r = client.request(method, path.format(pid=team["pid"], task_id=team["task_id"], file_id=team["file_id"], code_file_id=team["code_file_id"]), **kwargs)
    if role_at_least(role, min_role):
        assert r.status_code < 300, r.text
    else:
        assert r.status_code == 403, r.text
        assert min_role in r.json()["detail"]


def test_lower_roles_cannot_push_and_nothing_reaches_github(client, team):
    for role in ("viewer", "editor"):
        r = client.post(f"/projects/{team['pid']}/push-to-github", json={"repo_name": "x"}, headers=auth(team["tokens"][role]))
        assert r.status_code == 403
    assert team["github"]["calls"] == []


def test_refused_writes_change_nothing(client, team):
    viewer = auth(team["tokens"]["viewer"])
    client.put(f"/tasks/{team['task_id']}", json={"status": "done"}, headers=viewer)
    client.delete(f"/tasks/{team['task_id']}", headers=viewer)
    client.put(f"/projects/{team['pid']}/code", json={"content": "hacked", "language": "python"}, headers=viewer)
    with SessionLocal() as db:
        assert db.get(TaskModel, team["task_id"]).status == "todo"
    assert client.get(f"/projects/{team['pid']}/code", headers=viewer).json()["code_file"]["content"] == "x"


def test_task_and_file_routes_check_the_objects_own_project(client, make_user, project_of, team):
    """A role in one project gives nothing in another (ids can't be swapped)."""
    outsider = make_user("oscar")
    project_of(outsider, "oscar-project")  # owner somewhere else
    headers = auth(outsider)
    assert client.put(f"/tasks/{team['task_id']}", json={"status": "done"}, headers=headers).status_code == 404
    assert client.delete(f"/files/{team['file_id']}", headers=headers).status_code == 404


def test_creator_without_membership_row_has_no_access(client, team):
    """project_members decides access, not projects.owner_id."""
    with SessionLocal() as db:
        db.query(ProjectMemberModel).filter(ProjectMemberModel.project_id == team["pid"], ProjectMemberModel.role == "owner").delete()
        db.commit()
    assert client.get(f"/projects/{team['pid']}", headers=auth(team["tokens"]["owner"])).status_code == 404


def test_creating_a_project_makes_you_its_owner(client, make_user, project_of):
    token = make_user("zoe")
    pid = project_of(token)
    with SessionLocal() as db:
        member = db.query(ProjectMemberModel).filter(ProjectMemberModel.project_id == pid).one()
        assert member.role == "owner"


def test_analytics_counts_every_project_you_are_a_member_of(client, team):
    stats = client.get("/analytics", headers=auth(team["tokens"]["viewer"])).json()
    assert stats["total_projects"] == 1 and stats["total_tasks"] == 1 and stats["total_files"] == 1


@pytest.mark.parametrize("role", ROLES)
def test_every_member_role_can_open_sockets(client, team, role):
    with open_socket(client, team["tokens"][role], team["pid"]):
        pass


def test_viewer_reads_chat_but_cannot_post(client, team):
    pid = team["pid"]
    with open_socket(client, team["tokens"]["viewer"], pid) as viewer, \
            open_socket(client, team["tokens"]["editor"], pid) as editor:
        viewer.send_json({"content": "let me in"})
        assert viewer.receive_json()["type"] == "error"
        editor.send_json({"content": "hello"})
        assert viewer.receive_json()["content"] == "hello"  # the viewer's message was never broadcast
        assert editor.receive_json()["content"] == "hello"
    messages = client.get(f"/projects/{pid}/messages", headers=auth(team["tokens"]["owner"])).json()["messages"]
    assert [m["content"] for m in messages] == ["hello"]


def test_role_change_applies_to_an_open_chat_socket(client, team):
    with open_socket(client, team["tokens"]["editor"], team["pid"]) as ws:
        ws.send_json({"content": "still editor"})
        assert ws.receive_json()["content"] == "still editor"
        with SessionLocal() as db:
            db.query(ProjectMemberModel).filter(ProjectMemberModel.project_id == team["pid"], ProjectMemberModel.role == "editor").update({"role": "viewer"})
            db.commit()
        ws.send_json({"content": "now viewer"})
        assert ws.receive_json()["type"] == "error"


def test_removed_member_socket_is_closed_on_next_message(client, team):
    with open_socket(client, team["tokens"]["editor"], team["pid"]) as ws:
        with SessionLocal() as db:
            db.query(ProjectMemberModel).filter(ProjectMemberModel.project_id == team["pid"], ProjectMemberModel.role == "editor").delete()
            db.commit()
        ws.send_json({"content": "hello?"})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1008


def test_ticket_issued_before_removal_is_refused(client, team):
    path = ws_path(client, team["tokens"]["editor"], team["pid"])
    with SessionLocal() as db:
        db.query(ProjectMemberModel).filter(ProjectMemberModel.project_id == team["pid"], ProjectMemberModel.role == "editor").delete()
        db.commit()
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(path):
            pass
    assert closed.value.code == 1008


def test_unknown_role_is_a_programming_error():
    with pytest.raises(ValueError):
        require_project_role("admin")
