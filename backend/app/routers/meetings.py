"""Group video meetings: a LiveKit token for joining a project's call."""
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.config import settings
from app.core.deps import get_current_user, require_project_role
from app.core.rate_limit import MEETING_TOKEN_LIMIT, limiter, user_or_ip
from app.models import ProjectModel, UserModel
from app.schemas.meetings import MeetingTokenResponse
from app.services import meetings

router = APIRouter(tags=["meetings"])

NOT_CONFIGURED = "Video is not configured"


@router.post("/projects/{project_id}/meeting/token", response_model=MeetingTokenResponse)
@limiter.limit(MEETING_TOKEN_LIMIT, key_func=user_or_ip)
def meeting_token(
    request: Request,
    project: ProjectModel = Depends(require_project_role("viewer")),
    current_user: UserModel = Depends(get_current_user),
):
    """Any member (owner, editor or viewer) may join; others get 404. The browser
    asks for this when someone clicks Join, then connects to LiveKit with it."""
    if not meetings.is_configured():
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED)
    return {"token": meetings.create_token(current_user, project.id), "url": settings.livekit_url}
