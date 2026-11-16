"""Parser for the content of the Zwilling QR code.

Example content:
    zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL

Also accepted are only the query part ("tc=...&cc=...") or the
bare ID ("34OL").
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
import re
import secrets
from urllib.parse import parse_qs, urlparse

_CODE_RE = re.compile(r"^[A-Z0-9_-]{2,32}$")

# Generated IDs: prefix "HA-" plus 8 characters without easily confused ones (0/O, 1/I).
# The prefix with a hyphen keeps them clearly apart from the Zwilling IDs (e.g. "34OL").
GENERATED_PREFIX = "HA-"
_GENERATED_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_GENERATED_LENGTH = 8


@dataclass(frozen=True)
class ParsedCode:
    """Result of parsing."""

    cc: str
    tc: str | None = None
    size: str | None = None


def parse_qr(raw: str | None) -> ParsedCode | None:
    """Returns the ID (and extra data) or None if there is nothing usable in it."""
    raw = (raw or "").strip()
    if not raw:
        return None

    tc: str | None
    size: str | None
    if "://" in raw or "=" in raw:
        query = urlparse(raw).query if "://" in raw else raw.lstrip("?")
        params = {key.lower(): values[0] for key, values in parse_qs(query).items() if values}
        cc = params.get("cc")
        tc = params.get("tc")
        size = params.get("s")
    else:
        cc, tc, size = raw, None, None

    if not cc:
        return None
    cc = cc.strip().upper()
    if not _CODE_RE.match(cc):
        return None

    return ParsedCode(
        cc=cc,
        tc=tc.strip().upper() if tc and tc.strip() else None,
        size=size.strip().lower() if size and size.strip() else None,
    )


def generate_code(existing: Collection[str | None] = ()) -> str:
    """Create a new, unique ID (does not collide with existing entries)."""
    taken = {code.upper() for code in existing if code}
    while True:
        code = GENERATED_PREFIX + "".join(
            secrets.choice(_GENERATED_ALPHABET) for _ in range(_GENERATED_LENGTH)
        )
        if code not in taken:
            return code
