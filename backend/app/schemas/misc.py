"""Schemas for AI, GitHub, analytics and admin routes."""
from pydantic import BaseModel, Field

from app.schemas.common import Page


class CodeGenRequest(BaseModel):
    prompt: str


class CodeReviewRequest(BaseModel):
    code: str


class AIResult(BaseModel):
    result: str


class GitHubAuthorizeUrl(BaseModel):
    url: str


class PushToGithubRequest(BaseModel):
    repo_name: str = Field(pattern=r"^[A-Za-z0-9._-]{1,100}$")
    private: bool = True


class PushToGithubResponse(BaseModel):
    message: str
    repo_url: str | None
    private: bool


class TasksByStatus(BaseModel):
    todo: int
    in_progress: int
    done: int


class AnalyticsOut(BaseModel):
    total_projects: int
    total_tasks: int
    tasks_by_status: TasksByStatus
    total_files: int
    total_messages: int


class AdminUserOut(BaseModel):
    id: int
    username: str
    is_admin: bool
    project_count: int


class AdminUsersResponse(Page):
    users: list[AdminUserOut]


class AdminProjectOut(BaseModel):
    id: int
    name: str
    owner_username: str
    task_count: int


class AdminProjectsResponse(Page):
    projects: list[AdminProjectOut]


class PlatformStats(BaseModel):
    total_users: int
    total_projects: int
    total_tasks: int
    total_files: int
    total_messages: int
