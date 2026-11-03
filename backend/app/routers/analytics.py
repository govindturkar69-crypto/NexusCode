from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import (
    TASK_STATUSES,
    FileModel,
    MessageModel,
    ProjectModel,
    TaskModel,
    UserModel,
)
from app.schemas.misc import AnalyticsOut

router = APIRouter(tags=["analytics"])


@router.get("/analytics", response_model=AnalyticsOut)
def get_analytics(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    project_ids = [p.id for p in db.query(ProjectModel).filter(ProjectModel.owner_id == current_user.id).all()]

    if not project_ids:
        return {
            "total_projects": 0,
            "total_tasks": 0,
            "tasks_by_status": {status: 0 for status in TASK_STATUSES},
            "total_files": 0,
            "total_messages": 0,
        }

    tasks = db.query(TaskModel).filter(TaskModel.project_id.in_(project_ids)).all()
    return {
        "total_projects": len(project_ids),
        "total_tasks": len(tasks),
        "tasks_by_status": {status: len([t for t in tasks if t.status == status]) for status in TASK_STATUSES},
        "total_files": db.query(FileModel).filter(FileModel.project_id.in_(project_ids)).count(),
        "total_messages": db.query(MessageModel).filter(MessageModel.project_id.in_(project_ids)).count(),
    }
