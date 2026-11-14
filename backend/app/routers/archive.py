"""A project's code as a ZIP: export (any member) and import (owner and editor).
All the checks live in services/project_archive.py."""
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_project_role
from app.models import (
    CodeFileModel,
    ProjectMemberModel,
    ProjectModel,
    TaskModel,
    UserModel,
)
from app.routers.code import MAX_FILES_PER_PROJECT
from app.services import project_archive as archive
from app.services.activity import publish, record

router = APIRouter(tags=["code"])


@router.get("/projects/{project_id}/export")
def export_project(project: ProjectModel = Depends(require_project_role("viewer")), db: Session = Depends(get_db)):
    """The project's code files, tasks.json and a README, as one ZIP download."""
    tasks = (
        db.query(TaskModel, UserModel.username)
        .outerjoin(UserModel, UserModel.id == TaskModel.assignee_id)
        .filter(TaskModel.project_id == project.id)
        .order_by(TaskModel.id)
        .all()
    )
    code_files = db.query(CodeFileModel).filter(CodeFileModel.project_id == project.id).order_by(CodeFileModel.path).all()
    members = db.query(ProjectMemberModel).filter(ProjectMemberModel.project_id == project.id).count()
    data = archive.build_export(project, tasks, code_files, members)
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{archive.export_filename(project.name)}"',
            "Cache-Control": "no-store",
        },
    )


def _parse_decisions(raw: str) -> dict[str, str]:
    try:
        decisions = json.loads(raw or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="decisions must be a JSON object.") from None
    if not isinstance(decisions, dict) or any(not isinstance(k, str) or v not in ("skip", "rename") for k, v in decisions.items()):
        raise HTTPException(status_code=422, detail='decisions maps paths to "skip" or "rename".')
    return decisions


@router.post("/projects/{project_id}/code/import")
def import_code(
    file: UploadFile = File(...),
    dry_run: bool = Form(True),
    decisions: str = Form("{}"),
    project: ProjectModel = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """
    dry_run (the default) only reports what would happen to each file. Send the
    same ZIP again with dry_run=false and, for files that already exist,
    decisions = {"path": "skip" | "rename"} to create them. Everything is
    checked again on the real run: nothing from the preview is trusted.
    """
    choices = _parse_decisions(decisions)
    data = file.file.read(archive.MAX_ARCHIVE_BYTES + 1)
    existing = [path for (path,) in db.query(CodeFileModel.path).filter(CodeFileModel.project_id == project.id).all()]
    try:
        entries = archive.analyze(data, existing, MAX_FILES_PER_PROJECT - len(existing))
    except archive.ArchiveError as err:
        raise HTTPException(status_code=422, detail=str(err)) from None

    report = [{"path": e.path, "status": e.status, "size": e.size, "reason": e.reason} for e in entries]
    summary = {status: sum(1 for e in entries if e.status == status) for status in ("new", "duplicate", "skipped")}
    if dry_run:
        return {"dry_run": True, "entries": report, "summary": summary, "capacity": MAX_FILES_PER_PROJECT - len(existing)}

    to_create = archive.plan(entries, existing, choices)
    if len(existing) + len(to_create) > MAX_FILES_PER_PROJECT:
        raise HTTPException(status_code=409, detail=f"A project can have at most {MAX_FILES_PER_PROJECT} files.")
    for path, content in to_create:
        db.add(CodeFileModel(project_id=project.id, path=path, language=archive.language_for_path(path), content=content))
    name = (file.filename or "archive.zip").rsplit("/", 1)[-1][:100]
    if to_create:
        record(db, project.id, current_user.id, "code_created", f"{len(to_create)} file{'s' if len(to_create) != 1 else ''} from {name}")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Someone else just created one of these files. Preview the ZIP again.") from None
    if to_create:
        publish(project.id, "code_created")
    renamed = {e.path for e in entries if e.status == "duplicate" and choices.get(e.path) == "rename"}
    return {
        "dry_run": False,
        "created": [path for path, _ in to_create],
        "renamed": sorted(renamed),
        "skipped": [r for r in report if r["status"] == "skipped" or (r["status"] == "duplicate" and r["path"] not in renamed)],
        "summary": summary,
    }
