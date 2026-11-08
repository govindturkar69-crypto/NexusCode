"""Sign in with Google: state, PKCE, ID token verification and account rules."""
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from conftest import DEFAULT_PASSWORD, auth
from oauth_fakes import GOOGLE_CLIENT_ID, OTHER_KEY, FakeProviders, pkce_pair

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import ALGORITHM, SECRET_KEY
from app.models import OAuthIdentityModel, UserModel
from app.services import oauth

NONCE = "n" * 32


@pytest.fixture
def google(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", GOOGLE_CLIENT_ID)
    monkeypatch.setattr(settings, "google_client_secret", "google-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://api.test/auth/google/callback")
    fake = FakeProviders()
    real_post, real_get = httpx.post, httpx.get
    monkeypatch.setattr(httpx, "post", lambda url, *a, **k: fake.post(url, *a, **k) or real_post(url, *a, **k))
    monkeypatch.setattr(httpx, "get", lambda url, *a, **k: fake.get(url, *a, **k) or real_get(url, *a, **k))
    oauth.google_keys.clear()
    yield fake
    oauth.google_keys.clear()


def start(client, intent="login", headers=None, nonce=NONCE):
    verifier, challenge = pkce_pair()
    r = client.post("/auth/oauth/google/start", json={"nonce": nonce, "code_challenge": challenge, "intent": intent}, headers=headers or {})
    return r, verifier


def through_google(client, google, start_response):
    """The browser goes to Google, then back to our callback. Returns the fragment we hand the frontend."""
    code, _ = google.authorize(start_response.json()["url"])
    state = parse_qs(urlsplit(start_response.json()["url"]).query)["state"][0]
    r = client.get("/auth/google/callback", params={"code": code, "state": state}, follow_redirects=False)
    assert r.status_code in (302, 307)
    location = r.headers["location"]
    assert location.startswith("http://frontend.test/oauth/callback#")
    assert "?" not in location.split("#")[0]
    return {k: v[0] for k, v in parse_qs(location.split("#", 1)[1]).items()}


def complete(client, fragment, verifier, nonce=NONCE, headers=None, **overrides):
    body = {"provider": "google", "code": fragment["code"], "state": fragment["state"], "nonce": nonce, "code_verifier": verifier, **overrides}
    return client.post("/auth/oauth/complete", json=body, headers=headers or {})


def sign_in(client, google, **kwargs):
    r, verifier = start(client, **{k: v for k, v in kwargs.items() if k in ("intent", "headers")})
    assert r.status_code == 200, r.text
    fragment = through_google(client, google, r)
    return complete(client, fragment, verifier, headers=kwargs.get("headers"))


def _user(username):
    with SessionLocal() as db:
        return db.query(UserModel).filter(UserModel.username == username).first()


# ---- starting ----

def test_off_until_configured(client):
    assert client.get("/auth/options").json()["google"] is False
    r, _ = start(client)
    assert r.status_code == 503 and "isn't set up" in r.json()["detail"]


def test_options_show_google_when_configured(client, google):
    assert client.get("/auth/options").json()["google"] is True


def test_authorize_url_uses_pkce_state_and_an_id_token_nonce(client, google):
    r, verifier = start(client)
    query = {k: v[0] for k, v in parse_qs(urlsplit(r.json()["url"]).query).items()}
    assert r.json()["url"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert query["client_id"] == GOOGLE_CLIENT_ID and query["redirect_uri"] == "http://api.test/auth/google/callback"
    assert query["response_type"] == "code" and query["scope"] == "openid email profile"
    assert query["code_challenge_method"] == "S256" and len(query["code_challenge"]) == 43
    assert query["nonce"] == oauth.nonce_hash(NONCE) and NONCE not in r.json()["url"]
    assert verifier not in r.json()["url"]
    state = oauth.read_state(query["state"])
    assert state["prv"] == "google" and state["int"] == "login" and state["uid"] is None


def test_unknown_provider_is_404(client, google):
    _, challenge = pkce_pair()
    assert client.post("/auth/oauth/myspace/start", json={"nonce": NONCE, "code_challenge": challenge}).status_code == 404


@pytest.mark.parametrize("body", [
    {"nonce": "short", "code_challenge": "a" * 43},
    {"nonce": NONCE, "code_challenge": "too-short"},
    {"nonce": NONCE, "code_challenge": "a" * 43, "intent": "steal"},
])
def test_start_validates_input(client, google, body):
    assert client.post("/auth/oauth/google/start", json=body).status_code == 422


def test_linking_needs_a_signed_in_user(client, google):
    r, _ = start(client, intent="link")
    assert r.status_code == 401


# ---- callback ----

def test_callback_hands_the_code_to_the_frontend_in_the_fragment(client, google):
    r, _ = start(client)
    fragment = through_google(client, google, r)
    assert set(fragment) == {"provider", "code", "state"} and fragment["provider"] == "google"


@pytest.mark.parametrize("params,expected", [
    ({"error": "access_denied"}, "cancelled"),
    ({"code": "c", "state": "not-a-real-state"}, "failed"),
    ({"code": "c"}, "failed"),
    ({"state": "x"}, "failed"),
])
def test_callback_problems_reach_the_frontend_as_errors(client, google, params, expected):
    r = client.get("/auth/google/callback", params=params, follow_redirects=False)
    fragment = parse_qs(r.headers["location"].split("#", 1)[1])
    assert fragment["error"] == [expected] and "code" not in fragment


def test_callback_rejects_a_state_from_the_github_repo_flow(client, google):
    from app.core.security import create_oauth_state

    other = create_oauth_state(1, "x" * 64)
    r = client.get("/auth/google/callback", params={"code": "c", "state": other}, follow_redirects=False)
    assert "error=failed" in r.headers["location"]


# ---- signing in ----

def test_first_sign_in_creates_an_account(client, google):
    r = sign_in(client, google)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "created" and data["username"] == "pat"
    user = _user("pat")
    assert user.hashed_password is None
    assert (user.email, user.email_verified) == ("pat@example.com", True)
    assert client.get("/me", headers=auth(data["access_token"])).json()["username"] == "pat"
    with SessionLocal() as db:
        identity = db.query(OAuthIdentityModel).one()
        assert (identity.provider, identity.provider_user_id, identity.user_id) == ("google", "g-100", user.id)


def test_signing_in_again_is_the_same_account(client, google):
    first = sign_in(client, google).json()
    google.google_user["email"] = "changed@example.com"  # the Google account's email changed
    again = sign_in(client, google).json()
    assert again["status"] == "signed_in" and again["username"] == first["username"]
    with SessionLocal() as db:
        assert db.query(UserModel).count() == 1


def test_the_token_carries_the_session_version(client, google):
    token = sign_in(client, google).json()["access_token"]
    assert jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])["ver"] == 0


