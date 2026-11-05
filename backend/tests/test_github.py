from urllib.parse import parse_qs, urlparse

import pytest
from conftest import auth, get_github_token, set_github_token
from sqlalchemy import text

from app.core.database import engine
from app.routers import github as github_router
from app.services import github as github_oauth

ALICE_NONCE = "alice-tab-nonce-0123456789"
BOB_NONCE = "bob-tab-nonce-9876543210abc"


def _start(client, token, nonce):
    r = client.post("/auth/github/start", json={"nonce": nonce}, headers=auth(token))
    assert r.status_code == 200, r.text
    query = parse_qs(urlparse(r.json()["url"]).query)
    assert query["scope"] == ["repo"]
    assert query["client_id"] == ["test-client-id"]
    assert query["redirect_uri"] == ["http://api.test/auth/github/callback"]
    assert nonce not in query["state"][0]  # only its hash travels
    return query["state"][0]


def _callback(client, **params):
    r = client.get("/auth/github/callback", params=params, follow_redirects=False)
    assert r.status_code in (302, 307)
    return r.headers["location"]


def _pending_from(location):
    assert location.startswith("http://frontend.test/projects#")
    return parse_qs(urlparse(location).fragment)["github_pending"][0]


def _complete(client, token, pending, nonce):
    return client.post("/auth/github/complete", json={"pending": pending, "nonce": nonce}, headers=auth(token))


def _link(client, token, nonce, code="c1"):
    pending = _pending_from(_callback(client, code=code, state=_start(client, token, nonce)))
    return _complete(client, token, pending, nonce)


def test_start_requires_auth_and_a_real_nonce(client, make_user):
    assert client.post("/auth/github/start", json={"nonce": ALICE_NONCE}).status_code == 401
    alice = make_user("alice")
    assert client.post("/auth/github/start", json={"nonce": "short"}, headers=auth(alice)).status_code == 422


def test_old_single_step_login_route_is_gone(client, make_user):
    alice = make_user("alice")
    assert client.get("/auth/github/login", headers=auth(alice)).status_code == 404


def test_full_flow_links_token_to_initiating_user(client, make_user, fake_token_exchange):
    alice = make_user("alice")
    make_user("bob")
    location = _callback(client, code="c1", state=_start(client, alice, ALICE_NONCE))
    # Nothing is saved until the initiating tab confirms
    assert get_github_token("alice") is None
    assert "gho_fake_token" not in location  # the token travels encrypted

    r = _complete(client, alice, _pending_from(location), ALICE_NONCE)
    assert r.status_code == 200 and r.json() == {"connected": True}
    assert get_github_token("alice") == "gho_fake_token"
    assert get_github_token("bob") is None


def test_login_csrf_victim_cannot_be_linked_to_attacker(client, make_user, fake_token_exchange):
    """Attacker starts a flow and sends the GitHub link to a victim. The victim
    authorizes, so the callback carries the victim's code with the attacker's state."""
    attacker = make_user("attacker")
    victim = make_user("victim")
    attacker_state = _start(client, attacker, ALICE_NONCE)
    fake_token_exchange["token"] = "gho_VICTIM_token"
    pending = _pending_from(_callback(client, code="victim-code", state=attacker_state))

    # The victim's browser completes with the victim's own session and tab nonce
    assert _complete(client, victim, pending, BOB_NONCE).status_code == 400
    # Even with the attacker's nonce, the victim's session is the wrong user
    assert _complete(client, victim, pending, ALICE_NONCE).status_code == 400
    assert get_github_token("victim") is None
    assert get_github_token("attacker") is None


def test_wrong_nonce_from_same_user_is_rejected(client, make_user, fake_token_exchange):
    alice = make_user("alice")
    pending = _pending_from(_callback(client, code="c", state=_start(client, alice, ALICE_NONCE)))
    assert _complete(client, alice, pending, BOB_NONCE).status_code == 400
    assert get_github_token("alice") is None


def test_tampered_or_expired_pending_is_rejected(client, make_user, fake_token_exchange, monkeypatch):
    alice = make_user("alice")
    pending = _pending_from(_callback(client, code="c", state=_start(client, alice, ALICE_NONCE)))
    assert _complete(client, alice, pending[:-4] + "AAAA", ALICE_NONCE).status_code == 400
    monkeypatch.setattr(github_router, "PENDING_MAX_AGE_SECONDS", -1)
    assert _complete(client, alice, pending, ALICE_NONCE).status_code == 400
    assert get_github_token("alice") is None


@pytest.mark.parametrize("params", [
    {"code": "c"},                              # no state
    {"state": "whatever"},                      # no code
    {"code": "c", "state": "tampered.jwt.value"},
])
def test_callback_rejects_bad_input(client, make_user, fake_token_exchange, params):
    make_user("alice")
    assert _callback(client, **params).endswith("github=error")


def test_callback_rejects_login_token_as_state(client, make_user, fake_token_exchange):
    alice = make_user("alice")
    assert _callback(client, code="c", state=alice).endswith("github=error")


def test_failed_exchange_keeps_existing_token(client, make_user, fake_token_exchange):
    alice = make_user("alice")
    set_github_token("alice", "gho_existing")
    fake_token_exchange["token"] = None
    assert _callback(client, code="c", state=_start(client, alice, ALICE_NONCE)).endswith("github=error")
    assert get_github_token("alice") == "gho_existing"


def test_tokens_are_encrypted_at_rest(client, make_user, fake_token_exchange):
    alice = make_user("alice")
    assert _link(client, alice, ALICE_NONCE).status_code == 200
    with engine.connect() as conn:
        stored = conn.execute(text("SELECT github_token FROM users WHERE username = 'alice'")).scalar()
    assert stored.startswith("enc:v1:") and "gho_fake_token" not in stored
    assert get_github_token("alice") == "gho_fake_token"


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
    assert fake_github_http["calls"][0][2] == {"name": "my-repo.v1", "private": True, "auto_init": True}
    assert fake_github_http["repo_files"]("my-repo.v1") == {"main.py": "print(1)"}


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
