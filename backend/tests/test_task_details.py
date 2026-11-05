"""Editing tasks (assignee, due date, priority) and ordering them on the board."""
import pytest
from conftest import add_member, auth

from app.core.database import SessionLocal
from app.models import UserModel


@pytest.fixture
def team(client, make_user, project_of):
    tokens = {name: make_user(name) for name in ("olivia", "eddie", "vera", "oscar")}
    pid = project_of(tokens["olivia"], "team")
    add_member("eddie", pid, "editor")
    add_member("vera", pid, "viewer")
    with SessionLocal() as db:
        ids = {name: db.query(UserModel.id).filter(UserModel.username == name).scalar() for name in tokens}
    return {"t": tokens, "id": ids, "pid": pid, "editor": auth(tokens["eddie"]), "owner": auth(tokens["olivia"])}


def _task(client, team, title="T", **fields):
    r = client.post(f"/projects/{team['pid']}/tasks", json={"title": title, **fields}, headers=team["editor"])
    assert r.status_code == 201, r.text
    return r.json()["task"]


def _column(client, team, status):
    tasks = client.get(f"/projects/{team['pid']}/tasks", headers=team["owner"]).json()["tasks"]
    return [t["title"] for t in tasks if t["status"] == status]


def test_new_task_defaults(client, team):
    task = _task(client, team)
    assert task["priority"] == "medium"
    assert task["assignee_id"] is None and task["assignee_username"] is None and task["due_date"] is None


def test_create_with_details(client, team):
    task = _task(client, team, description="d", assignee_id=team["id"]["vera"], due_date="2030-01-15", priority="high")
    assert (task["description"], task["assignee_username"], task["due_date"], task["priority"]) == ("d", "vera", "2030-01-15", "high")


def test_edit_changes_only_fields_sent(client, team):
    task = _task(client, team, title="Old", description="keep", priority="low")
    r = client.patch(f"/tasks/{task['id']}", json={"title": "  New  ", "due_date": "2030-02-01"}, headers=team["editor"])
    assert r.status_code == 200
    updated = r.json()["task"]
    assert updated["title"] == "New" and updated["due_date"] == "2030-02-01"
    assert updated["description"] == "keep" and updated["priority"] == "low"


def test_edit_can_clear_optional_fields(client, team):
    task = _task(client, team, description="d", assignee_id=team["id"]["eddie"], due_date="2030-01-01")
    r = client.patch(f"/tasks/{task['id']}", json={"description": None, "assignee_id": None, "due_date": None}, headers=team["editor"])
    updated = r.json()["task"]
    assert updated["description"] is None and updated["assignee_id"] is None and updated["due_date"] is None


@pytest.mark.parametrize("body", [
    {"title": ""},
    {"title": "   "},
    {"title": None},
    {"title": "x" * 201},
    {"description": "x" * 5001},
    {"priority": "urgent"},
    {"priority": None},
    {"due_date": "not-a-date"},
    {"assignee_id": "bob"},
])
def test_edit_validation(client, team, body):
    task = _task(client, team, title="Keep me")
    assert client.patch(f"/tasks/{task['id']}", json=body, headers=team["editor"]).status_code == 422
    assert _column(client, team, "todo") == ["Keep me"]


def test_assignee_must_be_a_project_member(client, team):
    task = _task(client, team)
    r = client.patch(f"/tasks/{task['id']}", json={"assignee_id": team["id"]["oscar"]}, headers=team["editor"])
    assert r.status_code == 422 and "member" in r.json()["detail"]
    r = client.post(f"/projects/{team['pid']}/tasks", json={"title": "x", "assignee_id": 999999}, headers=team["editor"])
    assert r.status_code == 422


