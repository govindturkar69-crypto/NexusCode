"""Password reset, email verification and session invalidation."""
import time
from datetime import UTC, datetime, timedelta

import pytest
from conftest import DEFAULT_PASSWORD, auth

from app.core.database import SessionLocal
from app.models import AuthTokenModel, UserModel
from app.services import auth_tokens

NEW_PASSWORD = "a-brand-new-password"


def _user(username):
    with SessionLocal() as db:
        return db.query(UserModel).filter(UserModel.username == username).one()


def _verified_email(username, email):
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == username).update({"email": email, "email_verified": True})
        db.commit()


def _link_token(fake_resend, path):
    """The raw token from the last email sent, as a user would click it."""
    text = fake_resend["sent"][-1]["json"]["text"]
    marker = f"/{path}#token="
    return text.split(marker, 1)[1].split()[0]


def _aware(moment):
    """SQLite returns naive UTC timestamps, Postgres timezone-aware ones."""
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _login(client, username, password):
    return client.post("/login", data={"username": username, "password": password})


@pytest.fixture
def alice(client, make_user, fake_resend):
    token = make_user("alice")
    _verified_email("alice", "alice@example.com")
    return token


def _request(client, email):
    return client.post("/auth/password-reset/request", json={"email": email})


# ---- requesting ----

def test_request_sends_a_link_to_the_verified_address(client, alice, fake_resend):
    r = _request(client, "Alice@Example.com")
    assert r.status_code == 202
    sent = fake_resend["sent"][-1]["json"]
    assert sent["to"] == ["alice@example.com"]
    assert "http://frontend.test/reset-password#token=" in sent["text"]
    assert "username: alice" in sent["text"]


def test_no_user_enumeration(client, alice, fake_resend):
    known = _request(client, "alice@example.com")
    unknown = _request(client, "nobody@example.com")
    assert (known.status_code, known.json()) == (unknown.status_code, unknown.json())
    assert len(fake_resend["sent"]) == 1


def test_unverified_addresses_get_nothing_and_look_the_same(client, make_user, fake_resend):
    make_user("bob")
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == "bob").update({"email": "bob@example.com"})
        db.commit()
    r = _request(client, "bob@example.com")
    assert r.status_code == 202 and fake_resend["sent"] == []


def test_send_failures_look_the_same_too(client, alice, fake_resend):
    fake_resend["status"] = 500
    fake_resend["body"] = {"message": "down"}
    r = _request(client, "alice@example.com")
    assert r.status_code == 202 and r.json() == _request(client, "nobody@example.com").json()


def test_response_does_not_wait_for_the_email(client, alice, fake_resend, monkeypatch):
    """The work happens after the response, so its timing can't reveal an account."""
    from app.routers import password

    calls = []
    monkeypatch.setattr(password, "_send_reset_email", lambda email: calls.append(email))
    r = _request(client, "alice@example.com")
    assert r.status_code == 202 and calls == ["alice@example.com"]


def test_off_without_email(client, make_user):
    r = _request(client, "a@example.com")
    assert r.status_code == 503 and "isn't available" in r.json()["detail"]


@pytest.mark.parametrize("email", ["", "nope", "a@b"])
def test_invalid_email_is_422(client, email):
    assert _request(client, email).status_code == 422


def test_request_is_rate_limited(client, alice, fake_resend, rate_limits):
    codes = [_request(client, f"x{i}@example.com").status_code for i in range(6)]
    assert codes == [202] * 5 + [429]


# ---- confirming ----

def _confirm(client, token, password=NEW_PASSWORD):
    return client.post("/auth/password-reset/confirm", json={"token": token, "new_password": password})


def test_reset_changes_the_password(client, alice, fake_resend):
    _request(client, "alice@example.com")
    r = _confirm(client, _link_token(fake_resend, "reset-password"))
    assert r.status_code == 200, r.text
    assert _login(client, "alice", NEW_PASSWORD).status_code == 200
    assert _login(client, "alice", DEFAULT_PASSWORD).status_code == 401


def test_a_token_works_once(client, alice, fake_resend):
    _request(client, "alice@example.com")
    raw = _link_token(fake_resend, "reset-password")
    assert _confirm(client, raw).status_code == 200
    r = _confirm(client, raw, "yet-another-password")
    assert r.status_code == 400 and "already been used" in r.json()["detail"]
    assert _login(client, "alice", NEW_PASSWORD).status_code == 200


def test_tokens_expire_after_30_minutes(client, alice, fake_resend):
    _request(client, "alice@example.com")
    raw = _link_token(fake_resend, "reset-password")
    with SessionLocal() as db:
        token = db.query(AuthTokenModel).one()
        assert timedelta(minutes=29) < (_aware(token.expires_at) - datetime.now(UTC)) <= timedelta(minutes=30)
        token.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert _confirm(client, raw).status_code == 400
    assert _login(client, "alice", DEFAULT_PASSWORD).status_code == 200


