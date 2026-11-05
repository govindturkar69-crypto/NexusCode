"""Adding, changing and removing project members, and what that does to access."""
import pytest
from conftest import auth, ws_path
from starlette.websockets import WebSocketDisconnect

from app.core.database import SessionLocal
from app.models import ProjectModel, UserModel
from app.services import realtime


@pytest.fixture
def team(client, make_user, project_of):
    tokens = {name: make_user(name) for name in ("olivia", "eddie", "vera", "nina")}
    pid = project_of(tokens["olivia"], "team")
    owner = auth(tokens["olivia"])
    assert client.post(f"/projects/{pid}/members", json={"username": "eddie", "role": "editor"}, headers=owner).status_code == 201
    assert client.post(f"/projects/{pid}/members", json={"username": "vera", "role": "viewer"}, headers=owner).status_code == 201
    ids = {}
    with SessionLocal() as db:
        for name in tokens:
            ids[name] = db.query(UserModel.id).filter(UserModel.username == name).scalar()
    return {"t": tokens, "pid": pid, "id": ids, "owner": owner}


def _members(client, team, token="olivia"):
    r = client.get(f"/projects/{team['pid']}/members", headers=auth(team["t"][token]))
    return {m["username"]: m["role"] for m in r.json()["members"]}


def test_list_members_visible_to_every_member_but_not_outsiders(client, team):
    assert _members(client, team, "vera") == {"olivia": "owner", "eddie": "editor", "vera": "viewer"}
    assert client.get(f"/projects/{team['pid']}/members", headers=auth(team["t"]["nina"])).status_code == 404
    assert client.get(f"/projects/{team['pid']}/members").status_code == 401


def test_add_member_defaults_to_editor_and_grants_access(client, team):
    assert client.get(f"/projects/{team['pid']}", headers=auth(team["t"]["nina"])).status_code == 404
    r = client.post(f"/projects/{team['pid']}/members", json={"username": "nina"}, headers=team["owner"])
    assert r.status_code == 201 and r.json()["member"]["role"] == "editor"
    project = client.get(f"/projects/{team['pid']}", headers=auth(team["t"]["nina"])).json()["project"]
    assert project["role"] == "editor"


def test_add_member_errors(client, team):
    url = f"/projects/{team['pid']}/members"
    assert client.post(url, json={"username": "ghost"}, headers=team["owner"]).status_code == 404
    assert client.post(url, json={"username": "eddie"}, headers=team["owner"]).status_code == 409
    assert client.post(url, json={"username": "nina", "role": "admin"}, headers=team["owner"]).status_code == 422
    assert client.post(url, json={"username": ""}, headers=team["owner"]).status_code == 422


@pytest.mark.parametrize("who", ["eddie", "vera"])
def test_only_owners_can_add_or_change(client, team, who):
    headers = auth(team["t"][who])
    assert client.post(f"/projects/{team['pid']}/members", json={"username": "nina"}, headers=headers).status_code == 403
    assert client.patch(f"/projects/{team['pid']}/members/{team['id'][who]}", json={"role": "owner"}, headers=headers).status_code == 403
    assert client.delete(f"/projects/{team['pid']}/members/{team['id']['olivia']}", headers=headers).status_code == 403


def test_outsider_cannot_touch_members(client, team):
    headers = auth(team["t"]["nina"])
    pid = team["pid"]
    assert client.post(f"/projects/{pid}/members", json={"username": "nina"}, headers=headers).status_code == 404
    assert client.patch(f"/projects/{pid}/members/{team['id']['nina']}", json={"role": "owner"}, headers=headers).status_code == 404
    assert client.delete(f"/projects/{pid}/members/{team['id']['eddie']}", headers=headers).status_code == 404


def test_change_role_takes_effect(client, team):
    pid = team["pid"]
    r = client.patch(f"/projects/{pid}/members/{team['id']['vera']}", json={"role": "editor"}, headers=team["owner"])
    assert r.status_code == 200 and r.json()["member"]["role"] == "editor"
    assert client.post(f"/projects/{pid}/tasks", json={"title": "x"}, headers=auth(team["t"]["vera"])).status_code == 201
    client.patch(f"/projects/{pid}/members/{team['id']['vera']}", json={"role": "viewer"}, headers=team["owner"])
    assert client.post(f"/projects/{pid}/tasks", json={"title": "y"}, headers=auth(team["t"]["vera"])).status_code == 403


def test_change_role_of_non_member_is_404(client, team):
    r = client.patch(f"/projects/{team['pid']}/members/{team['id']['nina']}", json={"role": "viewer"}, headers=team["owner"])
    assert r.status_code == 404
    assert client.delete(f"/projects/{team['pid']}/members/{team['id']['nina']}", headers=team["owner"]).status_code == 404


