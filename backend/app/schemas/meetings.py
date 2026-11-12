from pydantic import BaseModel


class MeetingTokenResponse(BaseModel):
    # A LiveKit access token for this project's room, and the LiveKit server URL
    token: str
    url: str
