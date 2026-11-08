"""
Single-use tokens for password reset and email verification.

The raw token goes only into the email link. The database keeps its SHA-256
hash, so a leaked database can't be used to reset anyone's password. A token
works once, until it expires, and asking for a new one cancels the old ones.
"""
import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import AuthTokenModel, UserModel

PASSWORD_RESET = "password_reset"
VERIFY_EMAIL = "verify_email"
LIFETIMES = {
    PASSWORD_RESET: timedelta(minutes=30),
    # Longer, because people often open these later; the design is otherwise the same
    VERIFY_EMAIL: timedelta(hours=24),
}


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def issue(db: Session, user: UserModel, purpose: str, email: str | None = None) -> str:
    """Returns the raw token. Doesn't commit, so it lands with whatever else the caller saves."""
    db.query(AuthTokenModel).filter(
        AuthTokenModel.user_id == user.id, AuthTokenModel.purpose == purpose, AuthTokenModel.used_at.is_(None)
    ).delete()
    raw = secrets.token_urlsafe(32)
    db.add(AuthTokenModel(user_id=user.id, purpose=purpose, token_hash=_hash(raw), email=email, expires_at=_now() + LIFETIMES[purpose]))
    return raw


def consume(db: Session, raw: str, purpose: str) -> AuthTokenModel | None:
    """The token if it's valid, now marked used; otherwise None. Doesn't commit."""
    if not raw or len(raw) > 200:
        return None
    token = (
        db.query(AuthTokenModel)
        .filter(AuthTokenModel.token_hash == _hash(raw), AuthTokenModel.purpose == purpose)
        .with_for_update()
        .first()
    )
    if token is None or token.used_at is not None:
        return None
    expires_at = token.expires_at if token.expires_at.tzinfo else token.expires_at.replace(tzinfo=UTC)
    if expires_at <= _now():
        return None
    token.used_at = _now()
    # Written now, so later queries in the same request (and other requests) see it used
    db.flush()
    return token


def discard_unused(db: Session, user_id: int, purpose: str) -> None:
    db.query(AuthTokenModel).filter(
        AuthTokenModel.user_id == user_id, AuthTokenModel.purpose == purpose, AuthTokenModel.used_at.is_(None)
    ).delete()
