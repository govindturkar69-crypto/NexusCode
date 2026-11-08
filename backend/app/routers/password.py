"""
Password reset, email verification and ending sessions.

Reset requests answer the same way whether or not the address belongs to an
account, and do the lookup and sending after the response, so neither the
answer nor its timing says anything about who has an account.
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.core.deps import get_current_user
from app.core.rate_limit import (
    RESET_CONFIRM_LIMIT,
    RESET_REQUEST_LIMIT,
    TEST_EMAIL_LIMIT,
    limiter,
    user_or_ip,
)
from app.core.security import hash_password, session_token_for
from app.models import UserModel
from app.schemas.auth import (
    EmailToken,
    MessageResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    SessionResponse,
)
from app.services import auth_tokens
from app.services import email as email_service

logger = logging.getLogger("nexuscode")
router = APIRouter(tags=["password"])

RESET_REQUESTED = "If an account uses that email address, we've sent it a link to reset the password. It works for 30 minutes."
INVALID_LINK = "This link is invalid, has expired or has already been used. Ask for a new one."


def _link(path: str, token: str) -> str:
    # In the fragment, which browsers never send to servers or in Referer headers
    return f"{settings.frontend_url}/{path}#token={token}"


def _send_reset_email(email: str) -> None:
    """Runs after the response has gone out."""
    with SessionLocal() as db:
        # Only a verified address can receive reset links
        user = db.query(UserModel).filter(UserModel.email == email, UserModel.email_verified.is_(True)).first()
        if user is None:
            return
        raw = auth_tokens.issue(db, user, auth_tokens.PASSWORD_RESET, email)
        db.commit()
        try:
            email_service.send_email(
                email,
                "Reset your NexusCode password",
                f"Hi {user.username},\n\nSomeone asked to reset the password for your NexusCode account "
                f"(username: {user.username}). To choose a new one, open this link within 30 minutes:\n\n"
                f"{_link('reset-password', raw)}\n\n"
                "If that wasn't you, ignore this email: your password stays the same.\n",
            )
        except email_service.EmailNotConfiguredError:
            pass
        except (email_service.EmailRestrictedError, email_service.EmailSendError):
            # Already logged by the email service; the user only ever sees the neutral reply
            pass


def send_verification_email(db: Session, user: UserModel) -> None:
    """Commits the new token, then sends. Raises the email service's errors."""
    raw = auth_tokens.issue(db, user, auth_tokens.VERIFY_EMAIL, user.email)
    db.commit()
    email_service.send_email(
        user.email,
        "Confirm your email for NexusCode",
        f"Hi {user.username},\n\nTo confirm that {user.email} is your address on NexusCode, open this link "
        f"within 24 hours:\n\n{_link('verify-email', raw)}\n\nIf you didn't ask for this, ignore this email.\n",
    )


def send_verification_quietly(user_id: int) -> None:
    """After sign-up: a failure here mustn't fail the sign-up, and the user can resend from Settings."""
    with SessionLocal() as db:
        user = db.get(UserModel, user_id)
        if user is None or not user.email or user.email_verified or not email_service.is_configured():
            return
        try:
            send_verification_email(db, user)
        except (email_service.EmailRestrictedError, email_service.EmailSendError, email_service.EmailNotConfiguredError):
            pass


@router.post("/auth/password-reset/request", status_code=202, response_model=MessageResponse)
@limiter.limit(RESET_REQUEST_LIMIT)
def request_password_reset(request: Request, body: PasswordResetRequest, background: BackgroundTasks):
    if not email_service.is_configured():
        # True for every address, so it reveals nothing about accounts
        raise HTTPException(status_code=503, detail="Password reset by email isn't available on this server.")
    background.add_task(_send_reset_email, body.email)
    return {"message": RESET_REQUESTED}


@router.post("/auth/password-reset/confirm", response_model=MessageResponse)
@limiter.limit(RESET_CONFIRM_LIMIT)
def confirm_password_reset(request: Request, body: PasswordResetConfirm, db: Session = Depends(get_db)):
    token = auth_tokens.consume(db, body.token, auth_tokens.PASSWORD_RESET)
    if token is None:
        raise HTTPException(status_code=400, detail=INVALID_LINK)
    user = db.get(UserModel, token.user_id)
    user.hashed_password = hash_password(body.new_password)
    # Every existing session ends, wherever it is
    user.token_version = (user.token_version or 0) + 1
    # The link reached this inbox, which proves the address
    if token.email and token.email == user.email:
        user.email_verified = True
    auth_tokens.discard_unused(db, user.id, auth_tokens.PASSWORD_RESET)
    db.commit()
    logger.info("Password reset for user %s", user.id)
    return {"message": "Your password has been changed. Sign in with the new one."}


@router.post("/me/email/verification", response_model=MessageResponse)
@limiter.limit(TEST_EMAIL_LIMIT, key_func=user_or_ip)
def resend_verification(request: Request, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    if not current_user.email:
        raise HTTPException(status_code=409, detail="Add an email address first.")
    if current_user.email_verified:
        raise HTTPException(status_code=409, detail="This email address is already verified.")
    try:
        send_verification_email(db, current_user)
    except email_service.EmailNotConfiguredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except email_service.EmailRestrictedError as e:
        raise HTTPException(status_code=400, detail=f"Not sent. {e}") from e
    except email_service.EmailSendError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"message": f"We've sent a link to {current_user.email}. It works for 24 hours."}


# No login needed: the link may be opened in another browser
@router.post("/auth/verify-email", response_model=MessageResponse)
@limiter.limit(RESET_CONFIRM_LIMIT)
def verify_email(request: Request, body: EmailToken, db: Session = Depends(get_db)):
    token = auth_tokens.consume(db, body.token, auth_tokens.VERIFY_EMAIL)
    if token is None:
        raise HTTPException(status_code=400, detail=INVALID_LINK)
    user = db.get(UserModel, token.user_id)
    # The address may have changed since the link was sent
    if token.email != user.email:
        db.commit()
        raise HTTPException(status_code=400, detail="This link is for an email address the account no longer uses.")
    user.email_verified = True
    db.commit()
    return {"message": f"{user.email} is verified."}


@router.post("/me/sessions/revoke", response_model=SessionResponse)
def sign_out_everywhere_else(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """Ends every session, then returns a fresh token so this one carries on."""
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()
    db.refresh(current_user)
    return {"message": "Signed out everywhere else.", "access_token": session_token_for(current_user), "token_type": "bearer"}
