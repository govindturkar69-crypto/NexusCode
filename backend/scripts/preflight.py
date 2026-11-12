"""
Pre-deploy preflight. Prints OK / FAIL / SKIP for each check and never prints a
value. Exits 0 only if nothing FAILed.

    python scripts/preflight.py                      # checks the DB in backend/.env
    python scripts/preflight.py --health-url URL     # also check a running /health

Checks:
  - required env vars present (JWT_SECRET, FRONTEND_URL, GITHUB_TOKEN_ENC_KEY, a DB target)
  - database connectivity (read-only)
  - alembic head matches the DB's current version
  - row-level security on every public table (Postgres)
  - /health reachable (only when --health-url / PREFLIGHT_HEALTH_URL is given)
  - LiveKit vars all present and LIVEKIT_URL is ws(s):// (SKIP when none is set)

It is deliberately self-contained: it does not import the app, so it runs even
when required env vars are missing (that is one of the things it reports).
"""
import argparse
import os
import pathlib
import sys
import urllib.request

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

OK, FAIL, SKIP = "[ OK ]", "[FAIL]", "[SKIP]"
_failed = False


def report(status: str, label: str, note: str = "") -> None:
    global _failed
    if status == FAIL:
        _failed = True
    print(f"{status} {label}" + (f" - {note}" if note else ""))


def load_env() -> dict:
    """backend/.env merged under the real environment (env wins). Values stay in
    memory and are never printed."""
    env = {}
    dotenv = BACKEND_DIR / ".env"
    if dotenv.exists():
        for line in dotenv.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    env.update(os.environ)
    return env


def build_db_url(env: dict):
    """Mirror app/core/database.build_database_url without importing the app."""
    from sqlalchemy.engine import URL, make_url

    database_url = env.get("DATABASE_URL")
    if database_url:
        if database_url.startswith("postgres://"):
            database_url = "postgresql://" + database_url[len("postgres://"):]
        url = make_url(database_url)
        if url.get_backend_name() == "postgresql" and "sslmode" not in url.query:
            url = url.update_query_dict({"sslmode": "require"})
        return url
    if not env.get("DB_PASSWORD"):
        return None
    query = {"sslmode": env["DB_SSLMODE"]} if env.get("DB_SSLMODE") else {}
    return URL.create(
        "postgresql",
        username=env.get("DB_USER", "postgres"),
        password=env["DB_PASSWORD"],
        host=env.get("DB_HOST", "localhost"),
        port=int(env.get("DB_PORT", 5432)),
        database=env.get("DB_NAME", "postgres"),
        query=query,
    )


def check_required_env(env: dict) -> None:
    required = ["JWT_SECRET", "FRONTEND_URL", "GITHUB_TOKEN_ENC_KEY"]
    missing = [name for name in required if not env.get(name)]
    if missing:
        report(FAIL, "required env vars", f"missing/empty: {', '.join(missing)}")
    else:
        report(OK, "required env vars")
    if env.get("DATABASE_URL") or env.get("DB_PASSWORD"):
        report(OK, "database target configured")
    else:
        report(FAIL, "database target configured", "set DATABASE_URL or DB_PASSWORD")


def check_database(url) -> object | None:
    from sqlalchemy import create_engine

    if url is None:
        report(SKIP, "database connectivity", "no DB target")
        return None
    try:
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execution_options(isolation_level="AUTOCOMMIT")
            conn.exec_driver_sql("SELECT 1")
        report(OK, "database connectivity")
        return engine
    except Exception as e:
        report(FAIL, "database connectivity", type(e).__name__)
        return None


def check_alembic(engine) -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    try:
        script = ScriptDirectory.from_config(Config(str(BACKEND_DIR / "alembic.ini")))
        heads = script.get_heads()
    except Exception as e:
        report(FAIL, "alembic head readable", type(e).__name__)
        return
    if len(heads) != 1:
        report(FAIL, "single alembic head", f"{len(heads)} heads")
        return
    head = heads[0]
    if engine is None:
        report(SKIP, "DB at alembic head", "no DB connection")
        return
    try:
        with engine.connect() as conn:
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception as e:
        report(FAIL, "DB at alembic head", type(e).__name__)
        return
    if current == head:
        report(OK, f"DB at alembic head ({head})")
    else:
        report(FAIL, "DB at alembic head", f"DB is {current}, head is {head} - run migrations")


def check_rls(engine) -> None:
    from sqlalchemy import text

    if engine is None:
        report(SKIP, "row-level security", "no DB connection")
        return
    if engine.dialect.name != "postgresql":
        report(SKIP, "row-level security", "not Postgres")
        return
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT relname, relrowsecurity FROM pg_class "
                "WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname"
            )).all()
    except Exception as e:
        report(FAIL, "row-level security", type(e).__name__)
        return
    off = [name for name, enabled in rows if not enabled]
    if off:
        report(FAIL, "row-level security", f"OFF on: {', '.join(off)}")
    else:
        report(OK, f"row-level security (all {len(rows)} tables)")


def check_health(health_url: str | None) -> None:
    if not health_url:
        report(SKIP, "/health reachable", "pass --health-url to check")
        return
    try:
        with urllib.request.urlopen(health_url, timeout=10) as resp:
            ok = resp.status == 200
        report(OK if ok else FAIL, "/health reachable", "" if ok else f"status {resp.status}")
    except Exception as e:
        report(FAIL, "/health reachable", type(e).__name__)


def check_livekit(env: dict) -> None:
    names = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]
    present = [n for n in names if env.get(n)]
    if not present:
        report(SKIP, "LiveKit vars", "not set: video meetings are off")
    elif len(present) < len(names):
        report(FAIL, "LiveKit vars", f"missing: {', '.join(n for n in names if not env.get(n))}")
    elif not env["LIVEKIT_URL"].startswith(("wss://", "ws://")):
        report(FAIL, "LiveKit vars", "LIVEKIT_URL must start with wss:// (or ws:// for a local server)")
    else:
        report(OK, "LiveKit vars")


def main() -> int:
    parser = argparse.ArgumentParser(description="Pre-deploy preflight (read-only).")
    parser.add_argument("--health-url", default=os.environ.get("PREFLIGHT_HEALTH_URL"))
    args = parser.parse_args()

    env = load_env()
    print("NexusCode preflight (read-only; no values are printed)\n")
    check_required_env(env)
    engine = check_database(build_db_url(env))
    check_alembic(engine)
    check_rls(engine)
    check_health(args.health_url)
    check_livekit(env)
    print()
    if _failed:
        print("RESULT: FAIL - fix the items above before deploying.")
        return 1
    print("RESULT: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
