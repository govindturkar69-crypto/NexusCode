from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import jwt, JWTError

# This object knows how to hash and verify passwords using bcrypt
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# In a real production app, this secret would come from an environment
# variable, never hardcoded. For our learning project, this is fine for now.
SECRET_KEY = "this-is-a-temporary-secret-change-it-later"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # tokens expire after 1 hour

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
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