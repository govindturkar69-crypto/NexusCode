from fastapi import APIRouter, Depends, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_owned_project, get_owned_task
from app.models import ProjectModel, TaskModel
from app.schemas.project import TaskCreate, TaskListResponse, TaskResponse, TaskUpdate

router = APIRouter(tags=["tasks"])


@router.post("/projects/{project_id}/tasks", status_code=201, response_model=TaskResponse)
def create_task(task: TaskCreate, project: ProjectModel = Depends(get_owned_project), db: Session = Depends(get_db)):
    # New tasks go to the end of the board
    last_position = db.query(func.max(TaskModel.position)).filter(TaskModel.project_id == project.id).scalar()
    new_task = TaskModel(
        title=task.title,
        description=task.description,
        project_id=project.id,
        position=(last_position or 0) + 1,
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return {"message": "Task created", "task": new_task}


@router.get("/projects/{project_id}/tasks", response_model=TaskListResponse)
def get_project_tasks(project: ProjectModel = Depends(get_owned_project), db: Session = Depends(get_db)):
    tasks = (
        db.query(TaskModel)
        .filter(TaskModel.project_id == project.id)
        .order_by(TaskModel.position, TaskModel.id)
        .all()
    )
    return {"tasks": tasks}


@router.put("/tasks/{task_id}", response_model=TaskResponse)
def update_task_status(update: TaskUpdate, task: TaskModel = Depends(get_owned_task), db: Session = Depends(get_db)):
    task.status = update.status
    db.commit()
    db.refresh(task)
    return {"message": "Task updated", "task": task}


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task: TaskModel = Depends(get_owned_task), db: Session = Depends(get_db)):
    db.delete(task)
    db.commit()
    return Response(status_code=204)
