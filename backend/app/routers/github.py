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

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import seal, unseal
from app.core.database import get_db
from app.core.deps import get_current_user, require_project_role
from app.core.security import create_oauth_state, hash_oauth_nonce, verify_oauth_state
from app.models import CodeFileModel, ProjectModel, UserModel
from app.schemas.misc import (
    REPO_NAME_PATTERN,
    GitHubAuthorizeUrl,
    GitHubBranchListResponse,
    GitHubComplete,
    GitHubCompleteResponse,
    GitHubRepoListResponse,
    GitHubStart,
    PushToGithubRequest,
    PushToGithubResponse,
)
from app.services import github
from app.services.activity import publish, record

router = APIRouter(tags=["github"])

PENDING_MAX_AGE_SECONDS = 10 * 60
MAX_PUSH_BYTES = 50_000_000
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


def _connected_token(user: UserModel) -> str:
    if not user.github_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected")
    return user.github_token


@router.get("/me/github/repos", response_model=GitHubRepoListResponse)
def my_github_repos(current_user: UserModel = Depends(get_current_user)):
    """Repositories on the user's own account: the ones they can push to from here."""
    token = _connected_token(current_user)
    try:
        return {"repos": github.list_owned_repos(token)}
    except github.GitHubAPIError as e:
        raise _github_http_error(e, "Could not list your repositories") from e


@router.get("/me/github/repos/{repo_name}/branches", response_model=GitHubBranchListResponse)
def my_github_branches(repo_name: str = Path(pattern=REPO_NAME_PATTERN), current_user: UserModel = Depends(get_current_user)):
    token = _connected_token(current_user)
    try:
        # The owner always comes from the token, so this can't read someone else's repository
        login = github.get_github_username(token)
        return {"branches": [branch["name"] for branch in github.list_branches(token, f"{login}/{repo_name}")]}
    except github.GitHubAPIError as e:
        raise _github_http_error(e, f"Could not list the branches of {repo_name}") from e


@router.post("/projects/{project_id}/push-to-github", response_model=PushToGithubResponse)
def push_to_github(
    request: PushToGithubRequest,
    project: ProjectModel = Depends(require_project_role("owner")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Pushes all the project's files in one commit, to a new repository or to
    one the user owns. The token is decrypted only on the way to GitHub."""
    token = _connected_token(current_user)

    code_files = db.query(CodeFileModel).filter(CodeFileModel.project_id == project.id).order_by(CodeFileModel.path).all()
    if not code_files:
        raise HTTPException(status_code=400, detail="This project has no files to push yet.")
    files = {code_file.path: code_file.content or "" for code_file in code_files}
    if sum(len(content.encode("utf-8", "replace")) for content in files.values()) > MAX_PUSH_BYTES:
        raise HTTPException(status_code=400, detail=f"This project is larger than the {MAX_PUSH_BYTES // 1_000_000} MB that can be pushed at once.")

    try:
        if request.existing:
            login = github.get_github_username(token)
            repo = github.get_repo(token, f"{login}/{request.repo_name}")
        else:
            repo = github.create_github_repo(token, request.repo_name, request.private)
    except github.GitHubAPIError as e:
        if request.existing and e.status_code == 404:
            raise HTTPException(status_code=400, detail=f"There is no repository called {request.repo_name} on your GitHub account.") from e
        raise _github_http_error(e, "Could not open the repository" if request.existing else "Could not create the repository") from e

    full_name = repo["full_name"]
    count = len(files)
    message = f"Update from NexusCode ({count} file{'' if count == 1 else 's'})"
    try:
        pushed = github.push_files(token, repo, request.branch, files, message, new_repo=not request.existing)
    except github.GitHubAPIError as e:
        context = f"Could not push to {full_name}" if request.existing else f"Repository {full_name} was created, but pushing the files failed. Try again, pushing to it as an existing repository"
        raise _github_http_error(e, context) from e

    if pushed.changed:
        record(db, project.id, current_user.id, "github_pushed", f"{full_name} ({pushed.branch})")
        db.commit()
        publish(project.id, "github_pushed")
    return {
        "message": "Pushed to GitHub successfully" if pushed.changed else "GitHub already has these files, so there was nothing to commit",
        "repo_url": repo.get("html_url"),
        "private": repo.get("private", request.private),
        "repo_full_name": full_name,
        "branch": pushed.branch,
        "changed": pushed.changed,
        "files": count,
        "commit_url": pushed.commit_url,
    }
