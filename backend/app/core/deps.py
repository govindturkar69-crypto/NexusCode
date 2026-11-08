"""
Shared FastAPI dependencies. Every project permission check lives here, so a
route can't forget one: depend on require_project_role instead of querying by id.
"""
from fastapi import Depends, HTTPException, Query
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_session
from app.models import (
    PROJECT_ROLES,
    CodeFileModel,
    FileModel,
    ProjectMemberModel,
    ProjectModel,
    TaskModel,
    UserModel,
)

# Looks for "Authorization: Bearer <token>". tokenUrl only feeds the /docs
# page's "Authorize" button.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")
# The same, for routes that work with or without a login
optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login", auto_error=False)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> UserModel:
    session = decode_session(token)
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    username, version = session

    user = db.query(UserModel).filter(UserModel.username == username).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    if version != (user.token_version or 0):
        raise HTTPException(status_code=401, detail="Your session has ended. Please sign in again.")
    return user


def get_optional_user(token: str | None = Depends(optional_oauth2_scheme), db: Session = Depends(get_db)) -> UserModel | None:
    """The signed-in user, or None. A token that is sent but invalid is still an error."""
    if token is None:
        return None
    return get_current_user(token, db)


def get_current_admin(current_user: UserModel = Depends(get_current_user)) -> UserModel:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def project_role(db: Session, project_id: int, user_id: int) -> str | None:
    """The user's role in the project, or None if they aren't a member."""
    return (
        db.query(ProjectMemberModel.role)
        .filter(ProjectMemberModel.project_id == project_id, ProjectMemberModel.user_id == user_id)
        .scalar()
    )


def role_at_least(role: str | None, min_role: str) -> bool:
    return role is not None and PROJECT_ROLES.index(role) >= PROJECT_ROLES.index(min_role)


def _authorize(db: Session, project_id: int, user: UserModel, min_role: str, not_found: str) -> None:
    role = project_role(db, project_id, user.id)
    if role is None:
        # Same answer as "doesn't exist", so ids can't be probed
        raise HTTPException(status_code=404, detail=not_found)
    if not role_at_least(role, min_role):
        raise HTTPException(status_code=403, detail=f"This action needs the {min_role} role in this project.")


def require_project_role(min_role: str, resource: str = "project"):
    """
    The one permission check for project data. Returns a dependency that loads
    the object from the URL if the current user has at least `min_role` in its
    project: 404 for non-members, 403 for members with too low a role.

    resource: "project" (/projects/{project_id}), "task" (/tasks/{task_id}),
    "file" (/files/{file_id}) or "code_file" (/code-files/{code_file_id}); the
    dependency returns that object.

    viewer = read only; editor = also change tasks, files, code and chat;
    owner = also manage members, delete the project and push to GitHub.
    """
    if min_role not in PROJECT_ROLES:
        raise ValueError(f"Unknown role: {min_role}")

    def project_dependency(project_id: int, db: Session = Depends(get_db), user: UserModel = Depends(get_current_user)) -> ProjectModel:
        project = db.get(ProjectModel, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        _authorize(db, project.id, user, min_role, "Project not found")
        return project

    def task_dependency(task_id: int, db: Session = Depends(get_db), user: UserModel = Depends(get_current_user)) -> TaskModel:
        task = db.get(TaskModel, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        _authorize(db, task.project_id, user, min_role, "Task not found")
        return task

    def file_dependency(file_id: int, db: Session = Depends(get_db), user: UserModel = Depends(get_current_user)) -> FileModel:
        file = db.get(FileModel, file_id)
        if file is None:
            raise HTTPException(status_code=404, detail="File not found")
        _authorize(db, file.project_id, user, min_role, "File not found")
        return file

    def code_file_dependency(code_file_id: int, db: Session = Depends(get_db), user: UserModel = Depends(get_current_user)) -> CodeFileModel:
        code_file = db.get(CodeFileModel, code_file_id)
        if code_file is None:
            raise HTTPException(status_code=404, detail="Code file not found")
        _authorize(db, code_file.project_id, user, min_role, "Code file not found")
        return code_file

    return {"project": project_dependency, "task": task_dependency, "file": file_dependency, "code_file": code_file_dependency}[resource]


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
