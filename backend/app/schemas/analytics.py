"""Response model for GET /projects/{project_id}/analytics (see services/project_analytics.py)."""
from pydantic import BaseModel


class StatusCounts(BaseModel):
    todo: int
    in_progress: int
    done: int


class CompletionDates(BaseModel):
    dated: int
    undated: int


class BurnPoint(BaseModel):
    date: str
    scope: int
    completed: int
    remaining: int


class ThroughputBlock(BaseModel):
    start: str
    end: str
    days: int
    completed: int


class CycleTime(BaseModel):
    available: bool
    sample_size: int
    median_days: float | None
    p90_days: float | None
    reason: str | None


class Workload(BaseModel):
    user_id: int | None
    username: str | None
    todo: int
    in_progress: int
    done: int


class OverdueTask(BaseModel):
    id: int
    title: str
    due_date: str
    days_overdue: int
    assignee: str | None


class Overdue(BaseModel):
    count: int
    tasks: list[OverdueTask]


class ActivityDay(BaseModel):
    date: str
    events: int


class Contributor(BaseModel):
    username: str
    events: int


class RecentFile(BaseModel):
    path: str
    updated_at: str


class ProjectAnalytics(BaseModel):
    range_days: int
    start_date: str
    end_date: str
    tasks_by_status: StatusCounts
    total_tasks: int
    completion_dates: CompletionDates
    burn: list[BurnPoint]
    throughput: list[ThroughputBlock]
    cycle_time: CycleTime
    workload: list[Workload]
    overdue: Overdue
    activity_by_day: list[ActivityDay]
    contributors: list[Contributor]
    files_edited: int
    recent_files: list[RecentFile]
