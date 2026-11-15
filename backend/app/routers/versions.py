"""
A code file's version history (see docs/VERSION-HISTORY.md).

Every route hangs off the file and checks require_project_role on it, so
non-members get 404; every query is then scoped by the file AND its project,
so a version id from another project is a 404 too, never content.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_project_role
from app.core.rate_limit import RESTORE_LIMIT, limiter, user_or_ip
from app.models import CodeFileModel, CodeFileVersionModel, UserModel
from app.routers import collab
from app.schemas.versions import (
    VersionContentResponse,
    VersionLabelUpdate,
    VersionListResponse,
    VersionRestored,
)
from app.services.activity import publish, record
from app.services.versions import SnapshotRequest, latest_version

router = APIRouter(tags=["versions"])


def version_out(version: CodeFileVersionModel) -> dict:
    return {
        "id": version.id,
        "created_at": version.created_at,
        "label": version.label,
        "source": version.source,
        "author": version.author.username if version.author else None,
        "content_hash": version.content_hash,
        "size": len(version.content or ""),
    }


def _get_version(db: Session, code_file: CodeFileModel, version_id: int) -> CodeFileVersionModel:
    version = (
        db.query(CodeFileVersionModel)
        .filter(
            CodeFileVersionModel.id == version_id,
            CodeFileVersionModel.file_id == code_file.id,
            CodeFileVersionModel.project_id == code_file.project_id,
        )
        .first()
    )
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return version


@router.get("/code-files/{code_file_id}/versions", response_model=VersionListResponse)
def list_versions(
    code_file: CodeFileModel = Depends(require_project_role("viewer", "code_file")),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=50),
    offset: int = Query(0, ge=0),
):
    """Newest first, without content. Any member."""
    scoped = db.query(CodeFileVersionModel).filter(
        CodeFileVersionModel.file_id == code_file.id,
        CodeFileVersionModel.project_id == code_file.project_id,
    )
    total = scoped.with_entities(func.count(CodeFileVersionModel.id)).scalar()
    rows = (
        scoped.order_by(CodeFileVersionModel.created_at.desc(), CodeFileVersionModel.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return {"versions": [version_out(v) for v in rows], "total": total}


@router.get("/code-files/{code_file_id}/versions/{version_id}", response_model=VersionContentResponse)
def get_version(
    version_id: int,
    code_file: CodeFileModel = Depends(require_project_role("viewer", "code_file")),
    db: Session = Depends(get_db),
):
    """One version with its content (for the diff). Any member."""
    version = _get_version(db, code_file, version_id)
    return {"version": version_out(version), "content": version.content}


@router.patch("/code-files/{code_file_id}/versions/{version_id}", response_model=VersionContentResponse)
def label_version(
    body: VersionLabelUpdate,
    version_id: int,
    code_file: CodeFileModel = Depends(require_project_role("editor", "code_file")),
    db: Session = Depends(get_db),
):
    """Names (or un-names) a version. Owners and editors."""
    version = _get_version(db, code_file, version_id)
    version.label = body.label or None
    db.commit()
    db.refresh(version)
    return {"version": version_out(version), "content": version.content}


@router.post("/code-files/{code_file_id}/versions/{version_id}/restore", response_model=VersionRestored)
@limiter.limit(RESTORE_LIMIT, key_func=user_or_ip)
def restore_version(
    request: Request,
    version_id: int,
    code_file: CodeFileModel = Depends(require_project_role("editor", "code_file")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Makes the version's content the file's content, as a NEW version (source
    "restore"): history is never rewritten. The change goes through the live
    document, so connected editors see it instantly and can't overwrite it back,
    and the text, the document and the new version commit together."""
    version = _get_version(db, code_file, version_id)
    when = version.created_at.strftime("%Y-%m-%d %H:%M")
    snapshot = SnapshotRequest(
        source="restore",
        author_user_id=current_user.id,
        label=f"Restored the version from {when} UTC",
        force=True,
    )
    if not collab.replace_text(code_file.id, version.content, snapshot):
        raise HTTPException(status_code=404, detail="File not found")
    record(db, code_file.project_id, current_user.id, "code_restored", f"{code_file.path} (version from {when} UTC)")
    db.commit()
    publish(code_file.project_id, "code_restored")
    new_version = latest_version(db, code_file.id)
    return {
        "message": f"Restored {code_file.path} to the version from {when} UTC.",
        "version_id": new_version.id if new_version else version.id,
        "restored_to_version_id": version.id,
    }
