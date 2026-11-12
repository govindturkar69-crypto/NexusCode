"""
Group video meetings on LiveKit. No media and no meeting state pass through this
backend: LiveKit's servers carry the audio/video and track who is in each room.
The backend only does two things:

  * signs a short-lived access token for a project member (create_token), and
  * removes someone from a call when they lose access to the project (kick),
    since LiveKit checks a token only when a participant joins.

The API secret is used only here, to sign tokens and authenticate those calls.
It is never sent to the browser.
"""
import asyncio
import logging
from datetime import timedelta

import aiohttp
from livekit import api

from app.core.config import settings
from app.models import UserModel

logger = logging.getLogger("nexuscode")

# How long a token can be used to join. A call that has started keeps going after
# this (LiveKit refreshes the connection itself); it only limits joining later.
TOKEN_TTL = timedelta(hours=1)
# Removing a member must not wait long on LiveKit
KICK_TIMEOUT_SECONDS = 5


def is_configured() -> bool:
    return bool(settings.livekit_url and settings.livekit_api_key and settings.livekit_api_secret)


def room_name(project_id: int) -> str:
    """One room per project, the same for everyone in it."""
    return f"nexuscode-project-{project_id}"


def create_token(user: UserModel, project_id: int) -> str:
    """A token for this user to join this project's room. Every member, viewers
    included, may publish camera, microphone and screen, and send data messages."""
    grants = api.VideoGrants(
        room_join=True,
        room=room_name(project_id),
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
    )
    return (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(str(user.id))
        .with_name(user.username)
        .with_ttl(TOKEN_TTL)
        .with_grants(grants)
        .to_jwt()
    )


async def kick(project_id: int, user_id: int) -> None:
    """Removes the user from the project's call, if they are in it. Best effort:
    it never raises, so removing a member always completes."""
    if not is_configured():
        return
    request = api.RoomParticipantIdentity(room=room_name(project_id), identity=str(user_id))
    try:
        async with api.LiveKitAPI(
            settings.livekit_url,
            settings.livekit_api_key,
            settings.livekit_api_secret,
            timeout=aiohttp.ClientTimeout(total=KICK_TIMEOUT_SECONDS),
            failover=False,
        ) as client:
            await asyncio.wait_for(client.room.remove_participant(request), KICK_TIMEOUT_SECONDS + 1)
    except Exception as e:
        # Usually "not found": they weren't in the call. Only the type is logged.
        if getattr(e, "code", None) == "not_found":
            return
        logger.warning("Could not remove user %s from the meeting of project %s (%s)", user_id, project_id, type(e).__name__)
