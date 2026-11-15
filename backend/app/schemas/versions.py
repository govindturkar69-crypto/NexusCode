"""Responses for a code file's version history (routers/versions.py)."""
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

VersionLabel = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class VersionOut(BaseModel):
    """One version, without its content (listing stays light)."""

    id: int
    created_at: datetime
    label: str | None
    source: str
    author: str | None
    content_hash: str
    size: int


class VersionListResponse(BaseModel):
    versions: list[VersionOut]
    total: int


class VersionContentResponse(BaseModel):
    version: VersionOut
    content: str


class VersionLabelUpdate(BaseModel):
    label: VersionLabel | None = None


class VersionRestored(BaseModel):
    message: str
    version_id: int
    restored_to_version_id: int
