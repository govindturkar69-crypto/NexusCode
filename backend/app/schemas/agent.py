from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.services.agent import MAX_CALLS_PER_STEP, MAX_GOAL_CHARS

Goal = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_GOAL_CHARS)]


class AgentRunCreate(BaseModel):
    goal: Goal


class AgentLimits(BaseModel):
    max_steps: int
    max_tokens: int
    max_seconds: int


class AgentRunOut(BaseModel):
    id: int
    project_id: int
    goal: str
    status: str
    steps: int
    tokens: int
    summary: str | None = None
    stop_reason: str | None = None
    created_at: datetime
    limits: AgentLimits


class ToolResultIn(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    result: dict


class AgentStepRequest(BaseModel):
    results: list[ToolResultIn] = Field(default_factory=list, max_length=MAX_CALLS_PER_STEP)


ProjectPath = Annotated[str, StringConstraints(min_length=1, max_length=300)]
TaskTitleIn = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class AgentAccepted(BaseModel):
    """What the user kept from a run, for the activity feed. The changes themselves
    were saved through the normal file and task routes, with their own checks."""
    files: list[ProjectPath] = Field(default_factory=list, max_length=50)
    tasks: list[TaskTitleIn] = Field(default_factory=list, max_length=20)


class AgentQuota(BaseModel):
    user_limit: int
    user_remaining: int
    total_limit: int
    total_remaining: int
    resets_at: datetime
    # False while Gemini itself has refused for the day
    ai_available: bool = True
