"""Projects."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import (
    Pagination,
    get_current_user,
    project_role,
    require_project_role,
)
from app.models import ProjectMemberModel, ProjectModel, UserModel
from app.routers import collab
from app.routers.files import delete_project_assets
from app.schemas.project import (
    ProjectCreate,
    ProjectCreatedResponse,
    ProjectListResponse,
    ProjectResponse,
)

router = APIRouter(tags=["projects"])


def _project_out(project: ProjectModel, role: str) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "owner_id": project.owner_id,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "role": role,
    }


@router.post("/projects", status_code=201, response_model=ProjectCreatedResponse)
def create_project(project: ProjectCreate, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    new_project = ProjectModel(name=project.name, description=project.description, owner_id=current_user.id)
    new_project.members.append(ProjectMemberModel(user_id=current_user.id, role="owner"))
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return {"message": "Project created", "project": _project_out(new_project, "owner")}


@router.get("/projects", response_model=ProjectListResponse)
def get_my_projects(page: Pagination = Depends(), db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """Every project the user owns or is a member of, with their role in it."""
    query = (
        db.query(ProjectModel, ProjectMemberModel.role)
        .join(ProjectMemberModel, ProjectMemberModel.project_id == ProjectModel.id)
        .filter(ProjectMemberModel.user_id == current_user.id)
        .order_by(ProjectModel.id)
    )
    rows, total = page.apply(query)
    return page.envelope("projects", [_project_out(project, role) for project, role in rows], total)


@router.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(
    project: ProjectModel = Depends(require_project_role("viewer")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    return {"project": _project_out(project, project_role(db, project.id, current_user.id))}


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project: ProjectModel = Depends(require_project_role("owner")), db: Session = Depends(get_db)):
    # Rows go via ORM cascade; uploaded assets have to be removed from Cloudinary
    delete_project_assets(project)
    project_id = project.id
    db.delete(project)
    db.commit()
    collab.drop_project(project_id)
    return Response(status_code=204)
