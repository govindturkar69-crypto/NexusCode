import pytest
from conftest import DEFAULT_PASSWORD, auth

from app.core.security import create_access_token, create_oauth_state


def test_signup_then_login_and_me(client, make_user):
    token = make_user("alice")
    r = client.get("/me", headers=auth(token))
    assert r.status_code == 200
    assert r.json()["username"] == "alice"
    assert r.json()["is_admin"] is False


def test_signup_returns_201_and_duplicate_409(client):
    body = {"username": "alice", "password": DEFAULT_PASSWORD}
    assert client.post("/signup", json=body).status_code == 201
    r = client.post("/signup", json=body)
    assert r.status_code == 409
    assert r.json()["detail"] == "Username already taken"


@pytest.mark.parametrize("username", ["ab", "a" * 31, "Alice", "has space", "dash-name", "émile", ""])
def test_signup_rejects_bad_usernames(client, username):
    r = client.post("/signup", json={"username": username, "password": DEFAULT_PASSWORD})
    assert r.status_code == 422
    assert r.json()["detail"][0]["msg"].startswith("Username must be")


@pytest.mark.parametrize("username", ["abc", "a" * 30, "user_1"])
def test_signup_accepts_boundary_usernames(client, username):
    assert client.post("/signup", json={"username": username, "password": DEFAULT_PASSWORD}).status_code == 201


@pytest.mark.parametrize("password,ok", [
    ("1234567", False),       # 7 bytes
    ("12345678", True),       # 8 bytes
    ("x" * 72, True),         # bcrypt's limit
    ("x" * 73, False),
    ("€" * 25, False),        # 25 chars but 75 bytes
])
def test_signup_password_length_in_bytes(client, password, ok):
    r = client.post("/signup", json={"username": "pw_user", "password": password})
    assert r.status_code == (201 if ok else 422)


def test_login_wrong_password_is_401(client, make_user):
    make_user("alice")
    r = client.post("/login", data={"username": "alice", "password": "wrong-password"})
    assert r.status_code == 401


def test_login_unknown_user_is_401(client):
    r = client.post("/login", data={"username": "nobody", "password": DEFAULT_PASSWORD})
    assert r.status_code == 401


@pytest.mark.parametrize("header", [None, "Bearer", "Bearer not-a-jwt", "Basic abc"])
def test_protected_route_rejects_missing_or_bad_tokens(client, header):
    headers = {"Authorization": header} if header else {}
    assert client.get("/me", headers=headers).status_code == 401


def test_tampered_token_is_rejected(client, make_user):
    token = make_user("alice")
    assert client.get("/me", headers=auth(token[:-2] + "xx")).status_code == 401


def test_token_for_deleted_or_unknown_user_is_rejected(client):
    token = create_access_token({"sub": "ghost"})
    assert client.get("/me", headers=auth(token)).status_code == 401


def test_expired_token_is_rejected(client, make_user, monkeypatch):
    from app.core import security as auth_module
    make_user("alice")
    monkeypatch.setattr(auth_module, "ACCESS_TOKEN_EXPIRE_MINUTES", -1)
    expired = auth_module.create_access_token({"sub": "alice"})
    assert client.get("/me", headers=auth(expired)).status_code == 401


def test_oauth_state_cannot_be_used_as_login_token(client, make_user):
    make_user("alice")
    assert client.get("/me", headers=auth(create_oauth_state(1))).status_code == 401


def test_health_reports_database_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok"}


def test_cors_allows_frontend_and_localhost_only(client):
    preflight = {"Access-Control-Request-Method": "GET"}
    for origin in ("http://frontend.test", "http://localhost:5173"):
        r = client.options("/projects", headers={**preflight, "Origin": origin})
        assert r.headers.get("access-control-allow-origin") == origin
    r = client.options("/projects", headers={**preflight, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_removed_todos_routes_are_gone(client):
    assert client.get("/todos").status_code == 404
