"""The user's email address, and whether this server can send email."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.rate_limit import LOGIN_LIMIT, TEST_EMAIL_LIMIT, limiter, user_or_ip
from app.core.security import verify_password
from app.models import UserModel
from app.schemas.auth import AuthOptions, EmailOut, EmailUpdate, MessageResponse
from app.services import email as email_service
from app.services import oauth

router = APIRouter(tags=["email"])

WRONG_PASSWORD = "That password is not correct."


def email_out(user: UserModel) -> dict:
    return {
        "email": user.email,
        "email_verified": bool(user.email_verified),
        "has_password": user.hashed_password is not None,
        "sending": email_service.status(),
    }


@router.get("/auth/options", response_model=AuthOptions)
def auth_options():
    """What the login page can offer. Public: it says nothing about any account."""
    return {"email": email_service.is_configured(), "google": oauth.is_enabled("google"), "github": oauth.is_enabled("github")}


@router.get("/me/email", response_model=EmailOut)
def get_email(current_user: UserModel = Depends(get_current_user)):
    return email_out(current_user)


# Rate limited like login, because it checks the password. The address decides
# where reset links go, so changing it needs the password when there is one.
@router.put("/me/email", response_model=EmailOut)
@limiter.limit(LOGIN_LIMIT, key_func=user_or_ip)
def set_email(request: Request, body: EmailUpdate, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    if current_user.hashed_password is not None and not verify_password(body.current_password or "", current_user.hashed_password):
        raise HTTPException(status_code=400, detail=WRONG_PASSWORD)
    if body.email == current_user.email:
        return email_out(current_user)
    current_user.email = body.email
    current_user.email_verified = False
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That email address is already used by another account.") from None
    db.refresh(current_user)
    return email_out(current_user)


@router.post("/me/email/test", response_model=MessageResponse)
@limiter.limit(TEST_EMAIL_LIMIT, key_func=user_or_ip)
def send_test_email(request: Request, current_user: UserModel = Depends(get_current_user)):
    """Sends a test message to the user's own address, which shows straight away
    whether email works here, including when sending is restricted."""
    if not current_user.email:
        raise HTTPException(status_code=409, detail="Add an email address first.")
    try:
        email_service.send_email(
            current_user.email,
            "NexusCode test email",
            f"Hi {current_user.username},\n\nThis is a test email from NexusCode. If you can read it, email works.\n",
        )
    except email_service.EmailNotConfiguredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except email_service.EmailRestrictedError as e:
        raise HTTPException(status_code=400, detail=f"Not sent. {e}") from e
    except email_service.EmailSendError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"message": f"Test email sent to {current_user.email}."}
