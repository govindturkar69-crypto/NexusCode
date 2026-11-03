"""
Proof that the passlib -> pwdlib and python-jose -> PyJWT switch keeps every
existing account and session working.

tests/legacy_auth_fixtures.json was generated with the OLD stack (passlib
1.7.4 + bcrypt 4.0.1, python-jose 3.5.0) before the switch, using the
production settings (bcrypt cost 12, HS256).
"""
import json
import pathlib

import jwt
import pytest

from app.core import security

FIXTURES = json.loads((pathlib.Path(__file__).parent / "legacy_auth_fixtures.json").read_text(encoding="utf-8"))
# The fixture tokens were signed with this (deliberately short, test-only) key
SECRET = FIXTURES["secret"]

pytestmark = pytest.mark.filterwarnings("ignore:The HMAC key is .* below the minimum recommended length")


@pytest.mark.parametrize("item", FIXTURES["hashes"], ids=lambda i: repr(i["password"][:12]))
def test_passwords_hashed_by_passlib_still_verify(item):
    assert item["hash"].startswith("$2b$12$")
    assert security.verify_password(item["password"], item["hash"]) is True
    assert security.verify_password(item["password"] + "x", item["hash"]) is False


def test_new_hashes_use_the_same_format_and_cost():
    from pwdlib import PasswordHash
    from pwdlib.hashers.bcrypt import BcryptHasher

    production = PasswordHash((BcryptHasher(rounds=12),))
    new_hash = production.hash("correct-horse-1")
    assert new_hash.startswith("$2b$12$")
    assert production.verify("correct-horse-1", new_hash)


def test_overlong_or_garbage_input_is_just_a_failed_login():
    legacy = FIXTURES["hashes"][0]["hash"]
    assert security.verify_password("y" * 100, legacy) is False  # bcrypt 5 would raise ValueError
    assert security.verify_password("anything", "not-a-hash") is False


@pytest.fixture
def legacy_secret(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", SECRET)


def test_access_tokens_signed_by_python_jose_still_decode(legacy_secret):
    assert security.decode_access_token(FIXTURES["tokens"]["access"]) == "alice"


def test_expired_legacy_token_is_still_rejected(legacy_secret):
    assert security.decode_access_token(FIXTURES["tokens"]["expired_access"]) is None


def test_oauth_state_signed_by_python_jose_still_verifies(legacy_secret):
    assert security.verify_oauth_state(FIXTURES["tokens"]["oauth_state"]) == (7, "abc")


def test_ws_ticket_signed_by_python_jose_still_verifies(legacy_secret):
    security.used_ws_tickets.clear()
    assert security.consume_ws_ticket(FIXTURES["tokens"]["ws_ticket"], 3) == "alice"


def test_tokens_issued_now_are_plain_hs256_jwts(legacy_secret):
    token = security.create_access_token({"sub": "bob"})
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "HS256"
    assert jwt.decode(token, SECRET, algorithms=["HS256"])["sub"] == "bob"


def test_wrong_algorithm_is_refused(legacy_secret):
    unsigned = jwt.encode({"sub": "alice"}, key=None, algorithm="none")
    assert security.decode_access_token(unsigned) is None
