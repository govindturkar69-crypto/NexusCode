"""Activity feed, notifications and live updates."""
import io

import pytest
from conftest import add_member, auth, set_github_token, ws_path

from app.core.database import SessionLocal
from app.models import ActivityModel, NotificationModel, UserModel


@pytest.fixture
def team(client, make_user, project_of):
    tokens = {name: make_user(name) for name in ("olivia", "eddie", "vera", "oscar")}
    pid = project_of(tokens["olivia"], "Apollo")
    add_member("eddie", pid, "editor")
    add_member("vera", pid, "viewer")
    with SessionLocal() as db:
        ids = {name: db.query(UserModel.id).filter(UserModel.username == name).scalar() for name in tokens}
    return {"t": tokens, "id": ids, "pid": pid, "owner": auth(tokens["olivia"]), "editor": auth(tokens["eddie"])}


def _feed(client, team, who="olivia"):
    r = client.get(f"/projects/{team['pid']}/activity", headers=auth(team["t"][who]))
    assert r.status_code == 200, r.text
    return [(e["username"], e["action"], e["target"]) for e in r.json()["activity"]]


def _bell(client, team, who):
    return client.get("/notifications", headers=auth(team["t"][who])).json()


def test_task_actions_are_logged_newest_first(client, team):
    task = client.post(f"/projects/{team['pid']}/tasks", json={"title": "Ship"}, headers=team["editor"]).json()["task"]
    client.patch(f"/tasks/{task['id']}", json={"priority": "high"}, headers=team["editor"])
    client.patch(f"/tasks/{task['id']}/move", json={"status": "done", "index": 0}, headers=team["owner"])
    client.delete(f"/tasks/{task['id']}", headers=team["owner"])
    assert _feed(client, team, "vera") == [
        ("olivia", "task_deleted", "Ship"),
        ("olivia", "task_moved", "Ship → Done"),
        ("eddie", "task_edited", "Ship"),
        ("eddie", "task_created", "Ship"),
    ]


def test_legacy_status_route_is_logged_too(client, team):
    task = client.post(f"/projects/{team['pid']}/tasks", json={"title": "T"}, headers=team["editor"]).json()["task"]
    client.put(f"/tasks/{task['id']}", json={"status": "in_progress"}, headers=team["editor"])
    client.put(f"/tasks/{task['id']}", json={"status": "in_progress"}, headers=team["editor"])  # no change, no entry
    assert [e for e in _feed(client, team) if e[1] == "task_moved"] == [("eddie", "task_moved", "T → In Progress")]


def test_reordering_within_a_column_adds_no_entry(client, team):
    task = client.post(f"/projects/{team['pid']}/tasks", json={"title": "T"}, headers=team["editor"]).json()["task"]
    client.patch(f"/tasks/{task['id']}/move", json={"status": "todo", "index": 0}, headers=team["editor"])
    assert [e[1] for e in _feed(client, team)] == ["task_created"]


def test_refused_actions_log_nothing(client, team):
    task = client.post(f"/projects/{team['pid']}/tasks", json={"title": "T"}, headers=team["editor"]).json()["task"]
    viewer = auth(team["t"]["vera"])
    assert client.delete(f"/tasks/{task['id']}", headers=viewer).status_code == 403
    assert client.patch(f"/tasks/{task['id']}", json={"title": ""}, headers=team["editor"]).status_code == 422
    assert [e[1] for e in _feed(client, team)] == ["task_created"]


def test_file_upload_and_github_push_are_logged(client, team, fake_cloudinary, fake_github_http):
    client.post(f"/projects/{team['pid']}/files", files={"file": ("n.txt", io.BytesIO(b"hi"), "text/plain")}, headers=team["editor"])
    set_github_token("olivia", "gho_x")
    client.put(f"/projects/{team['pid']}/code", json={"content": "x", "language": "python"}, headers=team["owner"])
    assert client.post(f"/projects/{team['pid']}/push-to-github", json={"repo_name": "r"}, headers=team["owner"]).status_code == 200
    assert _feed(client, team) == [("olivia", "github_pushed", "tester/r (main)"), ("eddie", "file_uploaded", "n.txt")]


def test_failed_push_logs_nothing(client, team, fake_github_http):
    set_github_token("olivia", "gho_x")
    client.put(f"/projects/{team['pid']}/code", json={"content": "x", "language": "python"}, headers=team["owner"])
    fake_github_http["create_status"] = 422
    assert client.post(f"/projects/{team['pid']}/push-to-github", json={"repo_name": "r"}, headers=team["owner"]).status_code == 400
    assert _feed(client, team) == []


def test_member_changes_are_logged(client, team):
    pid = team["pid"]
    client.post(f"/projects/{pid}/members", json={"username": "oscar"}, headers=team["owner"])
    client.patch(f"/projects/{pid}/members/{team['id']['oscar']}", json={"role": "viewer"}, headers=team["owner"])
    client.delete(f"/projects/{pid}/members/{team['id']['oscar']}", headers=team["owner"])
    client.delete(f"/projects/{pid}/members/{team['id']['vera']}", headers=auth(team["t"]["vera"]))
    assert _feed(client, team) == [
        ("vera", "member_left", "vera"),
        ("olivia", "member_removed", "oscar"),
        ("olivia", "role_changed", "oscar → viewer"),
        ("olivia", "member_added", "oscar"),
    ]


def test_activity_permissions_and_pagination(client, team):
    pid = team["pid"]
    for i in range(3):
        client.post(f"/projects/{pid}/tasks", json={"title": f"t{i}"}, headers=team["editor"])
    assert client.get(f"/projects/{pid}/activity").status_code == 401
    assert client.get(f"/projects/{pid}/activity", headers=auth(team["t"]["oscar"])).status_code == 404
    page = client.get(f"/projects/{pid}/activity?limit=2&offset=1", headers=auth(team["t"]["vera"])).json()
    assert page["total"] == 3 and [e["target"] for e in page["activity"]] == ["t1", "t0"]