@pytest.mark.parametrize("email,name,expected", [
    ("Mary.Jane+tag@example.com", None, "mary_jane_tag"),
    (None, "Zoë O'Neil", "zo_o_neil"),
    ("ab@example.com", None, "ab_google"),
    ("x" * 40 + "@example.com", None, "x" * 24),
    (None, None, "google"),
])
def test_generated_usernames_follow_the_sign_up_rules(client, google, email, name, expected):
    google.google_user.update({"email": email, "name": name, "email_verified": email is not None})
    assert sign_in(client, google).json()["username"] == expected


def test_a_taken_username_gets_a_number(client, google, make_user):
    make_user("pat")
    username = sign_in(client, google).json()["username"]
    assert username.startswith("pat_") and len(username) == 9 and username[4:].isdigit()


def test_unverified_google_email_is_not_used(client, google, make_user):
    google.google_user["email_verified"] = False
    data = sign_in(client, google).json()
    assert data["status"] == "created"
    assert _user(data["username"]).email is None


# ---- linking rules: never join automatically ----

def _owner_with_verified_email(make_user, username="owner", email="pat@example.com"):
    token = make_user(username)
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == username).update({"email": email, "email_verified": True})
        db.commit()
    return token


def test_a_matching_verified_email_asks_for_the_password_instead_of_joining(client, google, make_user):
    _owner_with_verified_email(make_user)
    data = sign_in(client, google).json()
    assert data["status"] == "link_required" and data["username"] == "owner"
    assert data["access_token"] is None and data["link_token"]
    with SessionLocal() as db:
        assert db.query(OAuthIdentityModel).count() == 0
        assert db.query(UserModel).count() == 1


