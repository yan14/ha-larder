"""QR-Etikettenbogen (A4) als PDF: eigene QR-Codes mehrerer Dosen zum Ausdrucken.

Das PDF wird hier ohne Zusatzbibliothek geschrieben: die QR-Codes als Vektor-Rechtecke (scharf
in jeder Druckgröße), Text in der eingebauten Schrift Helvetica. Aufgerufen wird es aus dem
Dashboard über eine signierte URL (`/api/larder/labels.pdf?...`), damit es sich in der App im
Browser öffnen, teilen und drucken lässt.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from http import HTTPStatus

from aiohttp import web
import segno

from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er

from .const import DOMAIN, scan_app_url

URL = f"/api/{DOMAIN}/labels.pdf"
DATA_VIEW = "labels_view"
MM = 72 / 25.4  # PDF-Punkte pro Millimeter
A4 = (210.0, 297.0)


@dataclass(frozen=True)
class Layout:
    """Etikettenformat auf A4 (alle Maße in mm)."""

    cols: int
    rows: int
    width: float
    height: float
    top: float  # Rand oben
    left: float  # Rand links
    gap_x: float = 0.0
    gap_y: float = 0.0

    @property
    def per_page(self) -> int:
        return self.cols * self.rows


# Gängige Bögen (z. B. Avery Zweckform 3475 = 70 × 36, 3652 = 70 × 42,3, 3655 = 105 × 74 … ähnliche Formate passen)
LAYOUTS: dict[str, Layout] = {
    "3x8": Layout(3, 8, 70.0, 36.0, 4.5, 0.0),
    "3x7": Layout(3, 7, 70.0, 42.3, 0.15, 0.0),
    "2x4": Layout(2, 4, 105.0, 74.0, 0.5, 0.0),
}
DEFAULT_LAYOUT = "3x8"


@dataclass(frozen=True)
class Label:
    name: str
    qr: str
    content: str = ""
    best_before: str = ""


_TEXT = {
    "de": {"best_before": "MHD"},
    "en": {"best_before": "Best before"},
}


def _pdf_text(value: str) -> bytes:
    """Text für Helvetica (WinAnsi): Umlaute bleiben, Unbekanntes wird '?', Klammern werden maskiert."""
    raw = value.encode("cp1252", errors="replace")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


# Durchschnittliche Zeichenbreite von Helvetica (Anteil der Schriftgröße) für das Kürzen langer Texte
_AVG = {False: 0.53, True: 0.58}


def _fit(text: str, width_pt: float, size: float, bold: bool = False) -> str:
    """Text so kürzen, dass er (ungefähr) in die Breite passt."""
    text = " ".join(text.split())
    limit = max(1, int(width_pt / (size * _AVG[bold])))
    return text if len(text) <= limit else text[: max(1, limit - 1)].rstrip() + "…"


def _wrap(text: str, width_pt: float, size: float, max_lines: int) -> list[str]:
    """Text auf höchstens `max_lines` Zeilen umbrechen; der Rest wird mit … gekürzt."""
    limit = max(1, int(width_pt / (size * _AVG[False])))
    lines: list[str] = []
    words = text.split()
    while words and len(lines) < max_lines:
        line = words.pop(0)
        while words and len(line) + 1 + len(words[0]) <= limit:
            line += " " + words.pop(0)
        lines.append(line)
    if words:
        lines[-1] = lines[-1] + " " + " ".join(words)
    return [_fit(line, width_pt, size) for line in lines]


def _qr_ops(content: str, x: float, y: float, size: float) -> list[bytes]:
    """QR-Code als gefüllte Rechtecke; (x, y) = linke untere Ecke, size = Kantenlänge in pt (ohne Ruhezone)."""
    matrix = segno.make_qr(content, error="m").matrix
    count = len(matrix)
    module = size / count
    ops: list[bytes] = []
    for r, row in enumerate(matrix):
        c = 0
        while c < count:
            if row[c]:
                start = c
                while c < count and row[c]:
                    c += 1
                ops.append(
                    f"{x + start * module:.3f} {y + (count - 1 - r) * module:.3f} "
                    f"{(c - start) * module:.3f} {module:.3f} re".encode()
                )
            else:
                c += 1
    ops.append(b"f")
    return ops


def _label_ops(label: Label, layout: Layout, index: int, border: bool, language: str) -> list[bytes]:
    col, row = index % layout.cols, index // layout.cols
    x_mm = layout.left + col * (layout.width + layout.gap_x)
    y_top_mm = layout.top + row * (layout.height + layout.gap_y)
    x = x_mm * MM
    y = (A4[1] - y_top_mm - layout.height) * MM  # PDF zählt von unten
    w, h = layout.width * MM, layout.height * MM
    pad = 3.0 * MM
    ops: list[bytes] = [b"q"]
    if border:
        ops += [b"0.8 g 0.8 G 0.3 w", f"{x:.3f} {y:.3f} {w:.3f} {h:.3f} re S".encode(), b"0 g 0 G"]
    qr_size = min(h - 2 * pad, w * 0.5)
    ops += [b"0 g"] + _qr_ops(label.qr, x + pad, y + (h - qr_size) / 2, qr_size)
    text_x = x + pad + qr_size + 2.5 * MM
    text_w = x + w - pad - text_x
    lines: list[tuple[str, float, bool]] = [(label.name, 11.0 if layout.height < 40 else 13.0, True)]
    if label.content:
        lines += [(part, 8.5, False) for part in _wrap(label.content, text_w, 8.5, 2)]
    if label.best_before:
        lines.append((f"{_TEXT[language]['best_before']}: {label.best_before}", 8.5, False))
    total = sum(size * 1.25 for _, size, _ in lines)
    cursor = y + h / 2 + total / 2
    for text, size, bold in lines:
        cursor -= size * 1.05
        font = b"/F2" if bold else b"/F1"
        ops.append(
            b"BT " + font + f" {size} Tf {text_x:.3f} {cursor:.3f} Td (".encode()
            + _pdf_text(_fit(text, text_w, size, bold))
            + b") Tj ET"
        )
        cursor -= size * 0.2
    ops.append(b"Q")
    return ops


def build_pdf(
    labels: list[Label],
    layout_key: str = DEFAULT_LAYOUT,
    skip: int = 0,
    border: bool = False,
    language: str = "en",
) -> bytes:
    """PDF mit allen Etiketten; `skip` lässt am Anfang schon benutzte Felder eines Bogens frei."""
    layout = LAYOUTS.get(layout_key, LAYOUTS[DEFAULT_LAYOUT])
    language = "de" if language.lower().startswith("de") else "en"
    skip = max(0, min(skip, layout.per_page - 1))
    slots = [None] * skip + list(labels)
    pages: list[list[bytes]] = []
    for start in range(0, max(len(slots), 1), layout.per_page):
        ops: list[bytes] = []
        for i, label in enumerate(slots[start : start + layout.per_page]):
            if label is not None:
                ops += _label_ops(label, layout, i, border, language)
        pages.append(ops)

    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog = add(b"")  # wird unten gefüllt
    pages_id = add(b"")
    font_regular = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    font_bold = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    kids: list[int] = []
    width, height = A4[0] * MM, A4[1] * MM
    for ops in pages:
        stream = b"\n".join(ops)
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        kids.append(
            add(
                (
                    f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {width:.2f} {height:.2f}] "
                    f"/Resources << /Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R >> >> "
                    f"/Contents {content} 0 R >>"
                ).encode()
            )
        )
    objects[catalog - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode()
    objects[pages_id - 1] = (
        f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()
    )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def _format_date(value: str, language: str) -> str:
    try:
        d = date.fromisoformat(value)
    except ValueError:
        return ""
    return d.strftime("%d.%m.%Y") if language.lower().startswith("de") else d.isoformat()


def collect_labels(hass: HomeAssistant, codes: list[str] | None, with_content: bool) -> list[Label]:
    """Etiketten der gewünschten Dosen (alle, wenn `codes` leer ist), alphabetisch nach Name."""
    registry = er.async_get(hass)
    wanted = {c.upper() for c in codes or []}
    language = hass.config.language or "en"
    labels: list[Label] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get("cc")
        if not cc or (wanted and cc.upper() not in wanted):
            continue
        content = best = ""
        if with_content:
            for platform, key in (("text", "content"), ("date", "best_before")):
                entity_id = registry.async_get_entity_id(platform, DOMAIN, f"{cc}_{key}")
                state = hass.states.get(entity_id) if entity_id else None
                value = state.state if state and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE) else ""
                if key == "content":
                    content = value
                else:
                    best = _format_date(value, language) if value else ""
        labels.append(Label(entry.title or cc, scan_app_url(cc), content, best))
    labels.sort(key=lambda label: label.name.casefold())
    return labels


class LabelSheetView(HomeAssistantView):
    """GET /api/larder/labels.pdf?device=<id>,<id>&layout=3x8&skip=0&content=1&border=0 (oder cc=A,B; ohne: alle)"""

    url = URL
    name = f"api:{DOMAIN}:labels"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        query = request.query
        codes = [c for c in query.get("cc", "").split(",") if c.strip()]
        devices = dr.async_get(hass)
        for device_id in (d for d in query.get("device", "").split(",") if d.strip()):
            device = devices.async_get(device_id)
            codes += [ident for domain, ident in (device.identifiers if device else ()) if domain == DOMAIN]
        if (query.get("cc") or query.get("device")) and not codes:
            return self.json_message("no containers", HTTPStatus.NOT_FOUND)
        labels = collect_labels(hass, codes, query.get("content") == "1")
        if not labels:
            return self.json_message("no containers", HTTPStatus.NOT_FOUND)
        try:
            skip = int(query.get("skip", "0"))
        except ValueError:
            skip = 0
        pdf = await hass.async_add_executor_job(
            build_pdf,
            labels,
            query.get("layout", DEFAULT_LAYOUT),
            skip,
            query.get("border") == "1",
            hass.config.language or "en",
        )
        return web.Response(
            body=pdf,
            content_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="larder-labels.pdf"'},
        )


def async_setup_labels(hass: HomeAssistant) -> None:
    """HTTP-Endpunkt einmalig registrieren (idempotent)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_VIEW):
        return
    hass.http.register_view(LabelSheetView())
    domain_data[DATA_VIEW] = True
