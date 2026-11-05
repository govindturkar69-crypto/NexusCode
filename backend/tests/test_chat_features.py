"""Presence, typing, message metadata and removed-member marking."""
from datetime import datetime

import pytest
from conftest import add_member, auth, ws_path

from app.core.database import SessionLocal
from app.models import MessageModel, UserModel
from app.routers import chat as chat_router


@pytest.fixture
def team(client, make_user, project_of):
    tokens = {name: make_user(name) for name in ("olivia", "eddie", "vera")}
    pid = project_of(tokens["olivia"], "team")
    add_member("eddie", pid, "editor")
    add_member("vera", pid, "viewer")
    with SessionLocal() as db:
        ids = {name: db.query(UserModel.id).filter(UserModel.username == name).scalar() for name in tokens}
    return {"t": tokens, "pid": pid, "id": ids}


def _connect(client, team, name):
    return client.websocket_connect(ws_path(client, team["t"][name], team["pid"]))


def _names(frame):
    assert frame["type"] == "presence"
    return [u["username"] for u in frame["users"]]


def test_presence_updates_on_join_and_leave(client, team):
    with _connect(client, team, "olivia") as olivia:
        assert _names(olivia.receive_json()) == ["olivia"]
        with _connect(client, team, "vera") as vera:
            assert _names(vera.receive_json()) == ["olivia", "vera"]
            assert _names(olivia.receive_json()) == ["olivia", "vera"]
        assert _names(olivia.receive_json()) == ["olivia"]


def test_two_tabs_count_as_one_person_until_both_close(client, team):
    with _connect(client, team, "olivia") as olivia:
        olivia.receive_json()
        with _connect(client, team, "eddie") as tab1:
            tab1.receive_json()
            olivia.receive_json()
            with _connect(client, team, "eddie") as tab2:
                assert _names(tab2.receive_json()) == ["eddie", "olivia"]
                olivia.receive_json()
            assert _names(olivia.receive_json()) == ["eddie", "olivia"]  # one tab still open
        assert _names(olivia.receive_json()) == ["olivia"]


def test_presence_is_per_project(client, team, project_of):
    other = project_of(team["t"]["vera"], "other")
    with _connect(client, team, "olivia") as olivia:
        assert _names(olivia.receive_json()) == ["olivia"]
        with client.websocket_connect(ws_path(client, team["t"]["vera"], other)) as vera:
            assert _names(vera.receive_json()) == ["vera"]
            olivia.send_json({"content": "ping"})
            assert olivia.receive_json()["content"] == "ping"  # no presence frame in between


def test_removing_a_member_updates_presence_for_others(client, team):
    owner = auth(team["t"]["olivia"])
    with _connect(client, team, "olivia") as olivia, _connect(client, team, "eddie"):
        olivia.receive_json()
        assert _names(olivia.receive_json()) == ["eddie", "olivia"]
        client.delete(f"/projects/{team['pid']}/members/{team['id']['eddie']}", headers=owner)
        assert _names(olivia.receive_json()) == ["olivia"]


def test_typing_goes_to_others_with_the_name_from_the_token(client, team):
    with _connect(client, team, "olivia") as olivia, _connect(client, team, "eddie") as eddie:
        olivia.receive_json()
        olivia.receive_json()
        eddie.receive_json()
        eddie.send_json({"type": "typing", "username": "mallory"})
        assert olivia.receive_json() == {"type": "typing", "user_id": team["id"]["eddie"], "username": "eddie"}


def test_typing_is_not_echoed_or_saved_and_is_throttled(client, team, monkeypatch):
    with _connect(client, team, "olivia") as olivia, _connect(client, team, "eddie") as eddie:
        olivia.receive_json()
        olivia.receive_json()
        eddie.receive_json()
        eddie.send_json({"type": "typing"})
        eddie.send_json({"type": "typing"})  # within the interval: dropped
        assert olivia.receive_json()["type"] == "typing"
        eddie.send_json({"content": "hi"})
        assert olivia.receive_json()["content"] == "hi"  # no second typing frame came first
        assert eddie.receive_json()["content"] == "hi"  # the sender never saw its own typing frame
    r = client.get(f"/projects/{team['pid']}/messages", headers=auth(team["t"]["olivia"]))
    assert [m["content"] for m in r.json()["messages"]] == ["hi"]


def test_viewers_cannot_send_typing(client, team, monkeypatch):
    monkeypatch.setattr(chat_router, "TYPING_MIN_INTERVAL_SECONDS", 0)
    with _connect(client, team, "olivia") as olivia, _connect(client, team, "vera") as vera:
        olivia.receive_json()
        olivia.receive_json()
        vera.receive_json()
        vera.send_json({"type": "typing"})
        vera.send_json({"content": "nope"})
        assert vera.receive_json()["type"] == "error"  # processed after the typing frame
        olivia.send_json({"content": "next"})
        assert olivia.receive_json()["content"] == "next"  # olivia got no typing frame


def test_live_messages_carry_author_and_timestamp(client, team):
    with _connect(client, team, "eddie") as eddie:
        eddie.receive_json()
        eddie.send_json({"content": "hello"})
        message = eddie.receive_json()
    assert message["type"] == "message"
    assert message["user_id"] == team["id"]["eddie"] and message["username"] == "eddie"
    assert datetime.fromisoformat(message["created_at"])
    assert message["author_removed"] is False


def test_history_marks_messages_from_removed_members_but_keeps_them(client, team):
    owner = auth(team["t"]["olivia"])
    with _connect(client, team, "eddie") as eddie:
        eddie.receive_json()
        eddie.send_json({"content": "from eddie"})
        eddie.receive_json()
    with _connect(client, team, "olivia") as olivia:
        olivia.receive_json()
        olivia.send_json({"content": "from olivia"})
        olivia.receive_json()

    def history():
        return {m["content"]: m for m in client.get(f"/projects/{team['pid']}/messages", headers=owner).json()["messages"]}

    assert history()["from eddie"]["author_removed"] is False
    client.delete(f"/projects/{team['pid']}/members/{team['id']['eddie']}", headers=owner)
    after = history()
    assert after["from eddie"]["author_removed"] is True and after["from eddie"]["username"] == "eddie"
    assert after["from olivia"]["author_removed"] is False
    assert after["from olivia"]["created_at"]


def test_old_messages_without_a_user_id_count_as_removed(client, team):
    with SessionLocal() as db:
        db.add(MessageModel(content="ancient", username="longgone", user_id=None, project_id=team["pid"]))
        db.commit()
    messages = client.get(f"/projects/{team['pid']}/messages", headers=auth(team["t"]["vera"])).json()["messages"]
    assert messages[0]["author_removed"] is True and messages[0]["username"] == "longgone"
