"""
The client IP used for rate limits can't be chosen by the caller (review H1).
X-Forwarded-For is read from the right, TRUSTED_PROXY_HOPS places in, and the
caller-written leftmost entry never decides the key.
"""
import pytest
from starlette.requests import Request

from app.core import client_ip as cip
from app.core.client_ip import client_ip, is_https, rate_limit_key
from app.core.config import settings


def conn(xff=None, peer="10.0.0.5", proto=None, scheme="http", extra=()):
    headers = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    if proto is not None:
        headers.append((b"x-forwarded-proto", proto.encode()))
    headers.extend(extra)
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers,
                    "client": (peer, 1234) if peer else None, "scheme": scheme, "server": ("api", 443), "query_string": b""})


# ---------------------------------------------------------------- the key itself


def test_one_hop_takes_the_entry_the_proxy_appended_not_the_spoofed_one():
    assert client_ip(conn("6.6.6.6, 203.0.113.9"), hops=1) == "203.0.113.9"
    assert client_ip(conn("1.1.1.1, 2.2.2.2, 203.0.113.9"), hops=1) == "203.0.113.9"


def test_the_spoofed_leftmost_value_never_changes_the_key():
    keys = {rate_limit_key(conn(f"{spoof}, 203.0.113.9"), hops=1) for spoof in ("6.6.6.6", "7.7.7.7", "::1", "junk", "")}
    assert keys == {"203.0.113.9"}


def test_different_real_clients_get_different_keys():
    assert rate_limit_key(conn("6.6.6.6, 203.0.113.9"), hops=1) != rate_limit_key(conn("6.6.6.6, 198.51.100.7"), hops=1)


def test_no_header_falls_back_to_the_tcp_peer():
    assert client_ip(conn(None, peer="10.0.0.5"), hops=1) == "10.0.0.5"
    assert client_ip(conn("", peer="10.0.0.5"), hops=1) == "10.0.0.5"


def test_fewer_entries_than_hops_falls_back_to_the_peer():
    # Two trusted proxies, but only one entry: the request didn't come through both
    assert client_ip(conn("203.0.113.9", peer="10.0.0.5"), hops=2) == "10.0.0.5"


def test_two_hops_reads_two_places_from_the_right():
    assert client_ip(conn("6.6.6.6, 203.0.113.9, 10.1.1.1"), hops=2) == "203.0.113.9"


def test_zero_hops_ignores_the_header():
    assert client_ip(conn("203.0.113.9", peer="10.0.0.5"), hops=0) == "10.0.0.5"


def test_a_malformed_trusted_entry_falls_back_to_the_peer():
    for bad in ("not-an-ip", "999.1.1.1", "[2001:db8::1", "unknown"):
        assert client_ip(conn(f"1.2.3.4, {bad}", peer="10.0.0.5"), hops=1) == "10.0.0.5", bad


def test_whitespace_ports_and_quotes_are_handled():
    assert client_ip(conn("  6.6.6.6 ,   203.0.113.9  "), hops=1) == "203.0.113.9"
    assert client_ip(conn("6.6.6.6, 203.0.113.9:51000"), hops=1) == "203.0.113.9"
    assert client_ip(conn('6.6.6.6, "[2001:db8::1]:443"'), hops=1) == "2001:db8::1"


def test_several_header_lines_count_as_one_list():
    c = conn(None, extra=[(b"x-forwarded-for", b"6.6.6.6"), (b"x-forwarded-for", b"203.0.113.9")])
    assert client_ip(c, hops=1) == "203.0.113.9"


def test_ipv6_is_normalised_and_grouped_by_64():
    assert client_ip(conn("6.6.6.6, 2001:DB8:0:0:0:0:0:1"), hops=1) == "2001:db8::1"
    # IPv4-mapped IPv6 is the same client as the IPv4 address
    assert client_ip(conn("6.6.6.6, ::ffff:203.0.113.9"), hops=1) == "203.0.113.9"
    # Rotating addresses inside one /64 doesn't give a fresh bucket; another /64 does
    a = rate_limit_key(conn("x, 2001:db8:1:2::1"), hops=1)
    b = rate_limit_key(conn("x, 2001:db8:1:2:ffff::9"), hops=1)
    c = rate_limit_key(conn("x, 2001:db8:1:3::1"), hops=1)
    assert a == b == "2001:db8:1:2::/64"
    assert c != a


def test_no_peer_at_all_still_gives_a_key():
    assert client_ip(conn(None, peer=None), hops=1) == "unknown"


def test_https_comes_from_the_trusted_proxy():
    assert is_https(conn(proto="https"), hops=1) is True
    assert is_https(conn(proto="http"), hops=1) is False
    # A client's own leftmost "https" doesn't count when the proxy said http
    assert is_https(conn(proto="https, http"), hops=1) is False
    assert is_https(conn(scheme="https"), hops=0) is True
    assert is_https(conn(proto="https", scheme="http"), hops=0) is False


def test_the_setting_defaults_to_one_hop_and_rejects_negatives(monkeypatch):
    from pydantic import ValidationError

    from app.core.config import Settings

    assert Settings.model_fields["trusted_proxy_hops"].default == 1
    for bad in ("-1", "abc", "1.5"):
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", bad)
        with pytest.raises(ValidationError):
            Settings()
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    assert Settings().trusted_proxy_hops == 2


def test_the_module_reads_the_setting(monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxy_hops", 0)
    assert cip.client_ip(conn("203.0.113.9", peer="10.0.0.5")) == "10.0.0.5"
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    assert cip.client_ip(conn("203.0.113.9", peer="10.0.0.5")) == "203.0.113.9"


# ---------------------------------------------------------------- through the app


def login(client, xff, username="nobody-here"):
    return client.post("/login", data={"username": username, "password": "wrong-password-1"}, headers={"X-Forwarded-For": xff})


def test_a_6th_failed_login_is_limited_even_with_a_new_spoofed_entry_each_time(client, rate_limits, monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    codes = [login(client, f"6.6.6.{i}, 203.0.113.9").status_code for i in range(6)]
    assert codes == [401] * 5 + [429]


def test_two_real_clients_do_not_share_a_bucket(client, rate_limits, monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    for _ in range(5):
        assert login(client, "203.0.113.9").status_code == 401
    assert login(client, "203.0.113.9").status_code == 429
    # A different client behind the same proxy is unaffected
    assert login(client, "198.51.100.7").status_code == 401


def test_hsts_follows_the_trusted_proxy(client, monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    assert "strict-transport-security" in client.get("/health", headers={"X-Forwarded-Proto": "https"}).headers
    assert "strict-transport-security" not in client.get("/health").headers


def test_nothing_else_in_the_app_reads_a_client_address():
    """client_ip.py is the only place a client address comes from: no slowapi
    get_remote_address, request.client or raw X-Forwarded-For elsewhere."""
    import pathlib
    import re

    app_dir = pathlib.Path(cip.__file__).resolve().parents[1]
    pattern = re.compile(
        r"get_remote_address|\b(request|websocket|conn|connection)\.client\b|scope\[[\"']client[\"']\]"
        r"|headers\b[^\n]*x-forwarded-(for|proto)",
        re.IGNORECASE,
    )
    offenders = []
    for path in app_dir.rglob("*.py"):
        if path.name == "client_ip.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("#", 1)[0]
            if pattern.search(code):
                offenders.append(f"{path.relative_to(app_dir)}:{number}: {line.strip()}")
    assert offenders == []
