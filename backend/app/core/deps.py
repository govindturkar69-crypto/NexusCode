"""
Shared FastAPI dependencies. Every ownership check lives here, so a route
can't forget one: depend on get_owned_project / get_owned_task /
get_owned_file instead of querying by id.
"""
from fastapi import Depends, HTTPException, Query
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models import FileModel, ProjectModel, TaskModel, UserModel

# Looks for "Authorization: Bearer <token>". tokenUrl only feeds the /docs
# page's "Authorize" button.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> UserModel:
    username = decode_access_token(token)
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = db.query(UserModel).filter(UserModel.username == username).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_current_admin(current_user: UserModel = Depends(get_current_user)) -> UserModel:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def get_owned_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
) -> ProjectModel:
    """The project from the URL, if the current user owns it; 404 otherwise
    (also for other users' projects, so ids can't be probed)."""
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.owner_id == current_user.id,
    ).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_owned_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
) -> TaskModel:
    task = db.query(TaskModel).join(ProjectModel).filter(
        TaskModel.id == task_id,
        ProjectModel.owner_id == current_user.id,
    ).first()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def get_owned_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
) -> FileModel:
    file = db.query(FileModel).join(ProjectModel).filter(
        FileModel.id == file_id,
        ProjectModel.owner_id == current_user.id,
    ).first()
    if file is None:
        raise HTTPException(status_code=404, detail="File not found")
    return file


class Pagination:
    """?limit=&offset= for list endpoints (default 50, max 200)."""

    def __init__(
        self,
        limit: int = Query(50, ge=1, le=200, description="Items per page (max 200)"),
        offset: int = Query(0, ge=0, description="Items to skip"),
    ):
        self.limit = limit
        self.offset = offset

    def apply(self, query):
        """Returns (items, total) for a SQLAlchemy query."""
        total = query.order_by(None).count()
        return query.limit(self.limit).offset(self.offset).all(), total

    def envelope(self, key: str, items, total: int) -> dict:
        return {key: items, "total": total, "limit": self.limit, "offset": self.offset}