def test_linking_with_the_right_password_joins_and_signs_in(client, google, make_user):
    _owner_with_verified_email(make_user)
    link_token = sign_in(client, google).json()["link_token"]
    assert client.post("/auth/oauth/link", json={"link_token": link_token, "password": "wrong-one"}).status_code == 400
    r = client.post("/auth/oauth/link", json={"link_token": link_token, "password": DEFAULT_PASSWORD})
    assert r.status_code == 200 and r.json()["status"] == "linked" and r.json()["username"] == "owner"
    # From now on Google signs in to that account directly
    assert sign_in(client, google).json() | {"access_token": None} == {
        "status": "signed_in", "username": "owner", "access_token": None, "token_type": "bearer", "provider": None, "link_token": None,
    }


def test_an_unverified_matching_email_never_links(client, google, make_user):
    make_user("squatter")
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == "squatter").update({"email": "pat@example.com", "email_verified": False})
        db.commit()
    data = sign_in(client, google).json()
    assert data["status"] == "created" and data["username"] != "squatter"
    assert _user(data["username"]).email is None  # the address stays with its current account
    with SessionLocal() as db:
        identity = db.query(OAuthIdentityModel).one()
        assert identity.user_id == _user(data["username"]).id


def test_a_link_token_cannot_be_forged_or_reused_after_expiry(client, google, make_user, monkeypatch):
    _owner_with_verified_email(make_user)
    link_token = sign_in(client, google).json()["link_token"]
    assert client.post("/auth/oauth/link", json={"link_token": link_token[:-4] + "AAAA", "password": DEFAULT_PASSWORD}).status_code == 400
    from app.routers import oauth as oauth_router

    monkeypatch.setattr(oauth_router, "LINK_TOKEN_SECONDS", -1)
    r = client.post("/auth/oauth/link", json={"link_token": link_token, "password": DEFAULT_PASSWORD})
    assert r.status_code == 400 and "expired" in r.json()["detail"]


def test_a_link_token_dies_if_the_account_changed_its_email(client, google, make_user):
    token = _owner_with_verified_email(make_user)
    link_token = sign_in(client, google).json()["link_token"]
    client.put("/me/email", json={"email": "elsewhere@example.com", "current_password": DEFAULT_PASSWORD}, headers=auth(token))
    assert client.post("/auth/oauth/link", json={"link_token": link_token, "password": DEFAULT_PASSWORD}).status_code == 400


def test_link_with_password_is_rate_limited(client, google, make_user, rate_limits):
    _owner_with_verified_email(make_user)
    link_token = sign_in(client, google).json()["link_token"]
    codes = [client.post("/auth/oauth/link", json={"link_token": link_token, "password": "guess"}).status_code for _ in range(6)]
    assert codes == [400] * 5 + [429]


# ---- linking from Settings, with a session ----

def test_a_signed_in_user_can_link_google(client, google, make_user):
    token = make_user("alice")
    r = sign_in(client, google, intent="link", headers=auth(token))
    assert r.status_code == 200 and r.json()["status"] == "linked"
    assert sign_in(client, google).json()["username"] == "alice"


def test_a_link_started_by_one_user_cannot_be_finished_by_another(client, google, make_user):
    alice, bob = make_user("alice"), make_user("bob")
    r, verifier = start(client, intent="link", headers=auth(alice))
    fragment = through_google(client, google, r)
    for headers in (auth(bob), {}):
        r2 = complete(client, fragment, verifier, headers=headers)
        assert r2.status_code == 400
    with SessionLocal() as db:
        assert db.query(OAuthIdentityModel).count() == 0


