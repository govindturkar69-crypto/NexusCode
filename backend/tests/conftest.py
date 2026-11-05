"""
Test setup. Environment variables are set *before* the app is imported, so
tests never read backend/.env or talk to real services.

By default tests use a temporary SQLite file. Set TEST_DATABASE_URL to run
them against a throwaway Postgres instead, e.g.
  TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/postgres
That database is WIPED (public schema dropped), so it must be on localhost.
"""
import os
import pathlib
import sys
import tempfile
from contextlib import contextmanager
from urllib.parse import urlparse

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_test_db_url = os.environ.get("TEST_DATABASE_URL")
if _test_db_url and urlparse(_test_db_url).hostname not in ("localhost", "127.0.0.1", "::1"):
    raise RuntimeError("TEST_DATABASE_URL must point at localhost: the test run wipes that database.")

_tmp_dir = tempfile.mkdtemp(prefix="nexuscode_tests_")
os.environ["DATABASE_URL"] = _test_db_url or f"sqlite:///{_tmp_dir}/test.db"
os.environ["JWT_SECRET"] = "test-only-jwt-secret-padded-to-48-bytes-xxxxxxx"
os.environ["FRONTEND_URL"] = "http://frontend.test"
os.environ["GEMINI_API_KEY"] = "test-gemini-key"
os.environ["CLOUDINARY_CLOUD_NAME"] = "test-cloud"
os.environ["CLOUDINARY_API_KEY"] = "test-key"
os.environ["CLOUDINARY_API_SECRET"] = "test-secret"
os.environ["GITHUB_CLIENT_ID"] = "test-client-id"
os.environ["GITHUB_CLIENT_SECRET"] = "test-client-secret"
os.environ["GITHUB_REDIRECT_URI"] = "http://api.test/auth/github/callback"
os.environ["GITHUB_TOKEN_ENC_KEY"] = "8ZK7f1e0bW0n5x3oZr5yC3w0e8u9pQvB2s4D6f8H0jY="  # test-only Fernet key

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pwdlib import PasswordHash  # noqa: E402
from pwdlib.hashers.bcrypt import BcryptHasher  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core import security as auth_module  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.rate_limit import limiter  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ProjectMemberModel, UserModel  # noqa: E402
from app.services import ai as ai_service  # noqa: E402
from app.services import github as github_service  # noqa: E402
from app.services import realtime as websocket_manager  # noqa: E402
from app.services import storage  # noqa: E402

# Real bcrypt, but at the minimum cost so the suite stays fast
auth_module.password_hasher = PasswordHash((BcryptHasher(rounds=4),))

DEFAULT_PASSWORD = "correct-horse-1"


def alembic_config():
    return Config(str(BACKEND_DIR / "alembic.ini"))


def wipe_database(target_engine):
    with target_engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
        else:
            Base.metadata.drop_all(conn)
            conn.execute(text("DROP TABLE IF EXISTS alembic_version"))


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    """Build the schema once per run with the real migrations (not create_all)."""
    wipe_database(engine)
    command.upgrade(alembic_config(), "head")
    yield


@pytest.fixture(autouse=True)
def fresh_database(migrated_database):
    """Every test starts with empty tables and no open sockets."""
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    websocket_manager.manager.active_connections.clear()
    websocket_manager.video_manager.active_connections.clear()
    # Rate limits are off unless a test opts in with the `rate_limits` fixture
    limiter.reset()
    auth_module.used_ws_tickets.clear()
    limiter.enabled = False
    yield


@pytest.fixture
def rate_limits():
    limiter.reset()
    limiter.enabled = True
    yield limiter
    limiter.enabled = False
    limiter.reset()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
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
        assert r.status_code == 201, r.text
        return r.json()["project"]["id"]

    return _create


def ws_path(client, token, project_id, kind="chat"):
    """Socket path with a fresh single-use ticket, the way the frontend connects."""
    r = client.post("/ws-ticket", json={"project_id": project_id}, headers=auth(token))
    assert r.status_code == 200, r.text
    return f"/ws/projects/{project_id}/{kind}?ticket={r.json()['ticket']}"


class SocketWithoutPresence:
    """A test socket whose receive_json skips presence frames, for tests that
    are about something else. test_chat_features.py checks presence itself."""

    def __init__(self, session):
        self.session = session

    def receive_json(self):
        while True:
            message = self.session.receive_json()
            if message.get("type") != "presence":
                return message

    def __getattr__(self, name):
        return getattr(self.session, name)


@contextmanager
def open_socket(client, token, project_id, kind="chat"):
    with client.websocket_connect(ws_path(client, token, project_id, kind)) as session:
        yield SocketWithoutPresence(session)


def add_member(username, project_id, role):
    with SessionLocal() as db:
        user = db.query(UserModel).filter(UserModel.username == username).one()
        db.add(ProjectMemberModel(project_id=project_id, user_id=user.id, role=role))
        db.commit()


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
    """Fakes the Cloudinary SDK calls only, so our storage code still runs."""
    state = {"uploads": [], "destroyed": [], "destroy_result": "ok", "fail_upload": False}

    def upload(data, **options):
        if state["fail_upload"]:
            raise ConnectionError("cloudinary is down")
        state["uploads"].append({"size": len(data), **options})
        public_id, resource_type = options["public_id"], options["resource_type"]
        return {
            "secure_url": f"https://res.cloudinary.test/{resource_type}/upload/{public_id}",
            "public_id": public_id,
            "resource_type": resource_type,
        }

    def destroy(public_id, **options):
        state["destroyed"].append((public_id, options.get("resource_type")))
        return {"result": state["destroy_result"]}

    monkeypatch.setattr(storage.cloudinary.uploader, "upload", upload)
    monkeypatch.setattr(storage.cloudinary.uploader, "destroy", destroy)
    return state


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
    monkeypatch.setattr(github_service, "exchange_code_for_token", lambda code: result["token"])
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
        monkeypatch.setattr(ai_service, name, make(name))
    return calls
