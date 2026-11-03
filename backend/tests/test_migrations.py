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

import app.models  # noqa: F401
from app.core.database import Base, engine

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


def _seed_baseline_data(eng):
    """Rows as they exist in production before 0002."""
    with eng.begin() as conn:
        conn.execute(text("INSERT INTO users (id, username, hashed_password, is_admin) VALUES (1, 'alice', 'h', false), (2, 'bob', 'h', false)"))
        conn.execute(text("INSERT INTO projects (id, name, owner_id) VALUES (10, 'p', 1)"))
        conn.execute(text("INSERT INTO tasks (id, title, status, project_id) VALUES (5, 'first', 'todo', 10), (3, 'second', 'done', 10)"))
        conn.execute(text("INSERT INTO files (id, filename, url, project_id) VALUES (7, 'a.pdf', 'https://x/a.pdf', 10)"))
        conn.execute(text(
            "INSERT INTO messages (id, content, username, project_id) VALUES "
            "(1, 'hi', 'alice', 10), (2, 'yo', 'bob', 10), (3, 'old', 'renamed_user', 10)"
        ))
        conn.execute(text("INSERT INTO code_files (id, content, language, project_id) VALUES (1, 'x', 'python', 10)"))


def test_0002_backfills_existing_rows(scratch_engine):
    _upgrade(scratch_engine, "0001_baseline")
    _seed_baseline_data(scratch_engine)
    _upgrade(scratch_engine, "0002_schema_improvements")

    with scratch_engine.connect() as conn:
        users = dict(conn.execute(text("SELECT content, user_id FROM messages")).all())
        assert users == {"hi": 1, "yo": 2, "old": None}  # unknown username stays NULL
        assert dict(conn.execute(text("SELECT id, position FROM tasks")).all()) == {5: 5, 3: 3}
        assert conn.execute(text("SELECT public_id FROM files")).scalar() is None
        for table in ("users", "projects", "tasks", "files", "messages", "code_files"):
            missing = conn.execute(text(f"SELECT count(*) FROM {table} WHERE created_at IS NULL OR updated_at IS NULL")).scalar()
            assert missing == 0, table
        indexes = {ix["name"] for t in ("projects", "tasks", "files", "messages") for ix in inspect(conn).get_indexes(t)}
        assert {"ix_projects_owner_id", "ix_tasks_project_id", "ix_files_project_id", "ix_messages_project_id", "ix_messages_user_id"} <= indexes


def test_0002_downgrade_keeps_data(scratch_engine):
    _upgrade(scratch_engine, "0001_baseline")
    _seed_baseline_data(scratch_engine)
    _upgrade(scratch_engine)
    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        command.downgrade(config, "0001_baseline")
    with scratch_engine.connect() as conn:
        assert "position" not in {c["name"] for c in inspect(conn).get_columns("tasks")}
        assert conn.execute(text("SELECT count(*) FROM messages")).scalar() == 3
        assert conn.execute(text("SELECT count(*) FROM tasks")).scalar() == 2
        # The baseline CHECK constraint survived the round trip
        with pytest.raises(Exception):  # noqa: B017 - IntegrityError type differs per driver
            with conn.begin():
                conn.execute(text("INSERT INTO tasks (title, status, project_id) VALUES ('bad', 'bogus', 10)"))


def test_check_constraint_survives_0002(scratch_engine):
    _upgrade(scratch_engine)
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, username, hashed_password) VALUES (1, 'a', 'h')"))
        conn.execute(text("INSERT INTO projects (id, name, owner_id) VALUES (1, 'p', 1)"))
    with pytest.raises(Exception):  # noqa: B017
        with scratch_engine.begin() as conn:
            conn.execute(text("INSERT INTO tasks (title, status, project_id) VALUES ('bad', 'bogus', 1)"))


def test_0004_encrypts_existing_plaintext_tokens_and_downgrade_restores(scratch_engine):
    from app.core.crypto import decrypt_secret

    _upgrade(scratch_engine, "0003_file_metadata")
    with scratch_engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO users (id, username, hashed_password, github_token) VALUES "
            "(1, 'a', 'h', 'gho_plain_a'), (2, 'b', 'h', NULL)"
        ))
    _upgrade(scratch_engine, "0004_encrypt_github_tokens")
    with scratch_engine.connect() as conn:
        stored = dict(conn.execute(text("SELECT id, github_token FROM users")).all())
    assert stored[1].startswith("enc:v1:") and decrypt_secret(stored[1]) == "gho_plain_a"
    assert stored[2] is None

    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        command.downgrade(config, "0003_file_metadata")
    with scratch_engine.connect() as conn:
        assert conn.execute(text("SELECT github_token FROM users WHERE id = 1")).scalar() == "gho_plain_a"


def test_baseline_downgrade_needs_explicit_flag(scratch_engine):
    _upgrade(scratch_engine, "0001_baseline")
    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        with pytest.raises(RuntimeError, match="drops ALL tables"):
            command.downgrade(config, "base")
    assert "users" in inspect(scratch_engine).get_table_names()