def test_a_google_account_cannot_be_linked_to_two_accounts(client, google, make_user):
    alice, bob = make_user("alice"), make_user("bob")
    sign_in(client, google, intent="link", headers=auth(alice))
    r = sign_in(client, google, intent="link", headers=auth(bob))
    assert r.status_code == 409 and "another NexusCode account" in r.json()["detail"]


def test_one_google_account_per_user(client, google, make_user):
    alice = make_user("alice")
    sign_in(client, google, intent="link", headers=auth(alice))
    google.google_user["sub"] = "g-200"
    r = sign_in(client, google, intent="link", headers=auth(alice))
    assert r.status_code == 409 and "Unlink" in r.json()["detail"]


def test_linking_the_same_account_twice_is_fine(client, google, make_user):
    alice = make_user("alice")
    sign_in(client, google, intent="link", headers=auth(alice))
    assert sign_in(client, google, intent="link", headers=auth(alice)).json()["status"] == "linked"


# ---- state and PKCE tampering ----

def test_wrong_nonce_is_refused(client, google):
    r, verifier = start(client)
    fragment = through_google(client, google, r)
    assert complete(client, fragment, verifier, nonce="z" * 32).status_code == 400


def test_wrong_pkce_verifier_is_refused_by_the_provider(client, google):
    r, _verifier = start(client)
    fragment = through_google(client, google, r)
    other_verifier, _ = pkce_pair()
    r2 = complete(client, fragment, other_verifier)
    assert r2.status_code == 400
    assert google.token_requests[-1]["data"]["code_verifier"] == other_verifier


def test_the_verifier_reaches_the_token_request(client, google):
    r, verifier = start(client)
    complete(client, through_google(client, google, r), verifier)
    sent = google.token_requests[-1]["data"]
    assert sent["code_verifier"] == verifier and sent["client_secret"] == "google-secret"
    assert sent["redirect_uri"] == "http://api.test/auth/google/callback"


def test_a_code_works_once(client, google):
    r, verifier = start(client)
    fragment = through_google(client, google, r)
    assert complete(client, fragment, verifier).status_code == 200
    assert complete(client, fragment, verifier).status_code == 400


def test_a_tampered_state_is_refused(client, google):
    r, verifier = start(client)
    fragment = through_google(client, google, r)
    payload = jwt.decode(fragment["state"], SECRET_KEY, algorithms=[ALGORITHM])
    forged = jwt.encode({**payload, "int": "link", "uid": 1}, "not-our-secret-" * 4, algorithm=ALGORITHM)
    assert complete(client, fragment, verifier, state=forged).status_code == 400


def test_an_expired_state_is_refused(client, google):
    r, verifier = start(client)
    fragment = through_google(client, google, r)
    payload = jwt.decode(fragment["state"], SECRET_KEY, algorithms=[ALGORITHM])
    expired = jwt.encode({**payload, "exp": datetime.now(UTC) - timedelta(seconds=1)}, SECRET_KEY, algorithm=ALGORITHM)
    assert complete(client, fragment, verifier, state=expired).status_code == 400


def test_a_login_token_is_not_a_state(client, google, make_user):
    r, verifier = start(client)
    fragment = through_google(client, google, r)
    assert complete(client, fragment, verifier, state=make_user("alice")).status_code == 400


@pytest.mark.parametrize("verifier", ["short", "x" * 129, "has spaces " * 5])
def test_malformed_verifiers_are_422(client, google, verifier):
    r, _ = start(client)
    fragment = through_google(client, google, r)
    assert complete(client, fragment, verifier).status_code == 422


# ---- ID token verification ----

@pytest.mark.parametrize("change", [
    {"id_token_claims": {"aud": "someone-elses-client"}},
    {"id_token_claims": {"iss": "https://evil.test"}},
    {"id_token_claims": {"exp": int(datetime.now(UTC).timestamp()) - 3600}},
    {"id_token_claims": {"iat": None}},
    {"id_token_claims": {"nonce": "replayed-from-another-sign-in"}},
    {"id_token_key": OTHER_KEY},
    {"id_token_kid": "unknown-kid"},
    {"id_token_alg": "none"},
])
def test_bad_id_tokens_are_refused(client, google, change):
    for key, value in change.items():
        setattr(google, key, value)
    r = sign_in(client, google)
    assert r.status_code == 400, r.text
    with SessionLocal() as db:
        assert db.query(UserModel).count() == 0


