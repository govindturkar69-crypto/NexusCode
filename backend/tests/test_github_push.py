"""Pushing a whole project to GitHub in one commit."""
import pytest
from conftest import add_member, auth, get_github_token, set_github_token

from app.core.database import SessionLocal
from app.models import ActivityModel, UserModel
from app.routers import github as github_router
from app.services import github as github_service


@pytest.fixture
def project(client, make_user, project_of):
    token = make_user("alice")
    pid = project_of(token)
    headers = auth(token)
    for path, content in {"main.py": "print(1)", "src/util/helpers.js": "export {}", "empty.txt": ""}.items():
        assert client.post(f"/projects/{pid}/code/files", json={"path": path, "content": content}, headers=headers).status_code == 201
    set_github_token("alice", "gho_alice")
    return {"pid": pid, "headers": headers, "files": {"main.py": "print(1)", "src/util/helpers.js": "export {}", "empty.txt": ""}}


def _push(client, project, **body):
    return client.post(f"/projects/{project['pid']}/push-to-github", json=body, headers=project["headers"])


# ---- new repository ----

def test_new_repo_gets_all_files_in_one_commit(client, project, fake_github_http):
    r = _push(client, project, repo_name="fresh")
    assert r.status_code == 200, r.text
    data = r.json()
    assert fake_github_http["repo_files"]("fresh") == project["files"]  # GitHub's README is gone
    commits = fake_github_http["commits_on"]("fresh")
    assert [c["message"] for c in commits] == ["Update from NexusCode (3 files)", "Initial commit"]
    assert data["changed"] is True and data["files"] == 3 and data["branch"] == "main"
    assert data["repo_full_name"] == "tester/fresh"
    assert data["commit_url"].startswith("https://github.test/tester/fresh/commit/")


def test_new_repo_is_private_unless_asked(client, project, fake_github_http):
    _push(client, project, repo_name="a")
    assert fake_github_http["repos"]["a"]["private"] is True
    r = _push(client, project, repo_name="b", private=False)
    assert fake_github_http["repos"]["b"]["private"] is False and r.json()["private"] is False


def test_new_repo_on_a_chosen_branch(client, project, fake_github_http):
    r = _push(client, project, repo_name="fresh", branch="dev")
    assert r.status_code == 200, r.text
    assert r.json()["branch"] == "dev"
    assert fake_github_http["repo_files"]("fresh", "dev") == project["files"]
    assert fake_github_http["repo_files"]("fresh", "main") == {"README.md": "# fresh"}


def test_new_repo_waits_for_github_to_finish_creating_it(client, project, fake_github_http):
    fake_github_http["init_delay"] = 2
    assert _push(client, project, repo_name="slow").status_code == 200
    assert fake_github_http["repo_files"]("slow") == project["files"]


def test_new_repo_that_never_gets_ready_says_so(client, project, fake_github_http):
    fake_github_http["init_delay"] = 99
    r = _push(client, project, repo_name="stuck")
    assert r.status_code == 502
    assert "was created" in r.json()["detail"] and "existing repository" in r.json()["detail"]


def test_name_taken_is_explained(client, project, fake_github_http):
    fake_github_http["create_status"] = 422
    r = _push(client, project, repo_name="dup")
    assert r.status_code == 400 and "already exists" in r.json()["detail"]


# ---- existing repository ----

