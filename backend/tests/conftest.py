"""
Test setup. Environment variables are set *before* the app is imported, so
tests never read backend/.env or talk to real services.

By default tests use a temporary SQLite file. Set TEST_DATABASE_URL to run
them against a throwaway Postgres instead, e.g.
  TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/postgres
"""
import os
import pathlib
import sys
import tempfile

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_tmp_dir = tempfile.mkdtemp(prefix="nexuscode_tests_")
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_tmp_dir}/test.db"
os.environ["JWT_SECRET"] = "test-only-jwt-secret"
os.environ["FRONTEND_URL"] = "http://frontend.test"
os.environ["GEMINI_API_KEY"] = "test-gemini-key"
os.environ["CLOUDINARY_CLOUD_NAME"] = "test-cloud"
os.environ["CLOUDINARY_API_KEY"] = "test-key"
os.environ["CLOUDINARY_API_SECRET"] = "test-secret"
os.environ["GITHUB_CLIENT_ID"] = "test-client-id"
os.environ["GITHUB_CLIENT_SECRET"] = "test-client-secret"
os.environ["GITHUB_REDIRECT_URI"] = "http://api.test/auth/github/callback"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import auth as auth_module  # noqa: E402
import main  # noqa: E402
from database import Base, SessionLocal, engine  # noqa: E402

# Real bcrypt, but at the minimum cost so the suite stays fast
auth_module.pwd_context.update(bcrypt__rounds=4)
from models import UserModel  # noqa: E402
import websocket_manager  # noqa: E402

DEFAULT_PASSWORD = "correct-horse-1"


@pytest.fixture(autouse=True)
def fresh_database():
    """Every test starts with empty tables and no open sockets."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    websocket_manager.manager.active_connections.clear()
    websocket_manager.video_manager.active_connections.clear()
    yield


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture
def make_user(client):
    """make_user("alice", admin=True) -> bearer token"""

    def _make(username, password=DEFAULT_PASSWORD, admin=False):
        r = client.post("/signup", json={"username": username, "password": password})
        assert r.status_code == 201, r.text
        if admin:
            with SessionLocal() as db:
                user = db.query(UserModel).filter(UserModel.username == username).one()
                user.is_admin = True
                db.commit()
        r = client.post("/login", data={"username": username, "password": password})
        assert r.status_code == 200, r.text
        return r.json()["access_token"]

    return _make


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def project_of(client):
    """project_of(token, name) -> project id"""

    def _create(token, name="Project"):
        r = client.post("/projects", json={"name": name}, headers=auth(token))
        assert r.status_code in (200, 201), r.text
        return r.json()["project"]["id"]

    return _create


def set_github_token(username, token):
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == username).one().github_token = token
        db.commit()


def get_github_token(username):
    with SessionLocal() as db:
        return db.query(UserModel).filter(UserModel.username == username).one().github_token


# ---- fakes for external services (the only things not exercised for real) ----

@pytest.fixture
def fake_cloudinary(monkeypatch):
    uploads = []

    def fake_upload(file_bytes, filename):
        uploads.append((filename, len(file_bytes)))
        return f"https://res.cloudinary.test/{filename}"

    monkeypatch.setattr(main, "upload_file_to_cloudinary", fake_upload)
    return uploads


@pytest.fixture
def fake_github_http(monkeypatch):
    """Fakes GitHub's REST API at the httpx level, so github_oauth's own
    request/response handling is still exercised."""
    import httpx

    state = {"create_status": 201, "push_status": 201, "calls": []}

    def fake_request(method, url, headers=None, json=None, timeout=None):
        state["calls"].append((method, url, json))
        request = httpx.Request(method, url)
        if method == "POST":
            if state["create_status"] == 201:
                body = {"full_name": f"tester/{json['name']}", "html_url": f"https://github.test/tester/{json['name']}", "private": json["private"]}
                return httpx.Response(201, json=body, request=request)
            return httpx.Response(
                state["create_status"],
                json={"message": "Repository creation failed.", "errors": [{"message": "name already exists on this account"}]},
                request=request,
            )
        if state["push_status"] == 201:
            return httpx.Response(201, json={"content": {}}, request=request)
        return httpx.Response(state["push_status"], json={"message": "Bad credentials"}, request=request)

    monkeypatch.setattr(httpx, "request", fake_request)
    return state


@pytest.fixture
def fake_token_exchange(monkeypatch):
    """Controls what GitHub's code->token exchange returns."""
    result = {"token": "gho_fake_token"}
    monkeypatch.setattr(main, "exchange_code_for_token", lambda code: result["token"])
    return result


@pytest.fixture
def fake_ai(monkeypatch):
    calls = []

    def make(name):
        def fake(text):
            calls.append((name, text))
            return f"{name} result"
        return fake

    for name in ("generate_code", "detect_bugs", "generate_docs"):
        monkeypatch.setattr(main, name, make(name))
    return calls
