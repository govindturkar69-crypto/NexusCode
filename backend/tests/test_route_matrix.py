"""
The authorization matrix, built from the app itself (no hand-kept route list):

1. every HTTP route needs a signed-in user, or is in PUBLIC (with a reason);
2. every route on a project resource is guarded by require_project_role, with
   the expected minimum role (viewer reads, editor/owner writes, documented
   exceptions in VIEWER_WRITES);
3. behaviourally: no token -> 401; a signed-in non-member (who owns another
   project) -> 404 with REAL ids of project A's resources; a viewer -> 403 on
   every editor/owner route;
4. per-user resources (agent runs, notifications) are 404 for other users;
5. WebSockets refuse a missing ticket and a ticket for another project.

A new route that isn't covered by these rules fails test 1 or 2 until it is.
"""
import inspect
import uuid

import pytest
from conftest import add_member, auth, ws_path
from fastapi.routing import APIRoute, APIWebSocketRoute
from starlette.websockets import WebSocketDisconnect

from app.core.database import SessionLocal
from app.main import app
from app.models import AgentRunModel, FileModel, NotificationModel, UserModel

# (method, path) -> why anyone may call it
PUBLIC = {
    ("GET", "/"): "API banner",
    ("GET", "/health"): "liveness and DB check for Render and Docker",
    ("POST", "/signup"): "account creation",
    ("POST", "/login"): "sign in",
    ("GET", "/auth/options"): "which sign-in methods the server offers",
    ("POST", "/auth/password-reset/request"): "forgotten password (answers the same whether or not the address exists)",
    ("POST", "/auth/password-reset/confirm"): "single-use reset token",
    ("POST", "/auth/verify-email"): "single-use verification token",
    ("POST", "/auth/oauth/{provider}/start"): "starts Google/GitHub sign-in (PKCE + nonce)",
    ("GET", "/auth/google/callback"): "OAuth provider redirect, checked by signed state",
    ("GET", "/auth/github/login/callback"): "OAuth provider redirect, checked by signed state",
    ("POST", "/auth/oauth/complete"): "finishes sign-in with code + state + nonce + PKCE verifier",
    ("POST", "/auth/oauth/link"): "links a provider to an account after its password is given",
    ("GET", "/auth/github/callback"): "GitHub repo-connection redirect, checked by signed state",
}
# WebSockets authenticate with a single-use ticket in the query string, not a header
TICKET_WEBSOCKETS = {"/ws/code-files/{code_file_id}", "/ws/projects/{project_id}/chat"}
# Project routes a viewer may call although they aren't GETs
VIEWER_WRITES = {
    ("DELETE", "/projects/{project_id}/members/{user_id}"): "leave the project (removing others is owner-only, tested below)",
    ("POST", "/projects/{project_id}/meeting/token"): "every member may join the meeting",
    ("POST", "/ai/projects/{project_id}/stream"): "ask the AI about code; applying an answer needs edit rights",
}
RESOURCE_PARAMS = ("{project_id}", "{task_id}", "{file_id}", "{code_file_id}")


def all_routes():
    def walk(routes):
        for r in routes:
            if type(r).__name__ == "_IncludedRouter":  # FastAPI keeps included routers wrapped
                yield from walk(r.original_router.routes)
            elif isinstance(r, (APIRoute, APIWebSocketRoute)):
                yield r

    return list(walk(app.routes))


def guards(dependant, found=None):
    found = [] if found is None else found
    for d in dependant.dependencies:
        try:
            nonlocals = inspect.getclosurevars(d.call).nonlocals
        except Exception:
            nonlocals = {}
        if "min_role" in nonlocals:
            found.append(("role", nonlocals["min_role"]))
        name = getattr(d.call, "__name__", "")
        if name in ("get_current_user", "get_current_admin"):
            found.append(("user", name))
        guards(d, found)
    return found


HTTP = [(m, r.path, r) for r in all_routes() if isinstance(r, APIRoute) for m in sorted(r.methods - {"HEAD", "OPTIONS"})]
WS = [r for r in all_routes() if isinstance(r, APIWebSocketRoute)]