def test_existing_repo_keeps_files_only_on_github(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    r = _push(client, project, repo_name="mine", existing=True)
    assert r.status_code == 200, r.text
    assert fake_github_http["repo_files"]("mine") == {"README.md": "# mine", **project["files"]}
    assert len(fake_github_http["commits_on"]("mine")) == 2
    assert not any(call[1].endswith("/user/repos") and call[0] == "POST" for call in fake_github_http["calls"])


def test_existing_repo_overwrites_changed_files_in_one_commit(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    _push(client, project, repo_name="mine", existing=True)
    file_id = client.get(f"/projects/{project['pid']}/code/files", headers=project["headers"]).json()["code_files"][1]["id"]
    client.put(f"/code-files/{file_id}", json={"content": "print(2)"}, headers=project["headers"])
    r = _push(client, project, repo_name="mine", existing=True)
    assert r.json()["changed"] is True
    assert fake_github_http["repo_files"]("mine")["main.py"] == "print(2)"
    assert len(fake_github_http["commits_on"]("mine")) == 3


def test_new_branch_starts_from_the_default_branch(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    r = _push(client, project, repo_name="mine", existing=True, branch="feature/x")
    assert r.status_code == 200, r.text
    assert r.json()["branch"] == "feature/x"
    assert fake_github_http["repo_files"]("mine", "feature/x") == {"README.md": "# mine", **project["files"]}
    assert fake_github_http["repo_files"]("mine", "main") == {"README.md": "# mine"}
    assert len(fake_github_http["commits_on"]("mine", "feature/x")) == 2


def test_pushing_again_with_no_changes_makes_no_commit_or_activity(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    assert _push(client, project, repo_name="mine", existing=True).json()["changed"] is True
    again = _push(client, project, repo_name="mine", existing=True)
    assert again.status_code == 200
    assert again.json()["changed"] is False and "nothing to commit" in again.json()["message"]
    assert len(fake_github_http["commits_on"]("mine")) == 2
    with SessionLocal() as db:
        assert db.query(ActivityModel).filter(ActivityModel.action == "github_pushed").count() == 1


def test_new_branch_with_identical_files_is_still_created(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    _push(client, project, repo_name="mine", existing=True)
    r = _push(client, project, repo_name="mine", existing=True, branch="copy")
    assert r.status_code == 200 and r.json()["changed"] is False
    assert "copy" in fake_github_http["repos"]["mine"]["refs"]


def test_completely_empty_repo_works(client, project, fake_github_http):
    fake_github_http["new_repo"]("blank", empty=True)
    r = _push(client, project, repo_name="blank", existing=True)
    assert r.status_code == 200, r.text
    assert fake_github_http["repo_files"]("blank") == project["files"]


def test_missing_repo_is_explained(client, project, fake_github_http):
    r = _push(client, project, repo_name="nope", existing=True)
    assert r.status_code == 400 and "no repository called nope" in r.json()["detail"]


def test_only_the_users_own_account_is_reachable(client, project, fake_github_http):
    """The owner comes from the token. A slash in the name can't point elsewhere."""
    assert _push(client, project, repo_name="someone/else", existing=True).status_code == 422
    assert _push(client, project, repo_name="..", existing=True).status_code == 422
    assert _push(client, project, repo_name=".", existing=True).status_code == 422
    assert not any("/repos/someone" in call[1] for call in fake_github_http["calls"])


def test_rejected_update_is_reported_and_nothing_is_logged(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    fake_github_http["push_status"] = 403
    r = _push(client, project, repo_name="mine", existing=True)
    assert r.status_code == 400 and "Could not push to tester/mine" in r.json()["detail"]
    with SessionLocal() as db:
        assert db.query(ActivityModel).filter(ActivityModel.action == "github_pushed").count() == 0


# ---- large files and limits ----

def test_large_files_go_as_blobs_and_small_ones_inline(client, project, fake_github_http):
    big = "x" * (github_service.INLINE_FILE_LIMIT_BYTES + 1)
    client.post(f"/projects/{project['pid']}/code/files", json={"path": "big.txt", "content": big}, headers=project["headers"])
    assert _push(client, project, repo_name="fresh").status_code == 200
    assert fake_github_http["repo_files"]("fresh")["big.txt"] == big
    assert len([c for c in fake_github_http["calls"] if c[1].endswith("/git/blobs")]) == 1


def test_unicode_survives(client, project, fake_github_http):
    client.post(f"/projects/{project['pid']}/code/files", json={"path": "ünï/cödé.py", "content": "print('héllo 🌍')"}, headers=project["headers"])
    assert _push(client, project, repo_name="fresh").status_code == 200
    assert fake_github_http["repo_files"]("fresh")["ünï/cödé.py"] == "print('héllo 🌍')"


def test_project_with_no_files_is_refused_before_github(client, make_user, project_of, fake_github_http):
    token = make_user("bob")
    pid = project_of(token)
    set_github_token("bob", "gho_b")
    r = client.post(f"/projects/{pid}/push-to-github", json={"repo_name": "x"}, headers=auth(token))
    assert r.status_code == 400 and "no files" in r.json()["detail"]
    assert fake_github_http["calls"] == []


def test_too_large_a_project_is_refused_before_github(client, project, fake_github_http, monkeypatch):
    monkeypatch.setattr(github_router, "MAX_PUSH_BYTES", 5)
    r = _push(client, project, repo_name="x")
    assert r.status_code == 400 and "larger than" in r.json()["detail"]
    assert fake_github_http["calls"] == []


@pytest.mark.parametrize("branch", ["", "a b", "/x", "x/", "a//b", "a..b", "x.lock", "-x", "x.", "a~b", "a^b", "a:b", "x" * 101])
def test_invalid_branch_names_are_refused(client, project, fake_github_http, branch):
    assert _push(client, project, repo_name="x", branch=branch).status_code == 422
    assert fake_github_http["calls"] == []


@pytest.mark.parametrize("branch", ["main", "feature/new-thing", "release-1.2", "v1.0_rc"])
def test_valid_branch_names_are_accepted(client, project, fake_github_http, branch):
    assert _push(client, project, repo_name="fresh", branch=branch).status_code == 200


# ---- errors and the token ----

def test_revoked_token_asks_to_reconnect(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    fake_github_http["push_status"] = 401
    r = _push(client, project, repo_name="mine", existing=True)
    assert r.status_code == 400 and "reconnect" in r.json()["detail"].lower()


def test_github_outage_is_502(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    fake_github_http["push_status"] = 500
    assert _push(client, project, repo_name="mine", existing=True).status_code == 502


def test_token_stays_encrypted_and_out_of_responses(client, project, fake_github_http):
    r = _push(client, project, repo_name="fresh")
    assert "gho_alice" not in r.text
    assert get_github_token("alice") == "gho_alice"
    with SessionLocal() as db:
        raw = db.execute(UserModel.__table__.select().with_only_columns(UserModel.__table__.c.github_token)).scalar()
        stored = db.connection().exec_driver_sql("SELECT github_token FROM users WHERE username = 'alice'").scalar()
    assert raw == "gho_alice"  # through the model it decrypts...
    assert "gho_alice" not in stored  # ...but what's in the table doesn't contain it


# ---- activity and permissions ----

def test_push_is_in_the_activity_feed_with_its_branch(client, project, fake_github_http):
    _push(client, project, repo_name="fresh", branch="dev")
    feed = client.get(f"/projects/{project['pid']}/activity", headers=project["headers"]).json()["activity"]
    assert (feed[0]["action"], feed[0]["target"]) == ("github_pushed", "tester/fresh (dev)")


@pytest.mark.parametrize("role", ["viewer", "editor"])
def test_only_owners_can_push(client, project, make_user, fake_github_http, role):
    token = make_user(role)
    add_member(role, project["pid"], role)
    set_github_token(role, "gho_x")
    r = client.post(f"/projects/{project['pid']}/push-to-github", json={"repo_name": "x"}, headers=auth(token))
    assert r.status_code == 403
    assert fake_github_http["calls"] == []


def test_outsiders_cannot_push(client, project, make_user, fake_github_http):
    token = make_user("eve")
    set_github_token("eve", "gho_x")
    r = client.post(f"/projects/{project['pid']}/push-to-github", json={"repo_name": "x"}, headers=auth(token))
    assert r.status_code == 404
    assert fake_github_http["calls"] == []


# ---- listing repositories and branches ----

def test_lists_repos_and_branches(client, project, fake_github_http):
    fake_github_http["new_repo"]("mine")
    repos = client.get("/me/github/repos", headers=project["headers"]).json()["repos"]
    assert repos == [{"name": "mine", "full_name": "tester/mine", "private": True, "default_branch": "main", "html_url": "https://github.test/tester/mine"}]
    r = client.get("/me/github/repos/mine/branches", headers=project["headers"])
    assert r.json() == {"branches": ["main"]}


def test_listing_needs_login_and_a_connection(client, make_user, fake_github_http):
    assert client.get("/me/github/repos").status_code == 401
    assert client.get("/me/github/repos/x/branches").status_code == 401
    token = make_user("bob")
    assert client.get("/me/github/repos", headers=auth(token)).status_code == 400
    assert client.get("/me/github/repos/x/branches", headers=auth(token)).status_code == 400


def test_branch_listing_rejects_bad_names_and_missing_repos(client, project, fake_github_http):
    assert client.get("/me/github/repos/bad%20name/branches", headers=project["headers"]).status_code == 422
    r = client.get("/me/github/repos/nope/branches", headers=project["headers"])
    assert r.status_code == 400 and "nope" in r.json()["detail"]


def test_listing_with_a_revoked_token_asks_to_reconnect(client, project, fake_github_http):
    fake_github_http["user_status"] = 401
    r = client.get("/me/github/repos/mine/branches", headers=project["headers"])
    assert r.status_code == 400 and "reconnect" in r.json()["detail"].lower()
