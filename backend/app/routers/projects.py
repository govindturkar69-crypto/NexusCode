"""Projects and their single code file."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Pagination, get_current_user, get_owned_project
from app.models import CodeFileModel, ProjectModel, UserModel
from app.routers.files import delete_project_assets
from app.schemas.project import (
    CodeFileResponse,
    CodeFileSavedResponse,
    CodeFileUpdate,
    ProjectCreate,
    ProjectCreatedResponse,
    ProjectListResponse,
    ProjectResponse,
)

router = APIRouter(tags=["projects"])


@router.post("/projects", status_code=201, response_model=ProjectCreatedResponse)
def create_project(project: ProjectCreate, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    new_project = ProjectModel(name=project.name, description=project.description, owner_id=current_user.id)
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return {"message": "Project created", "project": new_project}


@router.get("/projects", response_model=ProjectListResponse)
def get_my_projects(page: Pagination = Depends(), db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    query = db.query(ProjectModel).filter(ProjectModel.owner_id == current_user.id).order_by(ProjectModel.id)
    return page.envelope("projects", *page.apply(query))


@router.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(project: ProjectModel = Depends(get_owned_project)):
    return {"project": project}


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project: ProjectModel = Depends(get_owned_project), db: Session = Depends(get_db)):
    # Rows go via ORM cascade; uploaded assets have to be removed from Cloudinary
    delete_project_assets(project)
    db.delete(project)
    db.commit()
    return Response(status_code=204)


@router.get("/projects/{project_id}/code", response_model=CodeFileResponse)
def get_code_file(project: ProjectModel = Depends(get_owned_project), db: Session = Depends(get_db)):
    code_file = db.query(CodeFileModel).filter(CodeFileModel.project_id == project.id).first()
    if not code_file:
        code_file = CodeFileModel(content="", language="python", project_id=project.id)
        db.add(code_file)
        db.commit()
        db.refresh(code_file)
    return {"code_file": code_file}


@router.put("/projects/{project_id}/code", response_model=CodeFileSavedResponse)
def update_code_file(update: CodeFileUpdate, project: ProjectModel = Depends(get_owned_project), db: Session = Depends(get_db)):
    code_file = db.query(CodeFileModel).filter(CodeFileModel.project_id == project.id).first()
    if not code_file:
        code_file = CodeFileModel(project_id=project.id)
        db.add(code_file)

    code_file.content = update.content
    code_file.language = update.language
    db.commit()
    db.refresh(code_file)
    return {"message": "Code saved", "code_file": code_file}