def test_a_new_request_cancels_the_old_link(client, alice, fake_resend):
    _request(client, "alice@example.com")
    first = _link_token(fake_resend, "reset-password")
    _request(client, "alice@example.com")
    second = _link_token(fake_resend, "reset-password")
    assert _confirm(client, first).status_code == 400
    assert _confirm(client, second).status_code == 200


def test_only_a_hash_is_stored(client, alice, fake_resend):
    _request(client, "alice@example.com")
    raw = _link_token(fake_resend, "reset-password")
    with SessionLocal() as db:
        stored = db.query(AuthTokenModel).one().token_hash
    assert raw not in stored and len(stored) == 64 and len(raw) >= 40


@pytest.mark.parametrize("token", ["", "made-up-token", "x" * 500])
def test_made_up_tokens_fail(client, alice, token):
    assert _confirm(client, token).status_code in (400, 422)


def test_a_verification_token_cannot_reset_a_password(client, make_user, fake_resend):
    token = make_user("carol")
    client.put("/me/email", json={"email": "c@example.com", "current_password": DEFAULT_PASSWORD}, headers=auth(token))
    client.post("/me/email/verification", headers=auth(token))
    assert _confirm(client, _link_token(fake_resend, "verify-email")).status_code == 400


def test_new_password_rules_apply(client, alice, fake_resend):
    _request(client, "alice@example.com")
    assert _confirm(client, _link_token(fake_resend, "reset-password"), "short").status_code == 422


def test_confirm_is_rate_limited(client, rate_limits):
    codes = [_confirm(client, f"guess-{i}").status_code for i in range(11)]
    assert codes == [400] * 10 + [429]


# ---- sessions end ----

def test_reset_ends_every_existing_session(client, alice, fake_resend):
    assert client.get("/me", headers=auth(alice)).status_code == 200
    _request(client, "alice@example.com")
    _confirm(client, _link_token(fake_resend, "reset-password"))
    r = client.get("/me", headers=auth(alice))
    assert r.status_code == 401 and "session has ended" in r.json()["detail"]
    fresh = _login(client, "alice", NEW_PASSWORD).json()["access_token"]
    assert client.get("/me", headers=auth(fresh)).status_code == 200


def test_tokens_from_before_versions_still_work(client, make_user):
    """Tokens issued before the deploy carry no version and count as 0."""
    import jwt

    from app.core.security import ALGORITHM, SECRET_KEY

    make_user("dave")
    old_style = jwt.encode({"sub": "dave", "exp": datetime.now(UTC) + timedelta(minutes=5)}, SECRET_KEY, algorithm=ALGORITHM)
    assert client.get("/me", headers=auth(old_style)).status_code == 200
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == "dave").update({"token_version": 1})
        db.commit()
    assert client.get("/me", headers=auth(old_style)).status_code == 401


def test_a_forged_version_does_not_help(client, make_user):
    import jwt

    from app.core.security import ALGORITHM

    make_user("erin")
    forged = jwt.encode({"sub": "erin", "ver": 0, "exp": datetime.now(UTC) + timedelta(minutes=5)}, "wrong-secret-" * 4, algorithm=ALGORITHM)
    assert client.get("/me", headers=auth(forged)).status_code == 401


