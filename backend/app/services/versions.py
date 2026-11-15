"""
Server-side snapshots of a code file's text (see docs/VERSION-HISTORY.md).

take_snapshot() runs inside the one save path (collab's save_file), which runs
under the room's save lock, so two snapshots of the same file can't interleave
in this process. It also locks the file's row (FOR UPDATE, a no-op on SQLite),
so even several processes would queue. For sources "save" and "autosnapshot" it
throttles (one a minute per file) and deduplicates by content hash; a *final*
save (last person leaving, shutdown) skips the throttle but never the hash
check. "restore" and "import" rows are always written. The newest
MAX_VERSIONS_PER_FILE rows are kept; older ones go in the same transaction.
"""
import hashlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timeutil import aware_utc
from app.models import CodeFileModel, CodeFileVersionModel
from app.schemas.project import MAX_CODE_FILE_CHARS

logger = logging.getLogger("nexuscode")

SNAPSHOT_EVERY_SECONDS = 60
MAX_VERSIONS_PER_FILE = 50
THROTTLED_SOURCES = ("save", "autosnapshot")


@dataclass
class SnapshotRequest:
    """What a save would like snapshotted. Carried by the room until a save
    commits, so a failed save keeps it for the retry."""

    source: str = "autosnapshot"
    author_user_id: int | None = None
    label: str | None = None
    # True for the save when the last person leaves, and on shutdown: the 60 s
    # throttle is skipped so the state people left the file in is kept
    final: bool = False
    # True (restore) forces a save even when the text is unchanged
    force: bool = False
    # True for the save that only turns a file's existing text into its first live
    # document (the lazy backfill): no user changed anything, so no snapshot
    skip: bool = False


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def latest_version(db: Session, file_id: int) -> CodeFileVersionModel | None:
    return (
        db.query(CodeFileVersionModel)
        .filter(CodeFileVersionModel.file_id == file_id)
        .order_by(CodeFileVersionModel.created_at.desc(), CodeFileVersionModel.id.desc())
        .first()
    )


def take_snapshot(db: Session, file_id: int, project_id: int, text: str, request: SnapshotRequest) -> bool:
    """Adds a version row (and prunes) in the caller's transaction, if one is due.
    Returns whether a row was added. Raises nothing file-specific: the caller
    decides whether a failure may break the save (restore) or only be logged."""
    if len(text) > MAX_CODE_FILE_CHARS:
        logger.warning("Not snapshotting file %s: %s characters is over the limit", file_id, len(text))
        return False
    # Lock the file's row: snapshots of one file queue even across processes
    if db.execute(select(CodeFileModel.id).where(CodeFileModel.id == file_id).with_for_update()).first() is None:
        return False  # deleted meanwhile
    digest = content_hash(text)
    latest = latest_version(db, file_id)
    if request.source in THROTTLED_SOURCES and latest is not None:
        if latest.content_hash == digest:
            return False
        if not request.final and aware_utc(latest.created_at) > datetime.now(UTC) - timedelta(seconds=SNAPSHOT_EVERY_SECONDS):
            return False
    db.add(
        CodeFileVersionModel(
            file_id=file_id,
            project_id=project_id,
            content=text,
            content_hash=digest,
            author_user_id=request.author_user_id,
            label=request.label,
            source=request.source,
        )
    )
    db.flush()
    prune(db, file_id)
    return True


def prune(db: Session, file_id: int) -> None:
    """Deletes everything beyond the newest MAX_VERSIONS_PER_FILE versions."""
    old = [
        row_id
        for (row_id,) in db.query(CodeFileVersionModel.id)
        .filter(CodeFileVersionModel.file_id == file_id)
        .order_by(CodeFileVersionModel.created_at.desc(), CodeFileVersionModel.id.desc())
        .offset(MAX_VERSIONS_PER_FILE)
        .all()
    ]
    if old:
        db.query(CodeFileVersionModel).filter(CodeFileVersionModel.id.in_(old)).delete(synchronize_session=False)


def record_creation(db: Session, code_file: CodeFileModel, author_user_id: int | None, source: str = "save") -> None:
    """The first version of a file created with content (direct creation or ZIP
    import), in the caller's transaction. The file must have its id (flushed)."""
    if not code_file.content:
        return
    db.add(
        CodeFileVersionModel(
            file_id=code_file.id,
            project_id=code_file.project_id,
            content=code_file.content,
            content_hash=content_hash(code_file.content),
            author_user_id=author_user_id,
            source=source,
        )
    )
