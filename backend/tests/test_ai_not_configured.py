"""The AI is optional: with no Gemini key the app starts, /health answers, and every
AI route returns a clean 503 "AI is not configured". With a key, the clients are
made lazily and the agent still prefers AGENT_GEMINI_API_KEY."""
import os
import subprocess
import sys

import pytest
from conftest import BACKEND_DIR, auth

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import AgentRunModel
from app.services import ai

NOT_CONFIGURED = {"detail": "AI is not configured"}


@pytest.fixture
def no_keys(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", None)
    monkeypatch.setattr(settings, "agent_gemini_api_key", None)


@pytest.fixture
def owner(make_user):
    return make_user("olivia")


@pytest.fixture
def project(owner, project_of):
    return project_of(owner)


@pytest.fixture
def code_file(client, owner, project):
    r = client.post(f"/projects/{project}/code/files", json={"path": "main.py", "content": "print('hi')\n"}, headers=auth(owner))
    assert r.status_code == 201, r.text
    return r.json()["code_file"]["id"]


def test_the_app_starts_and_health_answers_with_no_gemini_key():
    """A fresh interpreter, so app.main is really imported without a key (the test
    process imported it long ago). Blank values also stop backend/.env's keys."""
    env = {**os.environ, "GEMINI_API_KEY": "", "AGENT_GEMINI_API_KEY": ""}
    code = (
        "from fastapi.testclient import TestClient\n"
        "from app.main import app\n"
        "from app.services import ai\n"
        "assert not ai.is_configured() and not ai.agent_is_configured()\n"
        "with TestClient(app) as c:\n"
        "    r = c.get('/health')\n"
        "    print(r.status_code, r.json())\n"
    )
    result = subprocess.run([sys.executable, "-c", code], cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr[-2000:]
    assert "200 {'status': 'ok', 'database': 'ok'}" in result.stdout


@pytest.mark.parametrize("path,body", [
    ("/ai/generate-code", {"prompt": "a hello world"}),
    ("/ai/detect-bugs", {"code": "print(1)"}),
    ("/ai/generate-docs", {"code": "print(1)"}),
])
def test_assistant_routes_answer_503_without_a_key(client, owner, no_keys, path, body):
    r = client.post(path, json=body, headers=auth(owner))
    assert (r.status_code, r.json()) == (503, NOT_CONFIGURED)


def test_streaming_assistant_answers_503_without_a_key(client, owner, project, code_file, no_keys):
    r = client.post(f"/ai/projects/{project}/stream", json={"action": "explain", "file_id": code_file}, headers=auth(owner))
    assert (r.status_code, r.json()) == (503, NOT_CONFIGURED)


def test_task_breakdown_answers_503_without_a_key(client, owner, project, no_keys):
    r = client.post(f"/ai/projects/{project}/task-suggestions", json={"description": "A login page"}, headers=auth(owner))
    assert (r.status_code, r.json()) == (503, NOT_CONFIGURED)


def test_agent_start_answers_503_and_creates_nothing(client, owner, project, no_keys):
    r = client.post(f"/ai/projects/{project}/agent/runs", json={"goal": "Fix the bug"}, headers=auth(owner))
    assert (r.status_code, r.json()) == (503, NOT_CONFIGURED)
    with SessionLocal() as db:
        assert db.query(AgentRunModel).count() == 0
    quota = client.get("/ai/agent/quota", headers=auth(owner)).json()
    assert quota["ai_configured"] is False
    assert quota["user_remaining"] == quota["user_limit"]  # nothing was counted


def test_agent_start_does_not_end_a_running_run_without_a_key(client, owner, project, monkeypatch):
    first = client.post(f"/ai/projects/{project}/agent/runs", json={"goal": "Fix the bug"}, headers=auth(owner))
    assert first.status_code == 201
    monkeypatch.setattr(settings, "gemini_api_key", None)
    monkeypatch.setattr(settings, "agent_gemini_api_key", None)
    assert client.post(f"/ai/projects/{project}/agent/runs", json={"goal": "Another"}, headers=auth(owner)).status_code == 503
    with SessionLocal() as db:
        assert db.get(AgentRunModel, first.json()["id"]).status == "running"


def test_agent_step_answers_503_without_a_key_and_can_be_retried(client, owner, project, monkeypatch):
    run_id = client.post(f"/ai/projects/{project}/agent/runs", json={"goal": "Fix the bug"}, headers=auth(owner)).json()["id"]
    monkeypatch.setattr(settings, "gemini_api_key", None)
    monkeypatch.setattr(settings, "agent_gemini_api_key", None)
    r = client.post(f"/ai/agent/runs/{run_id}/step", json={"results": []}, headers=auth(owner))
    assert (r.status_code, r.json()) == (503, NOT_CONFIGURED)
    with SessionLocal() as db:
        run = db.get(AgentRunModel, run_id)
        assert (run.status, run.phase, run.steps) == ("running", "ready", 0)  # not stuck "thinking"


def test_quota_says_ai_is_configured_when_a_key_is_set(client, owner):
    assert client.get("/ai/agent/quota", headers=auth(owner)).json()["ai_configured"] is True


def test_the_agent_alone_can_be_configured(client, owner, project, monkeypatch):
    """AGENT_GEMINI_API_KEY without GEMINI_API_KEY: the agent works, the assistant doesn't."""
    monkeypatch.setattr(settings, "gemini_api_key", None)
    monkeypatch.setattr(settings, "agent_gemini_api_key", "agent-only-test-key")
    assert ai.agent_is_configured() and not ai.is_configured()
    assert client.post(f"/ai/projects/{project}/agent/runs", json={"goal": "Fix it"}, headers=auth(owner)).status_code == 201
    assert client.post("/ai/generate-code", json={"prompt": "x"}, headers=auth(owner)).status_code == 503


def test_clients_are_made_on_first_use_one_per_key(monkeypatch):
    monkeypatch.setattr(ai, "_clients", {})
    monkeypatch.setattr(settings, "gemini_api_key", "shared-test-key")
    monkeypatch.setattr(settings, "agent_gemini_api_key", None)
    assert ai._clients == {}  # nothing until something asks
    shared = ai.get_client()
    # Without its own key the agent uses the shared key, so the very same client
    assert ai.get_agent_client() is shared
    assert ai.get_client() is shared
    monkeypatch.setattr(settings, "agent_gemini_api_key", "agent-test-key")
    assert ai.get_agent_client() is not shared
    assert len(ai._clients) == 2


def test_no_key_error_names_no_key(monkeypatch, caplog):
    monkeypatch.setattr(settings, "gemini_api_key", None)
    with pytest.raises(ai.AINotConfiguredError) as info:
        ai.get_client()
    assert str(info.value) == "AI is not configured"
    assert "test-gemini-key" not in caplog.text
