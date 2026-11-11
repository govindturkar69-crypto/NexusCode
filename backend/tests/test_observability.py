import json
import logging

import pytest

from app.core import observability


def test_json_formatter_emits_one_json_object_with_context():
    formatter = observability.JsonFormatter()
    record = logging.LogRecord("nexuscode.access", logging.INFO, __file__, 1, "request", None, None)
    record.request_id = "abc"
    record.status = 201
    record.path = "/projects"
    entry = json.loads(formatter.format(record))
    assert entry["msg"] == "request" and entry["level"] == "INFO"
    assert entry["request_id"] == "abc" and entry["status"] == 201 and entry["path"] == "/projects"
    assert entry["ts"].endswith("+00:00")


def test_json_formatter_includes_exceptions():
    formatter = observability.JsonFormatter()
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "failed", None, sys.exc_info())
    entry = json.loads(formatter.format(record))
    assert "ValueError: boom" in entry["exc"]


def test_requests_get_an_id_and_a_log_line_without_query_strings(client, caplog):
    with caplog.at_level(logging.INFO, logger="nexuscode.access"):
        r = client.get("/projects?token=secret-value")
    assert r.status_code == 401
    request_id = r.headers["X-Request-ID"]
    assert len(request_id) == 32
    lines = [rec for rec in caplog.records if rec.name == "nexuscode.access"]
    assert lines and lines[-1].request_id == request_id
    assert lines[-1].path == "/projects" and lines[-1].status == 401
    assert all("secret-value" not in json.dumps(vars(rec), default=str) for rec in lines)


def test_safe_incoming_request_id_is_kept_and_unsafe_one_replaced(client):
    assert client.get("/", headers={"X-Request-ID": "trace-123"}).headers["X-Request-ID"] == "trace-123"
    replaced = client.get("/", headers={"X-Request-ID": "bad id\nInjected: 1"}).headers["X-Request-ID"]
    assert replaced != "bad id\nInjected: 1" and len(replaced) == 32


def test_health_checks_log_at_debug_only(client, caplog):
    with caplog.at_level(logging.INFO, logger="nexuscode.access"):
        client.get("/health")
    assert not [rec for rec in caplog.records if rec.name == "nexuscode.access" and rec.path == "/health"]


def test_request_id_is_readable_cross_origin(client):
    r = client.get("/", headers={"Origin": "http://frontend.test"})
    assert "X-Request-ID" in r.headers.get("access-control-expose-headers", "")


def test_sentry_stays_off_without_dsn(monkeypatch):
    import sentry_sdk

    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    assert observability.init_sentry(None, "test", 0.0) is False
    assert calls == []


def test_sentry_init_never_sends_personal_data(monkeypatch):
    import sentry_sdk

    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    assert observability.init_sentry("https://key@o0.ingest.sentry.io/1", "staging", 0.1) is True
    assert calls[0]["send_default_pii"] is False
    assert calls[0]["environment"] == "staging" and calls[0]["traces_sample_rate"] == 0.1


@pytest.mark.parametrize("fmt", ["json", "text"])
def test_configure_logging_formats(fmt):
    root = logging.getLogger()
    before = (root.handlers[:], root.level)
    try:
        observability.configure_logging("WARNING", fmt)
        handler = root.handlers[0]
        assert isinstance(handler.formatter, observability.JsonFormatter) == (fmt == "json")
        assert root.level == logging.WARNING
        assert logging.getLogger("uvicorn.access").disabled is True
    finally:
        root.handlers, _ = before
        root.setLevel(before[1])


def test_security_headers_on_every_response(client):
    for path in ("/", "/health", "/does-not-exist"):
        r = client.get(path)
        assert r.headers["X-Content-Type-Options"] == "nosniff", path
        assert r.headers["X-Frame-Options"] == "DENY", path
        assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin", path


def test_hsts_only_over_https(client):
    # The TestClient speaks http, so no HSTS...
    assert "Strict-Transport-Security" not in client.get("/").headers
    # ...but an https request (as Render's proxy forwards) gets it
    https = client.get("https://testserver/")
    assert https.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
