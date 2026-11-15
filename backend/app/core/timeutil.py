"""Small datetime helpers shared by routers and services."""
from datetime import UTC, datetime


def aware_utc(value: datetime) -> datetime:
    """SQLite gives naive datetimes (stored as UTC); Postgres gives aware ones.
    This makes both aware, so they can be compared and subtracted."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)
