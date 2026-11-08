"""Profile and settings: password, GitHub connection, account deletion."""
import io

import pytest
from conftest import (
    DEFAULT_PASSWORD,
    add_member,
    auth,
    get_github_token,
    set_github_token,
    ws_path,
)

from app.core.database import SessionLocal
from app.models import (
    ActivityModel,
    MessageModel,
    NotificationModel,
    ProjectMemberModel,
    ProjectModel,
    TaskModel,
    UserModel,
)

NEW_PASSWORD = "brand-new-password-2"


def _user_id(username):
    with SessionLocal() as db:
        return db.query(UserModel.id).filter(UserModel.username == username).scalar()


def _login(client, username, password):
    return client.post("/login", data={"username": username, "password": password}).status_code


# ---- change password ----

def test_change_password(client, make_user):
    token = make_user("alice")
    r = client.post("/me/password", json={"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD}, headers=auth(token))
    assert r.status_code == 200
    assert _login(client, "alice", NEW_PASSWORD) == 200
    assert _login(client, "alice", DEFAULT_PASSWORD) == 401


def test_change_password_needs_the_current_one(client, make_user):
    token = make_user("alice")
    r = client.post("/me/password", json={"current_password": "wrong-password", "new_password": NEW_PASSWORD}, headers=auth(token))
    # 400, because the frontend logs out on any 401
    assert r.status_code == 400
    assert _login(client, "alice", DEFAULT_PASSWORD) == 200


@pytest.mark.parametrize("new", ["short", "x" * 73, "é" * 37])
def test_new_password_must_be_8_to_72_bytes(client, make_user, new):
    token = make_user("alice")
    r = client.post("/me/password", json={"current_password": DEFAULT_PASSWORD, "new_password": new}, headers=auth(token))
    assert r.status_code == 422
    assert "8 and 72 bytes" in r.text
    assert _login(client, "alice", DEFAULT_PASSWORD) == 200


def test_new_password_limits_are_inclusive(client, make_user):
    token = make_user("alice")
    r = client.post("/me/password", json={"current_password": DEFAULT_PASSWORD, "new_password": "x" * 72}, headers=auth(token))
    assert r.status_code == 200
    # A password change ends other sessions, so carry on with the token it returns
    token = r.json()["access_token"]
    r = client.post("/me/password", json={"current_password": "x" * 72, "new_password": "y" * 8}, headers=auth(token))
    assert r.status_code == 200


def test_new_password_must_differ(client, make_user):
    token = make_user("alice")
    r = client.post("/me/password", json={"current_password": DEFAULT_PASSWORD, "new_password": DEFAULT_PASSWORD}, headers=auth(token))
    assert r.status_code == 400


def test_an_overlong_current_password_is_just_wrong(client, make_user):
    token = make_user("alice")
    r = client.post("/me/password", json={"current_password": "x" * 100, "new_password": NEW_PASSWORD}, headers=auth(token))
    assert r.status_code == 400


def test_password_guessing_is_rate_limited(client, make_user, rate_limits):
    token = make_user("alice")
    body = {"current_password": "wrong-password", "new_password": NEW_PASSWORD}
    codes = [client.post("/me/password", json=body, headers=auth(token)).status_code for _ in range(6)]
    assert codes == [400] * 5 + [429]


@pytest.mark.parametrize("method,path", [
    ("post", "/me/password"),
    ("get", "/me/github"),
    ("delete", "/me/github"),
    ("get", "/me/deletion-plan"),
    ("post", "/me/delete"),
])
def test_all_of_it_needs_a_login(client, method, path):
    assert client.request(method.upper(), path, json={}).status_code == 401


# ---- GitHub connection ----

def test_github_status_when_not_connected(client, make_user):
    assert client.get("/me/github", headers=auth(make_user("alice"))).json() == {"connected": False, "username": None, "expired": False}


def test_github_status_shows_the_username(client, make_user, fake_github_http):
    token = make_user("alice")
    set_github_token("alice", "gho_x")
    r = client.get("/me/github", headers=auth(token)).json()
    assert r == {"connected": True, "username": "tester", "expired": False}


def test_github_status_when_the_token_was_revoked(client, make_user, fake_github_http):
    token = make_user("alice")
    set_github_token("alice", "gho_x")
    fake_github_http["user_status"] = 401
    r = client.get("/me/github", headers=auth(token)).json()
    assert r == {"connected": True, "username": None, "expired": True}


def test_github_status_when_github_is_down(client, make_user, fake_github_http):
    token = make_user("alice")
    set_github_token("alice", "gho_x")
    fake_github_http["user_status"] = 503
    r = client.get("/me/github", headers=auth(token)).json()
    assert r == {"connected": True, "username": None, "expired": False}


def test_disconnect_github_deletes_only_your_token(client, make_user):
    alice, _bob = make_user("alice"), make_user("bob")
    set_github_token("alice", "gho_a")
    set_github_token("bob", "gho_b")
    assert client.delete("/me/github", headers=auth(alice)).status_code == 204
    assert get_github_token("alice") is None
    assert get_github_token("bob") == "gho_b"
    assert client.delete("/me/github", headers=auth(alice)).status_code == 204  # already gone: still fine


def test_push_after_disconnect_is_refused(client, make_user, project_of):
    token = make_user("alice")
    pid = project_of(token, "P")
    set_github_token("alice", "gho_a")
    client.delete("/me/github", headers=auth(token))
    client.put(f"/projects/{pid}/code", json={"content": "x", "language": "python"}, headers=auth(token))
    assert client.post(f"/projects/{pid}/push-to-github", json={"repo_name": "r"}, headers=auth(token)).status_code == 400


# ---- deleting an account ----

@pytest.fixture
def world(client, make_user, project_of):
    """alice is in five projects, each with a different future."""
    t = {name: make_user(name) for name in ("alice", "bob", "carol", "dave")}
    p = {
        "alone": project_of(t["alice"], "Alone"),
        "with_editor": project_of(t["alice"], "With editor"),
        "with_viewer": project_of(t["alice"], "With viewer"),
        "co_owned": project_of(t["alice"], "Co-owned"),
        "bobs": project_of(t["bob"], "Bobs"),
    }
    # carol joined first but is only a viewer: an editor is preferred
    add_member("carol", p["with_editor"], "viewer")
    add_member("bob", p["with_editor"], "editor")
    add_member("dave", p["with_editor"], "editor")
    add_member("carol", p["with_viewer"], "viewer")
    add_member("bob", p["co_owned"], "owner")
    add_member("alice", p["bobs"], "editor")
    return {"t": t, "p": p, "alice": auth(t["alice"])}


def _delete(client, world, password=DEFAULT_PASSWORD):
    return client.post("/me/delete", json={"password": password}, headers=world["alice"])


def _role(project_id, username):
    with SessionLocal() as db:
        return (
            db.query(ProjectMemberModel.role)
            .join(UserModel, ProjectMemberModel.user_id == UserModel.id)
            .filter(ProjectMemberModel.project_id == project_id, UserModel.username == username)
            .scalar()
        )


def _owner_id(project_id):
    with SessionLocal() as db:
        return db.query(ProjectModel.owner_id).filter(ProjectModel.id == project_id).scalar()


def test_the_plan_says_what_will_happen(client, world):
    p = world["p"]
    assert client.get("/me/deletion-plan", headers=world["alice"]).json() == {
        "deleted": [{"project_id": p["alone"], "name": "Alone"}],
        "transferred": [
            {"project_id": p["with_editor"], "name": "With editor", "new_owner": "bob"},
            {"project_id": p["with_viewer"], "name": "With viewer", "new_owner": "carol"},
        ],
        "left": [
            {"project_id": p["co_owned"], "name": "Co-owned"},
            {"project_id": p["bobs"], "name": "Bobs"},
        ],
    }


def test_the_plan_changes_nothing(client, world):
    client.get("/me/deletion-plan", headers=world["alice"])
    assert _role(world["p"]["with_editor"], "bob") == "editor"
    assert _login(client, "alice", DEFAULT_PASSWORD) == 200


def test_deleting_needs_the_right_password(client, world):
    assert _delete(client, world, "wrong-password").status_code == 400
    assert _login(client, "alice", DEFAULT_PASSWORD) == 200
    with SessionLocal() as db:
        assert db.query(ProjectModel).count() == 5


def test_deleting_is_rate_limited(client, world, rate_limits):
    codes = [_delete(client, world, "wrong-password").status_code for _ in range(6)]
    assert codes == [400] * 5 + [429]


def test_account_is_gone_and_the_session_stops_working(client, world):
    assert _delete(client, world).status_code == 204
    assert _login(client, "alice", DEFAULT_PASSWORD) == 401
    assert client.get("/me", headers=world["alice"]).status_code == 401
    assert client.get("/projects", headers=world["alice"]).status_code == 401


def test_a_project_nobody_else_is_in_is_deleted_with_its_files(client, world, fake_cloudinary):
    pid = world["p"]["alone"]
    client.post(f"/projects/{pid}/files", files={"file": ("a.txt", io.BytesIO(b"hi"), "text/plain")}, headers=world["alice"])
    assert _delete(client, world).status_code == 204
    with SessionLocal() as db:
        assert db.get(ProjectModel, pid) is None
    assert len(fake_cloudinary["destroyed"]) == 1


def test_a_cloudinary_failure_does_not_block_deletion(client, world, fake_cloudinary):
    pid = world["p"]["alone"]
    client.post(f"/projects/{pid}/files", files={"file": ("a.txt", io.BytesIO(b"hi"), "text/plain")}, headers=world["alice"])
    fake_cloudinary["destroy_result"] = "error"
    assert _delete(client, world).status_code == 204


def test_editor_is_preferred_as_the_new_owner_and_is_told(client, world):
    pid, bob = world["p"]["with_editor"], world["t"]["bob"]
    assert _delete(client, world).status_code == 204
    assert _role(pid, "bob") == "owner"
    assert _role(pid, "carol") == "viewer"
    assert _role(pid, "dave") == "editor"
    assert _owner_id(pid) == _user_id("bob")
    notes = client.get("/notifications", headers=auth(bob)).json()["notifications"]
    assert "alice deleted their account, so you now own With editor" in [n["message"] for n in notes]
    # The new owner really can act as one
    assert client.delete(f"/projects/{pid}", headers=auth(bob)).status_code == 204


def test_a_viewer_takes_over_when_there_is_nobody_else(client, world):
    pid = world["p"]["with_viewer"]
    _delete(client, world)
    assert _role(pid, "carol") == "owner"
    assert _owner_id(pid) == _user_id("carol")


def test_a_project_with_another_owner_just_carries_on(client, world):
    pid = world["p"]["co_owned"]
    _delete(client, world)
    assert _role(pid, "bob") == "owner"
    assert _role(pid, "alice") is None
    assert _owner_id(pid) == _user_id("bob")
    notes = client.get("/notifications", headers=auth(world["t"]["bob"])).json()["notifications"]
    assert not any("Co-owned" in n["message"] for n in notes)


def test_a_project_they_only_belonged_to_is_untouched(client, world):
    pid = world["p"]["bobs"]
    _delete(client, world)
    assert _owner_id(pid) == _user_id("bob")
    assert _role(pid, "alice") is None


def test_their_work_stays_but_loses_the_link(client, world):
    pid, alice_id = world["p"]["bobs"], _user_id("alice")
    task = client.post(f"/projects/{pid}/tasks", json={"title": "Mine", "assignee_id": alice_id}, headers=world["alice"]).json()["task"]
    with SessionLocal() as db:
        db.add(MessageModel(username="alice", user_id=alice_id, content="hello", project_id=pid))
        db.add(NotificationModel(user_id=alice_id, project_id=pid, kind="added", message="x"))
        db.commit()

    assert _delete(client, world).status_code == 204

    bob = auth(world["t"]["bob"])
    with SessionLocal() as db:
        assert db.get(TaskModel, task["id"]).assignee_id is None
        assert db.query(NotificationModel).filter(NotificationModel.user_id == alice_id).count() == 0
        assert db.query(ActivityModel).filter(ActivityModel.user_id == alice_id).count() == 0
    message = client.get(f"/projects/{pid}/messages", headers=bob).json()["messages"][0]
    assert (message["username"], message["user_id"], message["author_removed"]) == ("alice", None, True)
    feed = client.get(f"/projects/{pid}/activity", headers=bob).json()["activity"]
    assert feed[0]["action"] == "member_left" and feed[0]["username"] is None and feed[0]["target"] == "alice"
    assert any(e["action"] == "task_created" and e["username"] is None for e in feed)


def test_the_username_is_free_again(client, world):
    _delete(client, world)
    r = client.post("/signup", json={"username": "alice", "password": NEW_PASSWORD})
    assert r.status_code == 201
    token = client.post("/login", data={"username": "alice", "password": NEW_PASSWORD}).json()["access_token"]
    assert client.get("/projects", headers=auth(token)).json()["projects"] == []


def test_a_user_with_no_projects_can_delete(client, make_user):
    token = make_user("loner")
    assert client.post("/me/delete", json={"password": DEFAULT_PASSWORD}, headers=auth(token)).status_code == 204


def test_live_sockets_are_closed_and_teammates_see_it(client, world):
    pid = world["p"]["bobs"]
    with client.websocket_connect(ws_path(client, world["t"]["bob"], pid)) as bob:
        assert bob.receive_json()["type"] == "presence"
        with client.websocket_connect(ws_path(client, world["t"]["alice"], pid)) as alice:
            assert alice.receive_json()["type"] == "presence"
            assert bob.receive_json()["type"] == "presence"
            assert _delete(client, world).status_code == 204
        frames = []
        while True:
            frames.append(bob.receive_json())
            if frames[-1].get("type") == "activity":
                break
        assert frames[-1] == {"type": "activity", "action": "member_left"}
        presence = [f for f in frames if f["type"] == "presence"]
        assert [u["username"] for u in presence[-1]["users"]] == ["bob"]
