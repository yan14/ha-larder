"""Parser für den Inhalt des Zwilling-QR-Codes.

Beispiel-Inhalt:
    zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL

Akzeptiert werden außerdem nur der Query-Teil ("tc=...&cc=...") oder die
nackte ID ("34OL").
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
import re
import secrets
from urllib.parse import parse_qs, urlparse

_CODE_RE = re.compile(r"^[A-Z0-9_-]{2,32}$")

# Selbst erzeugte IDs: Präfix "HA-" plus 8 Zeichen ohne leicht verwechselbare (0/O, 1/I).
# Das Präfix mit Bindestrich hält sie klar von den Zwilling-IDs (z. B. "34OL") getrennt.
GENERATED_PREFIX = "HA-"
_GENERATED_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_GENERATED_LENGTH = 8


@dataclass(frozen=True)
class ParsedCode:
    """Ergebnis des Parsens."""

    cc: str
    tc: str | None = None
    size: str | None = None


def parse_qr(raw: str | None) -> ParsedCode | None:
    """Liefert die ID (und Zusatzdaten) oder None, wenn nichts Brauchbares drinsteht."""
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
    """Neue, eindeutige ID erzeugen (kollidiert nicht mit bestehenden Einträgen)."""
    taken = {code.upper() for code in existing if code}
    while True:
        code = GENERATED_PREFIX + "".join(
            secrets.choice(_GENERATED_ALPHABET) for _ in range(_GENERATED_LENGTH)
        )
        if code not in taken:
            return code
