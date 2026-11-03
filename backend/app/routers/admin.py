from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_admin
from app.models import FileModel, MessageModel, ProjectModel, TaskModel, UserModel
from app.schemas.misc import AdminProjectsResponse, AdminUsersResponse, PlatformStats

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/users", response_model=AdminUsersResponse)
def admin_get_all_users(db: Session = Depends(get_db)):
    users = db.query(UserModel).order_by(UserModel.id).all()
    return {
        "users": [
            {"id": u.id, "username": u.username, "is_admin": bool(u.is_admin), "project_count": len(u.projects)}
            for u in users
        ]
    }


@router.get("/projects", response_model=AdminProjectsResponse)
def admin_get_all_projects(db: Session = Depends(get_db)):
    projects = db.query(ProjectModel).order_by(ProjectModel.id).all()
    return {
        "projects": [
            {"id": p.id, "name": p.name, "owner_username": p.owner.username, "task_count": len(p.tasks)}
            for p in projects
        ]
    }


@router.get("/stats", response_model=PlatformStats)
def admin_get_platform_stats(db: Session = Depends(get_db)):
    return {
        "total_users": db.query(UserModel).count(),
        "total_projects": db.query(ProjectModel).count(),
        "total_tasks": db.query(TaskModel).count(),
        "total_files": db.query(FileModel).count(),
        "total_messages": db.query(MessageModel).count(),
    }
