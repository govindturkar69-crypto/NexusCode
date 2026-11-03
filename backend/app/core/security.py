import hashlib
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

# This object knows how to hash and verify passwords using bcrypt
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Required setting with no default (see app/core/config.py): a missing secret
# stops the server instead of falling back to a value in the source code.
SECRET_KEY = settings.jwt_secret

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
    expire = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
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
