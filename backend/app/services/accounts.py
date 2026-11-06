"""
Deleting a user account.

What happens to each of the user's projects:
- another owner exists: the project carries on, the user just leaves it
- no other owner but other members: the longest-standing editor (or viewer, if
  there are no editors) becomes owner and is notified, so teammates keep their work
- nobody else: the project is deleted, including its uploaded files

plan_deletion() decides this, so the confirm dialog shows exactly what
delete_account() then does.
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import (
    ActivityModel,
    MessageModel,
    NotificationModel,
    ProjectMemberModel,
    ProjectModel,
    TaskModel,
    UserModel,
)
from app.routers.files import delete_project_assets
from app.services.activity import notify, record


@dataclass
class ProjectFate:
    project: ProjectModel
    # Set when the project passes to someone else
    successor: ProjectMemberModel | None = None
    # Remaining owner, when the project carries on without a transfer
    other_owner: ProjectMemberModel | None = None

    @property
    def deleted(self) -> bool:
        return self.successor is None and self.other_owner is None


def _others(db: Session, project_id: int, user_id: int) -> list[ProjectMemberModel]:
    # Locked on Postgres, so two owners deleting their accounts at once can't
    # each count on the other staying
    return (
        db.query(ProjectMemberModel)
        .filter(ProjectMemberModel.project_id == project_id, ProjectMemberModel.user_id != user_id)
        .order_by(ProjectMemberModel.created_at, ProjectMemberModel.id)
        .with_for_update()
        .all()
    )


def plan_deletion(db: Session, user: UserModel) -> list[ProjectFate]:
    """One entry for every project the user owns or belongs to."""
    projects = (
        db.query(ProjectModel)
        .outerjoin(ProjectMemberModel, ProjectMemberModel.project_id == ProjectModel.id)
        .filter((ProjectMemberModel.user_id == user.id) | (ProjectModel.owner_id == user.id))
        .distinct()
        .order_by(ProjectModel.id)
        .all()
    )
    fates = []
    for project in projects:
        others = _others(db, project.id, user.id)
        owner = next((m for m in others if m.role == "owner"), None)
        if owner is not None:
            fates.append(ProjectFate(project, other_owner=owner))
            continue
        # With no other owner the user must be the owner, so someone has to take over
        editors = [m for m in others if m.role == "editor"]
        fates.append(ProjectFate(project, successor=(editors or others or [None])[0]))
    return fates


def delete_account(db: Session, user: UserModel) -> list[int]:
    """Deletes the user and commits. Returns the ids of the projects they were in."""
    fates = plan_deletion(db, user)
    project_ids = [fate.project.id for fate in fates]
    username = user.username
    for fate in fates:
        project = fate.project
        if fate.deleted:
            continue
        record(db, project.id, None, "member_left", username)
        if fate.successor is not None:
            fate.successor.role = "owner"
            project.owner_id = fate.successor.user_id
            record(db, project.id, None, "role_changed", f"{fate.successor.user.username} → owner")
            notify(db, fate.successor.user_id, project.id, "role_changed", f"{username} deleted their account, so you now own {project.name}")
        elif project.owner_id == user.id:
            project.owner_id = fate.other_owner.user_id

    # Spelled out rather than left to the foreign keys, so this reads the same
    # on every database. Messages and activity stay; they just lose the link.
    db.query(ProjectMemberModel).filter(ProjectMemberModel.user_id == user.id).delete()
    db.query(NotificationModel).filter(NotificationModel.user_id == user.id).delete()
    db.query(TaskModel).filter(TaskModel.assignee_id == user.id).update({"assignee_id": None})
    db.query(MessageModel).filter(MessageModel.user_id == user.id).update({"user_id": None})
    db.query(ActivityModel).filter(ActivityModel.user_id == user.id).update({"user_id": None})

    # Last, so a database problem above can't lose files of a project that survives
    for fate in fates:
        if fate.deleted:
            delete_project_assets(fate.project)
            db.delete(fate.project)
    db.flush()
    db.expire(user)
    db.delete(user)
    db.commit()
    return project_ids
