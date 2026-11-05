import json
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_project_role
from app.core.rate_limit import AI_LIMIT, limiter, user_or_ip
from app.models import CodeFileModel, ProjectModel, UserModel
from app.schemas.misc import (
    MAX_AI_INPUT_CHARS,
    AIResult,
    AssistRequest,
    CodeGenRequest,
    CodeReviewRequest,
)
from app.services import ai, ai_assist

router = APIRouter(prefix="/ai", tags=["ai"])

MAX_AI_CONTEXT_CHARS = 60_000


def _run(fn, text: str) -> dict:
    try:
        return {"result": fn(text)}
    except (ai.AIQuotaExceededError, ai.AIServiceBusyError) as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/generate-code", response_model=AIResult)
@limiter.limit(AI_LIMIT, key_func=user_or_ip)
def ai_generate_code(request: Request, body: CodeGenRequest, current_user: UserModel = Depends(get_current_user)):
    return _run(ai.generate_code, body.prompt)


@router.post("/detect-bugs", response_model=AIResult)
@limiter.limit(AI_LIMIT, key_func=user_or_ip)
def ai_detect_bugs(request: Request, body: CodeReviewRequest, current_user: UserModel = Depends(get_current_user)):
    return _run(ai.detect_bugs, body.code)


@router.post("/generate-docs", response_model=AIResult)
@limiter.limit(AI_LIMIT, key_func=user_or_ip)
def ai_generate_docs(request: Request, body: CodeReviewRequest, current_user: UserModel = Depends(get_current_user)):
    return _run(ai.generate_docs, body.code)


def _sse(event: str, data: dict) -> str:
    # json.dumps escapes newlines, so reply text can't break out of its frame
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _frames(reply: Iterator[str]) -> Iterator[str]:
    try:
        for text in reply:
            yield _sse("delta", {"text": text})
    except ai_assist.StreamInterrupted as e:
        yield _sse("error", {"detail": str(e)})
        return
    yield _sse("done", {})


@router.post("/projects/{project_id}/stream")
@limiter.limit(AI_LIMIT, key_func=user_or_ip)
def ai_assist_stream(
    request: Request,
    body: AssistRequest,
    project: ProjectModel = Depends(require_project_role("viewer")),
    db: Session = Depends(get_db),
):
    """
    Streams a reply about the project's files as server-sent events: "delta" frames
    of text, then "done" or "error". Every member can ask, since it changes nothing.

    The files are read here rather than sent by the browser, so the role check
    above decides what the AI can see. Any id from another project is a 404.
    """
    wanted = [body.file_id, *(i for i in body.context_file_ids if i != body.file_id)]
    rows = db.query(CodeFileModel).filter(CodeFileModel.project_id == project.id, CodeFileModel.id.in_(wanted)).all()
    by_id = {row.id: row for row in rows}
    if any(file_id not in by_id for file_id in wanted):
        raise HTTPException(status_code=404, detail="Code file not found")

    open_file = by_id[body.file_id]
    content = open_file.content or ""
    if not content.strip():
        raise HTTPException(status_code=422, detail="This file is empty, so there's nothing to work with.")
    if len(content) > MAX_AI_INPUT_CHARS:
        raise HTTPException(status_code=422, detail=f"This file is too long for the AI (over {MAX_AI_INPUT_CHARS:,} characters).")
    context = [(by_id[i].path, by_id[i].content or "") for i in wanted[1:]]
    if len(content) + sum(len(text) for _, text in context) > MAX_AI_CONTEXT_CHARS:
        raise HTTPException(status_code=422, detail="That's too much code for one request. Include fewer files.")

    prompt = ai_assist.build_prompt(body.action, (open_file.path, content), context)
    try:
        # Waits for the first text, so quota and busy errors keep their normal status
        reply = ai_assist.stream_reply(prompt)
    except (ai.AIQuotaExceededError, ai.AIServiceBusyError) as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    return StreamingResponse(
        _frames(reply),
        media_type="text/event-stream",
        # Without these, a proxy can hold the reply back until it's complete
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
