"""
A stand-in for Gemini at the SDK boundary (client.models.generate_content_stream).
Each scripted reply is a list of parts; it streams them one chunk per part, the way
the real API streams, with usage metadata on the last chunk. It records exactly what
the server sent, so tests can check the conversation, the config and the fencing.
"""
from google.genai import errors, types


def text(value):
    return types.Part(text=value)


def thought(value):
    return types.Part(text=value, thought=True)


def call(name, **args):
    # Real replies from thinking models carry a signature that must come back unchanged
    return types.Part(function_call=types.FunctionCall(name=name, args=args), thought_signature=b"sig-" + name.encode())


class FakeGemini:
    def __init__(self):
        self.replies = []  # list of parts lists, or exceptions to raise
        self.requests = []  # (contents, config) per call
        self.tokens_per_reply = 1000
        self.fail_midway = False

    def script(self, *replies):
        self.replies.extend(replies)
        return self

    def generate_content_stream(self, model, contents, config):
        self.requests.append((list(contents), config))
        if not self.replies:
            raise AssertionError("Gemini was called more times than scripted")
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return self._chunks(reply)

    def _chunks(self, parts):
        for index, part in enumerate(parts):
            if self.fail_midway and index == 1:
                raise errors.ServerError(500, {"error": {"message": "broke"}})
            last = index == len(parts) - 1
            yield types.GenerateContentResponse(
                candidates=[types.Candidate(content=types.Content(role="model", parts=[part]), finish_reason="STOP" if last else None)],
                usage_metadata=types.GenerateContentResponseUsageMetadata(total_token_count=self.tokens_per_reply) if last else None,
            )


def quota_error(quota_id="GenerateRequestsPerDayPerProjectPerModel-FreeTier", retry="71461s"):
    """A 429 shaped like Gemini's real one, which names the quota it hit."""
    return errors.ClientError(429, {"error": {
        "code": 429,
        "message": "You exceeded your current quota",
        "status": "RESOURCE_EXHAUSTED",
        "details": [
            {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{"quotaId": quota_id, "quotaValue": "20"}]},
            {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry},
        ],
    }})


def per_minute_error():
    return quota_error("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "20s")


def busy_error():
    return errors.ServerError(503, {"error": {"code": 503, "message": "Overloaded", "status": "UNAVAILABLE"}})


def parse_sse(body: str) -> list[tuple[str, dict]]:
    import json

    events = []
    for block in body.strip().split("\n\n"):
        if not block.strip():
            continue
        lines = block.split("\n")
        name = lines[0].removeprefix("event: ")
        data = json.loads(lines[1].removeprefix("data: "))
        events.append((name, data))
    return events
