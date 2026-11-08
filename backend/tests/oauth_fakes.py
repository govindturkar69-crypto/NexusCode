"""
Stand-ins for the OAuth providers, at their HTTP boundary, that behave like the
real ones where it matters: Google signs ID tokens with its own RSA key and
publishes it as a JWKS, GitHub answers /user and /user/emails only for the token
it issued, codes work once, and PKCE is enforced by checking the verifier
against the challenge from the authorize request. So our own state,
PKCE and ID-token checks all run for real.
"""
import base64
import hashlib
import secrets
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

GOOGLE_KID = "test-key-1"
GOOGLE_CLIENT_ID = "google-client.test"
GITHUB_LOGIN_CLIENT_ID = "github-login-client.test"


def _rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


GOOGLE_KEY = _rsa_key()
OTHER_KEY = _rsa_key()


def jwk_for(private_key, kid):
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    return {**jwk, "kid": kid, "alg": "RS256", "use": "sig"}


def pkce_pair():
    verifier = secrets.token_urlsafe(48)[:64]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


class FakeProviders:
    def __init__(self):
        self.codes = {}  # code -> {"challenge", "nonce", "provider", "used"}
        self.google_user = {"sub": "g-100", "email": "Pat@Example.com", "email_verified": True, "name": "Pat Example"}
        # Overrides for the next ID token: claims, signing key, kid, algorithm
        self.id_token_claims = {}
        self.id_token_key = GOOGLE_KEY
        self.id_token_kid = GOOGLE_KID
        self.id_token_alg = "RS256"
        self.github_user = {"id": 4242, "login": "Octo-Cat", "name": "The Octocat"}
        self.github_emails = [
            {"email": "octo@example.com", "primary": True, "verified": True},
            {"email": "old@example.com", "primary": False, "verified": True},
        ]
        self.github_tokens = set()
        self.github_api_status = 200
        self.jwks_fetches = 0
        self.token_requests = []
        self.down = False

    def authorize(self, url):
        """What the provider does when the browser arrives: issue a code for this request."""
        query = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        code = secrets.token_urlsafe(16)
        provider = "google" if "accounts.google.com" in url else "github"
        self.codes[code] = {"challenge": query["code_challenge"], "nonce": query.get("nonce"), "provider": provider, "used": False}
        return code, query

    def _id_token(self, nonce):
        now = int(time.time())
        claims = {
            "iss": "https://accounts.google.com",
            "aud": GOOGLE_CLIENT_ID,
            "iat": now,
            "exp": now + 3600,
            "nonce": nonce,
            **self.google_user,
            **self.id_token_claims,
        }
        claims = {k: v for k, v in claims.items() if v is not None}
        if self.id_token_alg == "none":
            return jwt.encode(claims, None, algorithm="none", headers={"kid": self.id_token_kid})
        return jwt.encode(claims, self.id_token_key, algorithm=self.id_token_alg, headers={"kid": self.id_token_kid})

    def _redeem(self, data):
        entry = self.codes.get(data.get("code"))
        if entry is None or entry["used"]:
            return None, {"error": "invalid_grant"}
        verifier = data.get("code_verifier", "")
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        if challenge != entry["challenge"]:
            return None, {"error": "invalid_grant", "error_description": "code_verifier mismatch"}
        entry["used"] = True
        return entry, None

    def post(self, url, data=None, **kwargs):
        request = httpx.Request("POST", url)
        if self.down:
            raise httpx.ConnectError("down")
        self.token_requests.append({"url": url, "data": data})
        if url.startswith("https://oauth2.googleapis.com/token"):
            entry, error = self._redeem(data)
            if error:
                return httpx.Response(400, json=error, request=request)
            return httpx.Response(200, json={"id_token": self._id_token(entry["nonce"]), "access_token": "ya29.x"}, request=request)
        if url.startswith("https://github.com/login/oauth/access_token"):
            entry, error = self._redeem(data)
            # Like GitHub: errors come back as 200 with an "error" field
            if error:
                return httpx.Response(200, json=error, request=request)
            token = "gho_" + secrets.token_hex(8)
            self.github_tokens.add(token)
            return httpx.Response(200, json={"access_token": token, "token_type": "bearer", "scope": "read:user,user:email"}, request=request)
        return None

    def get(self, url, **kwargs):
        request = httpx.Request("GET", url)
        if url.startswith("https://www.googleapis.com/oauth2/v3/certs"):
            self.jwks_fetches += 1
            return httpx.Response(200, json={"keys": [jwk_for(GOOGLE_KEY, GOOGLE_KID)]}, request=request)
        if url.startswith("https://api.github.com/"):
            if self.down:
                raise httpx.ConnectError("down")
            token = (kwargs.get("headers") or {}).get("Authorization", "").removeprefix("Bearer ")
            if token not in self.github_tokens:
                return httpx.Response(401, json={"message": "Bad credentials"}, request=request)
            if self.github_api_status != 200:
                return httpx.Response(self.github_api_status, json={"message": "nope"}, request=request)
            if url == "https://api.github.com/user":
                return httpx.Response(200, json=self.github_user, request=request)
            if url == "https://api.github.com/user/emails":
                return httpx.Response(200, json=self.github_emails, request=request)
            return httpx.Response(404, json={"message": "Not Found"}, request=request)
        return None
