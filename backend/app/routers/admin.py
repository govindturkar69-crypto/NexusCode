"""
Platform-wide views for admins. Each endpoint runs a fixed number of queries
however many rows there are: per-row counts come from GROUP BY subqueries
instead of loading every related object (the old N+1).
"""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Pagination, get_current_admin
from app.models import FileModel, MessageModel, ProjectModel, TaskModel, UserModel
from app.schemas.misc import AdminProjectsResponse, AdminUsersResponse, PlatformStats

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/users", response_model=AdminUsersResponse)
def admin_get_all_users(page: Pagination = Depends(), db: Session = Depends(get_db)):
    project_counts = (
        select(ProjectModel.owner_id, func.count(ProjectModel.id).label("project_count"))
        .group_by(ProjectModel.owner_id)
        .subquery()
    )
    query = (
        db.query(
            UserModel.id,
            UserModel.username,
            UserModel.is_admin,
            func.coalesce(project_counts.c.project_count, 0).label("project_count"),
        )
        .outerjoin(project_counts, project_counts.c.owner_id == UserModel.id)
        .order_by(UserModel.id)
    )
    rows, total = page.apply(query)
    users = [
        {"id": r.id, "username": r.username, "is_admin": bool(r.is_admin), "project_count": r.project_count}
        for r in rows
    ]
    return page.envelope("users", users, total)


@router.get("/projects", response_model=AdminProjectsResponse)
def admin_get_all_projects(page: Pagination = Depends(), db: Session = Depends(get_db)):
    task_counts = (
        select(TaskModel.project_id, func.count(TaskModel.id).label("task_count"))
        .group_by(TaskModel.project_id)
        .subquery()
    )
    query = (
        db.query(
            ProjectModel.id,
            ProjectModel.name,
            UserModel.username.label("owner_username"),
            func.coalesce(task_counts.c.task_count, 0).label("task_count"),
        )
        .join(UserModel, ProjectModel.owner_id == UserModel.id)
        .outerjoin(task_counts, task_counts.c.project_id == ProjectModel.id)
        .order_by(ProjectModel.id)
    )
    rows, total = page.apply(query)
    projects = [
        {"id": r.id, "name": r.name, "owner_username": r.owner_username, "task_count": r.task_count}
        for r in rows
    ]
    return page.envelope("projects", projects, total)


@router.get("/stats", response_model=PlatformStats)
def admin_get_platform_stats(db: Session = Depends(get_db)):
    # One round trip: five scalar subqueries in a single SELECT
    counts = db.query(
        select(func.count(UserModel.id)).scalar_subquery().label("total_users"),
        select(func.count(ProjectModel.id)).scalar_subquery().label("total_projects"),
        select(func.count(TaskModel.id)).scalar_subquery().label("total_tasks"),
        select(func.count(FileModel.id)).scalar_subquery().label("total_files"),
        select(func.count(MessageModel.id)).scalar_subquery().label("total_messages"),
    ).one()
    return dict(counts._mapping)
