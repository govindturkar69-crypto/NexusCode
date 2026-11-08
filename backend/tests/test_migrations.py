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


def test_0005_makes_every_existing_owner_a_member(scratch_engine):
    _upgrade(scratch_engine, "0004_encrypt_github_tokens")
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, username, hashed_password) VALUES (1, 'a', 'h'), (2, 'b', 'h')"))
        conn.execute(text("INSERT INTO projects (id, name, owner_id) VALUES (10, 'p1', 1), (11, 'p2', 1), (12, 'p3', 2)"))
    _upgrade(scratch_engine, "0005_project_members")
    with scratch_engine.connect() as conn:
        rows = conn.execute(text("SELECT project_id, user_id, role FROM project_members ORDER BY project_id")).all()
        assert [tuple(r) for r in rows] == [(10, 1, "owner"), (11, 1, "owner"), (12, 2, "owner")]
        assert conn.execute(text("SELECT count(*) FROM project_members WHERE created_at IS NULL")).scalar() == 0

    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        command.downgrade(config, "0004_encrypt_github_tokens")
    assert "project_members" not in inspect(scratch_engine).get_table_names()
    with scratch_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM projects")).scalar() == 3


def test_0006_gives_existing_tasks_defaults_and_keeps_constraints(scratch_engine):
    _upgrade(scratch_engine, "0005_project_members")
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, username, hashed_password) VALUES (1, 'a', 'h')"))
        conn.execute(text("INSERT INTO projects (id, name, owner_id) VALUES (1, 'p', 1)"))
        conn.execute(text("INSERT INTO tasks (id, title, status, project_id, position) VALUES (1, 't', 'done', 1, 7)"))
    _upgrade(scratch_engine, "0006_task_details")
    with scratch_engine.connect() as conn:
        row = conn.execute(text("SELECT title, status, position, priority, assignee_id, due_date FROM tasks")).one()
        assert tuple(row) == ("t", "done", 7, "medium", None, None)
    for sql in ("UPDATE tasks SET priority = 'urgent'", "UPDATE tasks SET status = 'bogus'"):
        with pytest.raises(Exception):  # noqa: B017
            with scratch_engine.begin() as conn:
                conn.execute(text(sql))

    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        command.downgrade(config, "0005_project_members")
    with scratch_engine.connect() as conn:
        assert conn.execute(text("SELECT title, status FROM tasks")).one() == ("t", "done")
        assert "priority" not in {c["name"] for c in inspect(conn).get_columns("tasks")}


def test_project_members_rejects_duplicates_and_bad_roles(scratch_engine):
    _upgrade(scratch_engine)
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, username, hashed_password) VALUES (1, 'a', 'h')"))
        conn.execute(text("INSERT INTO projects (id, name, owner_id) VALUES (1, 'p', 1)"))
        conn.execute(text("INSERT INTO project_members (project_id, user_id, role) VALUES (1, 1, 'owner')"))
    for sql in (
        "INSERT INTO project_members (project_id, user_id, role) VALUES (1, 1, 'viewer')",
        "UPDATE project_members SET role = 'admin'",
    ):
        with pytest.raises(Exception):  # noqa: B017
            with scratch_engine.begin() as conn:
                conn.execute(text(sql))


def test_baseline_downgrade_needs_explicit_flag(scratch_engine):
    _upgrade(scratch_engine, "0001_baseline")
    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        with pytest.raises(RuntimeError, match="drops ALL tables"):
            command.downgrade(config, "base")
    assert "users" in inspect(scratch_engine).get_table_names()


def _seed_code_files_before_0008(eng):
    """Project 10 has every kind of language value; 11 has no file at all."""
    with eng.begin() as conn:
        conn.execute(text("INSERT INTO users (id, username, hashed_password) VALUES (1, 'alice', 'x')"))
        conn.execute(text("INSERT INTO projects (id, name, owner_id) VALUES (10, 'a', 1), (11, 'b', 1), (12, 'c', 1), (13, 'd', 1), (14, 'e', 1), (15, 'f', 1), (16, 'g', 1)"))
        conn.execute(text(
            "INSERT INTO code_files (id, content, language, project_id) VALUES "
            "(1, 'print(1)', 'python', 10), (2, 'js', 'javascript', 12), (3, 'J', 'java', 13), "
            "(4, 'c', 'cpp', 14), (5, '<p>', 'html', 15), (6, NULL, NULL, 16)"
        ))


def test_0008_moves_each_single_file_into_a_default_file(scratch_engine):
    _upgrade(scratch_engine, "0007_activity_notifications")
    _seed_code_files_before_0008(scratch_engine)
    with scratch_engine.connect() as conn:
        before = conn.execute(text("SELECT id, updated_at FROM code_files ORDER BY id")).all()
    _upgrade(scratch_engine, "0008_multi_file_code")
    with scratch_engine.connect() as conn:
        rows = conn.execute(text("SELECT project_id, path, language, content FROM code_files ORDER BY id")).all()
        assert [tuple(r) for r in rows] == [
            (10, "main.py", "python", "print(1)"),
            (12, "main.js", "javascript", "js"),
            (13, "main.java", "java", "J"),
            (14, "main.cpp", "cpp", "c"),
            (15, "main.html", "html", "<p>"),
            (16, "main.txt", "plaintext", ""),
        ]
        assert conn.execute(text("SELECT id, updated_at FROM code_files ORDER BY id")).all() == before
        # Many files per project now, but not the same path twice
        conn.execute(text("INSERT INTO code_files (path, content, language, project_id) VALUES ('other.py', '', 'python', 10)"))
        conn.commit()
        with pytest.raises(Exception, match="(?i)unique"):
            conn.execute(text("INSERT INTO code_files (path, content, language, project_id) VALUES ('other.py', '', 'python', 10)"))
        conn.rollback()


