from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import get_current_user
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
def ai_generate_code(request: CodeGenRequest, current_user: UserModel = Depends(get_current_user)):
    return _run(ai.generate_code, request.prompt)


@router.post("/detect-bugs", response_model=AIResult)
def ai_detect_bugs(request: CodeReviewRequest, current_user: UserModel = Depends(get_current_user)):
    return _run(ai.detect_bugs, request.code)


@router.post("/generate-docs", response_model=AIResult)
def ai_generate_docs(request: CodeReviewRequest, current_user: UserModel = Depends(get_current_user)):
    return _run(ai.generate_docs, request.code)
