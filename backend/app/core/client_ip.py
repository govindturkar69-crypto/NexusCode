"""
The client's IP address, as far as it can be trusted.

Behind a reverse proxy (Render), the TCP peer is the proxy, and the client's
address is in X-Forwarded-For. A client can write anything into that header
itself, and each proxy only **appends** what it saw, so only the rightmost
entries are trustworthy: the one added by the proxy next to us, and so on
leftwards for each further proxy we trust.

TRUSTED_PROXY_HOPS (default 1) says how many proxies sit in front of the app:

- 0: ignore X-Forwarded-For; the client is the TCP peer.
- N >= 1: the client is the entry N places from the right. If the header has
  fewer entries (the request didn't come through all N proxies), or that entry
  isn't a valid IP address, fall back to the TCP peer.

The leftmost entry is never used (unless the header has exactly N entries, in
which case it IS the one the outermost proxy wrote). The same rule applies to
X-Forwarded-Proto, for HSTS.

uvicorn runs WITHOUT --proxy-headers (see Dockerfile), so request.client is
always the real TCP peer and this module is the single place a client address
comes from (rate limits; logs and Sentry don't record client IPs).
"""
import ipaddress

from starlette.requests import HTTPConnection

from app.core.config import settings


def _parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """A bare IPv4/IPv6 address, '[v6]:port' or 'v4:port'; None for anything else."""
    value = value.strip().strip('"')
    if not value:
        return None
    if value.startswith("["):  # [2001:db8::1]:443
        end = value.find("]")
        if end == -1:
            return None
        value = value[1:end]
    elif value.count(":") == 1:  # 203.0.113.9:51000
        value = value.split(":", 1)[0]
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        return address.ipv4_mapped
    return address


def _entry_from_right(conn: HTTPConnection, header: str, hops: int) -> str | None:
    """The entry `hops` places from the right of a comma-separated forwarding
    header (several header lines count as one list, in order), or None."""
    if hops <= 0:
        return None
    values = conn.headers.getlist(header)
    entries = [entry.strip() for entry in ",".join(values).split(",")] if values else []
    if not values or entries == [""] or len(entries) < hops:
        return None
    return entries[-hops]


def _peer(conn: HTTPConnection) -> str:
    host = conn.client.host if conn.client else ""
    parsed = _parse_ip(host) if host else None
    return str(parsed) if parsed else (host or "unknown")


def client_ip(conn: HTTPConnection, hops: int | None = None) -> str:
    """The client's address as a normalised string (IPv6 compressed, IPv4-mapped
    IPv6 shown as IPv4). Never chosen by the caller beyond what the trusted proxy saw."""
    hops = settings.trusted_proxy_hops if hops is None else hops
    entry = _entry_from_right(conn, "x-forwarded-for", hops)
    parsed = _parse_ip(entry) if entry is not None else None
    return str(parsed) if parsed else _peer(conn)


def rate_limit_key(conn: HTTPConnection, hops: int | None = None) -> str:
    """Key for per-IP rate limits. IPv6 clients are grouped by /64, the block one
    home or phone normally gets, so rotating addresses inside it doesn't reset the limit."""
    address = client_ip(conn, hops)
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return address
    if isinstance(parsed, ipaddress.IPv6Address):
        return str(ipaddress.ip_network(f"{parsed}/64", strict=False))
    return address


def limiter_key(request) -> str:
    """rate_limit_key with the configured hops. slowapi passes the request only to
    key functions that take exactly one parameter, hence this wrapper."""
    return rate_limit_key(request)


def is_https(conn: HTTPConnection, hops: int | None = None) -> bool:
    """Whether the client connected over HTTPS: the trusted proxy's
    X-Forwarded-Proto, else the scheme of the direct connection."""
    hops = settings.trusted_proxy_hops if hops is None else hops
    proto = _entry_from_right(conn, "x-forwarded-proto", hops)
    if proto is not None:
        return proto.lower() == "https"
    return conn.url.scheme in ("https", "wss")
