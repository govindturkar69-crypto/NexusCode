"""Sign in with GitHub: its own OAuth app, separate from "Connect GitHub" (repo access)."""
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from conftest import DEFAULT_PASSWORD, auth
from oauth_fakes import GITHUB_LOGIN_CLIENT_ID, FakeProviders, pkce_pair

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import OAuthIdentityModel, UserModel
from app.services import oauth

NONCE = "n" * 32
REDIRECT = "http://api.test/auth/github/login/callback"


@pytest.fixture
def github(monkeypatch):
    monkeypatch.setattr(settings, "github_login_client_id", GITHUB_LOGIN_CLIENT_ID)
    monkeypatch.setattr(settings, "github_login_client_secret", "github-login-secret")
    monkeypatch.setattr(settings, "github_login_redirect_uri", REDIRECT)
    fake = FakeProviders()
    real_post, real_get = httpx.post, httpx.get
    monkeypatch.setattr(httpx, "post", lambda url, *a, **k: fake.post(url, *a, **k) or real_post(url, *a, **k))
    monkeypatch.setattr(httpx, "get", lambda url, *a, **k: fake.get(url, *a, **k) or real_get(url, *a, **k))
    return fake


def start(client, intent="login", headers=None):
    verifier, challenge = pkce_pair()
    r = client.post("/auth/oauth/github/start", json={"nonce": NONCE, "code_challenge": challenge, "intent": intent}, headers=headers or {})
    return r, verifier


def through_github(client, github, start_response):
    url = start_response.json()["url"]
    code, query = github.authorize(url)
    r = client.get("/auth/github/login/callback", params={"code": code, "state": query["state"]}, follow_redirects=False)
    return {k: v[0] for k, v in parse_qs(r.headers["location"].split("#", 1)[1]).items()}


def sign_in(client, github, intent="login", headers=None):
    r, verifier = start(client, intent, headers)
    assert r.status_code == 200, r.text
    fragment = through_github(client, github, r)
    body = {"provider": "github", "code": fragment["code"], "state": fragment["state"], "nonce": NONCE, "code_verifier": verifier}
    return client.post("/auth/oauth/complete", json=body, headers=headers or {})


def _user(username):
    with SessionLocal() as db:
        return db.query(UserModel).filter(UserModel.username == username).first()


def test_off_until_configured(client):
    assert client.get("/auth/options").json()["github"] is False
    r, _ = start(client)
    assert r.status_code == 503 and "GitHub" in r.json()["detail"]


def test_separate_from_the_repo_access_app(client, github, monkeypatch):
    # The repo-access app's settings don't turn sign-in on, and aren't used by it
    monkeypatch.setattr(settings, "github_client_id", "repo-app-id")
    monkeypatch.setattr(settings, "github_client_secret", "repo-app-secret")
    r, _ = start(client)
    query = {k: v[0] for k, v in parse_qs(urlsplit(r.json()["url"]).query).items()}
    assert r.json()["url"].startswith("https://github.com/login/oauth/authorize?")
    assert query["client_id"] == GITHUB_LOGIN_CLIENT_ID and query["redirect_uri"] == REDIRECT
    # Only who the user is and their email: no repository access
    assert query["scope"] == "read:user user:email"
    assert query["code_challenge_method"] == "S256"
    assert oauth.read_state(query["state"])["prv"] == "github"


def test_only_the_repo_app_configured_leaves_sign_in_off(client, monkeypatch):
    monkeypatch.setattr(settings, "github_client_id", "repo-app-id")
    monkeypatch.setattr(settings, "github_client_secret", "repo-app-secret")
    monkeypatch.setattr(settings, "github_redirect_uri", "http://api.test/auth/github/callback")
    assert client.get("/auth/options").json()["github"] is False


