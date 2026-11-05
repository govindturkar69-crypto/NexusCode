"""A project's code files, and the folders implied by their paths."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, defer

from app.core.database import get_db
from app.core.deps import get_current_user, require_project_role
from app.models import CodeFileModel, ProjectModel, UserModel
from app.schemas.project import (
    CodeFileContent,
    CodeFileCreate,
    CodeFileListResponse,
    CodeFileRename,
    CodeFileResponse,
    CodeFileSavedResponse,
    CodeFileSummaryResponse,
    CodeFileUpdate,
    FolderDelete,
    FolderDeleted,
    FolderRename,
)
from app.services.activity import publish, record
from app.services.code_paths import language_for_path, path_conflict

router = APIRouter(tags=["code"])

MAX_FILES_PER_PROJECT = 500

# How the single-file editor named its file
LEGACY_EXTENSIONS = {"python": "py", "javascript": "js", "java": "java", "cpp": "cpp", "html": "html"}


def _all_paths(db: Session, project_id: int, excluding: int | None = None) -> list[str]:
    query = db.query(CodeFileModel.path).filter(CodeFileModel.project_id == project_id)
    if excluding is not None:
        query = query.filter(CodeFileModel.id != excluding)
    return [path for (path,) in query.all()]


def _commit_paths(db: Session, conflict_path: str) -> None:
    """The unique constraint has the last word if two people pick a name at once."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"{conflict_path} already exists.") from None


def _files_in_folder(db: Session, project_id: int, folder: str, *, lock: bool = False) -> list[CodeFileModel]:
    # startswith() with autoescape, so % and _ in a folder name are taken literally
    query = (
        db.query(CodeFileModel)
        .filter(CodeFileModel.project_id == project_id, CodeFileModel.path.startswith(f"{folder}/", autoescape=True))
        .order_by(CodeFileModel.path)
    )
    if lock:
        query = query.with_for_update()
    files = query.all()
    if not files:
        raise HTTPException(status_code=404, detail=f"There is no folder called {folder}.")
    return files


@router.get("/projects/{project_id}/code/files", response_model=CodeFileListResponse)
def list_code_files(project: ProjectModel = Depends(require_project_role("viewer")), db: Session = Depends(get_db)):
    """Every file without its content, sorted by path. Bounded by MAX_FILES_PER_PROJECT, so not paginated."""
    files = (
        db.query(CodeFileModel)
        .options(defer(CodeFileModel.content))
        .filter(CodeFileModel.project_id == project.id)
        .order_by(CodeFileModel.path)
        .all()
    )
    return {"code_files": files}


