from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import (
    TASK_STATUSES,
    FileModel,
    MessageModel,
    ProjectMemberModel,
    ProjectModel,
    TaskModel,
    UserModel,
)
from app.schemas.misc import AnalyticsOut

router = APIRouter(tags=["analytics"])


@router.get("/analytics", response_model=AnalyticsOut)
def get_analytics(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """Counts are computed in the database (COUNT / GROUP BY), not by loading rows."""
    # Every project the user is a member of, whatever their role
    mine = select(ProjectMemberModel.project_id).where(ProjectMemberModel.user_id == current_user.id)

    total_projects = db.query(func.count(ProjectModel.id)).filter(ProjectModel.id.in_(mine)).scalar()

    status_counts = dict(
        db.query(TaskModel.status, func.count(TaskModel.id))
        .filter(TaskModel.project_id.in_(mine))
        .group_by(TaskModel.status)
        .all()
    )
    tasks_by_status = {status: status_counts.get(status, 0) for status in TASK_STATUSES}

    total_files = db.query(func.count(FileModel.id)).filter(FileModel.project_id.in_(mine)).scalar()
    total_messages = db.query(func.count(MessageModel.id)).filter(MessageModel.project_id.in_(mine)).scalar()

    return {
        "total_projects": total_projects,
        "total_tasks": sum(tasks_by_status.values()),
        "tasks_by_status": tasks_by_status,
        "total_files": total_files,
        "total_messages": total_messages,
    }
