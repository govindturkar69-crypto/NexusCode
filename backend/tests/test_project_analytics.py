"""GET /projects/{id}/analytics: who may see it, range validation, and every metric."""
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta

import pytest
from conftest import add_member, auth
from sqlalchemy import event

from app.core.database import SessionLocal, engine
from app.models import ActivityModel, CodeFileModel, TaskModel, UserModel
from app.services.project_analytics import project_analytics

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)
TODAY = NOW.date()


def at(days_ago, hour=10):
    return datetime.combine(TODAY - timedelta(days=days_ago), datetime.min.time(), tzinfo=UTC).replace(hour=hour)


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


@pytest.fixture
def owner(make_user):
    return make_user("olivia")


@pytest.fixture
def project(owner, project_of):
    return project_of(owner, "Analytics")


def user_id(name):
    with SessionLocal() as db:
        return db.query(UserModel.id).filter(UserModel.username == name).scalar()


# ---------- who may see it

@pytest.mark.parametrize("role", ["owner", "editor", "viewer"])
def test_every_member_can_read_it(client, make_user, owner, project, role):
    token = owner
    if role != "owner":
        token = make_user(f"m_{role}")
        add_member(f"m_{role}", project, role)
    r = client.get(f"/projects/{project}/analytics", headers=auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["range_days"] == 14


def test_non_member_gets_404(client, make_user, project):
    stranger = make_user("stranger")
    assert client.get(f"/projects/{project}/analytics", headers=auth(stranger)).status_code == 404


def test_unauthenticated_gets_401(client, project):
    assert client.get(f"/projects/{project}/analytics").status_code == 401


def test_unknown_project_gets_404(client, owner):
    assert client.get("/projects/999999/analytics", headers=auth(owner)).status_code == 404


@pytest.mark.parametrize("value", ["1", "0", "-7", "15", "31", "365", "abc", ""])
def test_range_must_be_7_14_or_30(client, owner, project, value):
    assert client.get(f"/projects/{project}/analytics?range={value}", headers=auth(owner)).status_code == 422


@pytest.mark.parametrize("days", [7, 14, 30])
def test_ranges_cover_that_many_days(client, owner, project, days):
    body = client.get(f"/projects/{project}/analytics?range={days}", headers=auth(owner)).json()
    assert body["range_days"] == days
    assert len(body["burn"]) == days
    assert len(body["activity_by_day"]) == days
    assert sum(block["days"] for block in body["throughput"]) == days


# ---------- an empty project

def test_empty_project(client, owner, project):
    body = client.get(f"/projects/{project}/analytics?range=7", headers=auth(owner)).json()
    assert body["tasks_by_status"] == {"todo": 0, "in_progress": 0, "done": 0}
    assert body["total_tasks"] == 0
    assert body["completion_dates"] == {"dated": 0, "undated": 0}
    assert all(p == {"date": p["date"], "scope": 0, "completed": 0, "remaining": 0} for p in body["burn"])
    assert body["throughput"] == [{"start": body["start_date"], "end": body["end_date"], "days": 7, "completed": 0}]
    assert body["cycle_time"]["available"] is False
    assert body["cycle_time"]["reason"]
    assert body["workload"] == []
    assert body["overdue"] == {"count": 0, "tasks": []}
    # Creating the project is itself not an activity event
    assert body["contributors"] == []
    assert body["files_edited"] == 0 and body["recent_files"] == []


# ---------- every metric, on rows with known timestamps

@pytest.fixture
def seeded(make_user, owner, project):
    make_user("eddie")
    add_member("eddie", project, "editor")
    olivia, eddie = user_id("olivia"), user_id("eddie")
    with SessionLocal() as db:
        def task(title, status, created, assignee=None, due=None):
            t = TaskModel(project_id=project, title=title, status=status, created_at=created, assignee_id=assignee, due_date=due, position=0)
            db.add(t)
            return t

        def move(title, label, when, who=olivia):
            db.add(ActivityModel(project_id=project, user_id=who, action="task_moved", target=f"{title} → {label}", created_at=when))

        # Finished in range: created 4 days ago, done 2 days ago (2 days of cycle time)
        task("Alpha", "done", at(4), olivia)
        move("Alpha", "In Progress", at(3))
        move("Alpha", "Done", at(2))
        # Finished in range: created 9 days ago, done today (9 days)
        task("Beta", "done", at(9), eddie)
        move("Beta", "Done", at(0))
        # Moved to Done twice (reopened): the latest move counts (created 6 days ago, done 1 day ago: 5 days)
        task("Gamma", "done", at(6), eddie)
        move("Gamma", "Done", at(5))
        move("Gamma", "To Do", at(4))
        move("Gamma", "Done", at(1))
        # Done but undated: created straight into Done, no move event
        task("Delta", "done", at(3))
        # Done but undated: two tasks share this title, so neither can be matched
        task("Twin", "done", at(5), olivia)
        task("Twin", "todo", at(5), olivia)
        move("Twin", "Done", at(1))
        # Finished before the 7-day range (done 10 days ago): in scope and completed, not in range metrics
        task("Old", "done", at(20), olivia)
        move("Old", "Done", at(10))
        # Open work, one overdue by 3 days, one due today (not overdue), one unassigned and overdue
        task("Open late", "in_progress", at(8), eddie, due=TODAY - timedelta(days=3))
        task("Open today", "todo", at(1), eddie, due=TODAY)
        task("Unassigned late", "todo", at(12), None, due=TODAY - timedelta(days=1))
        # Other activity in range: eddie 2 events, olivia's moves above
        db.add(ActivityModel(project_id=project, user_id=eddie, action="code_created", target="src/a.py", created_at=at(1)))
        db.add(ActivityModel(project_id=project, user_id=eddie, action="task_created", target="Open today", created_at=at(1)))
        # Code files: two edited in range, one long ago
        db.add(CodeFileModel(project_id=project, path="src/a.py", language="python", content="", updated_at=at(1, 9)))
        db.add(CodeFileModel(project_id=project, path="src/b.py", language="python", content="", updated_at=at(3)))
        db.add(CodeFileModel(project_id=project, path="old.py", language="python", content="", updated_at=at(40)))
        db.commit()
    return project


def analytics(project_id, days=7):
    with SessionLocal() as db:
        return project_analytics(db, project_id, days, now=NOW)


def test_status_counts_and_completion_dates(seeded):
    body = analytics(seeded)
    assert body["tasks_by_status"] == {"todo": 3, "in_progress": 1, "done": 6}
    assert body["total_tasks"] == 10
    # Alpha, Beta, Gamma, Old are dated; Delta and the done Twin are not
    assert body["completion_dates"] == {"dated": 4, "undated": 2}


def test_burn_up_and_down(seeded):
    burn = analytics(seeded)["burn"]
    assert [p["date"] for p in burn] == [(TODAY - timedelta(days=d)).isoformat() for d in range(6, -1, -1)]
    # Scope leaves out the 2 undated done tasks: 10 - 2 = 8 tasks, of which
    # "Open today" (created 1 day ago) joins on the last-but-one day
    by_date = {p["date"]: p for p in burn}
    six_days_ago = by_date[(TODAY - timedelta(days=6)).isoformat()]
    # Beta, Old, Open late, Unassigned late and Gamma exist; only Old is done
    assert six_days_ago == {"date": six_days_ago["date"], "scope": 5, "completed": 1, "remaining": 4}
    two_days_ago = by_date[(TODAY - timedelta(days=2)).isoformat()]
    assert (two_days_ago["scope"], two_days_ago["completed"]) == (7, 2)  # Alpha done
    last = burn[-1]
    assert (last["scope"], last["completed"], last["remaining"]) == (8, 4, 4)  # Gamma (yesterday) and Beta (today)


def test_throughput_blocks(seeded):
    week = analytics(seeded, 7)["throughput"]
    assert week == [{"start": (TODAY - timedelta(days=6)).isoformat(), "end": TODAY.isoformat(), "days": 7, "completed": 3}]
    blocks = analytics(seeded, 30)["throughput"]
    assert [b["days"] for b in blocks] == [2, 7, 7, 7, 7]
    assert blocks[-1]["completed"] == 3  # Alpha, Beta, Gamma
    assert blocks[-2]["completed"] == 1  # Old, 10 days ago
    assert sum(b["completed"] for b in blocks) == 4


def test_cycle_time_median_and_p90(seeded):
    cycle = analytics(seeded)["cycle_time"]
    # Alpha 2 days, Gamma 5 days, Beta 9 days (Old finished before the range)
    assert cycle["available"] is True
    assert cycle["sample_size"] == 3
    assert cycle["median_days"] == 5.0
    assert cycle["p90_days"] == 9.0
    assert cycle["reason"] is None


def test_workload_per_member(seeded):
    workload = analytics(seeded)["workload"]
    by_name = {w["username"]: w for w in workload}
    assert by_name["eddie"] == {"user_id": user_id("eddie"), "username": "eddie", "todo": 1, "in_progress": 1, "done": 2}
    assert by_name["olivia"] == {"user_id": user_id("olivia"), "username": "olivia", "todo": 1, "in_progress": 0, "done": 3}
    assert by_name[None] == {"user_id": None, "username": None, "todo": 1, "in_progress": 0, "done": 1}
    # Unassigned comes last
    assert workload[-1]["user_id"] is None


def test_overdue(seeded):
    overdue = analytics(seeded)["overdue"]
    assert overdue["count"] == 2
    assert [(t["title"], t["days_overdue"], t["assignee"]) for t in overdue["tasks"]] == [
        ("Open late", 3, "eddie"),
        ("Unassigned late", 1, None),
    ]


def test_activity_contributors_and_files(seeded):
    body = analytics(seeded)
    per_day = {d["date"]: d["events"] for d in body["activity_by_day"]}
    assert per_day[(TODAY - timedelta(days=1)).isoformat()] == 4  # Gamma, Twin moves + eddie's 2
    assert sum(per_day.values()) == 9  # the move 10 days ago is outside the range
    assert body["contributors"] == [{"username": "olivia", "events": 7}, {"username": "eddie", "events": 2}]
    assert body["files_edited"] == 2
    assert [f["path"] for f in body["recent_files"]] == ["src/a.py", "src/b.py"]


def test_query_count_does_not_grow_with_data(client, owner, project):
    def queries():
        with count_queries() as statements:
            r = client.get(f"/projects/{project}/analytics?range=30", headers=auth(owner))
            assert r.status_code == 200
        return len(statements)

    small = queries()
    with SessionLocal() as db:
        db.add_all([TaskModel(project_id=project, title=f"t{i}", status="done", position=i, due_date=date(2020, 1, 1)) for i in range(60)])
        db.add_all([ActivityModel(project_id=project, user_id=user_id("olivia"), action="task_moved", target=f"t{i} → Done") for i in range(60)])
        db.commit()
    assert queries() == small


def test_end_to_end_through_the_task_api(client, owner, project):
    """A task created and moved to Done through the API is dated and counted today."""
    r = client.post(f"/projects/{project}/tasks", json={"title": "Ship it"}, headers=auth(owner))
    assert r.status_code == 201, r.text
    task_id = r.json()["task"]["id"]
    # The way the Board moves a card
    r = client.patch(f"/tasks/{task_id}/move", json={"status": "done", "index": 0}, headers=auth(owner))
    assert r.status_code == 200, r.text
    body = client.get(f"/projects/{project}/analytics?range=7", headers=auth(owner)).json()
    assert body["tasks_by_status"]["done"] == 1
    assert body["completion_dates"] == {"dated": 1, "undated": 0}
    assert body["burn"][-1]["completed"] == 1
    assert body["throughput"][-1]["completed"] == 1
    assert body["cycle_time"]["available"] is True and body["cycle_time"]["sample_size"] == 1
    assert body["contributors"][0]["username"] == "olivia"
