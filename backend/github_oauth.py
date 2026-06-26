import os
import httpx
from dotenv import load_dotenv

load_dotenv()

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
GITHUB_REDIRECT_URI = os.getenv("GITHUB_REDIRECT_URI")


def get_github_authorize_url() -> str:
    """
    Builds the URL we send the user to, so they can approve our app on GitHub.
    'repo' scope lets us create/push to repositories on their behalf.
    """
    return (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&redirect_uri={GITHUB_REDIRECT_URI}"
        f"&scope=repo"
    )


def exchange_code_for_token(code: str) -> str:
    """
    Exchanges the temporary 'code' GitHub gave us for a real access token.
    This call happens server-to-server, never visible to the browser.
    """
    response = httpx.post(
        "https://github.com/login/oauth/access_token",
        data={
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
            "redirect_uri": GITHUB_REDIRECT_URI,
        },
        headers={"Accept": "application/json"},
    )
    data = response.json()
    return data.get("access_token")


def create_github_repo(token: str, repo_name: str) -> dict:
    """
    Creates a new repository on the user's GitHub account using their token.
    """
    response = httpx.post(
        "https://api.github.com/user/repos",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        json={"name": repo_name, "private": False},
    )
    return response.json()


def push_file_to_repo(token: str, repo_full_name: str, filename: str, content: str) -> dict:
    """
    Creates or updates a single file in a GitHub repo.
    GitHub's API requires file content to be Base64-encoded.
    """
    import base64
    encoded_content = base64.b64encode(content.encode()).decode()

    response = httpx.put(
        f"https://api.github.com/repos/{repo_full_name}/contents/{filename}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        json={
            "message": f"Update {filename} from NexusCode",
            "content": encoded_content,
        },
    )
    return response.json()