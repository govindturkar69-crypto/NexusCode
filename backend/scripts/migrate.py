"""
Safe `alembic upgrade head` for deploys. Run before the app starts:

    python scripts/migrate.py

- Database already managed by Alembic -> upgrade to head.
- Empty database                      -> upgrade to head (creates everything).
- Tables exist but no alembic_version  -> STOP with an error. That's a
  database from before Alembic; it must be stamped once by hand
  (alembic stamp 0001_baseline). Nothing is created, changed or dropped.

On Postgres a transaction-level advisory lock makes concurrent deploys wait
for each other instead of migrating twice.
"""
import pathlib
import sys

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

APP_TABLES = {"users", "projects", "tasks", "files", "messages", "code_files"}
ADVISORY_LOCK_ID = 7_340_001  # arbitrary, just has to be unique to this app


def alembic_config() -> Config:
    return Config(str(BACKEND_DIR / "alembic.ini"))


def run(engine) -> int:
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": ADVISORY_LOCK_ID})

        tables = set(inspect(connection).get_table_names())
        if "alembic_version" not in tables and tables & APP_TABLES:
            print(
                "ERROR: this database has NexusCode tables but is not managed by Alembic yet.\n"
                "Refusing to migrate so nothing gets recreated or lost.\n"
                "Verify it with `python scripts/check_baseline.py`, then run once:\n"
                "    alembic stamp 0001_baseline\n"
                "and deploy again.",
                file=sys.stderr,
            )
            return 1

        config = alembic_config()
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    print("Database schema is up to date.")
    return 0


if __name__ == "__main__":
    from database import engine

    sys.exit(run(engine))
