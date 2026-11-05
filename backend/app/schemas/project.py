from datetime import date, datetime
from typing import Annotated, Literal, get_args

from pydantic import (
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from app.models import TASK_PRIORITIES, TASK_STATUSES
from app.schemas.common import ORMModel, Page
from app.services.code_paths import path_problem


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class ProjectOut(ORMModel):
    id: int
    name: str
    description: str | None
    owner_id: int
    created_at: datetime
    updated_at: datetime
    # The current user's role in this project
    role: str


class ProjectResponse(BaseModel):
    project: ProjectOut


class ProjectCreatedResponse(ProjectResponse):
    message: str


class ProjectListResponse(Page):
    projects: list[ProjectOut]


TaskStatus = Literal["todo", "in_progress", "done"]
# The API schema and the DB CHECK constraint must allow exactly the same values
assert get_args(TaskStatus) == TASK_STATUSES


TaskPriority = Literal["low", "medium", "high"]
assert get_args(TaskPriority) == TASK_PRIORITIES

TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
TaskDescription = Annotated[str, StringConstraints(max_length=5000)]


class TaskCreate(BaseModel):
    title: TaskTitle
    description: TaskDescription | None = None
    assignee_id: int | None = None
    due_date: date | None = None
    priority: TaskPriority = "medium"


class TaskEdit(BaseModel):
    """Partial update: only the fields sent are changed."""

    title: TaskTitle | None = None
    description: TaskDescription | None = None
    assignee_id: int | None = None
    due_date: date | None = None
    priority: TaskPriority | None = None

    @model_validator(mode="after")
    def required_fields_cannot_be_cleared(self):
        for field in ("title", "priority"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise PydanticCustomError("not_nullable", "{field} cannot be empty", {"field": field})
        return self


class TaskUpdate(BaseModel):
    status: TaskStatus


class TaskMove(BaseModel):
    status: TaskStatus
    index: int = Field(ge=0)


class TaskOut(ORMModel):
    id: int
    title: str
    description: str | None
    status: TaskStatus
    position: int
    assignee_id: int | None
    assignee_username: str | None
    due_date: date | None
    priority: TaskPriority
    project_id: int
    created_at: datetime
    updated_at: datetime


class TaskResponse(BaseModel):
    message: str
    task: TaskOut


class TaskListResponse(Page):
    tasks: list[TaskOut]


class FileOut(ORMModel):
    id: int
    filename: str
    url: str
    project_id: int
    created_at: datetime


class FileResponse(BaseModel):
    message: str
    file: FileOut


class FileListResponse(Page):
    files: list[FileOut]


class MessageOut(ORMModel):
    id: int
    username: str
    content: str
    user_id: int | None
    project_id: int
    created_at: datetime
    # The sender has since left or been removed; the message itself stays
    author_removed: bool = False


class MessageListResponse(BaseModel):
    """Newest first. Pass next_cursor as ?before= to get the next (older) page;
    it is null when there is nothing older."""

    messages: list[MessageOut]
    next_cursor: int | None


class WsTicketRequest(BaseModel):
    project_id: int


class WsTicketResponse(BaseModel):
    ticket: str
    expires_in: int


MAX_CODE_FILE_CHARS = 1_000_000


def _check_path(value: str) -> str:
    # PydanticCustomError keeps the message free of a "Value error, " prefix
    problem = path_problem(value)
    if problem:
        raise PydanticCustomError("path_invalid", problem)
    return value


class CodeFileUpdate(BaseModel):
    content: str = Field(max_length=MAX_CODE_FILE_CHARS)
    language: str = "python"


class CodeFileContent(BaseModel):
    content: str = Field(max_length=MAX_CODE_FILE_CHARS)


class CodeFileCreate(BaseModel):
    path: str
    content: str = Field(default="", max_length=MAX_CODE_FILE_CHARS)

    _valid_path = field_validator("path")(_check_path)


class CodeFileRename(BaseModel):
    path: str

    _valid_path = field_validator("path")(_check_path)


class FolderRename(BaseModel):
    path: str
    new_path: str

    _valid_paths = field_validator("path", "new_path")(_check_path)


class FolderDelete(BaseModel):
    path: str

    _valid_path = field_validator("path")(_check_path)


class FolderDeleted(BaseModel):
    deleted: list[int]


class CodeFileSummary(ORMModel):
    id: int
    path: str
    language: str | None
    project_id: int
    created_at: datetime
    updated_at: datetime


class CodeFileOut(CodeFileSummary):
    content: str | None


class CodeFileResponse(BaseModel):
    code_file: CodeFileOut


class CodeFileSummaryResponse(BaseModel):
    code_file: CodeFileSummary


class CodeFileListResponse(BaseModel):
    code_files: list[CodeFileSummary]


class CodeFileSavedResponse(CodeFileResponse):
    message: str


class RunRequest(BaseModel):
    stdin: str = Field(default="", max_length=10_000)


class RunResult(BaseModel):
    status: str
    succeeded: bool
    timed_out: bool
    stdout: str
    stderr: str
    compile_output: str
    exit_code: int | None
    time_seconds: float | None
    memory_kb: int | None
    truncated: bool
    remaining_today: int


class RunInfo(BaseModel):
    enabled: bool
    languages: list[str]
    remaining_today: int