def test_entries_survive_the_deleted_user(client, team):
    with SessionLocal() as db:
        db.add(ActivityModel(project_id=team["pid"], user_id=None, action="task_created", target="old"))
        db.commit()
    assert _feed(client, team) == [(None, "task_created", "old")]


def test_assignment_notifies_the_assignee_not_the_actor(client, team):
    pid, eddie = team["pid"], team["id"]["eddie"]
    r = client.post(f"/projects/{pid}/tasks", json={"title": "Fix", "assignee_id": eddie}, headers=team["owner"])
    task = r.json()["task"]
    bell = _bell(client, team, "eddie")
    assert bell["unread_count"] == 1
    assert bell["notifications"][0]["kind"] == "assigned"
    assert bell["notifications"][0]["message"] == 'olivia assigned you to "Fix" in Apollo'

    # Assigning yourself, re-saving the same assignee, or clearing: no notification
    client.patch(f"/tasks/{task['id']}", json={"assignee_id": eddie}, headers=team["owner"])
    client.patch(f"/tasks/{task['id']}", json={"assignee_id": team["id"]["olivia"]}, headers=team["owner"])
    client.patch(f"/tasks/{task['id']}", json={"assignee_id": None}, headers=team["owner"])
    assert _bell(client, team, "eddie")["unread_count"] == 1
    assert _bell(client, team, "olivia")["unread_count"] == 0


def test_reassigning_through_edit_notifies_the_new_assignee(client, team):
    task = client.post(f"/projects/{team['pid']}/tasks", json={"title": "Fix"}, headers=team["owner"]).json()["task"]
    client.patch(f"/tasks/{task['id']}", json={"assignee_id": team["id"]["vera"]}, headers=team["editor"])
    assert _bell(client, team, "vera")["notifications"][0]["message"] == 'eddie assigned you to "Fix" in Apollo'


def test_being_added_and_role_change_notify(client, team):
    pid = team["pid"]
    client.post(f"/projects/{pid}/members", json={"username": "oscar", "role": "viewer"}, headers=team["owner"])
    client.patch(f"/projects/{pid}/members/{team['id']['oscar']}", json={"role": "editor"}, headers=team["owner"])
    client.patch(f"/projects/{pid}/members/{team['id']['oscar']}", json={"role": "editor"}, headers=team["owner"])  # no change
    messages = [(n["kind"], n["message"]) for n in _bell(client, team, "oscar")["notifications"]]
    assert messages == [
        ("role_changed", "olivia changed your role in Apollo to editor"),
        ("added", "olivia added you to Apollo as viewer"),
    ]


def test_mark_read_and_read_all(client, team):
    pid = team["pid"]
    for title in ("a", "b", "c"):
        client.post(f"/projects/{pid}/tasks", json={"title": title, "assignee_id": team["id"]["eddie"]}, headers=team["owner"])
    eddie = team["editor"]
    first = _bell(client, team, "eddie")["notifications"][0]["id"]
    r = client.post(f"/notifications/{first}/read", headers=eddie)
    assert r.status_code == 200 and r.json()["notification"]["is_read"] is True
    assert _bell(client, team, "eddie")["unread_count"] == 2
    unread = client.get("/notifications?unread_only=true", headers=eddie).json()
    assert unread["total"] == 2 and first not in [n["id"] for n in unread["notifications"]]
    assert client.post("/notifications/read-all", headers=eddie).json() == {"marked": 2}
    assert _bell(client, team, "eddie")["unread_count"] == 0


def test_notifications_are_private(client, team):
    client.post(f"/projects/{team['pid']}/tasks", json={"title": "x", "assignee_id": team["id"]["eddie"]}, headers=team["owner"])
    note = _bell(client, team, "eddie")["notifications"][0]["id"]
    other = auth(team["t"]["oscar"])
    assert client.get("/notifications", headers=other).json()["notifications"] == []
    assert client.post(f"/notifications/{note}/read", headers=other).status_code == 404
    client.post("/notifications/read-all", headers=other)
    assert _bell(client, team, "eddie")["unread_count"] == 1
    assert client.get("/notifications").status_code == 401
    assert client.post(f"/notifications/{note}/read").status_code == 401


def test_deleting_a_project_removes_its_activity_and_notifications(client, team):
    client.post(f"/projects/{team['pid']}/tasks", json={"title": "x", "assignee_id": team["id"]["eddie"]}, headers=team["owner"])
    assert client.delete(f"/projects/{team['pid']}", headers=team["owner"]).status_code == 204
    with SessionLocal() as db:
        assert db.query(ActivityModel).count() == 0 and db.query(NotificationModel).count() == 0


def test_open_boards_get_a_live_activity_frame(client, team):
    with client.websocket_connect(ws_path(client, team["t"]["vera"], team["pid"])) as vera:
        assert vera.receive_json()["type"] == "presence"
        client.post(f"/projects/{team['pid']}/tasks", json={"title": "x"}, headers=team["editor"])
        assert vera.receive_json() == {"type": "activity", "action": "task_created"}


def test_a_failed_publish_does_not_fail_the_request(client, team, monkeypatch):
    from app.services import activity

    def boom(*args, **kwargs):
        raise RuntimeError("socket layer down")

    monkeypatch.setattr(activity.anyio.from_thread, "run", boom)
    r = client.post(f"/projects/{team['pid']}/tasks", json={"title": "x"}, headers=team["editor"])
    assert r.status_code == 201
