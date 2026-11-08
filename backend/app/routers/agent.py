"""
The coding agent's API. See app/services/agent.py for how a run works.

  POST /ai/projects/{project_id}/agent/runs   start a run (editors and owners)
  POST /ai/agent/runs/{run_id}/step           tool results in, one streamed Gemini step out
  POST /ai/agent/runs/{run_id}/stop           end the run
  POST /ai/agent/runs/{run_id}/accepted       record what the user kept, for the activity feed

A run belongs to the user who started it: anyone else gets 404. Each request also
checks that this user is still an editor in the project, so losing the role stops a
run straight away.
"""
import json
import logging
import secrets
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from google.genai import types
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.deps import _authorize, get_current_user, require_project_role
from app.core.rate_limit import AI_LIMIT, limiter, user_or_ip
from app.models import AgentRunModel, ProjectModel, UserModel
from app.schemas.agent import (
    AgentAccepted,
    AgentRunCreate,
    AgentRunOut,
    AgentStepRequest,
)
from app.services import agent
from app.services.activity import publish, record
from app.services.ai import AIQuotaExceededError, AIServiceBusyError

logger = logging.getLogger("nexuscode")
router = APIRouter(prefix="/ai", tags=["agent"])

RUN_NOT_FOUND = "Agent run not found"
ACTIVE = "running"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def run_out(run: AgentRunModel) -> dict:
    return {
        "id": run.id,
        "project_id": run.project_id,
        "goal": run.goal,
        "status": run.status,
        "steps": run.steps,
        "tokens": run.tokens,
        "summary": run.summary,
        "stop_reason": run.stop_reason,
        "created_at": run.created_at,
        "limits": {"max_steps": agent.MAX_STEPS, "max_tokens": agent.MAX_RUN_TOKENS, "max_seconds": agent.MAX_RUN_SECONDS},
    }


def _end(run: AgentRunModel, status: str, reason: str | None = None, summary: str | None = None) -> None:
    run.status = status
    run.phase = "ready"
    run.stop_reason = reason
    if summary is not None:
        run.summary = summary
    run.history = None
    run.pending_calls = None
    run.finished_at = datetime.now(UTC)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _own_run(run_id: int, db: Session, user: UserModel, *, lock: bool = False) -> AgentRunModel:
    query = db.query(AgentRunModel).filter(AgentRunModel.id == run_id)
    run = (query.with_for_update() if lock else query).first()
    # Another user's run is "not found", like everything else that isn't yours
    if run is None or run.user_id != user.id:
        raise HTTPException(status_code=404, detail=RUN_NOT_FOUND)
    _authorize(db, run.project_id, user, "editor", RUN_NOT_FOUND)
    return run