def min_role(route):
    roles = [v for k, v in guards(route.dependant) if k == "role"]
    return roles[0] if roles else None


def test_the_matrix_sees_every_route():
    # Guards against the walker silently missing routes after a FastAPI change
    assert len(HTTP) >= 85
    assert {r.path for r in WS} == TICKET_WEBSOCKETS
    assert set(PUBLIC) <= {(m, p) for m, p, _ in HTTP}


@pytest.mark.parametrize("method,path,route", HTTP, ids=[f"{m} {p}" for m, p, _ in HTTP])
def test_every_route_needs_a_user_or_is_public(method, path, route):
    signed_in = any(kind == "user" for kind, _ in guards(route.dependant))
    if (method, path) in PUBLIC:
        assert not signed_in, f"{method} {path} is listed as public but requires a user: update PUBLIC"
    else:
        assert signed_in, f"{method} {path} has no authentication and isn't in PUBLIC"


@pytest.mark.parametrize("method,path,route", HTTP, ids=[f"{m} {p}" for m, p, _ in HTTP])
def test_project_resources_use_require_project_role_with_the_right_role(method, path, route):
    if not any(param in path for param in RESOURCE_PARAMS):
        return
    role = min_role(route)
    assert role is not None, f"{method} {path} touches a project resource without require_project_role"
    if method == "GET":
        assert role == "viewer", f"{method} {path}: reads should be open to every member, got {role}"
    elif (method, path) in VIEWER_WRITES:
        assert role == "viewer"
    else:
        assert role in ("editor", "owner"), f"{method} {path}: a write open to viewers ({role}); add it to VIEWER_WRITES with a reason if intended"


# ---------------------------------------------------------------- behaviour


@pytest.fixture
def world(client, make_user, project_of):
    """Project A (owner olivia, viewer vic) with one of each resource, and project B
    owned by mallory, who is NOT a member of A."""
    olivia, vic, mallory = make_user("olivia"), make_user("vic"), make_user("mallory")
    a = project_of(olivia, "A")
    b = project_of(mallory, "B")
    add_member("vic", a, "viewer")
    task = client.post(f"/projects/{a}/tasks", json={"title": "t"}, headers=auth(olivia)).json()["task"]["id"]
    code = client.post(f"/projects/{a}/code/files", json={"path": "a.py", "content": "x"}, headers=auth(olivia)).json()["code_file"]["id"]
    version = client.get(f"/code-files/{code}/versions", headers=auth(olivia)).json()["versions"][0]["id"]
    with SessionLocal() as db:
        upload = FileModel(filename="a.txt", url="https://example.invalid/a.txt", project_id=a)
        db.add(upload)
        db.commit()
        upload_id = upload.id
        vic_id = db.query(UserModel.id).filter(UserModel.username == "vic").scalar()
        olivia_id = db.query(UserModel.id).filter(UserModel.username == "olivia").scalar()
    ids = {"project_id": a, "task_id": task, "file_id": upload_id, "code_file_id": code, "version_id": version, "user_id": vic_id}
    return {"olivia": olivia, "vic": vic, "mallory": mallory, "a": a, "b": b, "ids": ids, "olivia_id": olivia_id}


def fill(path, ids):
    out = path
    for key, value in ids.items():
        out = out.replace("{" + key + "}", str(value))
    return out.replace("{provider}", "google").replace("{run_id}", "1").replace("{notification_id}", "1").replace("{repo_name}", "r")


def call(client, method, path, token=None):
    headers = auth(token) if token else {}
    return client.request(method, path, json={}, headers=headers)


@pytest.mark.parametrize("method,path,route", [h for h in HTTP if (h[0], h[1]) not in PUBLIC], ids=[f"{m} {p}" for m, p, _ in HTTP if (m, p) not in PUBLIC])
def test_no_token_is_401(client, world, method, path, route):
    r = call(client, method, fill(path, world["ids"]))
    # The upload middleware refuses a body without Content-Length before auth runs
    assert r.status_code in ((401, 411) if path.endswith(("/files", "/code/import")) and method == "POST" else (401,)), f"{method} {path} -> {r.status_code}"


