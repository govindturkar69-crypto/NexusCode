from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, get_owned_project
from app.core.security import create_oauth_state, verify_oauth_state
from app.models import CodeFileModel, ProjectModel, UserModel
from app.schemas.misc import (
    GitHubAuthorizeUrl,
    PushToGithubRequest,
    PushToGithubResponse,
)
from app.services import github

router = APIRouter(tags=["github"])

LANGUAGE_EXTENSIONS = {"python": "py", "javascript": "js", "java": "java", "cpp": "cpp", "html": "html"}


def _github_result_redirect(result: str) -> RedirectResponse:
    """Sends the browser back to the projects page with ?github=connected|error."""
    return RedirectResponse(url=f"{settings.frontend_url}/projects?{urlencode({'github': result})}")


@router.get("/auth/github/login", response_model=GitHubAuthorizeUrl)
def github_login(current_user: UserModel = Depends(get_current_user)):
    state = create_oauth_state(current_user.id)
    return {"url": github.get_github_authorize_url(state)}


@router.get("/auth/github/callback")
def github_callback(code: str | None = None, state: str | None = None, db: Session = Depends(get_db)):
    # The signed state tells us which user started the flow. Without a valid
    # one we can't safely attach a token to anybody.
    user_id = verify_oauth_state(state) if state else None
    if not code or user_id is None:
        return _github_result_redirect("error")

    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if user is None:
        return _github_result_redirect("error")

    access_token = github.exchange_code_for_token(code)
    if not access_token:
        # Keep any token the user already had
        return _github_result_redirect("error")

    user.github_token = access_token
    db.commit()
    return _github_result_redirect("connected")


def _github_http_error(error: github.GitHubAPIError, context: str) -> HTTPException:
    if error.status_code == 401:
        return HTTPException(status_code=400, detail="Your GitHub authorization has expired or was revoked. Please reconnect GitHub.")
    if error.status_code in (400, 403, 404, 422):
        return HTTPException(status_code=400, detail=f"{context}: {error.message}")
    return HTTPException(status_code=502, detail=f"{context}: {error.message}")


@router.post("/projects/{project_id}/push-to-github", response_model=PushToGithubResponse)
def push_to_github(
    request: PushToGithubRequest,
    project: ProjectModel = Depends(get_owned_project),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    if not current_user.github_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected")

    code_file = db.query(CodeFileModel).filter(CodeFileModel.project_id == project.id).first()
    if not code_file:
        raise HTTPException(status_code=404, detail="No code file found for this project")

    filename = f"main.{LANGUAGE_EXTENSIONS.get(code_file.language, 'txt')}"

    try:
        repo_result = github.create_github_repo(current_user.github_token, request.repo_name, request.private)
    except github.GitHubAPIError as e:
        raise _github_http_error(e, "Could not create the repository") from e

    try:
        github.push_file_to_repo(current_user.github_token, repo_result["full_name"], filename, code_file.content or "")
    except github.GitHubAPIError as e:
        raise _github_http_error(e, f"Repository {repo_result['full_name']} was created, but pushing {filename} failed") from e

    return {
        "message": "Pushed to GitHub successfully",
        "repo_url": repo_result.get("html_url"),
        "private": repo_result.get("private", request.private),
    }
