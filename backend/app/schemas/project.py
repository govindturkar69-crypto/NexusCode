from datetime import datetime
from typing import Literal, get_args

from pydantic import BaseModel

from app.models import TASK_STATUSES
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


class ProjectResponse(BaseModel):
    project: ProjectOut


class ProjectCreatedResponse(ProjectResponse):
    message: str


class ProjectListResponse(Page):
    projects: list[ProjectOut]


TaskStatus = Literal["todo", "in_progress", "done"]
# The API schema and the DB CHECK constraint must allow exactly the same values
assert get_args(TaskStatus) == TASK_STATUSES


class TaskCreate(BaseModel):
    title: str
    description: str | None = None


class TaskUpdate(BaseModel):
    status: TaskStatus


class TaskOut(ORMModel):
    id: int
    title: str
    description: str | None
    status: TaskStatus
    position: int
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
