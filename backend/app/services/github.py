import base64
import time
from dataclasses import dataclass
from urllib.parse import quote, urlencode

import httpx

from app.core.config import settings

GITHUB_CLIENT_ID = settings.github_client_id
GITHUB_CLIENT_SECRET = settings.github_client_secret
GITHUB_REDIRECT_URI = settings.github_redirect_uri
GITHUB_TIMEOUT_SECONDS = 15
# A tree can carry a lot of file content in one request
GITHUB_TREE_TIMEOUT_SECONDS = 60
API = "https://api.github.com"
# Smaller files go inside the tree request; larger ones get a request of their own
INLINE_FILE_LIMIT_BYTES = 100_000
# GitHub takes a moment to create the first commit of a new repository
NEW_REPO_RETRIES = 5
NEW_REPO_RETRY_SECONDS = 1.0


def get_github_authorize_url(state: str) -> str:
    """
    Builds the URL we send the user to, so they can approve our app on GitHub.
    'repo' scope lets us create/push to repositories on their behalf.
    `state` is echoed back to the callback so we know which user started the flow.
    """
    params = {
        "client_id": GITHUB_CLIENT_ID,
        "redirect_uri": GITHUB_REDIRECT_URI,
        "scope": "repo",
        "state": state,
    }
    return f"https://github.com/login/oauth/authorize?{urlencode(params)}"


def exchange_code_for_token(code: str) -> str | None:
    """
    Exchanges the temporary 'code' GitHub gave us for a real access token.
    This call happens server-to-server, never visible to the browser.
    Returns None if GitHub rejects the code or can't be reached.
    """
    try:
        response = httpx.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": GITHUB_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
            timeout=GITHUB_TIMEOUT_SECONDS,
        )
        data = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    return data.get("access_token") or None


class GitHubAPIError(Exception):
    """Raised when a GitHub API call fails. `status_code` is GitHub's (0 if unreachable)."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _github_request(method: str, url: str, token: str, payload: dict | None = None, timeout: float = GITHUB_TIMEOUT_SECONDS) -> dict:
    try:
        response = httpx.request(
            method,
            url,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json=payload,
            timeout=timeout,
        )
    except httpx.HTTPError as e:
        raise GitHubAPIError(0, "Could not reach GitHub. Please try again.") from e

    try:
        data = response.json()
    except ValueError:
        data = {}

    if not response.is_success:
        # 422 responses put the useful part (e.g. "name already exists on this
        # account") in errors[0].message rather than the top-level message.
        errors = data.get("errors") or []
        detail = next((err.get("message") for err in errors if isinstance(err, dict) and err.get("message")), None)
        raise GitHubAPIError(response.status_code, detail or data.get("message") or f"GitHub returned {response.status_code}")
    return data


def get_github_username(token: str) -> str | None:
    return _github_request("GET", f"{API}/user", token).get("login")


def list_owned_repos(token: str) -> list[dict]:
    """The user's own repositories, most recently updated first (up to 100)."""
    return _github_request("GET", f"{API}/user/repos?affiliation=owner&sort=updated&per_page=100", token)


def list_branches(token: str, repo_full_name: str) -> list[dict]:
    return _github_request("GET", f"{API}/repos/{repo_full_name}/branches?per_page=100", token)


def get_repo(token: str, repo_full_name: str) -> dict:
    return _github_request("GET", f"{API}/repos/{repo_full_name}", token)


def create_github_repo(token: str, repo_name: str, private: bool = True) -> dict:
    """auto_init gives it a first commit, because GitHub's tree and commit APIs
    refuse to work on an empty repository."""
    return _github_request("POST", f"{API}/user/repos", token, {"name": repo_name, "private": private, "auto_init": True})


@dataclass
class PushedCommit:
    branch: str
    # False if the branch already had exactly these files, so nothing was committed
    changed: bool
    commit_sha: str
    commit_url: str


def _branch_head(token: str, repo: str, branch: str) -> str | None:
    """The branch's latest commit, or None if there's no such branch. Raises a
    409 GitHubAPIError if the repository is completely empty."""
    try:
        return _github_request("GET", f"{API}/repos/{repo}/git/ref/heads/{quote(branch)}", token)["object"]["sha"]
    except GitHubAPIError as e:
        if e.status_code == 404:
            return None
        raise


