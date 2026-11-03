"""Pagination, chat cursor, analytics aggregation and the admin N+1 fix."""
from contextlib import contextmanager

import pytest
from conftest import auth
from sqlalchemy import event

from app.core.database import SessionLocal, engine
from app.models import MessageModel, ProjectModel, TaskModel, UserModel


@contextmanager
def count_queries():
    statements = []

    def before(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", before)


def _bulk(project_id, n_tasks=0, n_messages=0, owner_name="alice"):
    with SessionLocal() as db:
        owner_id = db.query(UserModel.id).filter(UserModel.username == owner_name).scalar()
        db.add_all([TaskModel(title=f"t{i}", project_id=project_id, position=i) for i in range(n_tasks)])
        db.add_all([MessageModel(content=f"m{i}", username=owner_name, user_id=owner_id, project_id=project_id) for i in range(n_messages)])
        db.commit()


@pytest.fixture
def alice(make_user):
    return make_user("alice")


def test_task_list_pagination(client, alice, project_of):
    pid = project_of(alice)
    _bulk(pid, n_tasks=120)

    first = client.get(f"/projects/{pid}/tasks", headers=auth(alice)).json()
    assert (len(first["tasks"]), first["total"], first["limit"], first["offset"]) == (50, 120, 50, 0)

    last = client.get(f"/projects/{pid}/tasks?limit=50&offset=100", headers=auth(alice)).json()
    assert [t["title"] for t in last["tasks"]] == [f"t{i}" for i in range(100, 120)]

    everything = client.get(f"/projects/{pid}/tasks?limit=200", headers=auth(alice)).json()
    assert len(everything["tasks"]) == 120


@pytest.mark.parametrize("query", ["limit=0", "limit=201", "offset=-1", "limit=abc"])
def test_pagination_bounds(client, alice, project_of, query):
    pid = project_of(alice)
    for path in ("/projects", f"/projects/{pid}/tasks", f"/projects/{pid}/files"):
        assert client.get(f"{path}?{query}", headers=auth(alice)).status_code == 422


def test_project_list_pagination(client, alice, project_of):
    for i in range(3):
        project_of(alice, f"p{i}")
    page = client.get("/projects?limit=2&offset=1", headers=auth(alice)).json()
    assert [p["name"] for p in page["projects"]] == ["p1", "p2"] and page["total"] == 3


def test_chat_history_is_newest_first_with_cursor(client, alice, project_of):
    pid = project_of(alice)
    _bulk(pid, n_messages=120)

    page1 = client.get(f"/projects/{pid}/messages", headers=auth(alice)).json()
    assert [m["content"] for m in page1["messages"][:3]] == ["m119", "m118", "m117"]
    assert len(page1["messages"]) == 50 and page1["next_cursor"] == page1["messages"][-1]["id"]

    seen = [m["content"] for m in page1["messages"]]
    cursor = page1["next_cursor"]
    while cursor is not None:
        page = client.get(f"/projects/{pid}/messages?before={cursor}", headers=auth(alice)).json()
        seen += [m["content"] for m in page["messages"]]
        cursor = page["next_cursor"]
    assert seen == [f"m{i}" for i in range(119, -1, -1)]  # every message exactly once, newest first


def test_chat_cursor_exact_page_has_no_next(client, alice, project_of):
    pid = project_of(alice)
    _bulk(pid, n_messages=50)
    page = client.get(f"/projects/{pid}/messages?limit=50", headers=auth(alice)).json()
    assert len(page["messages"]) == 50 and page["next_cursor"] is None


def test_chat_cursor_cannot_reach_other_projects(client, alice, make_user, project_of):
    bob = make_user("bob")
    bob_pid = project_of(bob)
    _bulk(bob_pid, n_messages=3, owner_name="bob")
    alice_pid = project_of(alice)
    page = client.get(f"/projects/{alice_pid}/messages?before=999999", headers=auth(alice)).json()
    assert page["messages"] == []


def test_analytics_counts_by_status(client, alice, project_of):
    pid = project_of(alice)
    ids = [client.post(f"/projects/{pid}/tasks", json={"title": str(i)}, headers=auth(alice)).json()["task"]["id"] for i in range(5)]
    client.put(f"/tasks/{ids[0]}", json={"status": "done"}, headers=auth(alice))
    client.put(f"/tasks/{ids[1]}", json={"status": "in_progress"}, headers=auth(alice))
    stats = client.get("/analytics", headers=auth(alice)).json()
    assert stats["tasks_by_status"] == {"todo": 3, "in_progress": 1, "done": 1}
    assert stats["total_tasks"] == 5 and stats["total_projects"] == 1


def _make_platform(n_users, projects_each=2, tasks_each=3):
    with SessionLocal() as db:
        for u in range(n_users):
            user = UserModel(username=f"user{u}", hashed_password="x")
            db.add(user)
            db.flush()
            for p in range(projects_each):
                project = ProjectModel(name=f"u{u}p{p}", owner_id=user.id)
                db.add(project)
                db.flush()
                db.add_all([TaskModel(title="t", project_id=project.id) for _ in range(tasks_each)])
        db.commit()


@pytest.mark.parametrize("path", ["/admin/users?limit=200", "/admin/projects?limit=200", "/admin/stats"])
def test_admin_query_count_does_not_grow_with_rows(client, make_user, path):
    admin = make_user("root_admin", admin=True)
    _make_platform(3)
    with count_queries() as small:
        assert client.get(path, headers=auth(admin)).status_code == 200
    _make_platform(0)  # no-op, keeps the session warm
    with SessionLocal() as db:
        db.query(TaskModel).delete()
        db.query(ProjectModel).delete()
        db.query(UserModel).filter(UserModel.username != "root_admin").delete()
        db.commit()
    _make_platform(30)
    with count_queries() as big:
        assert client.get(path, headers=auth(admin)).status_code == 200
    assert len(big) == len(small), (len(small), len(big))
    assert len(big) <= 4  # auth lookup + count + page (+ nothing per row)


def test_admin_lists_are_paginated_with_correct_counts(client, make_user):
    admin = make_user("root_admin", admin=True)
    _make_platform(3, projects_each=2, tasks_each=3)
    users = client.get("/admin/users?limit=2", headers=auth(admin)).json()
    assert users["total"] == 4 and len(users["users"]) == 2
    by_name = {u["username"]: u for u in client.get("/admin/users", headers=auth(admin)).json()["users"]}
    assert by_name["user0"]["project_count"] == 2 and by_name["root_admin"]["project_count"] == 0
    projects = client.get("/admin/projects?offset=4", headers=auth(admin)).json()
    assert projects["total"] == 6 and [p["task_count"] for p in projects["projects"]] == [3, 3]
    assert projects["projects"][0]["owner_username"] == "user2"
    stats = client.get("/admin/stats", headers=auth(admin)).json()
    assert stats == {"total_users": 4, "total_projects": 6, "total_tasks": 18, "total_files": 0, "total_messages": 0}
