"""
Sign in with Google: OAuth 2.0 authorization code flow with PKCE.

The browser tab that starts a sign-in keeps two secrets, a nonce and the PKCE
code verifier. The provider redirects to our callback, which checks `state`
and hands the code to the frontend in the URL fragment. The tab then sends the
code back with both secrets. So a code that leaks on the way is useless: it
needs the verifier (PKCE) and the nonce, which only that tab has.

`state` is signed by us, expires in 10 minutes, and names the provider, the
intent (sign in, or link to the signed-in account) and the nonce's hash.

Google's ID token is verified fully: RS256 signature against Google's published
keys, audience, issuer, expiry, and the nonce. An email is only trusted when the
provider says it's verified.
"""
import hashlib
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import settings
from app.core.security import ALGORITHM, SECRET_KEY

TIMEOUT_SECONDS = 15
STATE_TYPE = "oauth_signin_state"
STATE_MINUTES = 10
INTENTS = ("login", "link")

GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
JWKS_CACHE_SECONDS = 3600



class OAuthError(Exception):
    """The sign-in can't go ahead. The message is safe to show to users."""


@dataclass
class Profile:
    provider: str
    provider_user_id: str
    # Only set when the provider says the address is verified
    email: str | None
    name: str | None


def _setting(name: str) -> str | None:
    value = getattr(settings, name, None)
    return value or None


def client_config(provider: str) -> tuple[str, str, str] | None:
    """(client id, secret, redirect URI), or None if the provider isn't set up."""
    prefix = {"google": "google"}.get(provider)
    if prefix is None:
        return None
    values = tuple(_setting(f"{prefix}_{part}") for part in ("client_id", "client_secret", "redirect_uri"))
    return values if all(values) else None


def is_enabled(provider: str) -> bool:
    return client_config(provider) is not None


def nonce_hash(nonce: str) -> str:
    return hashlib.sha256(nonce.encode()).hexdigest()


def create_state(provider: str, nonce: str, intent: str, user_id: int | None) -> str:
    payload = {
        "typ": STATE_TYPE,
        "prv": provider,
        "nh": nonce_hash(nonce),
        "int": intent,
        "uid": user_id,
        "exp": datetime.now(UTC) + timedelta(minutes=STATE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def read_state(state: str) -> dict | None:
    """The state's contents if we signed it, it hasn't expired and it's the right type."""
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != STATE_TYPE or payload.get("int") not in INTENTS or not isinstance(payload.get("nh"), str):
        return None
    return payload


def authorize_url(provider: str, state: str, code_challenge: str, nonce: str) -> str:
    client_id, _secret, redirect_uri = client_config(provider)
    common = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    params = {**common, "response_type": "code", "scope": "openid email profile", "nonce": nonce_hash(nonce), "prompt": "select_account"}
    return f"{GOOGLE_AUTHORIZE}?{urlencode(params)}"


def _post_form(url: str, data: dict) -> dict:
    try:
        response = httpx.post(url, data=data, headers={"Accept": "application/json"}, timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as e:
        raise OAuthError("The sign-in service couldn't be reached. Please try again.") from e
    try:
        body = response.json()
    except ValueError:
        body = {}
    if not response.is_success or "error" in body:
        raise OAuthError("The sign-in couldn't be completed. Please try again.")
    return body


# ---- Google ----

class _GoogleKeys:
    """Google's public signing keys, refreshed hourly or when an unknown key id appears."""

    def __init__(self):
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at = 0.0
        self._lock = threading.Lock()

    def _fetch(self) -> None:
        try:
            response = httpx.get(GOOGLE_JWKS, timeout=TIMEOUT_SECONDS)
            response.raise_for_status()
            keys = response.json().get("keys", [])
        except (httpx.HTTPError, ValueError) as e:
            raise OAuthError("Google's sign-in keys couldn't be loaded. Please try again.") from e
        self._keys = {key["kid"]: jwt.PyJWK(key) for key in keys if key.get("kid")}
        self._fetched_at = time.monotonic()

    def get(self, kid: str) -> jwt.PyJWK:
        with self._lock:
            stale = time.monotonic() - self._fetched_at > JWKS_CACHE_SECONDS
            if stale or kid not in self._keys:
                self._fetch()
            if kid not in self._keys:
                raise OAuthError("Google's sign-in response couldn't be verified.")
            return self._keys[kid]

    def clear(self) -> None:
        with self._lock:
            self._keys = {}
            self._fetched_at = 0.0


google_keys = _GoogleKeys()


def verify_google_id_token(id_token: str, expected_nonce_hash: str) -> dict:
    client_id = client_config("google")[0]
    try:
        header = jwt.get_unverified_header(id_token)
        if header.get("alg") != "RS256" or not header.get("kid"):
            raise OAuthError("Google's sign-in response couldn't be verified.")
        key = google_keys.get(header["kid"])
        claims = jwt.decode(
            id_token,
            key.key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=GOOGLE_ISSUERS,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            leeway=60,
        )
    except jwt.PyJWTError as e:
        raise OAuthError("Google's sign-in response couldn't be verified.") from e
    # Ties the ID token to this sign-in, so an old one can't be replayed
    if not secrets.compare_digest(str(claims.get("nonce", "")), expected_nonce_hash):
        raise OAuthError("Google's sign-in response couldn't be verified.")
    return claims


def _google_profile(code: str, code_verifier: str, expected_nonce_hash: str) -> Profile:
    client_id, client_secret, redirect_uri = client_config("google")
    tokens = _post_form(GOOGLE_TOKEN, {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
    })
    if not tokens.get("id_token"):
        raise OAuthError("Google didn't confirm who you are. Please try again.")
    claims = verify_google_id_token(tokens["id_token"], expected_nonce_hash)
    email = claims.get("email") if claims.get("email_verified") is True else None
    return Profile("google", str(claims["sub"]), email.lower() if email else None, claims.get("name"))


def fetch_profile(provider: str, code: str, code_verifier: str, expected_nonce_hash: str) -> Profile:
    if not is_enabled(provider):
        raise OAuthError("This sign-in option isn't set up on this server.")
    return {"google": _google_profile}[provider](code, code_verifier, expected_nonce_hash)
