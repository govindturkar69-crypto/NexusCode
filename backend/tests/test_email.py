"""Email addresses on accounts, and the email service. Only Resend's HTTP API is faked."""
import pytest
from conftest import DEFAULT_PASSWORD, auth

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import UserModel
from app.services import email as email_service


def _set(client, token, email, password=DEFAULT_PASSWORD):
    body = {"email": email}
    if password is not None:
        body["current_password"] = password
    return client.put("/me/email", json=body, headers=auth(token))


# ---- addresses ----

def test_existing_users_start_without_an_email(client, make_user):
    data = client.get("/me/email", headers=auth(make_user("alice"))).json()
    assert data["email"] is None and data["email_verified"] is False and data["has_password"] is True


def test_add_an_email_lowercased_and_unverified(client, make_user):
    token = make_user("alice")
    r = _set(client, token, "  Alice@Example.COM ")
    assert r.status_code == 200, r.text
    assert (r.json()["email"], r.json()["email_verified"]) == ("alice@example.com", False)


def test_changing_the_email_needs_the_password(client, make_user):
    token = make_user("alice")
    assert _set(client, token, "a@example.com", "wrong-password").status_code == 400
    assert _set(client, token, "a@example.com", None).status_code == 400
    assert client.get("/me/email", headers=auth(token)).json()["email"] is None


def test_an_email_belongs_to_one_account_whatever_the_case(client, make_user):
    alice, bob = make_user("alice"), make_user("bob")
    assert _set(client, alice, "shared@example.com").status_code == 200
    r = _set(client, bob, "SHARED@example.com")
    assert r.status_code == 409 and "another account" in r.json()["detail"]


def test_changing_the_email_marks_it_unverified(client, make_user):
    token = make_user("alice")
    _set(client, token, "a@example.com")
    with SessionLocal() as db:
        db.query(UserModel).filter(UserModel.username == "alice").update({"email_verified": True})
        db.commit()
    _set(client, token, "A@example.com")  # same address: no change
    assert client.get("/me/email", headers=auth(token)).json()["email_verified"] is True
    _set(client, token, "b@example.com")
    assert client.get("/me/email", headers=auth(token)).json()["email_verified"] is False


@pytest.mark.parametrize("email", ["", "plain", "a@b", "a b@example.com", "@example.com", "a@", "a@@example.com", "x" * 65 + "@example.com", "a@" + "b" * 250 + ".com"])
def test_invalid_addresses_are_refused(client, make_user, email):
    assert _set(client, make_user("alice"), email).status_code == 422


def test_lowercase_is_enforced_by_the_database_too(client, make_user):
    make_user("alice")
    with SessionLocal() as db, pytest.raises(Exception, match="(?i)check|constraint"):
        db.query(UserModel).filter(UserModel.username == "alice").update({"email": "Mixed@Example.com"})
        db.commit()


def test_needs_login(client):
    assert client.get("/me/email").status_code == 401
    assert client.put("/me/email", json={"email": "a@example.com"}).status_code == 401
    assert client.post("/me/email/test").status_code == 401


# ---- the service ----

def test_off_without_keys(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", None)
    token = make_user("alice")
    sending = client.get("/me/email", headers=auth(token)).json()["sending"]
    assert sending["enabled"] is False and "isn't set up" in sending["message"]
    assert client.get("/auth/options").json() == {"email": False, "google": False, "github": False}
    _set(client, token, "a@example.com")
    r = client.post("/me/email/test", headers=auth(token))
    assert r.status_code == 503 and "isn't set up" in r.json()["detail"]


def test_sends_through_resend(client, make_user, fake_resend):
    token = make_user("alice")
    _set(client, token, "a@example.com")
    r = client.post("/me/email/test", headers=auth(token))
    assert r.status_code == 200, r.text
    sent = fake_resend["sent"][0]
    assert sent["json"]["to"] == ["a@example.com"]
    assert sent["json"]["from"] == "NexusCode Test <mail@nexus.test>"
    assert sent["headers"]["Authorization"] == "Bearer re_test_key"
    assert client.get("/auth/options").json()["email"] is True


def test_test_email_needs_an_address(client, make_user, fake_resend):
    r = client.post("/me/email/test", headers=auth(make_user("alice")))
    assert r.status_code == 409
    assert fake_resend["sent"] == []


def test_restriction_is_reported_not_silent(client, make_user, fake_resend, caplog):
    fake_resend["status"] = 403
    fake_resend["body"] = {"statusCode": 403, "name": "validation_error", "message": "You can only send testing emails to your own email address (owner@x.test). To send emails to other recipients, please verify a domain at resend.com/domains."}
    token = make_user("alice")
    _set(client, token, "a@example.com")
    before = client.get("/me/email", headers=auth(token)).json()["sending"]
    assert before["restricted"] is False
    r = client.post("/me/email/test", headers=auth(token))
    assert r.status_code == 400 and "account owner" in r.json()["detail"]
    after = client.get("/me/email", headers=auth(token)).json()["sending"]
    assert after["restricted"] is True and "verify" in after["message"].lower()
    assert any("restricted" in record.getMessage() or "refused" in record.getMessage() for record in caplog.records)


def test_the_resend_test_sender_is_known_to_be_restricted(client, make_user, fake_resend, monkeypatch):
    monkeypatch.setattr(settings, "mail_from_email", "onboarding@resend.dev")
    sending = client.get("/me/email", headers=auth(make_user("alice"))).json()["sending"]
    assert sending["enabled"] is True and sending["restricted"] is True


@pytest.mark.parametrize("status_code,expected,text", [(401, 502, "key"), (403, 502, "key"), (429, 502, "Too many"), (500, 502, "couldn't be sent")])
def test_provider_errors_are_explained(client, make_user, fake_resend, status_code, expected, text):
    fake_resend["status"] = status_code
    fake_resend["body"] = {"message": "nope"}
    token = make_user("alice")
    _set(client, token, "a@example.com")
    r = client.post("/me/email/test", headers=auth(token))
    assert r.status_code == expected and text in r.json()["detail"]
    assert "re_test_key" not in r.text


def test_unreachable_provider(client, make_user, fake_resend):
    import httpx

    fake_resend["error"] = httpx.ConnectError("down")
    token = make_user("alice")
    _set(client, token, "a@example.com")
    assert client.post("/me/email/test", headers=auth(token)).status_code == 502


def test_test_email_is_rate_limited(client, make_user, fake_resend, rate_limits):
    token = make_user("alice")
    _set(client, token, "a@example.com")
    codes = [client.post("/me/email/test", headers=auth(token)).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


def test_startup_logs_say_how_email_behaves(caplog, monkeypatch):
    import logging

    caplog.set_level(logging.INFO, logger="nexuscode")
    monkeypatch.setattr(settings, "resend_api_key", None)
    email_service.log_configuration()
    monkeypatch.setattr(settings, "resend_api_key", "re_x")
    monkeypatch.setattr(settings, "mail_from_email", "onboarding@resend.dev")
    email_service.log_configuration()
    messages = [r.getMessage() for r in caplog.records]
    assert any("Email is off" in m for m in messages)
    assert any("restricted" in m for m in messages)
