from urllib.parse import parse_qs, urlparse

import pytest
from conftest import auth, get_github_token, set_github_token

from app.services import github as github_oauth


def _state_for(client, token):
    url = client.get("/auth/github/login", headers=auth(token)).json()["url"]
    query = parse_qs(urlparse(url).query)
    assert query["scope"] == ["repo"]
    assert query["client_id"] == ["test-client-id"]
    assert query["redirect_uri"] == ["http://api.test/auth/github/callback"]
    return query["state"][0]


def _callback(client, **params):
    r = client.get("/auth/github/callback", params=params, follow_redirects=False)
    assert r.status_code in (302, 307)
    return r.headers["location"]


def test_github_login_requires_auth(client):
    assert client.get("/auth/github/login").status_code == 401


def test_callback_links_token_to_initiating_user(client, make_user, fake_token_exchange):
    alice = make_user("alice")
    make_user("bob")
    state = _state_for(client, alice)
    assert _callback(client, code="c1", state=state) == "http://frontend.test/projects?github=connected"
    assert get_github_token("alice") == "gho_fake_token"
    assert get_github_token("bob") is None


@pytest.mark.parametrize("params", [
    {"code": "c"},                              # no state
    {"state": "whatever"},                      # no code
    {"code": "c", "state": "tampered.jwt.value"},
])
def test_callback_rejects_bad_input(client, make_user, fake_token_exchange, params):
    make_user("alice")
    assert _callback(client, **params).endswith("github=error")
    assert get_github_token("alice") is None


def test_callback_rejects_login_token_as_state(client, make_user, fake_token_exchange):
    alice = make_user("alice")
    assert _callback(client, code="c", state=alice).endswith("github=error")


def test_failed_exchange_keeps_existing_token(client, make_user, fake_token_exchange):
    alice = make_user("alice")
    set_github_token("alice", "gho_existing")
    fake_token_exchange["token"] = None
    assert _callback(client, code="c", state=_state_for(client, alice)).endswith("github=error")
    assert get_github_token("alice") == "gho_existing"


def test_exchange_code_handles_network_errors(monkeypatch):
    import httpx

    def boom(*args, **kwargs):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "post", boom)
    assert github_oauth.exchange_code_for_token("code") is None


@pytest.fixture
def pushable(client, make_user, project_of):
    alice = make_user("alice")
    pid = project_of(alice)
    client.put(f"/projects/{pid}/code", json={"content": "print(1)", "language": "python"}, headers=auth(alice))
    set_github_token("alice", "gho_alice")
    return alice, pid


def test_push_creates_private_repo_by_default(client, pushable, fake_github_http):
    alice, pid = pushable
    r = client.post(f"/projects/{pid}/push-to-github", json={"repo_name": "my-repo.v1"}, headers=auth(alice))
    assert r.status_code == 200, r.text
    assert r.json()["private"] is True
    create, push = fake_github_http["calls"]
    assert create[2] == {"name": "my-repo.v1", "private": True}
    assert push[1].endswith("/repos/tester/my-repo.v1/contents/main.py")


def test_push_public_when_requested(client, pushable, fake_github_http):
    alice, pid = pushable
    r = client.post(f"/projects/{pid}/push-to-github", json={"repo_name": "pub", "private": False}, headers=auth(alice))
    assert r.status_code == 200 and fake_github_http["calls"][0][2]["private"] is False


@pytest.mark.parametrize("name", ["bad name", "a/b", "", "a" * 101, "émoji"])
def test_push_rejects_invalid_repo_names(client, pushable, fake_github_http, name):
    alice, pid = pushable
    assert client.post(f"/projects/{pid}/push-to-github", json={"repo_name": name}, headers=auth(alice)).status_code == 422
    assert fake_github_http["calls"] == []


def test_push_without_github_connected_is_400(client, pushable, fake_github_http):
    alice, pid = pushable
    set_github_token("alice", None)
    r = client.post(f"/projects/{pid}/push-to-github", json={"repo_name": "x"}, headers=auth(alice))
    assert r.status_code == 400 and r.json()["detail"] == "GitHub account not connected"


def test_push_reports_existing_repo(client, pushable, fake_github_http):
    alice, pid = pushable
    fake_github_http["create_status"] = 422
    r = client.post(f"/projects/{pid}/push-to-github", json={"repo_name": "dup"}, headers=auth(alice))
    assert r.status_code == 400 and "already exists" in r.json()["detail"]


def test_push_with_revoked_token_asks_to_reconnect(client, pushable, fake_github_http):
    alice, pid = pushable
    fake_github_http["push_status"] = 401
    r = client.post(f"/projects/{pid}/push-to-github", json={"repo_name": "x"}, headers=auth(alice))
    assert r.status_code == 400 and "reconnect" in r.json()["detail"].lower()


def test_push_github_outage_is_502_not_success(client, pushable, fake_github_http):
    alice, pid = pushable
    fake_github_http["push_status"] = 500
    r = client.post(f"/projects/{pid}/push-to-github", json={"repo_name": "x"}, headers=auth(alice))
    assert r.status_code == 502 and "was created" in r.json()["detail"]
