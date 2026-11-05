"""Running code through Judge0. Only the HTTP call to Judge0 is faked."""
import base64
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from conftest import add_member, auth

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import CodeRunModel, UserModel
from app.services import runner


def b64(text):
    return base64.b64encode(text.encode()).decode()


@pytest.fixture
def judge0(monkeypatch):
    """Records what would reach Judge0 and replies with state["reply"]."""
    state = {
        "calls": [],
        "status_code": 201,
        "error": None,
        "reply": {
            "status": {"id": 3, "description": "Accepted"},
            "stdout": b64("hello\n"),
            "stderr": None,
            "compile_output": None,
            "message": None,
            "time": "0.012",
            "memory": 3200,
            "exit_code": 0,
        },
    }

    def fake_post(url, params=None, headers=None, json=None, timeout=None):
        state["calls"].append({"url": url, "params": params, "headers": headers, "json": json, "timeout": timeout})
        if state["error"]:
            raise state["error"]
        return httpx.Response(state["status_code"], json=state["reply"], request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(settings, "judge0_api_key", "test-judge0-key")
    monkeypatch.setattr(settings, "judge0_api_url", "https://judge0.test")
    monkeypatch.setattr(settings, "run_daily_limit", 45)
    monkeypatch.setattr(settings, "run_user_daily_limit", 15)
    return state


@pytest.fixture
def team(client, make_user, project_of):
    tokens = {name: make_user(name) for name in ("olivia", "eddie", "vera", "oscar")}
    pid = project_of(tokens["olivia"], "Apollo")
    add_member("eddie", pid, "editor")
    add_member("vera", pid, "viewer")
    owner = auth(tokens["olivia"])
    r = client.post(f"/projects/{pid}/code/files", json={"path": "main.py", "content": "print('hello')"}, headers=owner)
    return {
        "pid": pid,
        "file_id": r.json()["code_file"]["id"],
        "owner": owner,
        "editor": auth(tokens["eddie"]),
        "viewer": auth(tokens["vera"]),
        "outsider": auth(tokens["oscar"]),
    }


def _run(client, team, who="editor", **body):
    return client.post(f"/code-files/{team['file_id']}/run", json=body, headers=team[who])


def _new_file(client, team, path, content="x = 1"):
    return client.post(f"/projects/{team['pid']}/code/files", json={"path": path, "content": content}, headers=team["owner"]).json()["code_file"]["id"]


# ---- running ----

def test_run_returns_stdout_exit_code_and_time(client, team, judge0):
    r = _run(client, team)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["stdout"] == "hello\n"
    assert data["stderr"] == "" and data["compile_output"] == ""
    assert data["exit_code"] == 0 and data["time_seconds"] == 0.012 and data["memory_kb"] == 3200
    assert data["status"] == "Accepted" and data["succeeded"] is True and data["timed_out"] is False
    assert data["truncated"] is False
    assert data["remaining_today"] == 14


def test_request_to_judge0_is_sandboxed_and_limited(client, team, judge0):
    _run(client, team, stdin="some input")
    call = judge0["calls"][0]
    assert call["url"] == "https://judge0.test/submissions"
    assert call["params"]["base64_encoded"] == "true" and call["params"]["wait"] == "true"
    body = call["json"]
    assert base64.b64decode(body["source_code"]).decode() == "print('hello')"
    assert base64.b64decode(body["stdin"]).decode() == "some input"
    assert body["language_id"] == 71
    assert body["enable_network"] is False
    assert body["cpu_time_limit"] == runner.CPU_LIMIT_SECONDS
    assert body["wall_time_limit"] == runner.WALL_LIMIT_SECONDS
    assert body["memory_limit"] == runner.MEMORY_LIMIT_KB
    assert call["timeout"] == runner.REQUEST_TIMEOUT_SECONDS
    assert call["headers"]["X-RapidAPI-Key"] == "test-judge0-key"


def test_it_runs_the_saved_content(client, team, judge0):
    client.put(f"/code-files/{team['file_id']}", json={"content": "print('saved')"}, headers=team["editor"])
    _run(client, team)
    assert base64.b64decode(judge0["calls"][0]["json"]["source_code"]).decode() == "print('saved')"


@pytest.mark.parametrize("path,language_id", [("a.js", 63), ("a.ts", 74), ("A.java", 62), ("a.c", 50), ("a.cpp", 54), ("a.go", 60), ("a.rs", 73), ("a.rb", 72), ("a.php", 68), ("a.sh", 46), ("a.cs", 51)])
def test_language_comes_from_the_file(client, team, judge0, path, language_id):
    file_id = _new_file(client, team, path)
    assert client.post(f"/code-files/{file_id}/run", json={}, headers=team["editor"]).status_code == 200
    assert judge0["calls"][0]["json"]["language_id"] == language_id


def test_stderr_and_a_nonzero_exit_code(client, team, judge0):
    judge0["reply"].update(status={"id": 11, "description": "Runtime Error (NZEC)"}, stdout=None, stderr=b64("Traceback\n"), exit_code=1)
    data = _run(client, team).json()
    assert data["stderr"] == "Traceback\n" and data["exit_code"] == 1
    assert data["status"] == "Runtime Error (NZEC)" and data["succeeded"] is False


def test_compile_errors(client, team, judge0):
    judge0["reply"].update(status={"id": 6, "description": "Compilation Error"}, stdout=None, compile_output=b64("error: x"), exit_code=None, time=None, memory=None)
    data = _run(client, team).json()
    assert data["compile_output"] == "error: x" and data["succeeded"] is False
    assert data["exit_code"] is None and data["time_seconds"] is None


def test_timeouts_are_flagged(client, team, judge0):
    judge0["reply"].update(status={"id": 5, "description": "Time Limit Exceeded"}, stdout=None, time="5.0")
    data = _run(client, team).json()
    assert data["timed_out"] is True and data["succeeded"] is False


def test_output_is_cut_to_the_limit(client, team, judge0):
    judge0["reply"]["stdout"] = b64("x" * (runner.MAX_OUTPUT_CHARS + 10))
    data = _run(client, team).json()
    assert len(data["stdout"]) == runner.MAX_OUTPUT_CHARS and data["truncated"] is True


def test_non_utf8_output_does_not_crash(client, team, judge0):
    judge0["reply"]["stdout"] = base64.b64encode(b"ok \xff\xfe").decode()
    r = _run(client, team)
    assert r.status_code == 200 and r.json()["stdout"].startswith("ok ")


# ---- refused before Judge0 ----

def test_not_configured_is_explained(client, team, judge0, monkeypatch):
    monkeypatch.setattr(settings, "judge0_api_key", None)
    r = _run(client, team)
    assert r.status_code == 503 and "isn't set up" in r.json()["detail"]
    assert judge0["calls"] == []
    with SessionLocal() as db:
        assert db.query(CodeRunModel).count() == 0


@pytest.mark.parametrize("path", ["notes.md", "README", "data.json", "page.html"])
def test_unsupported_languages_are_refused(client, team, judge0, path):
    file_id = _new_file(client, team, path)
    r = client.post(f"/code-files/{file_id}/run", json={}, headers=team["editor"])
    assert r.status_code == 422 and "isn't supported" in r.json()["detail"]
    assert judge0["calls"] == []


def test_empty_files_are_refused(client, team, judge0):
    file_id = _new_file(client, team, "e.py", "   \n")
    assert client.post(f"/code-files/{file_id}/run", json={}, headers=team["editor"]).status_code == 422
    assert judge0["calls"] == []


def test_huge_source_and_stdin_are_refused(client, team, judge0):
    file_id = _new_file(client, team, "big.py", "x" * 64_001)
    assert client.post(f"/code-files/{file_id}/run", json={}, headers=team["editor"]).status_code == 422
    assert _run(client, team, stdin="x" * 10_001).status_code == 422
    assert judge0["calls"] == []


# ---- Judge0 failures ----

@pytest.mark.parametrize("status_code,expected,text", [
    (429, 429, "limit"),
    (401, 502, "key"),
    (403, 502, "key"),
    (500, 502, "problem"),
    (503, 502, "problem"),
])
def test_judge0_errors_are_explained(client, team, judge0, status_code, expected, text):
    judge0["status_code"] = status_code
    r = _run(client, team)
    assert r.status_code == expected and text in r.json()["detail"]
    assert "test-judge0-key" not in r.text


def test_judge0_unreachable(client, team, judge0):
    judge0["error"] = httpx.ConnectError("down")
    r = _run(client, team)
    assert r.status_code == 502 and "reach" in r.json()["detail"]


def test_judge0_timeout(client, team, judge0):
    judge0["error"] = httpx.ReadTimeout("slow")
    assert _run(client, team).status_code == 502


@pytest.mark.parametrize("status_id", [1, 2])
def test_judge0_still_queued_says_busy(client, team, judge0, status_id):
    judge0["reply"]["status"] = {"id": status_id, "description": "In Queue"}
    r = _run(client, team)
    assert r.status_code == 502 and "busy" in r.json()["detail"]


@pytest.mark.parametrize("status_id", [13, 14])
def test_judge0_internal_errors_are_not_blamed_on_the_code(client, team, judge0, status_id):
    judge0["reply"]["status"] = {"id": status_id, "description": "Internal Error"}
    assert _run(client, team).status_code == 502


def test_unreadable_reply_is_handled(client, team, judge0):
    judge0["reply"] = {"nothing": "useful"}
    assert _run(client, team).status_code == 502


# ---- limits ----

def test_per_user_daily_limit(client, team, judge0, monkeypatch):
    monkeypatch.setattr(settings, "run_user_daily_limit", 2)
    assert _run(client, team).json()["remaining_today"] == 1
    assert _run(client, team).json()["remaining_today"] == 0
    r = _run(client, team)
    assert r.status_code == 429 and "your 2 code runs" in r.json()["detail"]
    assert len(judge0["calls"]) == 2
    # Someone else still has theirs
    assert _run(client, team, who="owner").status_code == 200


def test_site_wide_daily_limit(client, team, judge0, monkeypatch):
    monkeypatch.setattr(settings, "run_daily_limit", 2)
    _run(client, team)
    _run(client, team, who="owner")
    r = _run(client, team)
    assert r.status_code == 429 and "This site" in r.json()["detail"]
    assert len(judge0["calls"]) == 2


def test_yesterdays_runs_do_not_count(client, team, judge0, monkeypatch):
    monkeypatch.setattr(settings, "run_daily_limit", 1)
    with SessionLocal() as db:
        db.add(CodeRunModel(project_id=team["pid"], user_id=None, created_at=datetime.now(UTC) - timedelta(days=2)))
        db.commit()
    assert _run(client, team).status_code == 200


def test_failed_runs_still_count(client, team, judge0, monkeypatch):
    monkeypatch.setattr(settings, "run_user_daily_limit", 1)
    judge0["status_code"] = 500
    assert _run(client, team).status_code == 502
    assert _run(client, team).status_code == 429


def test_per_minute_limit_is_per_user(client, team, judge0, rate_limits):
    codes = [_run(client, team).status_code for _ in range(6)]
    assert codes == [200] * 5 + [429]
    assert _run(client, team, who="owner").status_code == 200


def test_run_rows_hold_no_code_or_output(client, team, judge0):
    _run(client, team)
    with SessionLocal() as db:
        run = db.query(CodeRunModel).one()
        assert run.project_id == team["pid"]
        assert {c.name for c in CodeRunModel.__table__.columns} == {"id", "project_id", "user_id", "created_at"}


# ---- permissions ----

def test_viewer_cannot_run(client, team, judge0):
    r = _run(client, team, who="viewer")
    assert r.status_code == 403 and "editor" in r.json()["detail"]
    assert judge0["calls"] == []


@pytest.mark.parametrize("who", ["editor", "owner"])
def test_editors_and_owners_can_run(client, team, judge0, who):
    assert _run(client, team, who=who).status_code == 200


def test_outsider_gets_404(client, team, judge0):
    assert _run(client, team, who="outsider").status_code == 404
    assert judge0["calls"] == []


def test_login_is_required(client, team, judge0):
    assert client.post(f"/code-files/{team['file_id']}/run", json={}).status_code == 401
    assert client.get("/run/info").status_code == 401
    assert judge0["calls"] == []


def test_run_info(client, team, judge0, monkeypatch):
    data = client.get("/run/info", headers=team["viewer"]).json()
    assert data["enabled"] is True and data["remaining_today"] == 15
    assert {"python", "javascript", "java"} <= set(data["languages"])
    _run(client, team)
    assert client.get("/run/info", headers=team["editor"]).json()["remaining_today"] == 14
    monkeypatch.setattr(settings, "judge0_api_key", "")
    assert client.get("/run/info", headers=team["editor"]).json()["enabled"] is False


def test_no_route_runs_code_locally():
    """Guards the rule that user code only ever leaves for Judge0."""
    import inspect

    from app.routers import run as run_router

    for module in (runner, run_router):
        source = inspect.getsource(module)
        for forbidden in ("subprocess", "exec(", "eval(", "os.system"):
            assert forbidden not in source


# ---- deleting ----

def test_deleting_an_account_keeps_the_count_but_not_the_link(client, team, judge0):
    _run(client, team)
    with SessionLocal() as db:
        eddie = db.query(UserModel).filter(UserModel.username == "eddie").one().id
    from conftest import DEFAULT_PASSWORD

    assert client.post("/me/delete", json={"password": DEFAULT_PASSWORD}, headers=team["editor"]).status_code == 204
    with SessionLocal() as db:
        run = db.query(CodeRunModel).one()
        assert run.user_id is None and db.query(CodeRunModel).filter(CodeRunModel.user_id == eddie).count() == 0


def test_deleting_a_project_removes_its_runs(client, team, judge0):
    _run(client, team)
    assert client.delete(f"/projects/{team['pid']}", headers=team["owner"]).status_code == 204
    with SessionLocal() as db:
        assert db.query(CodeRunModel).count() == 0
