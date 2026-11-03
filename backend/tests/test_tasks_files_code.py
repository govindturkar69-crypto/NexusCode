import io

import pytest
from conftest import auth
from sqlalchemy.exc import IntegrityError

from app.core.database import SessionLocal
from app.models import TaskModel


@pytest.fixture
def alice(make_user):
    return make_user("alice")


@pytest.fixture
def pid(alice, project_of):
    return project_of(alice)


def test_task_lifecycle(client, alice, pid):
    r = client.post(f"/projects/{pid}/tasks", json={"title": "Write tests", "description": "now"}, headers=auth(alice))
    task = r.json()["task"]
    assert task["status"] == "todo" and task["title"] == "Write tests"
    for status in ("in_progress", "done", "todo"):
        r = client.put(f"/tasks/{task['id']}", json={"status": status}, headers=auth(alice))
        assert r.status_code == 200 and r.json()["task"]["status"] == status
    assert client.delete(f"/tasks/{task['id']}", headers=auth(alice)).status_code == 204
    assert client.get(f"/projects/{pid}/tasks", headers=auth(alice)).json()["tasks"] == []


@pytest.mark.parametrize("status", ["archived", "", "DONE", None, 3])
def test_invalid_task_status_is_422(client, alice, pid, status):
    task_id = client.post(f"/projects/{pid}/tasks", json={"title": "t"}, headers=auth(alice)).json()["task"]["id"]
    assert client.put(f"/tasks/{task_id}", json={"status": status}, headers=auth(alice)).status_code == 422


def test_database_check_constraint_blocks_bad_status(pid):
    with SessionLocal() as db:
        db.add(TaskModel(title="bad", status="bogus", project_id=pid))
        with pytest.raises(IntegrityError):
            db.commit()


def test_missing_task_is_404(client, alice):
    assert client.put("/tasks/999", json={"status": "done"}, headers=auth(alice)).status_code == 404
    assert client.delete("/tasks/999", headers=auth(alice)).status_code == 404


def test_file_upload_list_delete(client, alice, pid, fake_cloudinary):
    r = client.post(
        f"/projects/{pid}/files",
        files={"file": ("report.pdf", io.BytesIO(b"%PDF-1.4 data"), "application/pdf")},
        headers=auth(alice),
    )
    assert r.status_code == 201, r.text
    file = r.json()["file"]
    assert file["filename"] == "report.pdf"
    assert file["url"].startswith("https://")
    assert len(fake_cloudinary["uploads"]) == 1

    files = client.get(f"/projects/{pid}/files", headers=auth(alice)).json()["files"]
    assert [f["filename"] for f in files] == ["report.pdf"]

    assert client.delete(f"/files/{file['id']}", headers=auth(alice)).status_code == 204
    assert client.get(f"/projects/{pid}/files", headers=auth(alice)).json()["files"] == []
    assert client.delete(f"/files/{file['id']}", headers=auth(alice)).status_code == 404


def test_upload_to_missing_project_is_404(client, alice, fake_cloudinary):
    r = client.post("/projects/999/files", files={"file": ("a.txt", io.BytesIO(b"x"), "text/plain")}, headers=auth(alice))
    assert r.status_code == 404
    assert fake_cloudinary["uploads"] == []


def test_code_file_created_on_first_read_and_saved(client, alice, pid):
    r = client.get(f"/projects/{pid}/code", headers=auth(alice))
    assert r.json()["code_file"]["content"] == "" and r.json()["code_file"]["language"] == "python"
    client.put(f"/projects/{pid}/code", json={"content": "console.log(1)", "language": "javascript"}, headers=auth(alice))
    code = client.get(f"/projects/{pid}/code", headers=auth(alice)).json()["code_file"]
    assert code["content"] == "console.log(1)" and code["language"] == "javascript"


def test_project_create_get_delete(client, alice):
    r = client.post("/projects", json={"name": "P", "description": "d"}, headers=auth(alice))
    project = r.json()["project"]
    assert project["name"] == "P" and project["description"] == "d"
    assert client.get(f"/projects/{project['id']}", headers=auth(alice)).json()["project"]["name"] == "P"
    assert client.delete(f"/projects/{project['id']}", headers=auth(alice)).status_code == 204
    assert client.delete(f"/projects/{project['id']}", headers=auth(alice)).status_code == 404


def test_ai_routes_require_auth_and_call_service(client, alice, fake_ai):
    for path, body in (("/ai/generate-code", {"prompt": "p"}), ("/ai/detect-bugs", {"code": "c"}), ("/ai/generate-docs", {"code": "c"})):
        assert client.post(path, json=body).status_code == 401
        r = client.post(path, json=body, headers=auth(alice))
        assert r.status_code == 200 and r.json()["result"].endswith("result")
    assert [name for name, _ in fake_ai] == ["generate_code", "detect_bugs", "generate_docs"]


def test_ai_quota_and_busy_errors_are_503(client, alice, monkeypatch):
    from app.services import ai as ai_service
    from app.services.ai import AIQuotaExceededError, AIServiceBusyError

    def quota(_):
        raise AIQuotaExceededError("quota reached")

    def busy(_):
        raise AIServiceBusyError("busy")

    monkeypatch.setattr(ai_service, "generate_code", quota)
    monkeypatch.setattr(ai_service, "detect_bugs", busy)
    r = client.post("/ai/generate-code", json={"prompt": "p"}, headers=auth(alice))
    assert r.status_code == 503 and r.json()["detail"] == "quota reached"
    assert client.post("/ai/detect-bugs", json={"code": "c"}, headers=auth(alice)).status_code == 503


def test_new_tasks_go_to_the_end_and_have_timestamps(client, alice, pid):
    ids = [client.post(f"/projects/{pid}/tasks", json={"title": t}, headers=auth(alice)).json()["task"]["id"] for t in "abc"]
    tasks = client.get(f"/projects/{pid}/tasks", headers=auth(alice)).json()["tasks"]
    assert [t["id"] for t in tasks] == ids
    assert [t["position"] for t in tasks] == [1, 2, 3]
    assert all(t["created_at"] and t["updated_at"] for t in tasks)


def test_chat_messages_record_the_sender_id(client, alice, pid):
    from app.models import MessageModel, UserModel

    with client.websocket_connect(f"/ws/projects/{pid}/chat?token={alice}") as ws:
        ws.send_json({"content": "hi"})
        ws.receive_json()
    with SessionLocal() as db:
        message = db.query(MessageModel).one()
        assert message.user_id == db.query(UserModel.id).filter(UserModel.username == "alice").scalar()


def test_messages_are_newest_first(client, alice, pid):
    with client.websocket_connect(f"/ws/projects/{pid}/chat?token={alice}") as ws:
        for text in ("one", "two", "three"):
            ws.send_json({"content": text})
            ws.receive_json()
    messages = client.get(f"/projects/{pid}/messages", headers=auth(alice)).json()["messages"]
    assert [m["content"] for m in messages] == ["three", "two", "one"]
