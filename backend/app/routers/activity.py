from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Pagination, get_current_user, require_project_role
from app.models import ActivityModel, NotificationModel, ProjectModel, UserModel
from app.schemas.activity import (
    ActivityListResponse,
    MarkedRead,
    NotificationListResponse,
    NotificationResponse,
)

router = APIRouter(tags=["activity"])


@router.get("/projects/{project_id}/activity", response_model=ActivityListResponse)
def project_activity(page: Pagination = Depends(), project: ProjectModel = Depends(require_project_role("viewer")), db: Session = Depends(get_db)):
    """Newest first."""
    query = (
        db.query(ActivityModel, UserModel.username)
        .outerjoin(UserModel, ActivityModel.user_id == UserModel.id)
        .filter(ActivityModel.project_id == project.id)
        .order_by(ActivityModel.id.desc())
    )
    rows, total = page.apply(query)
    entries = [
        {
            "id": entry.id,
            "action": entry.action,
            "target": entry.target,
            "user_id": entry.user_id,
            "username": username,
            "created_at": entry.created_at,
        }
        for entry, username in rows
    ]
    return page.envelope("activity", entries, total)


def _mine(db: Session, user: UserModel):
    return db.query(NotificationModel).filter(NotificationModel.user_id == user.id)


@router.get("/notifications", response_model=NotificationListResponse)
def list_notifications(
    unread_only: bool = Query(False),
    page: Pagination = Depends(),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """The current user's own notifications, newest first."""
    query = _mine(db, current_user)
    if unread_only:
        query = query.filter(NotificationModel.is_read.is_(False))
    rows, total = page.apply(query.order_by(NotificationModel.id.desc()))
    unread = (
        db.query(func.count(NotificationModel.id))
        .filter(NotificationModel.user_id == current_user.id, NotificationModel.is_read.is_(False))
        .scalar()
    )
    return {**page.envelope("notifications", rows, total), "unread_count": unread}


# Before /{notification_id}/read so "read-all" can't be mistaken for an id
@router.post("/notifications/read-all", response_model=MarkedRead)
def mark_all_read(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    marked = _mine(db, current_user).filter(NotificationModel.is_read.is_(False)).update({"is_read": True})
    db.commit()
    return {"marked": marked}


@router.post("/notifications/{notification_id}/read", response_model=NotificationResponse)
def mark_read(notification_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    notification = _mine(db, current_user).filter(NotificationModel.id == notification_id).first()
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return {"notification": notification}
