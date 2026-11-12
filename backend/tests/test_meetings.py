"""LiveKit meeting tokens: who may get one, what is in it, and removal from a call.

Tokens are signed and verified with the real LiveKit library, using a key pair
that exists only in these tests. Nothing here talks to LiveKit's servers."""
import asyncio
import time

import jwt
import pytest
from conftest import add_member, auth
from livekit import api

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import UserModel
from app.routers import meetings as meetings_router
from app.services import meetings as meetings_service

TEST_URL = "wss://nexuscode-test.livekit.cloud"
TEST_KEY = "test-only-livekit-key"
TEST_SECRET = "test-only-livekit-secret-0123456789abcdefghijklmn"


@pytest.fixture
def livekit(monkeypatch):
    monkeypatch.setattr(settings, "livekit_url", TEST_URL)
    monkeypatch.setattr(settings, "livekit_api_key", TEST_KEY)
    monkeypatch.setattr(settings, "livekit_api_secret", TEST_SECRET)


@pytest.fixture
def team(make_user, project_of):
    """A project with an owner, an editor, a viewer, and an outsider with a project of their own."""
    owner = make_user("olivia")
    tokens = {"owner": owner, "editor": make_user("eddie"), "viewer": make_user("vera"), "outsider": make_user("stan")}
    pid = project_of(owner)
    add_member("eddie", pid, "editor")
    add_member("vera", pid, "viewer")
    project_of(tokens["outsider"], "Stan's")
    return pid, tokens


def user_id(username):
    with SessionLocal() as db:
        return db.query(UserModel.id).filter(UserModel.username == username).scalar()


def token_url(pid):
    return f"/projects/{pid}/meeting/token"


@pytest.mark.parametrize("role,username", [("owner", "olivia"), ("editor", "eddie"), ("viewer", "vera")])
def test_every_member_role_gets_a_token_for_the_project_room(client, livekit, team, role, username):
    pid, tokens = team
    r = client.post(token_url(pid), headers=auth(tokens[role]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"token", "url"}
    assert body["url"] == TEST_URL

    claims = api.TokenVerifier(TEST_KEY, TEST_SECRET).verify(body["token"])
    assert claims.identity == str(user_id(username))
    assert claims.name == username
    assert claims.video.room == meetings_service.room_name(pid) == f"nexuscode-project-{pid}"
    assert claims.video.room_join is True
    assert claims.video.can_publish is True
    assert claims.video.can_subscribe is True
    assert claims.video.can_publish_data is True


def test_the_token_is_short_lived(client, livekit, team):
    pid, tokens = team
    raw = jwt.decode(client.post(token_url(pid), headers=auth(tokens["owner"])).json()["token"], TEST_SECRET, algorithms=["HS256"])
    assert raw["iss"] == TEST_KEY
    assert raw["exp"] - raw["nbf"] == 3600
    assert time.time() < raw["exp"] <= time.time() + 3600 + 5


def test_the_token_is_signed_with_the_server_secret(client, livekit, team):
    pid, tokens = team
    token = client.post(token_url(pid), headers=auth(tokens["owner"])).json()["token"]
    with pytest.raises(jwt.InvalidSignatureError):
        api.TokenVerifier(TEST_KEY, "some-other-secret-0123456789abcdefghijklmnopq").verify(token)


def test_the_secret_never_leaves_the_server(client, livekit, team):
    pid, tokens = team
    r = client.post(token_url(pid), headers=auth(tokens["owner"]))
    assert TEST_SECRET not in r.text


def test_each_project_has_its_own_room(client, livekit, team, project_of):
    pid, tokens = team
    other = project_of(tokens["owner"], "Second")
    rooms = {
        api.TokenVerifier(TEST_KEY, TEST_SECRET).verify(client.post(token_url(p), headers=auth(tokens["owner"])).json()["token"]).video.room
        for p in (pid, other)
    }
    assert len(rooms) == 2


def test_non_members_and_unknown_projects_get_404(client, livekit, team):
    pid, tokens = team
    assert client.post(token_url(pid), headers=auth(tokens["outsider"])).status_code == 404
    assert client.post(token_url(999999), headers=auth(tokens["owner"])).status_code == 404


def test_login_is_required(client, livekit, team):
    pid, _ = team
    assert client.post(token_url(pid)).status_code == 401
    assert client.post(token_url(pid), headers=auth("not-a-token")).status_code == 401


@pytest.mark.parametrize("missing", ["livekit_url", "livekit_api_key", "livekit_api_secret"])
def test_503_when_video_is_not_configured(client, livekit, team, monkeypatch, missing):
    pid, tokens = team
    monkeypatch.setattr(settings, missing, None)
    r = client.post(token_url(pid), headers=auth(tokens["viewer"]))
    assert r.status_code == 503
    assert r.json()["detail"] == meetings_router.NOT_CONFIGURED == "Video is not configured"


def test_not_configured_still_hides_projects_from_non_members(client, team):
    pid, tokens = team
    assert not meetings_service.is_configured()  # the tests never see the real .env values
    assert client.post(token_url(pid), headers=auth(tokens["outsider"])).status_code == 404


def test_the_token_endpoint_is_rate_limited(client, livekit, team, rate_limits):
    from app.core.rate_limit import MEETING_TOKEN_LIMIT

    pid, tokens = team
    limit = int(MEETING_TOKEN_LIMIT.split("/")[0])
    codes = [client.post(token_url(pid), headers=auth(tokens["owner"])).status_code for _ in range(limit + 1)]
    assert codes[:limit] == [200] * limit
    assert codes[-1] == 429


# ---- removal from a call ----

@pytest.fixture
def kicks(monkeypatch):
    """Records meeting removals instead of calling LiveKit's servers."""
    calls = []

    async def record(project_id, user_id):
        calls.append((project_id, user_id))

    monkeypatch.setattr(meetings_service, "kick", record)
    return calls


def test_removing_a_member_removes_them_from_the_call(client, team, kicks):
    pid, tokens = team
    r = client.delete(f"/projects/{pid}/members/{user_id('eddie')}", headers=auth(tokens["owner"]))
    assert r.status_code in (200, 204)
    assert kicks == [(pid, user_id("eddie"))]


def test_deleting_an_account_removes_it_from_every_call(client, team, kicks, project_of):
    from conftest import DEFAULT_PASSWORD

    pid, tokens = team
    second = project_of(tokens["owner"], "Second")
    add_member("vera", second, "viewer")
    vera = user_id("vera")
    r = client.post("/me/delete", json={"password": DEFAULT_PASSWORD}, headers=auth(tokens["viewer"]))
    assert r.status_code == 204, r.text
    assert sorted(kicks) == sorted([(pid, vera), (second, vera)])


def test_kick_does_nothing_when_video_is_not_configured():
    assert not meetings_service.is_configured()
    asyncio.run(meetings_service.kick(1, 2))  # returns without trying to connect


def test_kick_never_raises_when_livekit_cannot_be_reached(monkeypatch):
    # A closed local port: the call fails fast, without leaving this machine
    monkeypatch.setattr(settings, "livekit_url", "ws://127.0.0.1:9")
    monkeypatch.setattr(settings, "livekit_api_key", TEST_KEY)
    monkeypatch.setattr(settings, "livekit_api_secret", TEST_SECRET)
    started = time.monotonic()
    asyncio.run(meetings_service.kick(1, 2))
    assert time.monotonic() - started < meetings_service.KICK_TIMEOUT_SECONDS + 2
