from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import Pagination, project_role, require_project_role
from app.models import ProjectModel, TaskModel
from app.schemas.project import (
    TaskCreate,
    TaskEdit,
    TaskListResponse,
    TaskMove,
    TaskResponse,
    TaskUpdate,
)

router = APIRouter(tags=["tasks"])


def _check_assignee(db: Session, project_id: int, assignee_id: int | None) -> None:
    if assignee_id is not None and project_role(db, project_id, assignee_id) is None:
        raise HTTPException(status_code=422, detail="The assignee must be a member of this project.")


@router.post("/projects/{project_id}/tasks", status_code=201, response_model=TaskResponse)
def create_task(task: TaskCreate, project: ProjectModel = Depends(require_project_role("editor")), db: Session = Depends(get_db)):
    _check_assignee(db, project.id, task.assignee_id)
    # New tasks go to the end of the board
    last_position = db.query(func.max(TaskModel.position)).filter(TaskModel.project_id == project.id).scalar()
    new_task = TaskModel(
        title=task.title,
        description=task.description,
        assignee_id=task.assignee_id,
        due_date=task.due_date,
        priority=task.priority,
        project_id=project.id,
        position=(last_position or 0) + 1,
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return {"message": "Task created", "task": new_task}


@router.get("/projects/{project_id}/tasks", response_model=TaskListResponse)
def get_project_tasks(page: Pagination = Depends(), project: ProjectModel = Depends(require_project_role("viewer")), db: Session = Depends(get_db)):
    query = (
        db.query(TaskModel)
        .options(joinedload(TaskModel.assignee))
        .filter(TaskModel.project_id == project.id)
        .order_by(TaskModel.position, TaskModel.id)
    )
    return page.envelope("tasks", *page.apply(query))


@router.put("/tasks/{task_id}", response_model=TaskResponse)
def update_task_status(update: TaskUpdate, task: TaskModel = Depends(require_project_role("editor", "task")), db: Session = Depends(get_db)):
    task.status = update.status
    db.commit()
    db.refresh(task)
    return {"message": "Task updated", "task": task}


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
def edit_task(edit: TaskEdit, task: TaskModel = Depends(require_project_role("editor", "task")), db: Session = Depends(get_db)):
    """Changes only the fields sent. Send null to clear assignee, due date or description."""
    changes = edit.model_dump(exclude_unset=True)
    if "assignee_id" in changes:
        _check_assignee(db, task.project_id, changes["assignee_id"])
    for field, value in changes.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return {"message": "Task updated", "task": task}


@router.patch("/tasks/{task_id}/move", response_model=TaskResponse)
def move_task(move: TaskMove, task: TaskModel = Depends(require_project_role("editor", "task")), db: Session = Depends(get_db)):
    """Puts the task at `index` in a column and renumbers that column. Rows are
    locked on Postgres, so two simultaneous drags can't produce mixed-up numbers."""
    column = (
        db.query(TaskModel)
        .filter(TaskModel.project_id == task.project_id, TaskModel.status == move.status, TaskModel.id != task.id)
        .order_by(TaskModel.position, TaskModel.id)
        .with_for_update()
        .all()
    )
    column.insert(min(move.index, len(column)), task)
    task.status = move.status
    for position, item in enumerate(column, start=1):
        item.position = position
    db.commit()
    db.refresh(task)
    return {"message": "Task moved", "task": task}


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task: TaskModel = Depends(require_project_role("editor", "task")), db: Session = Depends(get_db)):
    db.delete(task)
    db.commit()
    return Response(status_code=204)
