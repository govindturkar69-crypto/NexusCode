"""The pre-deploy preflight script's pure logic (no real DB or .env)."""
import sys

from conftest import BACKEND_DIR

sys.path.insert(0, str(BACKEND_DIR / "scripts"))
import preflight  # noqa: E402


def run(fn, *args):
    """Call a check and return its printed lines, resetting the module's flag."""
    preflight._failed = False
    out = []
    original = preflight.report

    def capture(status, label, note=""):
        out.append((status, label, note))
        original(status, label, note)

    preflight.report = capture
    try:
        fn(*args)
    finally:
        preflight.report = original
    return out, preflight._failed


def test_required_env_passes_when_all_present():
    env = {"JWT_SECRET": "x", "FRONTEND_URL": "http://x", "GITHUB_TOKEN_ENC_KEY": "k", "DB_PASSWORD": "p"}
    out, failed = run(preflight.check_required_env, env)
    assert not failed
    assert all(s == preflight.OK for s, _, _ in out)


def test_required_env_fails_on_missing():
    out, failed = run(preflight.check_required_env, {"FRONTEND_URL": "http://x"})
    assert failed
    labels = {label: (status, note) for status, label, note in out}
    assert labels["required env vars"][0] == preflight.FAIL
    assert "JWT_SECRET" in labels["required env vars"][1]
    assert labels["database target configured"][0] == preflight.FAIL


def test_database_target_accepts_either_url_or_password():
    assert not run(preflight.check_required_env, {"JWT_SECRET": "x", "FRONTEND_URL": "u", "GITHUB_TOKEN_ENC_KEY": "k", "DATABASE_URL": "postgresql://h/d"})[1]


def test_livekit_skips_when_unset_fails_when_partial_passes_when_full():
    assert run(preflight.check_livekit, {})[0][0][0] == preflight.SKIP
    partial, failed = run(preflight.check_livekit, {"LIVEKIT_URL": "wss://x"})
    assert failed and partial[0][0] == preflight.FAIL
    full, failed = run(preflight.check_livekit, {"LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s"})
    assert not failed and full[0][0] == preflight.OK


def test_build_db_url_from_parts_and_url():
    assert preflight.build_db_url({}) is None  # no target
    url = preflight.build_db_url({"DB_PASSWORD": "pw", "DB_HOST": "h", "DB_NAME": "d"})
    assert url.drivername == "postgresql" and url.host == "h" and url.database == "d"
    # postgres:// is normalised and sslmode added
    full = preflight.build_db_url({"DATABASE_URL": "postgres://u:pw@host/db"})
    assert full.drivername == "postgresql" and full.query.get("sslmode") == "require"


def test_load_env_parses_dotenv_and_env_wins(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text('A=from_file\nB="quoted"\n# C=comment\n\nD=\n', encoding="utf-8")
    monkeypatch.setattr(preflight, "BACKEND_DIR", tmp_path)
    monkeypatch.setenv("A", "from_env")
    env = preflight.load_env()
    assert env["A"] == "from_env"  # real environment wins
    assert env["B"] == "quoted" and env["D"] == ""
    assert "C" not in env  # comments skipped


def test_health_skips_without_url():
    out, failed = run(preflight.check_health, None)
    assert not failed and out[0][0] == preflight.SKIP


def test_livekit_url_must_be_a_websocket_url_and_is_never_printed():
    env = {"LIVEKIT_URL": "https://secret-project.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s"}
    lines, failed = run(preflight.check_livekit, env)
    assert failed and lines[0][0] == preflight.FAIL
    assert "secret-project" not in " ".join(str(part) for part in lines[0])
