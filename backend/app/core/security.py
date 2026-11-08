import hashlib
import logging
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from jwt import PyJWTError as JWTError
from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError
from pwdlib.hashers.bcrypt import BcryptHasher

from app.core.config import settings

# bcrypt, cost 12: the same algorithm and cost passlib used, so every existing
# $2b$12$ hash still verifies (see tests/test_legacy_auth.py)
password_hasher = PasswordHash((BcryptHasher(rounds=12),))

# Required setting with no default (see app/core/config.py): a missing secret
# stops the server instead of falling back to a value in the source code.
SECRET_KEY = settings.jwt_secret
if len(SECRET_KEY.encode()) < 32:
    # RFC 7518: HS256 keys should be at least 32 bytes. Not fatal, so a
    # deployment with an older short secret keeps running.
    logging.getLogger("nexuscode").warning(
        "JWT_SECRET is shorter than 32 bytes; generate a longer one with "
        "python -c \"import secrets; print(secrets.token_urlsafe(64))\""
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # tokens expire after 1 hour
OAUTH_STATE_EXPIRE_MINUTES = 10
OAUTH_STATE_TYPE = "github_oauth_state"

def hash_password(password: str) -> str:
    return password_hasher.hash(password)

def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    # Accounts made through Google or GitHub have no password: nothing matches it
    if not hashed_password:
        return False
    try:
        return password_hasher.verify(plain_password, hashed_password)
    except (ValueError, UnknownHashError):
        # bcrypt 5 refuses passwords over 72 bytes (sign-up never allows them),
        # and an unknown hash format can't match: both are simply a wrong login
        return False

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def session_token_for(user) -> str:
    """A login token. `ver` is the user's token_version: raising that ends every token issued before."""
    return create_access_token(data={"sub": user.username, "ver": user.token_version or 0})


def decode_session(token: str) -> tuple[str, int] | None:
    """(username, token version) from a valid login token. Tokens from before
    versions existed have none, which counts as 0."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    username, version = payload.get("sub"), payload.get("ver", 0)
    if not isinstance(username, str) or not isinstance(version, int):
        return None
    return username, version


def decode_access_token(token: str):
    session = decode_session(token)
    return session[0] if session else None

def hash_oauth_nonce(nonce: str) -> str:
    return hashlib.sha256(nonce.encode()).hexdigest()


def create_oauth_state(user_id: int, nonce_hash: str) -> str:
    """
    Signed, short-lived OAuth `state`: which user started the GitHub flow, and
    the hash of a nonce that only the initiating browser tab knows. It has no
    "sub", so it can never be used as a login token.
    """
    expire = datetime.now(UTC) + timedelta(minutes=OAUTH_STATE_EXPIRE_MINUTES)
    payload = {
        "typ": OAUTH_STATE_TYPE,
        "uid": user_id,
        "nh": nonce_hash,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_oauth_state(state: str) -> tuple[int, str] | None:
    """Returns (user_id, nonce_hash) from a valid state, or None."""
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("typ") != OAUTH_STATE_TYPE:
        return None
    user_id, nonce_hash = payload.get("uid"), payload.get("nh")
    if not isinstance(user_id, int) or not isinstance(nonce_hash, str):
        return None
    return user_id, nonce_hash


# --- WebSocket tickets ---
# Browsers can't send headers on WebSocket connections, so instead of putting
# the long-lived login token in the URL, the client trades it for a ticket that
# is valid for 30 seconds, for one project, and for one connection only.
WS_TICKET_TYPE = "ws_ticket"
WS_TICKET_TTL_SECONDS = 30


class _UsedTickets:
    """Remembers consumed ticket ids until they would have expired anyway.
    In-process (one instance); several instances would need a shared store."""

    def __init__(self):
        self._used: dict[str, float] = {}
        self._lock = threading.Lock()

    def consume(self, ticket_id: str, expires_at: float) -> bool:
        now = time.time()
        with self._lock:
            for key in [k for k, exp in self._used.items() if exp < now]:
                del self._used[key]
            if ticket_id in self._used:
                return False
            self._used[ticket_id] = expires_at
            return True

    def clear(self):
        with self._lock:
            self._used.clear()


used_ws_tickets = _UsedTickets()


def create_ws_ticket(username: str, project_id: int) -> str:
    expire = datetime.now(UTC) + timedelta(seconds=WS_TICKET_TTL_SECONDS)
    payload = {"typ": WS_TICKET_TYPE, "usr": username, "pid": project_id, "jti": uuid.uuid4().hex, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def consume_ws_ticket(ticket: str, project_id: int) -> str | None:
    """Returns the username if the ticket is valid, unused and for this project.
    A ticket works once; a second connection attempt with it is refused."""
    try:
        payload = jwt.decode(ticket, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("typ") != WS_TICKET_TYPE or payload.get("pid") != project_id:
        return None
    username, ticket_id = payload.get("usr"), payload.get("jti")
    if not isinstance(username, str) or not isinstance(ticket_id, str):
        return None
    if not used_ws_tickets.consume(ticket_id, float(payload["exp"])):
        return None
    return username
