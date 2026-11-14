"""
One project's analytics for the last 7, 14 or 30 days.

What the data can and can't say:
- Tasks have created_at but no completed_at. When a task reaches Done, the
  activity feed records "task_moved" with the target "<title> → Done", so a
  done task's completion time is the latest such event for its current title
  (after it was created). A task renamed after finishing, one sharing its title
  with another task, or one created straight into Done has no recorded
  completion time: it is counted as "undated" and left out of the time-based
  charts (burn-up/down, throughput, cycle time) rather than guessed.
- Saving code isn't an activity event, so "files" means files whose last edit
  (code_files.updated_at) falls in the range, not per-edit counts.
- Days are UTC calendar days.

Every count that can be is a GROUP BY in the database; the rest is one query per
table, so the number of queries doesn't grow with the data.
"""
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, time, timedelta
from statistics import median

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import TASK_STATUSES, ActivityModel, CodeFileModel, TaskModel, UserModel

RANGES = (7, 14, 30)
DONE_SUFFIX = " → Done"
TOP = 5
OVERDUE_LISTED = 10


def _aware(value: datetime) -> datetime:
    # SQLite gives naive datetimes (stored as UTC); Postgres gives aware ones
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _day(value) -> str:
    # func.date() is a string on SQLite and a date on Postgres
    return value.isoformat() if isinstance(value, date) else str(value)[:10]


