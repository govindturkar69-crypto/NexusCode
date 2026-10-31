import os
import secrets
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from passlib.context import CryptContext
from jose import jwt, JWTError

load_dotenv()

# This object knows how to hash and verify passwords using bcrypt
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# The signing secret must come from the environment. There is deliberately no
# default: a missing secret should stop the server, not silently fall back to
# a value anyone could read in the source code.
SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    raise RuntimeError(
        "JWT_SECRET environment variable is not set. Generate one with: "
        "python -c \"import secrets; print(secrets.token_urlsafe(64))\""
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # tokens expire after 1 hour
OAUTH_STATE_EXPIRE_MINUTES = 10
OAUTH_STATE_TYPE = "github_oauth_state"

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        return username
    except JWTError:
        return None

def create_oauth_state(user_id: int) -> str:
    """
    Signed, short-lived OAuth `state` that records which user started the
    GitHub flow. It has no "sub", so it can never be used as a login token.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=OAUTH_STATE_EXPIRE_MINUTES)
    payload = {
        "typ": OAUTH_STATE_TYPE,
        "uid": user_id,
        "nonce": secrets.token_urlsafe(16),
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_oauth_state(state: str):
    """Returns the user id stored in a valid state, or None."""
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("typ") != OAUTH_STATE_TYPE:
        return None
    user_id = payload.get("uid")
    return user_id if isinstance(user_id, int) else None
