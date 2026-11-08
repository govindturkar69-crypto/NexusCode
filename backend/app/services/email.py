"""
Sending email. Callers use send_email() and status(); the provider is behind
EmailSender, with Resend as the implementation.

Email is optional: without RESEND_API_KEY and MAIL_FROM_EMAIL it's off, and every
feature that needs it says so instead of failing.

Until a domain is verified in Resend, it only delivers to the Resend account
owner's own address (onboarding@resend.dev is that case). That's detected up
front from the sender address, and from Resend's refusal, then reported in
Settings and the logs instead of failing silently.
"""
import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import settings

logger = logging.getLogger("nexuscode")

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 15
# Resend's testing sender, which only delivers to the account owner
RESEND_TEST_DOMAIN = "resend.dev"

RESTRICTED_REASON = (
    "Email can only be delivered to the Resend account owner's own address, because "
    "no sending domain is verified in Resend yet. Verify a domain at resend.com/domains "
    "and send from an address on it to reach everyone."
)


class EmailNotConfiguredError(Exception):
    """Email is off on this server."""


class EmailRestrictedError(Exception):
    """The provider refused because sending is restricted to the account owner."""


class EmailSendError(Exception):
    """Any other failure. The message is safe to show to users."""


class EmailSender(Protocol):
    def send(self, to: str, subject: str, text: str) -> None: ...


class ResendSender:
    def __init__(self, api_key: str, from_address: str):
        self.api_key = api_key
        self.from_address = from_address

    def send(self, to: str, subject: str, text: str) -> None:
        try:
            response = httpx.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json={"from": self.from_address, "to": [to], "subject": subject, "text": text},
                timeout=TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as e:
            raise EmailSendError("The email service couldn't be reached. Please try again.") from e
        if response.is_success:
            return
        try:
            message = str(response.json().get("message", ""))
        except ValueError:
            message = ""
        if response.status_code == 403 and ("verify a domain" in message or "testing emails" in message):
            raise EmailRestrictedError(RESTRICTED_REASON)
        if response.status_code in (401, 403):
            raise EmailSendError("The email service rejected this server's key. The site owner needs to check it.")
        if response.status_code == 429:
            raise EmailSendError("Too many emails are being sent right now. Please try again in a minute.")
        raise EmailSendError("The email couldn't be sent. Please try again.")


@dataclass
class _State:
    # Set when Resend refuses because of the restriction, so Settings can say so
    restriction_seen: bool = False


_state = _State()


def is_configured() -> bool:
    return bool(settings.resend_api_key and settings.mail_from_email)


def from_address() -> str:
    name = (settings.mail_from_name or "").strip().replace('"', "")
    return f"{name} <{settings.mail_from_email}>" if name else settings.mail_from_email


def is_restricted() -> bool:
    if not is_configured():
        return False
    domain = settings.mail_from_email.rsplit("@", 1)[-1].lower()
    return domain == RESEND_TEST_DOMAIN or _state.restriction_seen


def status() -> dict:
    """What Settings shows about sending."""
    if not is_configured():
        return {
            "enabled": False,
            "restricted": False,
            "message": "Email isn't set up on this server, so email verification and password reset are turned off.",
        }
    if is_restricted():
        return {"enabled": True, "restricted": True, "message": RESTRICTED_REASON}
    return {"enabled": True, "restricted": False, "message": None}


def get_sender() -> EmailSender:
    return ResendSender(settings.resend_api_key, from_address())


def send_email(to: str, subject: str, text: str) -> None:
    if not is_configured():
        raise EmailNotConfiguredError(status()["message"])
    try:
        get_sender().send(to, subject, text)
    except EmailRestrictedError:
        _state.restriction_seen = True
        logger.warning("Email to a non-owner address was refused: %s", RESTRICTED_REASON)
        raise
    except EmailSendError:
        logger.exception("Email could not be sent")
        raise


def log_configuration() -> None:
    """Called at startup, so the logs say how email will behave."""
    if not is_configured():
        logger.warning("Email is off: set RESEND_API_KEY and MAIL_FROM_EMAIL to enable verification and password reset.")
    elif is_restricted():
        logger.warning("Email sending is restricted: %s", RESTRICTED_REASON)
    else:
        logger.info("Email is on, sending from %s", settings.mail_from_email)


def reset_state() -> None:
    """For tests."""
    _state.restriction_seen = False
