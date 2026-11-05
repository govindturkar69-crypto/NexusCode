import re

from pydantic import BaseModel, field_validator
from pydantic_core import PydanticCustomError

USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,30}$")


def _check_new_password(value: str) -> str:
    # bcrypt only looks at the first 72 bytes, so cap there instead of
    # silently ignoring the rest.
    if not 8 <= len(value.encode("utf-8")) <= 72:
        raise PydanticCustomError("password_invalid", "Password must be between 8 and 72 bytes long")
    return value


class UserCreate(BaseModel):
    username: str
    password: str

    # PydanticCustomError keeps the message clean (no "Value error, " prefix)
    # so the frontend can show it as-is.
    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        if not USERNAME_PATTERN.fullmatch(value):
            raise PydanticCustomError(
                "username_invalid",
                "Username must be 3-30 characters using only lowercase letters, numbers and _",
            )
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _check_new_password(value)


class SignupResponse(BaseModel):
    message: str
    username: str


class Token(BaseModel):
    access_token: str
    token_type: str


class MeOut(BaseModel):
    id: int
    username: str
    is_admin: bool


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return _check_new_password(value)


class AccountDelete(BaseModel):
    password: str


class MessageResponse(BaseModel):
    message: str


class GitHubStatus(BaseModel):
    connected: bool
    # Null when not connected, or when GitHub couldn't tell us
    username: str | None = None
    expired: bool = False


class PlannedProject(BaseModel):
    project_id: int
    name: str


class PlannedTransfer(PlannedProject):
    new_owner: str


class DeletionPlan(BaseModel):
    deleted: list[PlannedProject]
    transferred: list[PlannedTransfer]
    left: list[PlannedProject]