def _first_commit_of_new_repo(token: str, repo: str, branch: str) -> str:
    for attempt in range(NEW_REPO_RETRIES):
        try:
            head = _branch_head(token, repo, branch)
            if head:
                return head
        except GitHubAPIError as e:
            if e.status_code != 409:
                raise
        if attempt < NEW_REPO_RETRIES - 1:
            time.sleep(NEW_REPO_RETRY_SECONDS)
    raise GitHubAPIError(504, "GitHub didn't finish creating the repository in time. Push to it as an existing repository.")


def _start_empty_repo(token: str, repo: str, branch: str) -> str:
    """The contents API is the one way to put a first commit in an empty repository."""
    placeholder = base64.b64encode(b"Created by NexusCode\n").decode()
    result = _github_request(
        "PUT",
        f"{API}/repos/{repo}/contents/.nexuscode-init",
        token,
        {"message": "Initial commit", "content": placeholder, "branch": branch},
    )
    return result["commit"]["sha"]


def _tree_entry(token: str, repo: str, path: str, content: str) -> dict:
    entry = {"path": path, "mode": "100644", "type": "blob"}
    if len(content.encode("utf-8", "replace")) <= INLINE_FILE_LIMIT_BYTES:
        return {**entry, "content": content}
    blob = _github_request(
        "POST",
        f"{API}/repos/{repo}/git/blobs",
        token,
        {"content": base64.b64encode(content.encode("utf-8", "replace")).decode(), "encoding": "base64"},
        timeout=GITHUB_TREE_TIMEOUT_SECONDS,
    )
    return {**entry, "sha": blob["sha"]}


def push_files(token: str, repo: dict, branch: str | None, files: dict[str, str], message: str, *, new_repo: bool = False) -> PushedCommit:
    """
    Pushes every file in one commit, using the Git trees and commits APIs.

    On an existing branch the files are added on top of what's there: files that
    only exist on GitHub stay, nothing is force-pushed. A new repository's
    auto-generated first commit is replaced, since it holds nothing of the user's.
    """
    name = repo["full_name"]
    default_branch = repo.get("default_branch") or "main"
    branch = branch or default_branch
    replace_everything = new_repo

    if new_repo:
        head = _first_commit_of_new_repo(token, name, default_branch)
        branch_exists = branch == default_branch
    else:
        try:
            head = _branch_head(token, name, branch)
            branch_exists = head is not None
            if head is None:
                # A new branch starts from the default branch
                head = _branch_head(token, name, default_branch)
            if head is None:
                head = _start_empty_repo(token, name, branch)
                branch_exists = True
                replace_everything = True
        except GitHubAPIError as e:
            if e.status_code != 409:
                raise
            head = _start_empty_repo(token, name, branch)
            branch_exists = True
            replace_everything = True

    parent_tree = _github_request("GET", f"{API}/repos/{name}/git/commits/{head}", token)["tree"]["sha"]
    payload = {"tree": [_tree_entry(token, name, path, content) for path, content in files.items()]}
    if not replace_everything:
        payload["base_tree"] = parent_tree
    tree = _github_request("POST", f"{API}/repos/{name}/git/trees", token, payload, timeout=GITHUB_TREE_TIMEOUT_SECONDS)

    commit_sha = head
    changed = tree["sha"] != parent_tree
    if changed:
        commit = _github_request("POST", f"{API}/repos/{name}/git/commits", token, {"message": message, "tree": tree["sha"], "parents": [head]})
        commit_sha = commit["sha"]

    if not branch_exists:
        _github_request("POST", f"{API}/repos/{name}/git/refs", token, {"ref": f"refs/heads/{branch}", "sha": commit_sha})
    elif changed:
        _github_request("PATCH", f"{API}/repos/{name}/git/refs/heads/{quote(branch)}", token, {"sha": commit_sha, "force": False})

    html_url = repo.get("html_url") or f"https://github.com/{name}"
    return PushedCommit(branch=branch, changed=changed, commit_sha=commit_sha, commit_url=f"{html_url}/commit/{commit_sha}")
