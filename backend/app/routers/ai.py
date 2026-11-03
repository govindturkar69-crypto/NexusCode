from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.deps import get_current_user
from app.core.rate_limit import AI_LIMIT, limiter, user_or_ip
from app.models import UserModel
from app.schemas.misc import AIResult, CodeGenRequest, CodeReviewRequest
from app.services import ai

router = APIRouter(prefix="/ai", tags=["ai"])


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
