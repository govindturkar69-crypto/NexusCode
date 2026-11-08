"""Linked sign-in methods in Settings: listing, unlinking, and setting a first password."""
from conftest import DEFAULT_PASSWORD, auth

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import session_token_for
from app.models import OAuthIdentityModel, UserModel


def _user(username):
    with SessionLocal() as db:
        return db.query(UserModel).filter(UserModel.username == username).first()


def _link(username, *providers):
    with SessionLocal() as db:
        user = db.query(UserModel).filter(UserModel.username == username).one()
        for provider in providers:
            db.add(OAuthIdentityModel(user_id=user.id, provider=provider, provider_user_id=f"{provider}-{user.id}", email=f"{username}@{provider}.test"))
        db.commit()


def _oauth_only(username):
    """An account made with a provider: no password."""
    with SessionLocal() as db:
        user = UserModel(username=username, hashed_password=None)
        db.add(user)
        db.commit()
        db.refresh(user)
        return session_token_for(user)


def _providers(username):
    with SessionLocal() as db:
        user_id = db.query(UserModel.id).filter(UserModel.username == username).scalar()
        return sorted(p for (p,) in db.query(OAuthIdentityModel.provider).filter(OAuthIdentityModel.user_id == user_id))


def test_lists_methods_and_what_the_server_offers(client, make_user, monkeypatch):
    token = make_user("alice")
    _link("alice", "github")
    monkeypatch.setattr(settings, "google_client_id", "g")
    monkeypatch.setattr(settings, "google_client_secret", "g")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://api.test/auth/google/callback")
    data = client.get("/me/sign-in-methods", headers=auth(token)).json()
    assert data["has_password"] is True
    assert [(i["provider"], i["email"]) for i in data["identities"]] == [("github", "alice@github.test")]
    assert data["identities"][0]["linked_at"]
    assert data["available"] == {"google": True, "github": False}


def test_only_your_own_methods_are_listed(client, make_user):
    alice = make_user("alice")
    make_user("bob")
    _link("bob", "google")
    assert client.get("/me/sign-in-methods", headers=auth(alice)).json()["identities"] == []


def test_needs_sign_in(client):
    assert client.get("/me/sign-in-methods").status_code == 401
    assert client.delete("/me/identities/google").status_code == 401
    assert client.post("/me/password/set", json={"new_password": "a-new-password"}).status_code == 401


def test_unlink_with_a_password_left(client, make_user):
    token = make_user("alice")
    _link("alice", "google")
    assert client.delete("/me/identities/google", headers=auth(token)).status_code == 204
    assert _providers("alice") == []
    # Password sign-in still works
    assert client.post("/login", data={"username": "alice", "password": DEFAULT_PASSWORD}).status_code == 200


def test_cannot_unlink_the_last_way_in(client):
    token = _oauth_only("gina")
    _link("gina", "google")
    r = client.delete("/me/identities/google", headers=auth(token))
    assert r.status_code == 400 and "only way into this account" in r.json()["detail"]
    assert _providers("gina") == ["google"]


def test_can_unlink_one_of_two_providers_without_a_password(client):
    token = _oauth_only("gina")
    _link("gina", "google", "github")
    assert client.delete("/me/identities/github", headers=auth(token)).status_code == 204
    # ...but then not the other
    assert client.delete("/me/identities/google", headers=auth(token)).status_code == 400
    assert _providers("gina") == ["google"]


def test_setting_a_password_allows_unlinking(client):
    token = _oauth_only("gina")
    _link("gina", "google")
    r = client.post("/me/password/set", json={"new_password": "gina-password-1"}, headers=auth(token))
    assert r.status_code == 200
    assert client.delete("/me/identities/google", headers=auth(token)).status_code == 204
    assert client.post("/login", data={"username": "gina", "password": "gina-password-1"}).status_code == 200


def test_unlinking_something_not_linked_is_404(client, make_user):
    token = make_user("alice")
    _link("alice", "google")
    assert client.delete("/me/identities/github", headers=auth(token)).status_code == 404
    assert client.delete("/me/identities/myspace", headers=auth(token)).status_code == 404


def test_cannot_unlink_someone_elses(client, make_user):
    alice = make_user("alice")
    make_user("bob")
    _link("bob", "google")
    assert client.delete("/me/identities/google", headers=auth(alice)).status_code == 404
    assert _providers("bob") == ["google"]


def test_set_password_only_when_there_is_none(client, make_user):
    token = make_user("alice")
    r = client.post("/me/password/set", json={"new_password": "replaced-password"}, headers=auth(token))
    assert r.status_code == 409
    # The old password still works: set can't be used to bypass the current-password check
    assert client.post("/login", data={"username": "alice", "password": DEFAULT_PASSWORD}).status_code == 200


def test_set_password_follows_the_password_rules(client):
    token = _oauth_only("gina")
    for bad in ("short", "x" * 73):
        assert client.post("/me/password/set", json={"new_password": bad}, headers=auth(token)).status_code == 422
    assert _user("gina").hashed_password is None


def test_set_password_then_change_and_delete_work(client):
    token = _oauth_only("gina")
    client.post("/me/password/set", json={"new_password": "gina-password-1"}, headers=auth(token))
    assert client.get("/me/email", headers=auth(token)).json()["has_password"] is True
    r = client.post("/me/password", json={"current_password": "gina-password-1", "new_password": "gina-password-2"}, headers=auth(token))
    assert r.status_code == 200
    token = r.json()["access_token"]
    assert client.post("/me/delete", json={"password": "gina-password-2"}, headers=auth(token)).status_code == 204


def test_set_password_is_rate_limited(client, rate_limits):
    token = _oauth_only("gina")
    codes = [client.post("/me/password/set", json={"new_password": "gina-password-1"}, headers=auth(token)).status_code for _ in range(6)]
    assert codes == [200, 409, 409, 409, 409, 429]


def test_unlink_is_rate_limited(client, make_user, rate_limits):
    token = make_user("alice")
    codes = [client.delete("/me/identities/google", headers=auth(token)).status_code for _ in range(6)]
    assert codes[:5] == [404] * 5 and codes[5] == 429
