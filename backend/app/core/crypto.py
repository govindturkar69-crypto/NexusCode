"""
Encryption for secrets stored in the database (GitHub tokens) and for the
short-lived "pending GitHub link" blob handed to the browser.

GITHUB_TOKEN_ENC_KEY holds one or more Fernet keys separated by commas. The
first key encrypts; all of them decrypt, so a key can be rotated by putting
the new one first and keeping the old one until rows are re-encrypted.
Generate a key with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings

ENCRYPTED_PREFIX = "enc:v1:"


def build_fernet(keys: str) -> MultiFernet:
    parts = [k.strip() for k in keys.split(",") if k.strip()]
    if not parts:
        raise ValueError("GITHUB_TOKEN_ENC_KEY is empty")
    return MultiFernet([Fernet(k.encode()) for k in parts])


_fernet = build_fernet(settings.github_token_enc_key)


def encrypt_secret(value: str) -> str:
    return ENCRYPTED_PREFIX + _fernet.encrypt(value.encode()).decode()


def decrypt_secret(stored: str) -> str:
    """Decrypts a value written by encrypt_secret. Values without the prefix
    are returned unchanged (rows from before encryption was introduced)."""
    if not stored.startswith(ENCRYPTED_PREFIX):
        return stored
    return _fernet.decrypt(stored[len(ENCRYPTED_PREFIX):].encode()).decode()


def seal(payload: bytes) -> str:
    """Encrypts and authenticates a short-lived blob for the browser."""
    return _fernet.encrypt(payload).decode()


def unseal(token: str, max_age_seconds: int) -> bytes | None:
    """Returns the payload, or None if tampered with, foreign, or older than max_age."""
    try:
        return _fernet.decrypt(token.encode(), ttl=max_age_seconds)
    except (InvalidToken, ValueError):
        return None
