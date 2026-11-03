"""
READ-ONLY check that an existing (pre-Alembic) database matches the
0001_baseline migration, so it can safely be stamped:

    python scripts/check_baseline.py      # uses DATABASE_URL / DB_* env vars

It only inspects the schema; it never writes. Exit code 0 = safe to run
`alembic stamp 0001_baseline`, 1 = fix the listed problems first.
"""
import pathlib
import sys

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import inspect  # noqa: E402

# table -> {column: nullable}
EXPECTED_COLUMNS = {
    "users": {"id": False, "username": False, "hashed_password": False, "github_token": True, "is_admin": True},
    "projects": {"id": False, "name": False, "description": True, "owner_id": False},
    "tasks": {"id": False, "title": False, "description": True, "status": False, "project_id": False},
    "files": {"id": False, "filename": False, "url": False, "project_id": False},
    "messages": {"id": False, "content": False, "username": False, "project_id": False},
    "code_files": {"id": False, "content": True, "language": True, "project_id": False},
}
EXPECTED_FKS = {
    "projects": {("owner_id", "users")},
    "tasks": {("project_id", "projects")},
    "files": {("project_id", "projects")},
    "messages": {("project_id", "projects")},
    "code_files": {("project_id", "projects")},
}


def check(connection) -> list[str]:
    problems = []
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())

    if "alembic_version" in tables:
        problems.append("alembic_version already exists: this database is already managed by Alembic (don't stamp it again).")
    if "todos" in tables:
        problems.append("Old 'todos' table still exists. Drop it first: DROP TABLE IF EXISTS todos;")

    for table, columns in EXPECTED_COLUMNS.items():
        if table not in tables:
            problems.append(f"Missing table: {table}")
            continue
        actual = {c["name"]: c["nullable"] for c in inspector.get_columns(table)}
        for column, nullable in columns.items():
            if column not in actual:
                problems.append(f"{table}.{column} is missing")
            elif actual[column] != nullable:
                want = "NULL" if nullable else "NOT NULL"
                problems.append(f"{table}.{column} should be {want}")
        for extra in sorted(set(actual) - set(columns)):
            problems.append(f"{table}.{extra} is not in the baseline (unexpected column)")

        fks = {(fk["constrained_columns"][0], fk["referred_table"]) for fk in inspector.get_foreign_keys(table)}
        for column, target in EXPECTED_FKS.get(table, set()) - fks:
            problems.append(f"Missing foreign key {table}.{column} -> {target}")

    if "users" in tables:
        unique_username = any(
            ix["column_names"] == ["username"] and ix["unique"] for ix in inspector.get_indexes("users")
        ) or any(uc["column_names"] == ["username"] for uc in inspector.get_unique_constraints("users"))
        if not unique_username:
            problems.append("users.username has no unique index")

    if "code_files" in tables:
        unique_project = any(uc["column_names"] == ["project_id"] for uc in inspector.get_unique_constraints("code_files")) or any(
            ix["column_names"] == ["project_id"] and ix["unique"] for ix in inspector.get_indexes("code_files")
        )
        if not unique_project:
            problems.append("code_files.project_id has no unique constraint")

    if "tasks" in tables:
        checks = " ".join(c.get("sqltext", "") for c in inspector.get_check_constraints("tasks"))
        if not all(s in checks for s in ("todo", "in_progress", "done")):
            problems.append(
                "tasks.status CHECK constraint is missing. Run the Phase 1 SQL:\n"
                "  UPDATE tasks SET status = 'todo' WHERE status IS NULL OR status NOT IN ('todo','in_progress','done');\n"
                "  ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'todo';\n"
                "  ALTER TABLE tasks ALTER COLUMN status SET NOT NULL;\n"
                "  ALTER TABLE tasks ADD CONSTRAINT ck_tasks_status CHECK (status IN ('todo','in_progress','done'));"
            )
    return problems


if __name__ == "__main__":
    from database import engine

    with engine.connect() as conn:
        found = check(conn)
    if found:
        print("NOT safe to stamp yet:")
        for problem in found:
            print(f"  - {problem}")
        sys.exit(1)
    print("Schema matches 0001_baseline. Safe to run: alembic stamp 0001_baseline")