def test_last_owner_cannot_leave_or_be_demoted(client, team):
    pid, me = team["pid"], team["id"]["olivia"]
    r = client.delete(f"/projects/{pid}/members/{me}", headers=team["owner"])
    assert r.status_code == 409 and "at least one owner" in r.json()["detail"]
    assert client.patch(f"/projects/{pid}/members/{me}", json={"role": "editor"}, headers=team["owner"]).status_code == 409
    assert _members(client, team)["olivia"] == "owner"


def test_owner_can_leave_once_there_is_another_owner(client, team):
    pid, me = team["pid"], team["id"]["olivia"]
    client.patch(f"/projects/{pid}/members/{team['id']['eddie']}", json={"role": "owner"}, headers=team["owner"])
    assert client.delete(f"/projects/{pid}/members/{me}", headers=team["owner"]).status_code == 204
    assert client.get(f"/projects/{pid}", headers=team["owner"]).status_code == 404
    with SessionLocal() as db:
        # owner_id follows, so it never names someone who no longer owns the project
        assert db.get(ProjectModel, pid).owner_id == team["id"]["eddie"]


def test_demoted_creator_hands_over_owner_id(client, team):
    pid = team["pid"]
    client.patch(f"/projects/{pid}/members/{team['id']['eddie']}", json={"role": "owner"}, headers=team["owner"])
    assert client.patch(f"/projects/{pid}/members/{team['id']['olivia']}", json={"role": "viewer"}, headers=team["owner"]).status_code == 200
    with SessionLocal() as db:
        assert db.get(ProjectModel, pid).owner_id == team["id"]["eddie"]


@pytest.mark.parametrize("who", ["eddie", "vera"])
def test_member_can_leave(client, team, who):
    headers = auth(team["t"][who])
    assert client.delete(f"/projects/{team['pid']}/members/{team['id'][who]}", headers=headers).status_code == 204
    assert client.get(f"/projects/{team['pid']}", headers=headers).status_code == 404
    assert who not in _members(client, team)


def test_owner_can_remove_member_and_access_ends(client, team):
    pid = team["pid"]
    assert client.delete(f"/projects/{pid}/members/{team['id']['eddie']}", headers=team["owner"]).status_code == 204
    assert client.get(f"/projects/{pid}/tasks", headers=auth(team["t"]["eddie"])).status_code == 404
    assert client.post("/ws-ticket", json={"project_id": pid}, headers=auth(team["t"]["eddie"])).status_code == 404


@pytest.mark.parametrize("kind", ["chat", "meeting"])
def test_removal_closes_open_sockets_immediately(client, team, kind):
    pid = team["pid"]
    with client.websocket_connect(ws_path(client, team["t"]["eddie"], pid, kind)) as ws:
        if kind == "meeting":
            assert ws.receive_json()["type"] == "role"
        assert client.delete(f"/projects/{pid}/members/{team['id']['eddie']}", headers=team["owner"]).status_code == 204
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1008
    rooms = realtime.manager.active_connections if kind == "chat" else realtime.video_manager.active_connections
    assert pid not in rooms


def test_removal_only_closes_that_users_sockets(client, team):
    pid = team["pid"]
    with client.websocket_connect(ws_path(client, team["t"]["eddie"], pid)), \
            client.websocket_connect(ws_path(client, team["t"]["olivia"], pid)) as owner_socket:
        client.delete(f"/projects/{pid}/members/{team['id']['eddie']}", headers=team["owner"])
        owner_socket.send_json({"content": "still here"})
        assert owner_socket.receive_json()["content"] == "still here"


def test_project_list_includes_memberships_with_roles(client, team, project_of):
    own = project_of(team["t"]["vera"], "vera-own")
    projects = client.get("/projects", headers=auth(team["t"]["vera"])).json()
    assert {(p["id"], p["role"]) for p in projects["projects"]} == {(team["pid"], "viewer"), (own, "owner")}
    assert projects["total"] == 2
    assert client.get("/projects", headers=auth(team["t"]["nina"])).json()["projects"] == []


def test_project_list_pagination_counts_memberships(client, team, project_of):
    for i in range(3):
        project_of(team["t"]["vera"], f"p{i}")
    page = client.get("/projects?limit=2&offset=1", headers=auth(team["t"]["vera"])).json()
    assert page["total"] == 4 and len(page["projects"]) == 2


def test_deleting_a_project_removes_its_memberships(client, team):
    assert client.delete(f"/projects/{team['pid']}", headers=team["owner"]).status_code == 204
    assert client.get("/projects", headers=auth(team["t"]["eddie"])).json()["projects"] == []
