"""
Activity feed entries and in-app notifications.

record() and notify() only add to the session, so they commit (or roll back)
together with the change they describe. publish() then tells open Boards to
refresh, over the project's chat socket.
"""
import logging

import anyio
from sqlalchemy.orm import Session

from app.models import ActivityModel, NotificationModel
from app.services.realtime import manager

logger = logging.getLogger("nexuscode")


def record(db: Session, project_id: int, user_id: int | None, action: str, target: str) -> None:
    db.add(ActivityModel(project_id=project_id, user_id=user_id, action=action, target=target))


def notify(db: Session, user_id: int, project_id: int, kind: str, message: str, actor_id: int | None = None) -> None:
    """Nobody is notified about their own actions."""
    if user_id != actor_id:
        db.add(NotificationModel(user_id=user_id, project_id=project_id, kind=kind, message=message))


def publish(project_id: int, action: str) -> None:
    """Call from a plain `def` route, after commit. A failure here must never
    fail the request: the data is already saved, and Boards also refresh on load."""
    try:
        anyio.from_thread.run(manager.broadcast, project_id, {"type": "activity", "action": action})
    except Exception:
        logger.exception("Could not publish activity for project %s", project_id)
