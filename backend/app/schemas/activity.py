from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ORMModel, Page


class ActivityOut(BaseModel):
    id: int
    action: str
    target: str
    user_id: int | None
    # Null once the account that did this has been deleted
    username: str | None
    created_at: datetime


class ActivityListResponse(Page):
    activity: list[ActivityOut]


class NotificationOut(ORMModel):
    id: int
    project_id: int
    kind: str
    message: str
    is_read: bool
    created_at: datetime


class NotificationListResponse(Page):
    notifications: list[NotificationOut]
    unread_count: int


class NotificationResponse(BaseModel):
    notification: NotificationOut


class MarkedRead(BaseModel):
    marked: int