def test_the_repo_connect_callback_is_untouched(client, github):
    r = client.get("/auth/github/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert "/oauth/callback" not in r.headers.get("location", "")


def test_first_sign_in_creates_an_account_with_the_verified_primary_email(client, github):
    r = sign_in(client, github)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "created" and data["username"] == "octo"
    user = _user("octo")
    assert (user.email, user.email_verified, user.hashed_password) == ("octo@example.com", True, None)
    sent = github.token_requests[-1]["data"]
    assert sent["client_secret"] == "github-login-secret" and sent["redirect_uri"] == REDIRECT
    with SessionLocal() as db:
        identity = db.query(OAuthIdentityModel).one()
        assert (identity.provider, identity.provider_user_id) == ("github", "4242")


def test_the_login_is_used_for_the_username_without_an_email(client, github):
    github.github_emails = []
    data = sign_in(client, github).json()
    assert data["username"] == "octo_cat"
    assert _user(data["username"]).email is None


@pytest.mark.parametrize("emails", [
    [{"email": "octo@example.com", "primary": True, "verified": False}],
    [{"email": "octo@example.com", "primary": False, "verified": True}],
    [],
    {"message": "unexpected shape"},
])
def test_only_a_verified_primary_email_counts(client, github, make_user, emails):
    token = make_user("owner")
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == "owner").update({"email": "octo@example.com", "email_verified": True})
        db.commit()
    github.github_emails = emails
    data = sign_in(client, github).json()
    # Without a verified primary email there's no match, so no link offer and no email
    assert data["status"] == "created" and data["username"] != "owner"
    assert _user(data["username"]).email is None
    assert token


def test_the_same_github_account_signs_in_again(client, github):
    first = sign_in(client, github).json()
    github.github_user["login"] = "renamed"
    github.github_emails = [{"email": "new@example.com", "primary": True, "verified": True}]
    again = sign_in(client, github).json()
    assert again["status"] == "signed_in" and again["username"] == first["username"]


def test_a_matching_verified_email_needs_the_password(client, github, make_user):
    make_user("owner")
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == "owner").update({"email": "octo@example.com", "email_verified": True})
        db.commit()
    data = sign_in(client, github).json()
    assert data["status"] == "link_required" and data["access_token"] is None
    r = client.post("/auth/oauth/link", json={"link_token": data["link_token"], "password": DEFAULT_PASSWORD})
    assert r.status_code == 200 and r.json()["username"] == "owner"
    assert sign_in(client, github).json()["username"] == "owner"


def test_google_and_github_can_both_be_linked(client, github, make_user):
    alice = make_user("alice")
    assert sign_in(client, github, "link", auth(alice)).json()["status"] == "linked"
    with SessionLocal() as db:
        db.add(OAuthIdentityModel(user_id=_user("alice").id, provider="google", provider_user_id="g-1"))
        db.commit()
        assert db.query(OAuthIdentityModel).filter(OAuthIdentityModel.user_id == _user("alice").id).count() == 2


def test_a_google_state_cannot_finish_a_github_sign_in(client, github, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "g")
    monkeypatch.setattr(settings, "google_client_secret", "g")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://api.test/auth/google/callback")
    verifier, challenge = pkce_pair()
    google_url = client.post("/auth/oauth/google/start", json={"nonce": NONCE, "code_challenge": challenge}).json()["url"]
    google_state = parse_qs(urlsplit(google_url).query)["state"][0]
    # At the callback
    r = client.get("/auth/github/login/callback", params={"code": "c", "state": google_state}, follow_redirects=False)
    assert "error=failed" in r.headers["location"]
    # And at completion
    body = {"provider": "github", "code": "c", "state": google_state, "nonce": NONCE, "code_verifier": verifier}
    assert client.post("/auth/oauth/complete", json=body).status_code == 400


def test_a_wrong_verifier_is_refused(client, github):
    r, _ = start(client)
    fragment = through_github(client, github, r)
    other, _ = pkce_pair()
    body = {"provider": "github", "code": fragment["code"], "state": fragment["state"], "nonce": NONCE, "code_verifier": other}
    r2 = client.post("/auth/oauth/complete", json=body)
    assert r2.status_code == 400 and "couldn't be completed" in r2.json()["detail"]


@pytest.mark.parametrize("status", [401, 403, 500])
def test_github_api_failures_are_clear_errors(client, github, status):
    github.github_api_status = status
    r = sign_in(client, github)
    assert r.status_code == 400 and "GitHub" in r.json()["detail"]
    with SessionLocal() as db:
        assert db.query(UserModel).count() == 0


def test_the_github_token_is_not_kept(client, github):
    r = sign_in(client, github)
    issued = next(iter(github.github_tokens))
    assert issued not in r.text
    with SessionLocal() as db:
        user = db.query(UserModel).one()
        assert user.github_token is None


def test_cancelling_at_github(client, github):
    r = client.get("/auth/github/login/callback", params={"error": "access_denied", "state": "x"}, follow_redirects=False)
    fragment = parse_qs(r.headers["location"].split("#", 1)[1])
    assert fragment == {"provider": ["github"], "error": ["cancelled"]}