@router.post("/projects/{project_id}/agent/runs", status_code=201, response_model=AgentRunOut)
@limiter.limit(AI_LIMIT, key_func=user_or_ip)
def start_run(
    request: Request,
    body: AgentRunCreate,
    project: ProjectModel = Depends(require_project_role("editor")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    # One run at a time per user: starting another ends the old one
    for old in db.query(AgentRunModel).filter(AgentRunModel.user_id == current_user.id, AgentRunModel.status == ACTIVE).with_for_update():
        _end(old, "stopped", "A newer run was started.")
    run = AgentRunModel(project_id=project.id, user_id=current_user.id, goal=body.goal, nonce=secrets.token_hex(12))
    db.add(run)
    record(db, project.id, current_user.id, "agent_started", body.goal[:200])
    db.commit()
    db.refresh(run)
    publish(project.id, "agent_started")
    return run_out(run)


def _answers(run: AgentRunModel, body: AgentStepRequest) -> tuple[list[types.Part], list[tuple[dict, dict]]]:
    """Function responses for every call of the last step, in order. Results are
    required for exactly the calls the browser was told to run."""
    pending = json.loads(run.pending_calls or "[]")
    expected = {call["id"] for call in pending if "error" not in call}
    given = {item.id: item.result for item in body.results}
    if len(given) != len(body.results) or set(given) != expected:
        raise HTTPException(status_code=409, detail="These tool results don't match the agent's last step. Start a new run.")
    parts, answered = [], []
    for call in pending:
        if "error" in call:
            response = {"error": call["error"]}
        else:
            raw = given[call["id"]]
            if len(json.dumps(raw)) > agent.MAX_RESULT_JSON_CHARS:
                raise HTTPException(status_code=422, detail=f"A tool result is too large (over {agent.MAX_RESULT_JSON_CHARS:,} characters).")
            try:
                response = agent.clean_result(call["name"], call["args"], raw, run.nonce)
            except agent.ToolResultError as e:
                raise HTTPException(status_code=422, detail=str(e)) from e
            answered.append((call, response))
        parts.append(types.Part(function_response=types.FunctionResponse(id=call.get("model_id"), name=call["name"], response=response)))
    return parts, answered


def _track_failures(run: AgentRunModel, answered: list[tuple[dict, dict]]) -> None:
    for call, response in answered:
        if call["name"] != "run_file":
            continue
        fingerprint = agent.failure_fingerprint(call["name"], call["args"], response)
        if fingerprint is None:
            if response.get("status") == "ok":
                run.failure_hash, run.failure_streak = None, 0
        elif fingerprint == run.failure_hash:
            run.failure_streak += 1
        else:
            run.failure_hash, run.failure_streak = fingerprint, 1


def _cap_reason(run: AgentRunModel, history_chars: int) -> tuple[str, str] | None:
    if run.failure_streak >= agent.REPEATED_FAILURE_LIMIT:
        return "stuck", "The same error came back after a fix, so the agent stopped instead of repeating itself."
    if run.steps >= agent.MAX_STEPS:
        return "capped", f"The agent used all {agent.MAX_STEPS} steps for this run."
    if run.tokens >= agent.MAX_RUN_TOKENS:
        return "capped", "The agent reached this run's token limit."
    if datetime.now(UTC) - _aware(run.created_at) > timedelta(seconds=agent.MAX_RUN_SECONDS):
        return "capped", f"The run reached its {agent.MAX_RUN_SECONDS // 60}-minute time limit."
    if history_chars > agent.MAX_HISTORY_CHARS:
        return "capped", "The conversation got too long for one run."
    return None


def _ended_stream(run: AgentRunModel) -> StreamingResponse:
    frame = _sse("done", {"status": run.status, "reason": run.stop_reason, "steps": run.steps, "tokens": run.tokens, "max_steps": agent.MAX_STEPS})
    return StreamingResponse(iter([frame]), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/agent/runs/{run_id}/step")
@limiter.limit(AI_LIMIT, key_func=user_or_ip)
def step(request: Request, run_id: int, body: AgentStepRequest, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """
    Streams one Gemini step as server-sent events:
      thought {text}, text {text}            as they arrive
      tool_call {id, name, args}             checked calls for the browser to run
      tool_rejected {id, name, error}        calls refused here; Gemini hears why
      done {status, steps, tokens, ...}      status "tool_calls", or how the run ended
      error {detail, retryable}              the step failed; the same request can be retried
    """
    run = _own_run(run_id, db, current_user, lock=True)
    if run.status != ACTIVE:
        raise HTTPException(status_code=409, detail="This run has ended. Start a new one.")
    stale = datetime.now(UTC) - _aware(run.updated_at) > timedelta(seconds=agent.STEP_DEADLINE_SECONDS + 30)
    if run.phase == "thinking" and not stale:
        raise HTTPException(status_code=409, detail="The agent is already working on a step.")

    contents = agent.load_contents(run.history)
    if contents:
        parts, answered = _answers(run, body)
        _track_failures(run, answered)
        contents.append(types.Content(role="user", parts=parts))
    else:
        if body.results:
            raise HTTPException(status_code=409, detail="The first step has no tool results.")
        contents = [types.Content(role="user", parts=[types.Part(text=agent.first_prompt(run.goal, run.nonce))])]

    history = agent.dump_contents(contents)
    capped = _cap_reason(run, len(history))
    if capped:
        _end(run, *capped)
        db.commit()
        return _ended_stream(run)

    # Saved before streaming, so a retry after a failed step resends the same results
    run.phase = "thinking"
    db.commit()

    reply = agent.StepReply()
    try:
        events = agent.stream_step(contents, reply)
    except (AIQuotaExceededError, AIServiceBusyError) as e:
        run.phase = "ready"
        db.commit()
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception:
        run.phase = "ready"
        db.commit()
        raise

    return StreamingResponse(
        _step_frames(run.id, contents, events, reply),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _step_frames(run_id: int, contents: list[types.Content], events: Iterator[tuple[str, str]], reply: agent.StepReply) -> Iterator[str]:
    saved = False
    try:
        try:
            for kind, text in events:
                yield _sse(kind, {"text": text})
        except agent.StepInterrupted as e:
            yield _sse("error", {"detail": str(e), "retryable": True})
            return

        calls, frames = [], []
        for index, call in enumerate(reply.calls):
            call_id = f"{run_id}-{len(contents)}-{index}"
            entry = {"id": call_id, "name": call.name, "model_id": call.id}
            try:
                if index >= agent.MAX_CALLS_PER_STEP:
                    raise agent.ToolCallError(f"Too many tool calls in one step (at most {agent.MAX_CALLS_PER_STEP}).")
                entry["args"] = agent.validate_call(call.name, call.args)
                frames.append(_sse("tool_call", {"id": call_id, "name": call.name, "args": entry["args"]}))
            except agent.ToolCallError as e:
                entry["args"] = {}
                entry["error"] = str(e)
                frames.append(_sse("tool_rejected", {"id": call_id, "name": call.name, "error": str(e)}))
            calls.append(entry)

        with SessionLocal() as db:
            run = db.query(AgentRunModel).filter(AgentRunModel.id == run_id).with_for_update().one()
            if run.status != ACTIVE:
                # Stopped while this step was streaming: keep the stop
                saved = True
                yield _sse("done", {"status": run.status, "reason": run.stop_reason, "steps": run.steps, "tokens": run.tokens, "max_steps": agent.MAX_STEPS})
                return
            run.steps += 1
            run.tokens += reply.tokens
            run.phase = "ready"
            if calls:
                contents.append(types.Content(role="model", parts=reply.parts))
                run.history = agent.dump_contents(contents)
                run.pending_calls = json.dumps(calls)
                status = "tool_calls"
            else:
                summary = reply.text.strip() or "The agent finished without a summary."
                _end(run, "finished", summary=summary[:5000])
                status = "finished"
            db.commit()
            saved = True
            done = {"status": status, "steps": run.steps, "tokens": run.tokens, "max_steps": agent.MAX_STEPS}
            if status == "finished":
                done["summary"] = run.summary
            if reply.finish_reason and reply.finish_reason not in ("STOP", "FinishReason.STOP"):
                done["finish_reason"] = reply.finish_reason
        yield from frames
        yield _sse("done", done)
    finally:
        if not saved:
            # The step failed or the browser went away: let the same step be asked for again
            with SessionLocal() as db:
                run = db.query(AgentRunModel).filter(AgentRunModel.id == run_id).first()
                if run is not None and run.phase == "thinking":
                    run.phase = "ready"
                    db.commit()


@router.post("/agent/runs/{run_id}/stop", response_model=AgentRunOut)
def stop_run(run_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    run = _own_run(run_id, db, current_user, lock=True)
    if run.status == ACTIVE:
        _end(run, "stopped", "Stopped by you.")
        db.commit()
        db.refresh(run)
    return run_out(run)


@router.post("/agent/runs/{run_id}/accepted", response_model=AgentRunOut)
def changes_accepted(run_id: int, body: AgentAccepted, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    run = _own_run(run_id, db, current_user)
    count = len(body.files) + len(body.tasks)
    if count == 0:
        raise HTTPException(status_code=422, detail="Nothing was accepted.")
    pieces = []
    if body.files:
        pieces.append(", ".join(body.files[:5]) + (f" and {len(body.files) - 5} more" if len(body.files) > 5 else ""))
    if body.tasks:
        pieces.append(f"{len(body.tasks)} task{'s' if len(body.tasks) != 1 else ''}")
    run.changes_accepted += count
    record(db, run.project_id, current_user.id, "agent_applied", "; ".join(pieces)[:500])
    db.commit()
    db.refresh(run)
    publish(run.project_id, "agent_applied")
    return run_out(run)
