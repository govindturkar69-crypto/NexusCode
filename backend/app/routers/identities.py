"""
How a user signs in: their password and their linked Google and GitHub accounts.

Linking starts from Settings with POST /auth/oauth/{provider}/start and intent
"link" (see routers/oauth.py). Unlinking can never remove the last way in, and
accounts made with Google or GitHub can add a password here.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.rate_limit import LOGIN_LIMIT, limiter, user_or_ip
from app.core.security import hash_password
from app.models import OAuthIdentityModel, UserModel
from app.routers.oauth import PROVIDER_NAMES
from app.schemas.auth import MessageResponse, PasswordSet, SignInMethods
from app.services import oauth

router = APIRouter(tags=["sign-in methods"])


def _identities(db: Session, user_id: int) -> list[OAuthIdentityModel]:
    return db.query(OAuthIdentityModel).filter(OAuthIdentityModel.user_id == user_id).order_by(OAuthIdentityModel.provider).all()


@router.get("/me/sign-in-methods", response_model=SignInMethods)
def sign_in_methods(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    return {
        "has_password": current_user.hashed_password is not None,
        "identities": [{"provider": i.provider, "email": i.email, "linked_at": i.created_at} for i in _identities(db, current_user.id)],
        "available": {provider: oauth.is_enabled(provider) for provider in PROVIDER_NAMES},
    }


@router.delete("/me/identities/{provider}", status_code=204)
@limiter.limit(LOGIN_LIMIT, key_func=user_or_ip)
def unlink(request: Request, provider: str, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    # Locks the account row, so two unlinks at once can't both see "one left"
    user = db.query(UserModel).filter(UserModel.id == current_user.id).with_for_update().one()
    identities = _identities(db, user.id)
    identity = next((i for i in identities if i.provider == provider), None)
    if identity is None:
        raise HTTPException(status_code=404, detail="That sign-in method isn't linked to your account.")
    if user.hashed_password is None and len(identities) == 1:
        raise HTTPException(
            status_code=400,
            detail=f"{PROVIDER_NAMES.get(provider, provider)} is the only way into this account. Set a password or link another account first.",
        )
    db.delete(identity)
    db.commit()
    return Response(status_code=204)


# For accounts made with Google or GitHub, which start without a password.
# Changing an existing password is POST /me/password, which needs the old one.
@router.post("/me/password/set", response_model=MessageResponse)
@limiter.limit(LOGIN_LIMIT, key_func=user_or_ip)
def set_password(request: Request, body: PasswordSet, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    user = db.query(UserModel).filter(UserModel.id == current_user.id).with_for_update().one()
    if user.hashed_password is not None:
        raise HTTPException(status_code=409, detail="This account already has a password. Change it with your current password instead.")
    user.hashed_password = hash_password(body.new_password)
    db.commit()
    return {"message": "Password set. You can now also sign in with your username and password."}
