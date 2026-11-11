"""The demo seed script: it writes the expected data, removes only its own, and
its safety guards refuse the wrong databases. Runs against the test DB."""
import sys

import pytest
from conftest import BACKEND_DIR

from app.core.database import SessionLocal
from app.models import (
    ActivityModel,
    CodeFileModel,
    MessageModel,
    ProjectMemberModel,
    ProjectModel,
    TaskModel,
    UserModel,
)

sys.path.insert(0, str(BACKEND_DIR / "scripts"))
import seed_demo  # noqa: E402


def counts(db):
    return {
        UserModel: db.query(UserModel).count(),
        ProjectModel: db.query(ProjectModel).count(),
        ProjectMemberModel: db.query(ProjectMemberModel).count(),
        TaskModel: db.query(TaskModel).count(),
        CodeFileModel: db.query(CodeFileModel).count(),
        MessageModel: db.query(MessageModel).count(),
        ActivityModel: db.query(ActivityModel).count(),
    }


def test_seed_creates_the_expected_data_then_removes_only_its_own():
    with SessionLocal() as db:
        # A pre-existing, unrelated user must survive --remove
        db.add(UserModel(username="someone_else", email="someone@example.test"))
        db.commit()

        seed_demo.seed(db)
        c = counts(db)
        assert c[ProjectModel] == 1
        assert c[ProjectMemberModel] == len(seed_demo.DEMO_USERS) == 3
        assert c[TaskModel] == len(seed_demo.TASKS)
        assert c[CodeFileModel] == len(seed_demo.CODE_FILES)
        assert c[MessageModel] == len(seed_demo.MESSAGES)
        assert c[ActivityModel] == len(seed_demo.ACTIVITY)
        # the three demo users plus the bystander
        assert c[UserModel] == len(seed_demo.DEMO_USERS) + 1

        roles = {m.user.username: m.role for m in db.query(ProjectMemberModel).all()}
        assert roles == {"demo_priya": "owner", "demo_alex": "editor", "demo_sam": "viewer"}

        seed_demo.remove(db)
        after = counts(db)
        assert after[ProjectModel] == 0
        assert after[TaskModel] == 0
        assert after[CodeFileModel] == 0
        # only the bystander is left
        assert after[UserModel] == 1
        assert db.query(UserModel).one().username == "someone_else"


def test_seed_refuses_to_run_twice():
    with SessionLocal() as db:
        seed_demo.seed(db)
        with pytest.raises(SystemExit):
            seed_demo.seed(db)


def test_guard_refuses_without_demo_seed(monkeypatch):
    monkeypatch.setattr(seed_demo, "db_host", lambda: "localhost")
    monkeypatch.delenv("DEMO_SEED", raising=False)
    with pytest.raises(SystemExit):
        seed_demo.check_allowed_to_write()


def test_guard_refuses_a_production_host(monkeypatch):
    monkeypatch.setattr(seed_demo, "db_host", lambda: "db.abcde.pooler.supabase.com")
    monkeypatch.setenv("DEMO_SEED", "1")
    with pytest.raises(SystemExit):
        seed_demo.check_allowed_to_write()


def test_guard_refuses_a_remote_host_without_opt_in(monkeypatch):
    monkeypatch.setattr(seed_demo, "db_host", lambda: "demo-db.example.net")
    monkeypatch.setenv("DEMO_SEED", "1")
    monkeypatch.delenv("DEMO_SEED_ALLOW_REMOTE", raising=False)
    with pytest.raises(SystemExit):
        seed_demo.check_allowed_to_write()


def test_guard_allows_a_local_host_with_demo_seed(monkeypatch):
    monkeypatch.setattr(seed_demo, "db_host", lambda: "127.0.0.1")
    monkeypatch.setenv("DEMO_SEED", "1")
    seed_demo.check_allowed_to_write()  # does not raise
