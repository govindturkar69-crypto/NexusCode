import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator
from pydantic_core import PydanticCustomError

USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,30}$")


EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str) -> str:
    """Trimmed and lowercased, so one address can't belong to two accounts."""
    email = value.strip().lower()
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email) or ".." in email.split("@")[1]:
        raise PydanticCustomError("email_invalid", "Enter a valid email address.")
    return email


def _check_new_password(value: str) -> str:
    # bcrypt only looks at the first 72 bytes, so cap there instead of
    # silently ignoring the rest.
    if not 8 <= len(value.encode("utf-8")) <= 72:
        raise PydanticCustomError("password_invalid", "Password must be between 8 and 72 bytes long")
    return value


class UserCreate(BaseModel):
    username: str
    password: str
    # Optional: email can be off on a server, and accounts work without one
    email: str | None = None

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str | None) -> str | None:
        return None if value is None or not value.strip() else normalize_email(value)

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


class EmailUpdate(BaseModel):
    email: str
    # Required when the account has a password
    current_password: str | None = None

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        return normalize_email(value)


class EmailSending(BaseModel):
    enabled: bool
    restricted: bool
    message: str | None


class EmailOut(BaseModel):
    email: str | None
    email_verified: bool
    has_password: bool
    sending: EmailSending


class AuthOptions(BaseModel):
    email: bool
    google: bool = False
    github: bool = False


class PasswordResetRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        return normalize_email(value)


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return _check_new_password(value)


class EmailToken(BaseModel):
    token: str = Field(min_length=1, max_length=200)


class SessionResponse(BaseModel):
    message: str
    access_token: str
    token_type: str


# PKCE (RFC 7636): the verifier is 43-128 of these characters; S256 makes a 43-character challenge
PKCE_VERIFIER = r"^[A-Za-z0-9._~-]{43,128}$"
PKCE_CHALLENGE = r"^[A-Za-z0-9_-]{43}$"


class OAuthStart(BaseModel):
    nonce: str = Field(min_length=16, max_length=128)
    code_challenge: str = Field(pattern=PKCE_CHALLENGE)
    intent: Literal["login", "link"] = "login"


class OAuthStartResponse(BaseModel):
    url: str


class OAuthComplete(BaseModel):
    provider: Literal["google", "github"]
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=4096)
    nonce: str = Field(min_length=16, max_length=128)
    code_verifier: str = Field(pattern=PKCE_VERIFIER)


class OAuthLinkWithPassword(BaseModel):
    link_token: str = Field(min_length=1, max_length=4096)
    password: str = Field(max_length=1000)


class OAuthResult(BaseModel):
    # signed_in | created | linked | link_required
    status: str
    access_token: str | None = None
    token_type: str | None = None
    username: str | None = None
    provider: str | None = None
    link_token: str | None = None



class LinkedIdentity(BaseModel):
    provider: str
    email: str | None = None
    linked_at: datetime


class SignInMethods(BaseModel):
    has_password: bool
    identities: list[LinkedIdentity]
    # Providers this server has set up, so Settings offers only those
    available: dict[str, bool]


class PasswordSet(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return _check_new_password(value)
