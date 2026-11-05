"""Schemas for AI, GitHub, analytics and admin routes."""
import re

from pydantic import BaseModel, Field, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.common import Page

# Caps what a single request can send to the AI provider
MAX_AI_INPUT_CHARS = 20_000


class CodeGenRequest(BaseModel):
    prompt: str = Field(max_length=MAX_AI_INPUT_CHARS)


class CodeReviewRequest(BaseModel):
    code: str = Field(max_length=MAX_AI_INPUT_CHARS)


class AIResult(BaseModel):
    result: str


class GitHubAuthorizeUrl(BaseModel):
    url: str


class GitHubStart(BaseModel):
    # Random value the browser tab keeps in sessionStorage; only its hash goes into `state`
    nonce: str = Field(min_length=16, max_length=128)


class GitHubComplete(BaseModel):
    pending: str = Field(min_length=1, max_length=4096)
    nonce: str = Field(min_length=16, max_length=128)


class GitHubCompleteResponse(BaseModel):
    connected: bool


# "." and ".." would change what the API URL points at
REPO_NAME_PATTERN = r"^(?:[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}|\.[A-Za-z0-9_-][A-Za-z0-9._-]{0,98}|\.\.[A-Za-z0-9._-]{1,98})$"
# Git's own rules for a branch name, for the characters people actually use
BRANCH_PATTERN = re.compile(r"^(?!/)(?!.*//)(?!.*\.\.)(?!.*\.lock$)(?!.*/$)(?!.*\.$)(?!-)[A-Za-z0-9._/-]{1,100}$")


class PushToGithubRequest(BaseModel):
    repo_name: str = Field(pattern=REPO_NAME_PATTERN)
    # False creates repo_name; True pushes to a repository already on the user's account
    existing: bool = False
    # Only used when creating. New repositories are private unless asked otherwise.
    private: bool = True
    # None means the repository's default branch
    branch: str | None = None

    @field_validator("branch")
    @classmethod
    def validate_branch(cls, value: str | None) -> str | None:
        if value is not None and not BRANCH_PATTERN.fullmatch(value):
            raise PydanticCustomError("branch_invalid", "That isn't a valid branch name.")
        return value


class PushToGithubResponse(BaseModel):
    message: str
    repo_url: str | None
    private: bool
    repo_full_name: str
    branch: str
    changed: bool
    files: int
    commit_url: str


class GitHubRepoOut(BaseModel):
    name: str
    full_name: str
    private: bool
    default_branch: str | None
    html_url: str


class GitHubRepoListResponse(BaseModel):
    repos: list[GitHubRepoOut]


class GitHubBranchListResponse(BaseModel):
    branches: list[str]


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
