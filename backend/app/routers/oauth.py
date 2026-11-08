"""
Signing in with Google or GitHub, and linking them to an existing account.

1. POST /auth/oauth/{provider}/start: the tab sends its nonce's value and the
   PKCE challenge; it gets the provider's URL, with our signed `state`.
2. The provider sends the browser to GET /auth/{provider}/callback (GitHub's is
   /auth/github/login/callback, separate from the repo-access "Connect GitHub").
   We check `state` and pass the code to the frontend in the URL fragment.
3. POST /auth/oauth/complete: the tab sends the code, its nonce and the PKCE
   verifier. Only then is the code exchanged.

Accounts are never joined automatically. A provider whose verified email matches
an account only gets a "link required" answer, and joining it needs that
account's password (POST /auth/oauth/link) or a link started from Settings by
someone already signed in.
"""
import hmac
import json
import logging
import re
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import seal, unseal
from app.core.database import get_db
from app.core.deps import get_optional_user
from app.core.rate_limit import LOGIN_LIMIT, OAUTH_LIMIT, limiter
from app.core.security import session_token_for, verify_password
from app.models import OAuthIdentityModel, UserModel
from app.schemas.auth import (
    OAuthComplete,
    OAuthLinkWithPassword,
    OAuthResult,
    OAuthStart,
    OAuthStartResponse,
)
from app.services import oauth

logger = logging.getLogger("nexuscode")
router = APIRouter(tags=["oauth"])

PROVIDER_NAMES = {"google": "Google", "github": "GitHub"}
LINK_TOKEN_SECONDS = 10 * 60
FAILED = "That sign-in couldn't be completed. Please start again."


def _provider_or_404(provider: str) -> str:
    if provider not in PROVIDER_NAMES:
        raise HTTPException(status_code=404, detail="Unknown sign-in provider")
    return provider


def _frontend_callback(fragment: dict) -> RedirectResponse:
    # Fragment: never sent to any server, so the code stays out of logs and Referer headers
    return RedirectResponse(url=f"{settings.frontend_url}/oauth/callback#{urlencode(fragment)}")


@router.post("/auth/oauth/{provider}/start", response_model=OAuthStartResponse)
@limiter.limit(OAUTH_LIMIT)
def start(request: Request, provider: str, body: OAuthStart, current_user: UserModel | None = Depends(get_optional_user)):
    _provider_or_404(provider)
    if not oauth.is_enabled(provider):
        raise HTTPException(status_code=503, detail=f"Signing in with {PROVIDER_NAMES[provider]} isn't set up on this server.")
    if body.intent == "link" and current_user is None:
        raise HTTPException(status_code=401, detail="Sign in first to link an account.")
    user_id = current_user.id if body.intent == "link" else None
    state = oauth.create_state(provider, body.nonce, body.intent, user_id)
    return {"url": oauth.authorize_url(provider, state, body.code_challenge, body.nonce)}


def _callback(provider: str, code: str | None, state: str | None, error: str | None) -> RedirectResponse:
    payload = oauth.read_state(state) if state else None
    if error or not code or payload is None or payload.get("prv") != provider:
        # Someone cancelling at the provider ends up here too
        return _frontend_callback({"provider": provider, "error": "cancelled" if error == "access_denied" else "failed"})
    return _frontend_callback({"provider": provider, "code": code, "state": state})


@router.get("/auth/google/callback")
def google_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    return _callback("google", code, state, error)


# Separate from /auth/github/callback, which is the repo-access "Connect GitHub" flow
@router.get("/auth/github/login/callback")
def github_login_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    return _callback("github", code, state, error)


USERNAME_CHARS = re.compile(r"[^a-z0-9_]+")


def _unique_username(db: Session, profile: oauth.Profile) -> str:
    """From the email's local part or the name, kept to the sign-up rules; a number is added if taken."""
    seed = (profile.email.split("@")[0] if profile.email else None) or profile.name or profile.provider
    base = USERNAME_CHARS.sub("_", seed.lower()).strip("_")[:24] or profile.provider
    if len(base) < 3:
        base = f"{base}_{profile.provider}"[:24]
    candidate = base
    for _attempt in range(20):
        if not db.query(UserModel.id).filter(UserModel.username == candidate).first():
            return candidate
        candidate = f"{base}_{secrets.randbelow(10**5):05d}"
    raise HTTPException(status_code=503, detail="Couldn't choose a username. Please try again.")


def _signed_in(user: UserModel, status: str) -> dict:
    return {"status": status, "access_token": session_token_for(user), "token_type": "bearer", "username": user.username}


def _add_identity(db: Session, user: UserModel, profile: oauth.Profile) -> None:
    db.add(OAuthIdentityModel(user_id=user.id, provider=profile.provider, provider_user_id=profile.provider_user_id, email=profile.email))