def test_removing_a_member_unassigns_their_tasks_in_that_project_only(client, team, project_of):
    task = _task(client, team, assignee_id=team["id"]["eddie"])
    other_pid = project_of(team["t"]["eddie"], "eddie-own")
    other = client.post(f"/projects/{other_pid}/tasks", json={"title": "mine", "assignee_id": team["id"]["eddie"]}, headers=team["editor"]).json()["task"]
    assert client.delete(f"/projects/{team['pid']}/members/{team['id']['eddie']}", headers=team["owner"]).status_code == 204
    tasks = client.get(f"/projects/{team['pid']}/tasks", headers=team["owner"]).json()["tasks"]
    assert [t["assignee_id"] for t in tasks if t["id"] == task["id"]] == [None]
    mine = client.get(f"/projects/{other_pid}/tasks", headers=team["editor"]).json()["tasks"]
    assert mine[0]["id"] == other["id"] and mine[0]["assignee_id"] == team["id"]["eddie"]


@pytest.mark.parametrize("who,expected", [("olivia", 200), ("eddie", 200), ("vera", 403), ("oscar", 404)])
def test_edit_and_move_permissions(client, team, who, expected):
    task = _task(client, team)
    headers = auth(team["t"][who])
    assert client.patch(f"/tasks/{task['id']}", json={"title": "x"}, headers=headers).status_code == expected
    assert client.patch(f"/tasks/{task['id']}/move", json={"status": "done", "index": 0}, headers=headers).status_code == expected


def test_anonymous_cannot_edit_or_move(client, team):
    task = _task(client, team)
    assert client.patch(f"/tasks/{task['id']}", json={"title": "x"}).status_code == 401
    assert client.patch(f"/tasks/{task['id']}/move", json={"status": "done", "index": 0}).status_code == 401


def test_reorder_within_a_column_persists(client, team):
    a, _b, c = (_task(client, team, title=t) for t in "abc")
    assert _column(client, team, "todo") == ["a", "b", "c"]
    client.patch(f"/tasks/{c['id']}/move", json={"status": "todo", "index": 0}, headers=team["editor"])
    assert _column(client, team, "todo") == ["c", "a", "b"]
    client.patch(f"/tasks/{a['id']}/move", json={"status": "todo", "index": 2}, headers=team["editor"])
    assert _column(client, team, "todo") == ["c", "b", "a"]


def test_move_between_columns_at_an_exact_position(client, team):
    a, b, c = (_task(client, team, title=t) for t in "abc")
    client.patch(f"/tasks/{a['id']}/move", json={"status": "done", "index": 0}, headers=team["editor"])
    client.patch(f"/tasks/{b['id']}/move", json={"status": "done", "index": 0}, headers=team["editor"])
    r = client.patch(f"/tasks/{c['id']}/move", json={"status": "done", "index": 1}, headers=team["editor"])
    assert r.json()["task"]["status"] == "done"
    assert _column(client, team, "done") == ["b", "c", "a"]
    assert _column(client, team, "todo") == []


def test_move_index_past_the_end_goes_last(client, team):
    a, _b = (_task(client, team, title=t) for t in "ab")
    client.patch(f"/tasks/{a['id']}/move", json={"status": "todo", "index": 99}, headers=team["editor"])
    assert _column(client, team, "todo") == ["b", "a"]


@pytest.mark.parametrize("body", [{"status": "archived", "index": 0}, {"status": "done", "index": -1}, {"status": "done"}])
def test_move_validation(client, team, body):
    task = _task(client, team)
    assert client.patch(f"/tasks/{task['id']}/move", json=body, headers=team["editor"]).status_code == 422


def test_move_only_touches_its_own_project(client, team, project_of):
    other_pid = project_of(team["t"]["eddie"], "other")
    other = client.post(f"/projects/{other_pid}/tasks", json={"title": "other"}, headers=team["editor"]).json()["task"]
    task = _task(client, team)
    client.patch(f"/tasks/{task['id']}/move", json={"status": "todo", "index": 0}, headers=team["editor"])
    again = client.get(f"/projects/{other_pid}/tasks", headers=team["editor"]).json()["tasks"]
    assert again[0]["position"] == other["position"]


def test_task_list_does_not_query_per_assignee(client, team):
    from sqlalchemy import event

    from app.core.database import engine

    for _ in range(5):
        _task(client, team, assignee_id=team["id"]["eddie"])
    statements = []
    listener = lambda conn, cur, statement, params, ctx, many: statements.append(statement)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        client.get(f"/projects/{team['pid']}/tasks", headers=team["owner"])
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert len(statements) <= 5  # user, project, role, count, page
