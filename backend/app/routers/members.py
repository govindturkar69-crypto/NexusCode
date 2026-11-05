"""
Project membership. Owners add people by username, change roles and remove
members; any member can leave. A project always keeps at least one owner.
"""
import anyio
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_project_role, role_at_least
from app.models import ProjectMemberModel, ProjectModel, TaskModel, UserModel
from app.schemas.members import (
    MemberAdd,
    MemberListResponse,
    MemberResponse,
    MemberUpdate,
)
from app.services.activity import notify, publish, record
from app.services.realtime import manager, video_manager

router = APIRouter(tags=["members"])

LAST_OWNER = "A project needs at least one owner. Make someone else an owner first."


def _member_out(member: ProjectMemberModel, username: str) -> dict:
    return {"user_id": member.user_id, "username": username, "role": member.role, "created_at": member.created_at}


def _get_member(db: Session, project_id: int, user_id: int) -> ProjectMemberModel:
    member = (
        db.query(ProjectMemberModel)
        .filter(ProjectMemberModel.project_id == project_id, ProjectMemberModel.user_id == user_id)
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return member


def _other_owners(db: Session, project_id: int, user_id: int) -> list[ProjectMemberModel]:
    """The project's other owners, oldest first. Locks the rows on Postgres, so
    two owners demoting each other at once can't leave the project ownerless."""
    return (
        db.query(ProjectMemberModel)
        .filter(
            ProjectMemberModel.project_id == project_id,
            ProjectMemberModel.role == "owner",
            ProjectMemberModel.user_id != user_id,
        )
        .order_by(ProjectMemberModel.id)
        .with_for_update()
        .all()
    )


def _hand_over_if_creator(db: Session, project_id: int, user_id: int, other_owners: list[ProjectMemberModel]) -> None:
    """projects.owner_id must name someone who is still an owner."""
    project = db.get(ProjectModel, project_id)
    if project.owner_id == user_id and other_owners:
        project.owner_id = other_owners[0].user_id


@router.get("/projects/{project_id}/members", response_model=MemberListResponse)
def list_members(project: ProjectModel = Depends(require_project_role("viewer")), db: Session = Depends(get_db)):
    rows = (
        db.query(ProjectMemberModel, UserModel.username)
        .join(UserModel, ProjectMemberModel.user_id == UserModel.id)
        .filter(ProjectMemberModel.project_id == project.id)
        .order_by(ProjectMemberModel.id)
        .all()
    )
    return {"members": [_member_out(member, username) for member, username in rows]}


@router.post("/projects/{project_id}/members", status_code=201, response_model=MemberResponse)
def add_member(
    body: MemberAdd,
    project: ProjectModel = Depends(require_project_role("owner")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    user = db.query(UserModel).filter(UserModel.username == body.username).first()
    if user is None:
        raise HTTPException(status_code=404, detail=f"No user named {body.username}")
    member = ProjectMemberModel(project_id=project.id, user_id=user.id, role=body.role)
    db.add(member)
    record(db, project.id, current_user.id, "member_added", user.username)
    notify(db, user.id, project.id, "added", f"{current_user.username} added you to {project.name} as {body.role}", current_user.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"{body.username} is already a member of this project") from None
    db.refresh(member)
    publish(project.id, "member_added")
    return {"member": _member_out(member, user.username)}


@router.patch("/projects/{project_id}/members/{user_id}", response_model=MemberResponse)
def change_role(
    user_id: int,
    body: MemberUpdate,
    project: ProjectModel = Depends(require_project_role("owner")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    member = _get_member(db, project.id, user_id)
    if member.role == "owner" and body.role != "owner":
        others = _other_owners(db, project.id, user_id)
        if not others:
            raise HTTPException(status_code=409, detail=LAST_OWNER)
        _hand_over_if_creator(db, project.id, user_id, others)
    if member.role != body.role:
        record(db, project.id, current_user.id, "role_changed", f"{member.user.username} → {body.role}")
        notify(db, user_id, project.id, "role_changed", f"{current_user.username} changed your role in {project.name} to {body.role}", current_user.id)
    member.role = body.role
    db.commit()
    db.refresh(member)
    publish(project.id, "role_changed")
    return {"member": _member_out(member, member.user.username)}


# A plain def runs in a worker thread; anyio.from_thread gets back to the event
# loop that owns the sockets.
@router.delete("/projects/{project_id}/members/{user_id}", status_code=204)
def remove_member(
    user_id: int,
    project: ProjectModel = Depends(require_project_role("viewer")),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Owners can remove anyone; everyone else can only remove themselves (leave)."""
    if user_id != current_user.id:
        own = _get_member(db, project.id, current_user.id)
        if not role_at_least(own.role, "owner"):
            raise HTTPException(status_code=403, detail="Only owners can remove other members.")
    member = _get_member(db, project.id, user_id)
    if member.role == "owner":
        others = _other_owners(db, project.id, user_id)
        if not others:
            raise HTTPException(status_code=409, detail=LAST_OWNER)
        _hand_over_if_creator(db, project.id, user_id, others)
    project_id = project.id
    leaving = user_id == current_user.id
    record(db, project_id, current_user.id, "member_left" if leaving else "member_removed", member.user.username)
    db.delete(member)
    # An assignee must be a member, so their tasks here become unassigned
    db.query(TaskModel).filter(TaskModel.project_id == project_id, TaskModel.assignee_id == user_id).update({"assignee_id": None})
    db.commit()

    # They lose live access right away, not on their next message
    anyio.from_thread.run(manager.kick, project_id, user_id)
    anyio.from_thread.run(video_manager.kick, project_id, user_id)
    publish(project_id, "member_left" if leaving else "member_removed")
    return Response(status_code=204)
