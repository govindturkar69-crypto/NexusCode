"""
GitHub account linking and push-to-GitHub.

Linking is bound to the browser tab that started it, so a victim can't be
tricked into linking their GitHub account to an attacker's NexusCode account:

1. POST /auth/github/start (bearer token + a random nonce the tab keeps in
   sessionStorage) -> GitHub authorize URL whose signed `state` holds the
   user id and the nonce's hash.
2. GitHub -> GET /auth/github/callback. The code is exchanged, but the token
   is NOT saved yet: the browser is sent to the frontend with an encrypted,
   10-minute "pending" blob in the URL fragment (never sent to servers).
3. The frontend posts the blob and its nonce to POST /auth/github/complete
   with its own bearer token. The token is saved only if the blob's user is
   the logged-in user and the nonce matches.
"""
import hmac
import json
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import seal, unseal
from app.core.database import get_db
from app.core.deps import get_current_user, require_project_role
from app.core.security import create_oauth_state, hash_oauth_nonce, verify_oauth_state
from app.models import CodeFileModel, ProjectModel, UserModel
from app.schemas.misc import (
    GitHubAuthorizeUrl,
    GitHubComplete,
    GitHubCompleteResponse,
    GitHubStart,
    PushToGithubRequest,
    PushToGithubResponse,
)
from app.services import github

router = APIRouter(tags=["github"])

LANGUAGE_EXTENSIONS = {"python": "py", "javascript": "js", "java": "java", "cpp": "cpp", "html": "html"}
PENDING_MAX_AGE_SECONDS = 10 * 60
LINK_FAILED = "GitHub connection could not be verified. Please try connecting again."


def _github_error_redirect() -> RedirectResponse:
    return RedirectResponse(url=f"{settings.frontend_url}/projects?{urlencode({'github': 'error'})}")


@router.post("/auth/github/start", response_model=GitHubAuthorizeUrl)
def github_start(body: GitHubStart, current_user: UserModel = Depends(get_current_user)):
    state = create_oauth_state(current_user.id, hash_oauth_nonce(body.nonce))
    return {"url": github.get_github_authorize_url(state)}


@router.get("/auth/github/callback")
def github_callback(code: str | None = None, state: str | None = None):
    verified = verify_oauth_state(state) if state else None
    if not code or verified is None:
        return _github_error_redirect()
    user_id, nonce_hash = verified

    access_token = github.exchange_code_for_token(code)
    if not access_token:
        # Nothing is saved, so any token the user already had is kept
        return _github_error_redirect()

    pending = seal(json.dumps({"uid": user_id, "nh": nonce_hash, "tok": access_token}).encode())
    # Fragment, not query string: it stays in the browser (no server logs, no Referer)
    return RedirectResponse(url=f"{settings.frontend_url}/projects#{urlencode({'github_pending': pending})}")


@router.post("/auth/github/complete", response_model=GitHubCompleteResponse)
def github_complete(body: GitHubComplete, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    raw = unseal(body.pending, PENDING_MAX_AGE_SECONDS)
    if raw is None:
        raise HTTPException(status_code=400, detail=LINK_FAILED)
    pending = json.loads(raw)
    same_user = pending.get("uid") == current_user.id
    same_tab = hmac.compare_digest(pending.get("nh", ""), hash_oauth_nonce(body.nonce))
    if not (same_user and same_tab):
        raise HTTPException(status_code=400, detail=LINK_FAILED)

    current_user.github_token = pending["tok"]
    db.commit()
    return {"connected": True}


def _github_http_error(error: github.GitHubAPIError, context: str) -> HTTPException:
    if error.status_code == 401:
        return HTTPException(status_code=400, detail="Your GitHub authorization has expired or was revoked. Please reconnect GitHub.")
    if error.status_code in (400, 403, 404, 422):
        return HTTPException(status_code=400, detail=f"{context}: {error.message}")
    return HTTPException(status_code=502, detail=f"{context}: {error.message}")


@router.post("/projects/{project_id}/push-to-github", response_model=PushToGithubResponse)
def push_to_github(
    request: PushToGithubRequest,
    project: ProjectModel = Depends(require_project_role("owner")),
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