def test_changing_the_password_ends_other_sessions_but_not_this_one(client, make_user):
    first = make_user("frank")
    second = _login(client, "frank", DEFAULT_PASSWORD).json()["access_token"]
    r = client.post("/me/password", json={"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD}, headers=auth(first))
    assert r.status_code == 200
    replacement = r.json()["access_token"]
    assert client.get("/me", headers=auth(first)).status_code == 401
    assert client.get("/me", headers=auth(second)).status_code == 401
    assert client.get("/me", headers=auth(replacement)).status_code == 200


def test_sign_out_everywhere_else(client, make_user):
    here = make_user("gina")
    there = _login(client, "gina", DEFAULT_PASSWORD).json()["access_token"]
    r = client.post("/me/sessions/revoke", headers=auth(here))
    assert r.status_code == 200
    assert client.get("/me", headers=auth(there)).status_code == 401
    assert client.get("/me", headers=auth(here)).status_code == 401
    assert client.get("/me", headers=auth(r.json()["access_token"])).status_code == 200
    assert client.post("/me/sessions/revoke").status_code == 401


def test_ended_sessions_cannot_open_sockets(client, make_user):
    token = make_user("hana")
    client.post("/me/sessions/revoke", headers=auth(token))
    assert client.post("/ws-ticket", json={"project_id": 1}, headers=auth(token)).status_code == 401


# ---- email verification ----

def _add_email(client, token, email):
    return client.put("/me/email", json={"email": email, "current_password": DEFAULT_PASSWORD}, headers=auth(token))


def test_verify_an_email_from_settings(client, make_user, fake_resend):
    token = make_user("ivan")
    _add_email(client, token, "ivan@example.com")
    r = client.post("/me/email/verification", headers=auth(token))
    assert r.status_code == 200 and "24 hours" in r.json()["message"]
    assert fake_resend["sent"][-1]["json"]["to"] == ["ivan@example.com"]
    raw = _link_token(fake_resend, "verify-email")
    # No login needed: the link may be opened elsewhere
    assert client.post("/auth/verify-email", json={"token": raw}).status_code == 200
    assert client.get("/me/email", headers=auth(token)).json()["email_verified"] is True
    assert client.post("/auth/verify-email", json={"token": raw}).status_code == 400


def test_a_link_for_an_old_address_does_not_verify_the_new_one(client, make_user, fake_resend):
    token = make_user("joe")
    _add_email(client, token, "old@example.com")
    client.post("/me/email/verification", headers=auth(token))
    raw = _link_token(fake_resend, "verify-email")
    _add_email(client, token, "new@example.com")
    r = client.post("/auth/verify-email", json={"token": raw})
    assert r.status_code == 400 and "no longer uses" in r.json()["detail"]
    assert client.get("/me/email", headers=auth(token)).json()["email_verified"] is False


def test_verification_tokens_last_24_hours(client, make_user, fake_resend):
    token = make_user("kim")
    _add_email(client, token, "k@example.com")
    client.post("/me/email/verification", headers=auth(token))
    with SessionLocal() as db:
        expires = _aware(db.query(AuthTokenModel).one().expires_at)
    assert timedelta(hours=23) < expires - datetime.now(UTC) <= timedelta(hours=24)


@pytest.mark.parametrize("setup,code", [("none", 409), ("verified", 409)])
def test_resend_refuses_when_there_is_nothing_to_verify(client, make_user, fake_resend, setup, code):
    token = make_user("lee")
    if setup == "verified":
        _verified_email("lee", "lee@example.com")
    assert client.post("/me/email/verification", headers=auth(token)).status_code == code


def test_resend_reports_restriction(client, make_user, fake_resend):
    fake_resend["status"] = 403
    fake_resend["body"] = {"message": "You can only send testing emails to your own email address. Please verify a domain."}
    token = make_user("moe")
    _add_email(client, token, "moe@example.com")
    r = client.post("/me/email/verification", headers=auth(token))
    assert r.status_code == 400 and "account owner" in r.json()["detail"]


def test_a_reset_link_also_proves_the_address(client, alice, fake_resend):
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == "alice").update({"email_verified": True})
        db.commit()
    _request(client, "alice@example.com")
    _confirm(client, _link_token(fake_resend, "reset-password"))
    assert _user("alice").email_verified is True


# ---- sign-up with an email ----

def test_sign_up_with_an_email_sends_a_verification_link(client, fake_resend):
    r = client.post("/signup", json={"username": "newbie", "password": DEFAULT_PASSWORD, "email": "New@Example.com"})
    assert r.status_code == 201, r.text
    assert _user("newbie").email == "new@example.com" and _user("newbie").email_verified is False
    assert fake_resend["sent"][-1]["json"]["to"] == ["new@example.com"]
    assert "/verify-email#token=" in fake_resend["sent"][-1]["json"]["text"]


def test_sign_up_without_an_email_still_works(client):
    assert client.post("/signup", json={"username": "plain", "password": DEFAULT_PASSWORD}).status_code == 201
    assert _user("plain").email is None


def test_sign_up_with_a_taken_email_is_refused(client, make_user):
    client.post("/signup", json={"username": "first", "password": DEFAULT_PASSWORD, "email": "same@example.com"})
    r = client.post("/signup", json={"username": "second", "password": DEFAULT_PASSWORD, "email": "SAME@example.com"})
    assert r.status_code == 409
    with SessionLocal() as db:
        assert db.query(UserModel).filter(UserModel.username == "second").count() == 0


def test_sign_up_works_when_email_is_off(client):
    r = client.post("/signup", json={"username": "offline", "password": DEFAULT_PASSWORD, "email": "o@example.com"})
    assert r.status_code == 201


def test_sign_up_works_when_sending_fails(client, fake_resend):
    fake_resend["status"] = 500
    fake_resend["body"] = {"message": "down"}
    r = client.post("/signup", json={"username": "unlucky", "password": DEFAULT_PASSWORD, "email": "u@example.com"})
    assert r.status_code == 201


# ---- the token service directly ----

def test_consume_rejects_wrong_purpose_and_used_tokens(client, make_user):
    make_user("nina")
    with SessionLocal() as db:
        user = db.query(UserModel).filter(UserModel.username == "nina").one()
        raw = auth_tokens.issue(db, user, auth_tokens.PASSWORD_RESET)
        db.commit()
        assert auth_tokens.consume(db, raw, auth_tokens.VERIFY_EMAIL) is None
        assert auth_tokens.consume(db, raw, auth_tokens.PASSWORD_RESET) is not None
        db.commit()
        assert auth_tokens.consume(db, raw, auth_tokens.PASSWORD_RESET) is None


def test_tokens_are_long_and_random(client, make_user):
    make_user("olga")
    with SessionLocal() as db:
        user = db.query(UserModel).filter(UserModel.username == "olga").one()
        tokens = {auth_tokens.issue(db, user, auth_tokens.VERIFY_EMAIL) for _ in range(20)}
        db.rollback()
    assert len(tokens) == 20 and all(len(t) >= 40 for t in tokens)
    time.sleep(0)
