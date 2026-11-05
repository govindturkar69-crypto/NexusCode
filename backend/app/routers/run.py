"""Running a code file. The code itself runs on Judge0, never on this server."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, require_project_role
from app.core.rate_limit import RUN_LIMIT, limiter, user_or_ip
from app.models import CodeFileModel, CodeRunModel, UserModel
from app.schemas.project import RunInfo, RunRequest, RunResult
from app.services import runner

router = APIRouter(tags=["run"])

MAX_RUN_SOURCE_CHARS = 64_000


def _runs_today(db: Session, user_id: int | None = None) -> int:
    # Days are UTC. Kept in the database so the caps survive restarts and deploys.
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    query = db.query(func.count(CodeRunModel.id)).filter(CodeRunModel.created_at >= start)
    if user_id is not None:
        query = query.filter(CodeRunModel.user_id == user_id)
    return query.scalar()


def _remaining_today(db: Session, user_id: int) -> int:
    left_for_everyone = settings.run_daily_limit - _runs_today(db)
    left_for_user = settings.run_user_daily_limit - _runs_today(db, user_id)
    return max(0, min(left_for_everyone, left_for_user))


@router.get("/run/info", response_model=RunInfo)
def run_info(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    return {
        "enabled": runner.is_configured(),
        "languages": sorted(runner.LANGUAGES),
        "remaining_today": _remaining_today(db, current_user.id),
    }


# Editors and up, because every run spends a shared daily allowance
@router.post("/code-files/{code_file_id}/run", response_model=RunResult)
@limiter.limit(RUN_LIMIT, key_func=user_or_ip)
def run_code_file(
    request: Request,
    body: RunRequest,
    code_file: CodeFileModel = Depends(require_project_role("editor", "code_file")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Runs the file as saved, on its own."""
    if not runner.is_configured():
        raise HTTPException(status_code=503, detail="Running code isn't set up on this server yet.")
    if code_file.language not in runner.LANGUAGES:
        raise HTTPException(status_code=422, detail=f"{code_file.path} can't be run: this language isn't supported.")
    source = code_file.content or ""
    if not source.strip():
        raise HTTPException(status_code=422, detail="This file is empty, so there's nothing to run.")
    if len(source) > MAX_RUN_SOURCE_CHARS:
        raise HTTPException(status_code=422, detail=f"Files over {MAX_RUN_SOURCE_CHARS:,} characters can't be run.")

    if _runs_today(db, current_user.id) >= settings.run_user_daily_limit:
        raise HTTPException(status_code=429, detail=f"You've used your {settings.run_user_daily_limit} code runs for today. They reset at midnight UTC.")
    if _runs_today(db) >= settings.run_daily_limit:
        raise HTTPException(status_code=429, detail="This site has used all its code runs for today. They reset at midnight UTC.")

    # Counted before the call: a slow or failed run may still use up Judge0's quota
    db.add(CodeRunModel(project_id=code_file.project_id, user_id=current_user.id))
    db.commit()

    try:
        result = runner.run_code(code_file.language, source, body.stdin)
    except runner.RunnerQuotaError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except runner.RunnerUnavailableError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {**result, "remaining_today": _remaining_today(db, current_user.id)}
