"""
List endpoints run a fixed number of SQL statements however many rows they
return (no N+1 queries). Each is measured with 2 and with 12 rows: the counts
must be equal.
"""
import contextlib

import pytest
from conftest import add_member, auth
from sqlalchemy import event

from app.core.database import SessionLocal, engine
from app.models import NotificationModel, UserModel


@contextlib.contextmanager
def count_queries():
    seen = []

    def before(conn, cursor, statement, *args):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", before)


def queries_for(client, token, path):
    with count_queries() as seen:
        r = client.get(path, headers=auth(token))
    assert r.status_code == 200, r.text
    return len(seen)


def grow(client, token, project, n, make_user, start):
    """Adds n members (each also gets a notification), tasks (each logs activity), code files and projects."""
    for i in range(start, start + n):
        name = f"member{i}"
        make_user(name)
        add_member(name, project, "editor")
        for path, body in ((f"/projects/{project}/tasks", {"title": f"t{i}"}),
                           (f"/projects/{project}/code/files", {"path": f"f{i}.py", "content": "x"}),
                           ("/projects", {"name": f"p{i}"})):
            r = client.post(path, json=body, headers=auth(token))
            assert r.status_code in (200, 201), f"{path}: {r.status_code} {r.text[:120]}"
        with SessionLocal() as db:
            owner_id = db.query(UserModel.id).filter(UserModel.username == "owner").scalar()
            db.add(NotificationModel(user_id=owner_id, project_id=project, kind="added", message=f"n{i}"))
            db.commit()


@pytest.mark.parametrize("path", [
    "/projects",
    "/projects/{p}/tasks",
    "/projects/{p}/members",
    "/projects/{p}/activity",
    "/projects/{p}/code/files",
    "/notifications",
])
def test_list_endpoints_do_not_issue_a_query_per_row(client, make_user, project_of, path):
    owner = make_user("owner")
    project = project_of(owner, "P")
    grow(client, owner, project, 2, make_user, 0)
    small = queries_for(client, owner, path.format(p=project))
    grow(client, owner, project, 10, make_user, 2)
    large = queries_for(client, owner, path.format(p=project))
    r = client.get(path.format(p=project), headers=auth(owner)).json()
    assert len(str(r)) > 200, f"{path} returned almost nothing, so the check would prove nothing"
    assert large == small, f"{path}: {small} queries with 2 rows, {large} with 12"