PROJECT_ROUTES = [h for h in HTTP if any(p in h[1] for p in RESOURCE_PARAMS)]


@pytest.mark.parametrize("method,path,route", PROJECT_ROUTES, ids=[f"{m} {p}" for m, p, _ in PROJECT_ROUTES])
def test_a_member_of_another_project_gets_404_for_real_ids(client, world, method, path, route):
    """mallory owns project B; every route on project A's real resources is a 404
    to her, so ids can't be probed and A's data can't be reached through B."""
    r = call(client, method, fill(path, world["ids"]), world["mallory"])
    assert r.status_code == 404, f"{method} {path} -> {r.status_code}: {r.text[:200]}"


WRITE_ROUTES = [h for h in PROJECT_ROUTES if min_role(h[2]) in ("editor", "owner")]


@pytest.mark.parametrize("method,path,route", WRITE_ROUTES, ids=[f"{m} {p}" for m, p, _ in WRITE_ROUTES])
def test_a_viewer_gets_403_on_every_write(client, world, method, path, route):
    r = call(client, method, fill(path, world["ids"]), world["vic"])
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}: {r.text[:200]}"


def test_a_viewer_can_leave_but_not_remove_others(client, world, make_user):
    make_user("eve")
    add_member("eve", world["a"], "editor")
    with SessionLocal() as db:
        eve_id = db.query(UserModel.id).filter(UserModel.username == "eve").scalar()
    r = client.delete(f"/projects/{world['a']}/members/{eve_id}", headers=auth(world["vic"]))
    assert r.status_code == 403
    r = client.delete(f"/projects/{world['a']}/members/{world['olivia_id']}", headers=auth(world["vic"]))
    assert r.status_code == 403
    r = client.delete(f"/projects/{world['a']}/members/{world['ids']['user_id']}", headers=auth(world["vic"]))
    assert r.status_code in (200, 204)


def test_agent_runs_belong_to_their_user(client, world):
    with SessionLocal() as db:
        run = AgentRunModel(project_id=world["a"], user_id=world["olivia_id"], goal="g", nonce=uuid.uuid4().hex)
        db.add(run)
        db.commit()
        run_id = run.id
    for action in ("step", "stop", "accepted"):
        r = client.post(f"/ai/agent/runs/{run_id}/{action}", json={}, headers=auth(world["mallory"]))
        assert r.status_code == 404, f"{action}: {r.status_code} {r.text[:120]}"
        # A member of the project who didn't start the run can't drive it either
        r = client.post(f"/ai/agent/runs/{run_id}/{action}", json={}, headers=auth(world["vic"]))
        assert r.status_code in (403, 404), f"viewer {action}: {r.status_code}"


def test_notifications_belong_to_their_user(client, world):
    with SessionLocal() as db:
        note = NotificationModel(user_id=world["olivia_id"], project_id=world["a"], kind="added", message="m")
        db.add(note)
        db.commit()
        note_id = note.id
    r = client.post(f"/notifications/{note_id}/read", headers=auth(world["mallory"]))
    assert r.status_code == 404
    with SessionLocal() as db:
        assert db.get(NotificationModel, note_id).is_read is False


def test_websockets_refuse_no_ticket_and_another_projects_ticket(client, world):
    for path in (f"/ws/projects/{world['a']}/chat", f"/ws/code-files/{world['ids']['code_file_id']}"):
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(path) as ws:
                ws.receive_text()
    # mallory's valid ticket is for project B: it doesn't open A's chat or A's file
    for target in (f"/ws/projects/{world['a']}/chat", f"/ws/code-files/{world['ids']['code_file_id']}"):
        ticket_path = ws_path(client, world["mallory"], world["b"])
        ticket = ticket_path.split("ticket=")[1]
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"{target}?ticket={ticket}") as ws:
                ws.receive_text()