@router.post("/auth/oauth/complete", response_model=OAuthResult)
@limiter.limit(OAUTH_LIMIT)
def complete(request: Request, body: OAuthComplete, db: Session = Depends(get_db), current_user: UserModel | None = Depends(get_optional_user)):
    payload = oauth.read_state(body.state)
    # The same tab, for the same provider, that started this sign-in
    if payload is None or payload["prv"] != body.provider or not hmac.compare_digest(payload["nh"], oauth.nonce_hash(body.nonce)):
        raise HTTPException(status_code=400, detail=FAILED)
    linking = payload["int"] == "link"
    if linking and (current_user is None or current_user.id != payload.get("uid")):
        raise HTTPException(status_code=400, detail="Sign in to the account you started linking from, then try again.")

    try:
        profile = oauth.fetch_profile(body.provider, body.code, body.code_verifier, payload["nh"])
    except oauth.OAuthError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    name = PROVIDER_NAMES[profile.provider]
    identity = (
        db.query(OAuthIdentityModel)
        .filter(OAuthIdentityModel.provider == profile.provider, OAuthIdentityModel.provider_user_id == profile.provider_user_id)
        .first()
    )

    if linking:
        if identity is not None and identity.user_id != current_user.id:
            raise HTTPException(status_code=409, detail=f"That {name} account is already linked to another NexusCode account.")
        if identity is None:
            if db.query(OAuthIdentityModel.id).filter(OAuthIdentityModel.user_id == current_user.id, OAuthIdentityModel.provider == profile.provider).first():
                raise HTTPException(status_code=409, detail=f"Unlink your current {name} account first.")
            _add_identity(db, current_user, profile)
            _commit_identity(db, name)
        return {"status": "linked", "provider": profile.provider}

    if identity is not None:
        return _signed_in(db.get(UserModel, identity.user_id), "signed_in")

    # A verified email that belongs to an account: offer to link, never join automatically
    if profile.email:
        owner = db.query(UserModel).filter(UserModel.email == profile.email, UserModel.email_verified.is_(True)).first()
        if owner is not None:
            link_token = seal(json.dumps({
                "uid": owner.id,
                "prv": profile.provider,
                "pid": profile.provider_user_id,
                "email": profile.email,
            }).encode())
            return {"status": "link_required", "provider": profile.provider, "username": owner.username, "link_token": link_token}

    # A new account. It takes the email only if it's verified and nobody has it.
    email_free = profile.email and not db.query(UserModel.id).filter(UserModel.email == profile.email).first()
    user = UserModel(
        username=_unique_username(db, profile),
        hashed_password=None,
        email=profile.email if email_free else None,
        email_verified=bool(email_free),
    )
    db.add(user)
    db.flush()
    _add_identity(db, user, profile)
    _commit_identity(db, name)
    db.refresh(user)
    logger.info("New account %s from %s sign-in", user.id, profile.provider)
    return _signed_in(user, "created")


def _commit_identity(db: Session, name: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        # The same provider account linked at the same moment elsewhere
        db.rollback()
        raise HTTPException(status_code=409, detail=f"That {name} account was just linked to another account.") from None


# Rate limited like login, because it checks a password
@router.post("/auth/oauth/link", response_model=OAuthResult)
@limiter.limit(LOGIN_LIMIT)
def link_with_password(request: Request, body: OAuthLinkWithPassword, db: Session = Depends(get_db)):
    """Joins a provider account to an existing account whose verified email it
    shares, once the account's password proves this is its owner."""
    raw = unseal(body.link_token, LINK_TOKEN_SECONDS)
    if raw is None:
        raise HTTPException(status_code=400, detail="This link request has expired. Please sign in with the provider again.")
    data = json.loads(raw)
    user = db.get(UserModel, data["uid"])
    # The account may have changed its email since, so check it still matches
    if user is None or user.email != data["email"] or not user.email_verified:
        raise HTTPException(status_code=400, detail="This link request is no longer valid. Please sign in with the provider again.")
    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="That password is not correct.")
    name = PROVIDER_NAMES[data["prv"]]
    existing = (
        db.query(OAuthIdentityModel)
        .filter(OAuthIdentityModel.provider == data["prv"], OAuthIdentityModel.provider_user_id == data["pid"])
        .first()
    )
    if existing is not None and existing.user_id != user.id:
        raise HTTPException(status_code=409, detail=f"That {name} account is already linked to another NexusCode account.")
    if existing is None:
        if db.query(OAuthIdentityModel.id).filter(OAuthIdentityModel.user_id == user.id, OAuthIdentityModel.provider == data["prv"]).first():
            raise HTTPException(status_code=409, detail=f"This account already has a different {name} account linked.")
        db.add(OAuthIdentityModel(user_id=user.id, provider=data["prv"], provider_user_id=data["pid"], email=data["email"]))
        _commit_identity(db, name)
    return _signed_in(user, "linked")