def _p90(values: list[float]) -> float:
    ordered = sorted(values)
    # nearest-rank percentile
    rank = max(1, -(-90 * len(ordered) // 100))
    return ordered[rank - 1]


def project_analytics(db: Session, project_id: int, days: int, now: datetime | None = None) -> dict:
    now = _aware(now or datetime.now(UTC))
    today = now.date()
    start = today - timedelta(days=days - 1)
    start_at = datetime.combine(start, time.min, tzinfo=UTC)
    day_list = [start + timedelta(days=i) for i in range(days)]

    # --- tasks: counts by status (GROUP BY) and the rows the time charts need
    by_status = dict(
        db.query(TaskModel.status, func.count(TaskModel.id))
        .filter(TaskModel.project_id == project_id)
        .group_by(TaskModel.status)
        .all()
    )
    tasks = (
        db.query(TaskModel.id, TaskModel.title, TaskModel.status, TaskModel.created_at, TaskModel.due_date, TaskModel.assignee_id)
        .filter(TaskModel.project_id == project_id)
        .all()
    )

    # --- when each done task was finished (see the module docstring)
    moves = (
        db.query(ActivityModel.target, ActivityModel.created_at)
        .filter(ActivityModel.project_id == project_id, ActivityModel.action == "task_moved", ActivityModel.target.like(f"%{DONE_SUFFIX}"))
        .all()
    )
    finished_times: dict[str, list[datetime]] = defaultdict(list)
    for target, created_at in moves:
        finished_times[target[: -len(DONE_SUFFIX)]].append(_aware(created_at))
    title_counts = Counter(task.title for task in tasks)
    done_at: dict[int, datetime] = {}
    undated = 0
    for task in tasks:
        if task.status != "done":
            continue
        created = _aware(task.created_at)
        candidates = [t for t in finished_times.get(task.title, []) if t >= created] if title_counts[task.title] == 1 else []
        if candidates:
            done_at[task.id] = max(candidates)
        else:
            undated += 1

    # --- burn-up / burn-down: per day, the scope (tasks created by then) and how
    # many of them were finished by then. Undated done tasks are left out of both.
    in_charts = [task for task in tasks if task.status != "done" or task.id in done_at]
    created_days = sorted(_aware(task.created_at).date() for task in in_charts)
    finished_days = sorted(done_at[task.id].date() for task in in_charts if task.id in done_at)
    burn = []
    for day in day_list:
        scope = sum(1 for d in created_days if d <= day)
        completed = sum(1 for d in finished_days if d <= day)
        burn.append({"date": day.isoformat(), "scope": scope, "completed": completed, "remaining": scope - completed})

    # --- throughput: tasks finished in each 7-day block, oldest first. The
    # oldest block is shorter when the range isn't a whole number of weeks.
    throughput = []
    block_end = today
    while block_end >= start:
        block_start = max(start, block_end - timedelta(days=6))
        count = sum(1 for d in finished_days if block_start <= d <= block_end)
        throughput.append({"start": block_start.isoformat(), "end": block_end.isoformat(), "days": (block_end - block_start).days + 1, "completed": count})
        block_end = block_start - timedelta(days=1)
    throughput.reverse()

    # --- cycle time: creation to Done, for tasks finished in the range
    durations = [
        (done_at[task.id] - _aware(task.created_at)).total_seconds() / 86400
        for task in tasks
        if task.id in done_at and done_at[task.id] >= start_at
    ]
    if durations:
        cycle_time = {"available": True, "sample_size": len(durations), "median_days": round(median(durations), 2), "p90_days": round(_p90(durations), 2), "reason": None}
    else:
        cycle_time = {
            "available": False,
            "sample_size": 0,
            "median_days": None,
            "p90_days": None,
            "reason": "No task with a recorded move to Done was finished in this range.",
        }

    # --- workload per member (GROUP BY assignee and status), unassigned included
    workload_rows = (
        db.query(TaskModel.assignee_id, UserModel.username, TaskModel.status, func.count(TaskModel.id))
        .outerjoin(UserModel, UserModel.id == TaskModel.assignee_id)
        .filter(TaskModel.project_id == project_id)
        .group_by(TaskModel.assignee_id, UserModel.username, TaskModel.status)
        .all()
    )
    workload: dict = {}
    for assignee_id, username, status, count in workload_rows:
        entry = workload.setdefault(assignee_id, {"user_id": assignee_id, "username": username, **{s: 0 for s in TASK_STATUSES}})
        if status in TASK_STATUSES:
            entry[status] += count
    workload_list = sorted(
        workload.values(),
        key=lambda w: (w["user_id"] is None, -(w["todo"] + w["in_progress"]), (w["username"] or "")),
    )

    # --- overdue: not done, due before today
    usernames = dict(
        db.query(UserModel.id, UserModel.username)
        .filter(UserModel.id.in_({task.assignee_id for task in tasks if task.assignee_id is not None} or {-1}))
        .all()
    )
    overdue_tasks = sorted(
        (task for task in tasks if task.status != "done" and task.due_date is not None and task.due_date < today),
        key=lambda task: (task.due_date, task.id),
    )
    overdue = {
        "count": len(overdue_tasks),
        "tasks": [
            {
                "id": task.id,
                "title": task.title,
                "due_date": task.due_date.isoformat(),
                "days_overdue": (today - task.due_date).days,
                "assignee": usernames.get(task.assignee_id),
            }
            for task in overdue_tasks[:OVERDUE_LISTED]
        ],
    }

    # --- activity in the range: per day, and the most active people
    activity_days = dict(
        db.query(func.date(ActivityModel.created_at), func.count(ActivityModel.id))
        .filter(ActivityModel.project_id == project_id, ActivityModel.created_at >= start_at)
        .group_by(func.date(ActivityModel.created_at))
        .all()
    )
    activity_by_day_map = {_day(day): count for day, count in activity_days.items()}
    activity_by_day = [{"date": day.isoformat(), "events": activity_by_day_map.get(day.isoformat(), 0)} for day in day_list]
    contributors = [
        {"username": username, "events": count}
        for username, count in (
            db.query(UserModel.username, func.count(ActivityModel.id))
            .join(UserModel, UserModel.id == ActivityModel.user_id)
            .filter(ActivityModel.project_id == project_id, ActivityModel.created_at >= start_at)
            .group_by(UserModel.username)
            .order_by(func.count(ActivityModel.id).desc(), UserModel.username)
            .limit(TOP)
            .all()
        )
    ]

    # --- code files last edited in the range
    edited_count = (
        db.query(func.count(CodeFileModel.id))
        .filter(CodeFileModel.project_id == project_id, CodeFileModel.updated_at >= start_at)
        .scalar()
    )
    recent_files = [
        {"path": path, "updated_at": _aware(updated_at).isoformat()}
        for path, updated_at in (
            db.query(CodeFileModel.path, CodeFileModel.updated_at)
            .filter(CodeFileModel.project_id == project_id, CodeFileModel.updated_at >= start_at)
            .order_by(CodeFileModel.updated_at.desc(), CodeFileModel.path)
            .limit(TOP)
            .all()
        )
    ]

    return {
        "range_days": days,
        "start_date": start.isoformat(),
        "end_date": today.isoformat(),
        "tasks_by_status": {status: by_status.get(status, 0) for status in TASK_STATUSES},
        "total_tasks": len(tasks),
        "completion_dates": {"dated": len(done_at), "undated": undated},
        "burn": burn,
        "throughput": throughput,
        "cycle_time": cycle_time,
        "workload": workload_list,
        "overdue": overdue,
        "activity_by_day": activity_by_day,
        "contributors": contributors,
        "files_edited": edited_count,
        "recent_files": recent_files,
    }