@router.post("/projects/{project_id}/code/files", status_code=201, response_model=CodeFileResponse)
def create_code_file(
    body: CodeFileCreate,
    project: ProjectModel = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    others = _all_paths(db, project.id)
    if len(others) >= MAX_FILES_PER_PROJECT:
        raise HTTPException(status_code=409, detail=f"A project can have at most {MAX_FILES_PER_PROJECT} files.")
    problem = path_conflict(body.path, others)
    if problem:
        raise HTTPException(status_code=409, detail=problem)
    code_file = CodeFileModel(project_id=project.id, path=body.path, language=language_for_path(body.path), content=body.content)
    db.add(code_file)
    record(db, project.id, current_user.id, "code_created", body.path)
    _commit_paths(db, body.path)
    db.refresh(code_file)
    publish(project.id, "code_created")
    return {"code_file": code_file}


@router.get("/code-files/{code_file_id}", response_model=CodeFileResponse)
def get_code_file(code_file: CodeFileModel = Depends(require_project_role("viewer", "code_file"))):
    return {"code_file": code_file}


@router.put("/code-files/{code_file_id}", response_model=CodeFileSummaryResponse)
def save_code_file(
    body: CodeFileContent,
    code_file: CodeFileModel = Depends(require_project_role("editor", "code_file")),
    db: Session = Depends(get_db),
):
    """Autosave, so it doesn't send the content back or add to the activity feed."""
    code_file.content = body.content
    db.commit()
    db.refresh(code_file)
    return {"code_file": code_file}


@router.patch("/code-files/{code_file_id}", response_model=CodeFileSummaryResponse)
def rename_code_file(
    body: CodeFileRename,
    code_file: CodeFileModel = Depends(require_project_role("editor", "code_file")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Renames or moves a file. Its language follows the new extension."""
    if body.path != code_file.path:
        problem = path_conflict(body.path, _all_paths(db, code_file.project_id, excluding=code_file.id))
        if problem:
            raise HTTPException(status_code=409, detail=problem)
        record(db, code_file.project_id, current_user.id, "code_renamed", f"{code_file.path} → {body.path}")
        code_file.path = body.path
        code_file.language = language_for_path(body.path)
        _commit_paths(db, body.path)
        db.refresh(code_file)
        publish(code_file.project_id, "code_renamed")
    return {"code_file": code_file}


@router.delete("/code-files/{code_file_id}", status_code=204)
def delete_code_file(
    code_file: CodeFileModel = Depends(require_project_role("editor", "code_file")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    project_id = code_file.project_id
    record(db, project_id, current_user.id, "code_deleted", code_file.path)
    db.delete(code_file)
    db.commit()
    publish(project_id, "code_deleted")
    return Response(status_code=204)


@router.post("/projects/{project_id}/code/folders/rename", response_model=CodeFileListResponse)
def rename_folder(
    body: FolderRename,
    project: ProjectModel = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Renames or moves a folder and everything in it, all or nothing."""
    if body.path == body.new_path or body.new_path.startswith(f"{body.path}/"):
        raise HTTPException(status_code=409, detail="A folder can't be moved into itself.")
    files = _files_in_folder(db, project.id, body.path, lock=True)
    moving = {f.id for f in files}
    others = [path for (file_id, path) in db.query(CodeFileModel.id, CodeFileModel.path).filter(CodeFileModel.project_id == project.id) if file_id not in moving]
    for code_file in files:
        new_path = body.new_path + code_file.path[len(body.path):]
        if len(new_path) > 255:
            raise HTTPException(status_code=422, detail=f"{new_path} would be too long.")
        problem = path_conflict(new_path, others)
        if problem:
            raise HTTPException(status_code=409, detail=problem)
        code_file.path = new_path
        code_file.language = language_for_path(new_path)
    record(db, project.id, current_user.id, "code_renamed", f"{body.path}/ → {body.new_path}/")
    _commit_paths(db, body.new_path)
    publish(project.id, "code_renamed")
    return {"code_files": sorted(files, key=lambda f: f.path)}


@router.post("/projects/{project_id}/code/folders/delete", response_model=FolderDeleted)
def delete_folder(
    body: FolderDelete,
    project: ProjectModel = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    files = _files_in_folder(db, project.id, body.path)
    deleted = [f.id for f in files]
    for code_file in files:
        db.delete(code_file)
    record(db, project.id, current_user.id, "code_deleted", f"{body.path}/")
    db.commit()
    publish(project.id, "code_deleted")
    return {"deleted": deleted}


# The single-file API, for browser tabs still running the previous frontend
# during a deploy. It works on the project's oldest file.

def _oldest_file(db: Session, project_id: int) -> CodeFileModel | None:
    return db.query(CodeFileModel).filter(CodeFileModel.project_id == project_id).order_by(CodeFileModel.id).first()


def _new_legacy_file(project_id: int, language: str) -> CodeFileModel:
    path = f"main.{LEGACY_EXTENSIONS.get(language, 'txt')}"
    return CodeFileModel(project_id=project_id, path=path, language=language, content="")


@router.get("/projects/{project_id}/code", response_model=CodeFileResponse)
def get_legacy_code_file(project: ProjectModel = Depends(require_project_role("viewer")), db: Session = Depends(get_db)):
    code_file = _oldest_file(db, project.id)
    if not code_file:
        code_file = _new_legacy_file(project.id, "python")
        db.add(code_file)
        db.commit()
        db.refresh(code_file)
    return {"code_file": code_file}


@router.put("/projects/{project_id}/code", response_model=CodeFileSavedResponse)
def update_legacy_code_file(update: CodeFileUpdate, project: ProjectModel = Depends(require_project_role("editor")), db: Session = Depends(get_db)):
    code_file = _oldest_file(db, project.id)
    if not code_file:
        code_file = _new_legacy_file(project.id, update.language)
        db.add(code_file)
    code_file.content = update.content
    code_file.language = update.language
    db.commit()
    db.refresh(code_file)
    return {"message": "Code saved", "code_file": code_file}
