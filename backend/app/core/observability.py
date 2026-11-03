"""
Structured logging and error tracking.

- LOG_FORMAT=json (default) prints one JSON object per line, which log
  platforms (Render, Datadog, ...) can index; LOG_FORMAT=text is easier
  to read locally.
- SENTRY_DSN enables Sentry; without it nothing is sent anywhere. Personal
  data (cookies, auth headers, IPs) is not sent: send_default_pii=False.
"""
import json
import logging
import sys
from datetime import UTC, datetime

# Extra fields a log call can attach via `extra={...}`
CONTEXT_FIELDS = ("request_id", "method", "path", "status", "duration_ms", "client")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for field in CONTEXT_FIELDS:
            if hasattr(record, field):
                entry[field] = getattr(record, field)
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    handler = logging.StreamHandler(sys.stdout)
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Route uvicorn's own loggers through the same handler/format
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True
    # Request logging is done by our middleware (without query strings)
    logging.getLogger("uvicorn.access").disabled = True


def init_sentry(dsn: str | None, environment: str, traces_sample_rate: float) -> bool:
    """Starts Sentry if a DSN is configured. Returns whether it is enabled."""
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        traces_sample_rate=traces_sample_rate,
        send_default_pii=False,
    )
    return True