def test_an_hs256_token_signed_with_the_public_key_is_refused(client, google):
    """The classic algorithm confusion attack: HMAC keyed with Google's public key."""
    import base64
    import hashlib
    import hmac as hmac_lib

    from cryptography.hazmat.primitives import serialization
    from oauth_fakes import GOOGLE_KEY, GOOGLE_KID

    def b64(data):
        return base64.urlsafe_b64encode(data).rstrip(b"=")

    public_pem = GOOGLE_KEY.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    r, verifier = start(client)
    fragment = through_google(client, google, r)
    real = google._id_token(oauth.nonce_hash(NONCE))
    claims = jwt.decode(real, options={"verify_signature": False})
    signing_input = b64(json.dumps({"alg": "HS256", "kid": GOOGLE_KID}).encode()) + b"." + b64(json.dumps(claims).encode())
    forged = (signing_input + b"." + b64(hmac_lib.new(public_pem, signing_input, hashlib.sha256).digest())).decode()
    with pytest.raises(oauth.OAuthError):
        oauth.verify_google_id_token(forged, oauth.nonce_hash(NONCE))
    assert complete(client, fragment, verifier).status_code == 200  # the honest token still works


def test_issuer_without_https_is_accepted_as_google_documents(client, google):
    google.id_token_claims = {"iss": "accounts.google.com"}
    assert sign_in(client, google).status_code == 200


def test_keys_are_cached(client, google):
    sign_in(client, google)
    google.google_user["sub"] = "g-2"
    google.google_user["email"] = "other@example.com"
    sign_in(client, google)
    assert google.jwks_fetches == 1


def test_provider_outage_is_a_clear_error(client, google):
    r, verifier = start(client)
    fragment = through_google(client, google, r)
    google.down = True
    r2 = complete(client, fragment, verifier)
    assert r2.status_code == 400 and "couldn't be reached" in r2.json()["detail"]


# ---- accounts without a password ----

def test_password_login_never_works_for_a_google_only_account(client, google):
    username = sign_in(client, google).json()["username"]
    for password in ("", "anything", "None"):
        assert client.post("/login", data={"username": username, "password": password}).status_code in (401, 422)


def test_google_only_accounts_must_set_a_password_before_changing_or_deleting(client, google):
    token = sign_in(client, google).json()["access_token"]
    r = client.post("/me/password", json={"current_password": "x", "new_password": "a-new-password"}, headers=auth(token))
    assert r.status_code == 400 and "Set one in Settings" in r.json()["detail"]
    r = client.post("/me/delete", json={"password": "x"}, headers=auth(token))
    assert r.status_code == 400 and "Set one in Settings" in r.json()["detail"]


def test_google_only_accounts_can_change_email_without_a_password(client, google):
    token = sign_in(client, google).json()["access_token"]
    r = client.put("/me/email", json={"email": "new@example.com"}, headers=auth(token))
    assert r.status_code == 200 and r.json()["has_password"] is False


def test_deleting_an_account_removes_its_identities(client, google, make_user):
    alice = make_user("alice")
    sign_in(client, google, intent="link", headers=auth(alice))
    client.post("/me/delete", json={"password": DEFAULT_PASSWORD}, headers=auth(alice))
    with SessionLocal() as db:
        assert db.query(OAuthIdentityModel).count() == 0


def test_rate_limited(client, google, rate_limits):
    codes = [start(client)[0].status_code for _ in range(21)]
    assert codes[-1] == 429 and codes[:20] == [200] * 20


def test_responses_never_include_provider_tokens(client, google):
    r = sign_in(client, google)
    assert "ya29" not in r.text and "id_token" not in r.text
    assert json.dumps(r.json())
