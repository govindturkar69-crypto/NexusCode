import base64
from urllib.parse import urlencode

import httpx

from app.core.config import settings

GITHUB_CLIENT_ID = settings.github_client_id
GITHUB_CLIENT_SECRET = settings.github_client_secret
GITHUB_REDIRECT_URI = settings.github_redirect_uri
GITHUB_TIMEOUT_SECONDS = 15


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


def _github_request(method: str, url: str, token: str, payload: dict | None = None) -> dict:
    try:
        response = httpx.request(
            method,
            url,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json=payload,
            timeout=GITHUB_TIMEOUT_SECONDS,
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
    return _github_request("GET", "https://api.github.com/user", token).get("login")


def create_github_repo(token: str, repo_name: str, private: bool = True) -> dict:
    """
    Creates a new repository on the user's GitHub account using their token.
    """
    return _github_request(
        "POST",
        "https://api.github.com/user/repos",
        token,
        {"name": repo_name, "private": private},
    )


def push_file_to_repo(token: str, repo_full_name: str, filename: str, content: str) -> dict:
    """
    Creates or updates a single file in a GitHub repo.
    GitHub's API requires file content to be Base64-encoded.
    """
    encoded_content = base64.b64encode(content.encode()).decode()
    return _github_request(
        "PUT",
        f"https://api.github.com/repos/{repo_full_name}/contents/{filename}",
        token,
        {"message": f"Update {filename} from NexusCode", "content": encoded_content},
    )
