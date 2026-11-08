import anyio
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.rate_limit import LOGIN_LIMIT, limiter
from app.core.security import hash_password, session_token_for, verify_password
from app.models import UserModel
from app.schemas.auth import (
    AccountDelete,
    DeletionPlan,
    GitHubStatus,
    PasswordChange,
    SessionResponse,
)
from app.services import accounts, github
from app.services.activity import publish
from app.services.realtime import manager, video_manager

router = APIRouter(tags=["account"])

# 400, not 401: the frontend treats any 401 as an expired session and logs out
WRONG_PASSWORD = "That password is not correct."
NO_PASSWORD = "This account signs in with Google or GitHub and has no password yet. Set one in Settings first."


# Rate limited like login: a stolen session must not be able to guess the password
@router.post("/me/password", response_model=SessionResponse)
@limiter.limit(LOGIN_LIMIT)
def change_password(request: Request, body: PasswordChange, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    if current_user.hashed_password is None:
        raise HTTPException(status_code=400, detail=NO_PASSWORD)
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail=WRONG_PASSWORD)
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="The new password must be different from the current one.")
    current_user.hashed_password = hash_password(body.new_password)
    # Ends every other session; this one carries on with the token returned here
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()
    db.refresh(current_user)
    return {"message": "Password changed", "access_token": session_token_for(current_user), "token_type": "bearer"}


@router.get("/me/github", response_model=GitHubStatus)
def github_status(current_user: UserModel = Depends(get_current_user)):
    """Asks GitHub who the stored token belongs to, so the name is never stale."""
    if not current_user.github_token:
        return {"connected": False}
    try:
        return {"connected": True, "username": github.get_github_username(current_user.github_token)}
    except github.GitHubAPIError as e:
        # Still connected as far as we know, unless GitHub says the token is dead
        return {"connected": True, "expired": e.status_code == 401}


@router.delete("/me/github", status_code=204)
def disconnect_github(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    current_user.github_token = None
    db.commit()
    return Response(status_code=204)


@router.get("/me/deletion-plan", response_model=DeletionPlan)
def deletion_plan(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """What deleting this account would do, for the confirm dialog."""
    plan = {"deleted": [], "transferred": [], "left": []}
    for fate in accounts.plan_deletion(db, current_user):
        if fate.deleted:
            plan["deleted"].append({"project_id": fate.project.id, "name": fate.project.name})
        elif fate.successor is not None:
            plan["transferred"].append({"project_id": fate.project.id, "name": fate.project.name, "new_owner": fate.successor.user.username})
        else:
            plan["left"].append({"project_id": fate.project.id, "name": fate.project.name})
    return plan


# POST, since some proxies drop the body of a DELETE and this one carries the
# password. A plain def runs in a worker thread; see remove_member for the sockets.
@router.post("/me/delete", status_code=204)
@limiter.limit(LOGIN_LIMIT)
def delete_account(request: Request, body: AccountDelete, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    if current_user.hashed_password is None:
        raise HTTPException(status_code=400, detail=NO_PASSWORD)
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail=WRONG_PASSWORD)
    user_id = current_user.id
    project_ids = accounts.delete_account(db, current_user)

    for project_id in project_ids:
        anyio.from_thread.run(manager.kick, project_id, user_id)
        anyio.from_thread.run(video_manager.kick, project_id, user_id)
        publish(project_id, "member_left")
    return Response(status_code=204)
