from datetime import datetime
from typing import Literal, get_args

from pydantic import BaseModel, Field

from app.models import PROJECT_ROLES

ProjectRole = Literal["viewer", "editor", "owner"]
assert get_args(ProjectRole) == PROJECT_ROLES


class MemberAdd(BaseModel):
    username: str = Field(min_length=1, max_length=30)
    role: ProjectRole = "editor"


class MemberUpdate(BaseModel):
    role: ProjectRole


class MemberOut(BaseModel):
    user_id: int
    username: str
    role: ProjectRole
    created_at: datetime


class MemberResponse(BaseModel):
    member: MemberOut


class MemberListResponse(BaseModel):
    members: list[MemberOut]
