"""
IDOR tests: every route that touches a project's data must refuse a user who
doesn't own that project, and must refuse anonymous callers.
"""
import io

import pytest
from conftest import auth, open_socket, set_github_token


@pytest.fixture
def world(client, make_user, project_of, fake_cloudinary):
    """alice owns one project with a task, a file, a message and code; bob owns nothing."""
    alice = make_user("alice")
    bob = make_user("bob")
    pid = project_of(alice, "alice-project")
    task_id = client.post(f"/projects/{pid}/tasks", json={"title": "t"}, headers=auth(alice)).json()["task"]["id"]
    file_id = client.post(
        f"/projects/{pid}/files",
        files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
        headers=auth(alice),
    ).json()["file"]["id"]
    client.put(f"/projects/{pid}/code", json={"content": "print('secret')", "language": "python"}, headers=auth(alice))
    with open_socket(client, alice, pid) as ws:
        ws.send_json({"content": "alice's secret message"})
        ws.receive_json()
    set_github_token("bob", "gho_bob")
    return {"alice": alice, "bob": bob, "pid": pid, "task_id": task_id, "file_id": file_id}


# (method, path template, json body or None, multipart?)
PROJECT_ROUTES = [
    ("GET", "/projects/{pid}", None, False),
    ("DELETE", "/projects/{pid}", None, False),
    ("POST", "/projects/{pid}/tasks", {"title": "x"}, False),
    ("GET", "/projects/{pid}/tasks", None, False),
    ("PUT", "/tasks/{task_id}", {"status": "done"}, False),
    ("DELETE", "/tasks/{task_id}", None, False),
    ("POST", "/projects/{pid}/files", None, True),
    ("GET", "/projects/{pid}/files", None, False),
    ("DELETE", "/files/{file_id}", None, False),
    ("GET", "/projects/{pid}/messages", None, False),
    ("GET", "/projects/{pid}/code", None, False),
    ("PUT", "/projects/{pid}/code", {"content": "pwned", "language": "python"}, False),
    ("POST", "/projects/{pid}/push-to-github", {"repo_name": "stolen"}, False),
]


def _call(client, world, method, path, body, multipart, token):
    url = path.format(**world)
    kwargs = {"headers": auth(token) if token else {}}
    if multipart:
        kwargs["files"] = {"file": ("evil.txt", io.BytesIO(b"x"), "text/plain")}
    elif body is not None:
        kwargs["json"] = body
    return client.request(method, url, **kwargs)


@pytest.mark.parametrize("method,path,body,multipart", PROJECT_ROUTES, ids=[f"{m} {p}" for m, p, *_ in PROJECT_ROUTES])
def test_other_user_gets_404(client, world, fake_github_http, method, path, body, multipart):
    r = _call(client, world, method, path, body, multipart, world["bob"])
    assert r.status_code == 404, r.text
    # Nothing was sent to GitHub on bob's behalf
    assert fake_github_http["calls"] == []


@pytest.mark.parametrize("method,path,body,multipart", PROJECT_ROUTES, ids=[f"{m} {p}" for m, p, *_ in PROJECT_ROUTES])
def test_anonymous_gets_401(client, world, method, path, body, multipart):
    r = _call(client, world, method, path, body, multipart, None)
    assert r.status_code == 401


def test_owner_data_is_untouched_after_attacks(client, world, fake_github_http):
    for method, path, body, multipart in PROJECT_ROUTES:
        _call(client, world, method, path, body, multipart, world["bob"])
    alice, pid = world["alice"], world["pid"]
    assert client.get(f"/projects/{pid}", headers=auth(alice)).status_code == 200
    assert [t["status"] for t in client.get(f"/projects/{pid}/tasks", headers=auth(alice)).json()["tasks"]] == ["todo"]
    assert len(client.get(f"/projects/{pid}/files", headers=auth(alice)).json()["files"]) == 1
    assert client.get(f"/projects/{pid}/code", headers=auth(alice)).json()["code_file"]["content"] == "print('secret')"
    messages = client.get(f"/projects/{pid}/messages", headers=auth(alice)).json()["messages"]
    assert [m["content"] for m in messages] == ["alice's secret message"]


def test_project_lists_only_show_own_projects(client, world, project_of):
    project_of(world["bob"], "bob-project")
    alice_names = [p["name"] for p in client.get("/projects", headers=auth(world["alice"])).json()["projects"]]
    bob_names = [p["name"] for p in client.get("/projects", headers=auth(world["bob"])).json()["projects"]]
    assert alice_names == ["alice-project"]
    assert bob_names == ["bob-project"]


def test_analytics_only_counts_own_data(client, world):
    alice_stats = client.get("/analytics", headers=auth(world["alice"])).json()
    bob_stats = client.get("/analytics", headers=auth(world["bob"])).json()
    assert alice_stats["total_projects"] == 1
    assert alice_stats["total_tasks"] == 1
    assert alice_stats["total_files"] == 1
    assert alice_stats["total_messages"] == 1
    assert bob_stats["total_projects"] == 0
    assert bob_stats["tasks_by_status"] == {"todo": 0, "in_progress": 0, "done": 0}


@pytest.mark.parametrize("path", ["/admin/users", "/admin/projects", "/admin/stats"])
def test_admin_routes_need_admin(client, world, make_user, path):
    assert client.get(path, headers=auth(world["bob"])).status_code == 403
    assert client.get(path).status_code == 401
    admin = make_user("root_admin", admin=True)
    assert client.get(path, headers=auth(admin)).status_code == 200


def test_admin_sees_platform_data(client, world, make_user):
    admin = make_user("root_admin", admin=True)
    stats = client.get("/admin/stats", headers=auth(admin)).json()
    assert stats == {"total_users": 3, "total_projects": 1, "total_tasks": 1, "total_files": 1, "total_messages": 1}
    users = {u["username"]: u for u in client.get("/admin/users", headers=auth(admin)).json()["users"]}
    assert users["alice"]["project_count"] == 1 and users["root_admin"]["is_admin"] is True
    projects = client.get("/admin/projects", headers=auth(admin)).json()["projects"]
    assert projects == [{"id": world["pid"], "name": "alice-project", "owner_username": "alice", "task_count": 1}]


def test_owner_can_delete_project_and_children_go_with_it(client, world):
    alice, pid = world["alice"], world["pid"]
    assert client.delete(f"/projects/{pid}", headers=auth(alice)).status_code == 204
    assert client.get(f"/projects/{pid}", headers=auth(alice)).status_code == 404
    stats = client.get("/analytics", headers=auth(alice)).json()
    assert stats["total_tasks"] == 0 and stats["total_files"] == 0 and stats["total_messages"] == 0
