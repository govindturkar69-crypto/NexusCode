"""Rate limits on login, sign-up and AI routes, and AI input size caps."""
import pytest
from conftest import DEFAULT_PASSWORD, auth


def _login(client, password="wrong-password", ip="10.0.0.1"):
    return client.post("/login", data={"username": "alice", "password": password}, headers={"X-Forwarded-For": ip})


def test_login_allows_five_per_minute_then_429(client, make_user, rate_limits):
    make_user("alice")
    rate_limits.reset()  # make_user's own login doesn't count
    codes = [_login(client).status_code for _ in range(5)]
    assert codes == [401] * 5
    r = _login(client, password=DEFAULT_PASSWORD)  # even the right password is blocked now
    assert r.status_code == 429
    assert r.json()["detail"].startswith("Too many requests")
    assert r.headers["Retry-After"] == "60"


def test_signup_allows_three_per_hour(client, rate_limits):
    codes = [
        client.post("/signup", json={"username": f"user_{i}", "password": DEFAULT_PASSWORD}).status_code
        for i in range(4)
    ]
    assert codes == [201, 201, 201, 429]


def test_ai_limit_is_per_user(client, make_user, fake_ai, rate_limits):
    alice = make_user("alice")
    bob = make_user("bob")
    for _ in range(10):
        assert client.post("/ai/generate-code", json={"prompt": "p"}, headers=auth(alice)).status_code == 200
    assert client.post("/ai/detect-bugs", json={"code": "c"}, headers=auth(alice)).status_code == 200  # separate route
    assert client.post("/ai/generate-code", json={"prompt": "p"}, headers=auth(alice)).status_code == 429
    # bob has his own budget
    assert client.post("/ai/generate-code", json={"prompt": "p"}, headers=auth(bob)).status_code == 200
    assert len(fake_ai) == 12  # the blocked call never reached the AI service


def test_rate_limit_errors_keep_cors_headers(client, make_user, rate_limits):
    make_user("alice")
    rate_limits.reset()
    for _ in range(5):
        _login(client)
    r = client.post("/login", data={"username": "alice", "password": "x"}, headers={"Origin": "http://frontend.test", "X-Forwarded-For": "10.0.0.1"})
    assert r.status_code == 429
    assert r.headers.get("access-control-allow-origin") == "http://frontend.test"


@pytest.mark.parametrize("path,key", [("/ai/generate-code", "prompt"), ("/ai/detect-bugs", "code"), ("/ai/generate-docs", "code")])
def test_ai_input_is_capped_at_20k_chars(client, make_user, fake_ai, path, key):
    alice = make_user("alice")
    assert client.post(path, json={key: "x" * 20_000}, headers=auth(alice)).status_code == 200
    assert client.post(path, json={key: "x" * 20_001}, headers=auth(alice)).status_code == 422
    assert len(fake_ai) == 1
