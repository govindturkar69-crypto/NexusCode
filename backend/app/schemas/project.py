from datetime import date, datetime
from typing import Annotated, Literal, get_args

from pydantic import BaseModel, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from app.models import TASK_PRIORITIES, TASK_STATUSES
from app.schemas.common import ORMModel, Page


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


class CodeFileUpdate(BaseModel):
    content: str
    language: str = "python"


class CodeFileOut(ORMModel):
    id: int
    content: str | None
    language: str | None
    project_id: int
    updated_at: datetime


class CodeFileResponse(BaseModel):
    code_file: CodeFileOut


class CodeFileSavedResponse(CodeFileResponse):
    message: str
