"""Unit tests for the small service modules (no HTTP layer)."""
import pytest
from google.genai import errors

from app.core import database
from app.core.config import Settings
from app.services import ai
from app.services import storage as files


class _FakeModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def generate_content(self, model, contents):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return type("Response", (), {"text": outcome})()


@pytest.fixture
def fake_gemini(monkeypatch):
    def install(*outcomes):
        models = _FakeModels(outcomes)
        monkeypatch.setattr(ai, "client", type("FakeClient", (), {"models": models})())
        monkeypatch.setattr(ai.time, "sleep", lambda s: None)
        return models
    return install


def test_ai_returns_text_and_wraps_prompt(fake_gemini):
    models = fake_gemini("def f(): pass")
    assert ai.generate_code("reverse a list") == "def f(): pass"
    assert models.calls == 1


@pytest.mark.parametrize("fn", [ai.detect_bugs, ai.generate_docs])
def test_ai_review_helpers(fake_gemini, fn):
    fake_gemini("ok")
    assert fn("x = 1") == "ok"


def test_ai_quota_error_fails_fast(fake_gemini):
    models = fake_gemini(errors.ClientError(429, {"error": {"message": "quota"}}))
    with pytest.raises(ai.AIQuotaExceededError):
        ai.generate_code("p")
    assert models.calls == 1


def test_ai_other_client_errors_propagate(fake_gemini):
    fake_gemini(errors.ClientError(400, {"error": {"message": "bad"}}))
    with pytest.raises(errors.ClientError):
        ai.generate_code("p")


def test_ai_retries_server_errors_then_succeeds(fake_gemini):
    models = fake_gemini(errors.ServerError(503, {}), "done")
    assert ai.generate_code("p") == "done"
    assert models.calls == 2


def test_ai_gives_up_after_three_server_errors(fake_gemini):
    models = fake_gemini(*[errors.ServerError(503, {})] * 3)
    with pytest.raises(ai.AIServiceBusyError):
        ai.generate_code("p")
    assert models.calls == 3


def _config(**values):
    """Settings built only from the given values. Explicit init values beat
    environment variables, so every DB field is passed to shut those out."""
    defaults = {
        "jwt_secret": "x", "frontend_url": "http://f",
        "database_url": None, "db_password": None, "db_sslmode": None,
        "db_host": "localhost", "db_port": 5432, "db_user": "postgres", "db_name": "college_project_db",
    }
    return Settings(_env_file=None, **{**defaults, **values})


def test_db_url_requires_configuration():
    with pytest.raises(RuntimeError, match="Database is not configured"):
        database.build_database_url(_config())


def test_db_url_from_render_style_url_requires_ssl():
    url = database.build_database_url(_config(database_url="postgres://u:pw@db.example.com:5432/app"))
    assert url.drivername == "postgresql" and url.query["sslmode"] == "require"


def test_db_url_keeps_explicit_sslmode():
    url = database.build_database_url(_config(database_url="postgresql://u:pw@h/app?sslmode=disable"))
    assert url.query["sslmode"] == "disable"


def test_db_url_from_parts_decodes_legacy_password():
    url = database.build_database_url(_config(db_password="p%40ss", db_host="h", db_sslmode="require"))
    assert url.password == "p@ss" and url.host == "h" and url.port == 5432 and url.query["sslmode"] == "require"


def test_db_url_sqlite_passthrough():
    assert database.build_database_url(_config(database_url="sqlite://")).get_backend_name() == "sqlite"


def test_settings_require_jwt_secret_and_frontend_url(monkeypatch):
    from app.core import config

    monkeypatch.delenv("JWT_SECRET")
    monkeypatch.delenv("FRONTEND_URL")
    monkeypatch.setattr(config.Settings, "model_config", {**config.Settings.model_config, "env_file": None})
    config.get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="JWT_SECRET.*FRONTEND_URL|FRONTEND_URL.*JWT_SECRET"):
            config.get_settings()
    finally:
        config.get_settings.cache_clear()


def test_settings_strip_frontend_trailing_slash():
    config = _config(frontend_url="https://app.example/")
    assert config.frontend_url == "https://app.example"
    assert config.cors_origins[0] == "https://app.example"


PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16


@pytest.mark.parametrize("filename,content_type,data,expected", [
    ("a.png", "image/png", PNG, ("image/png", "image")),
    ("a.JPG", "image/jpeg", b"\xff\xd8\xff\xe0rest", ("image/jpeg", "image")),
    ("doc.pdf", "application/pdf", b"%PDF-1.7 ...", ("application/pdf", "image")),
    ("x.zip", "application/zip", b"PK\x03\x04rest", ("application/zip", "raw")),
    ("notes.md", "text/markdown", b"# hi", ("text/markdown", "raw")),
    ("main.py", "application/octet-stream", b"print(1)", ("text/plain", "raw")),  # browsers send this for .py
    ("app.js", "text/javascript", b"let x", ("text/plain", "raw")),
    ("data.csv", "text/csv; charset=utf-8", b"a,b", ("text/csv", "raw")),
])
def test_validate_upload_accepts(filename, content_type, data, expected):
    assert files.validate_upload(filename, content_type, data) == expected


@pytest.mark.parametrize("filename,content_type,data,status", [
    ("a.svg", "image/svg+xml", b"<svg onload=alert(1)>", 415),
    ("a.html", "text/html", b"<script>", 415),
    ("fake.png", "image/png", b"<html><script>", 415),       # wrong magic bytes
    ("a.png", "application/pdf", b"%PDF-1.4", 415),          # extension/type mismatch
    ("a.exe", "application/octet-stream", b"MZ", 415),
    ("bad.txt", "text/plain", b"\xff\xfe\xfa", 415),          # not UTF-8
    ("empty.txt", "text/plain", b"", 400),
    ("big.txt", "text/plain", b"x" * (10 * 1024 * 1024 + 1), 413),
])
def test_validate_upload_rejects(filename, content_type, data, status):
    with pytest.raises(files.UploadRejected) as info:
        files.validate_upload(filename, content_type, data)
    assert info.value.status_code == status


def test_delete_treats_not_found_as_success_and_raises_otherwise(monkeypatch):
    results = iter([{"result": "ok"}, {"result": "not found"}, {"result": "error"}])
    monkeypatch.setattr(files.cloudinary.uploader, "destroy", lambda *a, **k: next(results))
    files.delete_project_file("projects/1/a", "image")
    files.delete_project_file("projects/1/b", "raw")
    with pytest.raises(RuntimeError):
        files.delete_project_file("projects/1/c", "image")