def test_0008_downgrade_keeps_each_projects_oldest_file(scratch_engine):
    _upgrade(scratch_engine, "0007_activity_notifications")
    _seed_code_files_before_0008(scratch_engine)
    _upgrade(scratch_engine, "0008_multi_file_code")
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO code_files (path, content, language, project_id) VALUES ('other.py', 'later', 'python', 10)"))

    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        command.downgrade(config, "0007_activity_notifications")

    with scratch_engine.connect() as conn:
        assert "path" not in {c["name"] for c in inspect(conn).get_columns("code_files")}
        assert conn.execute(text("SELECT content FROM code_files WHERE project_id = 10")).scalars().all() == ["print(1)"]
        assert conn.execute(text("SELECT count(*) FROM code_files")).scalar() == 6
        with pytest.raises(Exception, match="(?i)unique"):
            conn.execute(text("INSERT INTO code_files (content, language, project_id) VALUES ('', 'python', 10)"))
        conn.rollback()

    # And forward again
    _upgrade(scratch_engine, "0008_multi_file_code")
    assert _version(scratch_engine) == "0008_multi_file_code"


def test_0009_adds_and_removes_code_runs(scratch_engine):
    _upgrade(scratch_engine, "0009_code_runs")
    assert "code_runs" in inspect(scratch_engine).get_table_names()
    config = alembic_config()
    with scratch_engine.begin() as conn:
        config.attributes["connection"] = conn
        command.downgrade(config, "0008_multi_file_code")
    assert "code_runs" not in inspect(scratch_engine).get_table_names()


def test_history_has_a_single_head():
    from alembic.script import ScriptDirectory

    assert len(ScriptDirectory.from_config(alembic_config()).get_heads()) == 1


def _downgrade(eng, revision):
    config = alembic_config()
    with eng.begin() as conn:
        config.attributes["connection"] = conn
        command.downgrade(config, revision)


def test_0010_drops_code_runs_from_a_database_already_at_0009(scratch_engine):
    """Production already ran 0009, and may hold rows."""
    _upgrade(scratch_engine, "0009_code_runs")
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, username, hashed_password) VALUES (1, 'alice', 'x')"))
        conn.execute(text("INSERT INTO projects (id, name, owner_id) VALUES (10, 'a', 1)"))
        conn.execute(text("INSERT INTO code_files (project_id, path, language, content) VALUES (10, 'a.py', 'python', 'kept')"))
        conn.execute(text("INSERT INTO code_runs (project_id, user_id) VALUES (10, 1)"))
    _upgrade(scratch_engine, "0010_drop_code_runs")
    assert _version(scratch_engine) == "0010_drop_code_runs"
    assert "code_runs" not in inspect(scratch_engine).get_table_names()
    with scratch_engine.connect() as conn:
        assert conn.execute(text("SELECT content FROM code_files")).scalar() == "kept"


def test_0010_works_from_a_database_that_never_had_0009(scratch_engine):
    _upgrade(scratch_engine, "0008_multi_file_code")
    assert "code_runs" not in inspect(scratch_engine).get_table_names()
    _upgrade(scratch_engine, "0010_drop_code_runs")
    assert _version(scratch_engine) == "0010_drop_code_runs"
    assert "code_runs" not in inspect(scratch_engine).get_table_names()


def test_0010_downgrade_recreates_the_empty_table(scratch_engine):
    _upgrade(scratch_engine, "0010_drop_code_runs")
    _downgrade(scratch_engine, "0009_code_runs")
    assert _version(scratch_engine) == "0009_code_runs"
    with scratch_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM code_runs")).scalar() == 0
    indexes = {ix["name"] for ix in inspect(scratch_engine).get_indexes("code_runs")}
    assert {"ix_code_runs_project_id", "ix_code_runs_user_id", "ix_code_runs_created_at"} <= indexes
    _upgrade(scratch_engine)
    assert "code_runs" not in inspect(scratch_engine).get_table_names()


def test_0011_adds_email_to_existing_users_without_changing_them(scratch_engine):
    _upgrade(scratch_engine, "0010_drop_code_runs")
    with scratch_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, username, hashed_password) VALUES (1, 'alice', 'h1'), (2, 'bob', 'h2')"))
    _upgrade(scratch_engine, "0011_user_email")
    with scratch_engine.connect() as conn:
        rows = conn.execute(text("SELECT username, hashed_password, email, email_verified FROM users ORDER BY id")).all()
        assert [tuple(r) for r in rows] == [("alice", "h1", None, False), ("bob", "h2", None, False)]
    with scratch_engine.begin() as conn:
        conn.execute(text("UPDATE users SET email = 'a@x.test' WHERE id = 1"))
    with scratch_engine.connect() as conn:
        with pytest.raises(Exception, match="(?i)unique"):
            conn.execute(text("UPDATE users SET email = 'a@x.test' WHERE id = 2"))
        conn.rollback()
        with pytest.raises(Exception, match="(?i)check|constraint"):
            conn.execute(text("UPDATE users SET email = 'B@x.test' WHERE id = 2"))
        conn.rollback()
    _downgrade(scratch_engine, "0010_drop_code_runs")
    assert "email" not in {c["name"] for c in inspect(scratch_engine).get_columns("users")}
    _upgrade(scratch_engine, "0011_user_email")

