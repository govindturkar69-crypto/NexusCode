"""
Migrations: the models and the migration history must describe the same
schema, and the deploy script must never touch a pre-Alembic database.
"""
import pathlib
import sys

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from conftest import BACKEND_DIR, alembic_config
from sqlalchemy import create_engine, inspect, text

import models  # noqa: F401
from database import Base, engine

sys.path.insert(0, str(BACKEND_DIR / "scripts"))
import check_baseline  # noqa: E402
import migrate  # noqa: E402


def test_models_match_migration_head():
    """If this fails, a model changed without a migration (run alembic revision --autogenerate)."""
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert diff == []


@pytest.fixture
def scratch_engine(tmp_path):
    """A separate, empty SQLite database for migration experiments."""
    eng = create_engine(f"sqlite:///{pathlib.Path(tmp_path) / 'scratch.db'}")
    yield eng
    eng.dispose()


def _upgrade(eng, revision="head"):
    config = alembic_config()
    with eng.begin() as conn:
        config.attributes["connection"] = conn
        command.upgrade(config, revision)


def _version(eng):
    with eng.connect() as conn:
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def test_migrate_script_builds_empty_database(scratch_engine):
    assert migrate.run(scratch_engine) == 0
    assert {"users", "projects", "tasks", "files", "messages", "code_files"} <= set(inspect(scratch_engine).get_table_names())
    assert _version(scratch_engine) is not None
    # Running it again is a no-op
    assert migrate.run(scratch_engine) == 0


def test_migrate_script_refuses_unstamped_legacy_database(scratch_engine, capsys):
    # A database created the old way (create_all) with some data in it
    Base.metadata.create_all(scratch_engine)
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (username, hashed_password, is_admin) VALUES ('legacy', 'x', 0)"))

    assert migrate.run(scratch_engine) == 1
    assert "alembic stamp 0001_baseline" in capsys.readouterr().err
    tables = set(inspect(scratch_engine).get_table_names())
    assert "alembic_version" not in tables
    with scratch_engine.connect() as conn:
        assert conn.execute(text("SELECT username FROM users")).scalar() == "legacy"


def test_stamped_legacy_database_upgrades_and_keeps_data(scratch_engine):
    _upgrade(scratch_engine, "0001_baseline")
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (username, hashed_password, is_admin) VALUES ('kept', 'x', 0)"))
        conn.execute(text("DELETE FROM alembic_version"))  # simulate pre-Alembic DB...
    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        command.stamp(config, "0001_baseline")  # ...that gets stamped
    assert migrate.run(scratch_engine) == 0
    with scratch_engine.connect() as conn:
        assert conn.execute(text("SELECT username FROM users")).scalar() == "kept"


def test_check_baseline_accepts_baseline_schema(scratch_engine):
    _upgrade(scratch_engine, "0001_baseline")
    with scratch_engine.begin() as conn:
        conn.execute(text("DROP TABLE alembic_version"))
    with scratch_engine.connect() as conn:
        assert check_baseline.check(conn) == []


def test_check_baseline_reports_problems(scratch_engine):
    _upgrade(scratch_engine, "0001_baseline")
    with scratch_engine.begin() as conn:
        conn.execute(text("CREATE TABLE todos (id INTEGER PRIMARY KEY)"))
    with scratch_engine.connect() as conn:
        problems = check_baseline.check(conn)
    assert any("already managed by Alembic" in p for p in problems)
    assert any("todos" in p for p in problems)


def test_check_baseline_detects_missing_status_constraint(scratch_engine):
    Base.metadata.create_all(scratch_engine)
    with scratch_engine.begin() as conn:
        conn.execute(text("DROP TABLE tasks"))
        conn.execute(text(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title VARCHAR NOT NULL, description VARCHAR, "
            "status VARCHAR NOT NULL, project_id INTEGER NOT NULL REFERENCES projects(id))"
        ))
    with scratch_engine.connect() as conn:
        assert any("CHECK constraint is missing" in p for p in check_baseline.check(conn))


def test_baseline_downgrade_needs_explicit_flag(scratch_engine):
    _upgrade(scratch_engine, "0001_baseline")
    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        with pytest.raises(RuntimeError, match="drops ALL tables"):
            command.downgrade(config, "base")
    assert "users" in inspect(scratch_engine).get_table_names()
