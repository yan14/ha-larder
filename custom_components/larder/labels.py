"""QR-Etikettenbogen (A4) als PDF: eigene QR-Codes mehrerer Dosen zum Ausdrucken.

Das PDF wird hier ohne Zusatzbibliothek geschrieben: die QR-Codes als Vektor-Rechtecke (scharf
in jeder Druckgröße), Text in Helvetica oder (Design "Handschrift") in der eingebetteten freien
Schrift Kalam (SIL Open Font License, fonts/OFL-Kalam.txt). Immer schwarz-weiß. Aufgerufen wird es aus dem
Dashboard über eine signierte URL (`/api/larder/labels.pdf?...`), damit es sich in der App im
Browser öffnen, teilen und drucken lässt.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from pathlib import Path
import struct
from datetime import date
from functools import partial
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
    page: tuple[float, float] = A4  # Etikettendrucker: eine Seite pro Etikett

    @property
    def per_page(self) -> int:
        return self.cols * self.rows


# Gängige Bögen (z. B. Avery Zweckform 3475 = 70 × 36, 3652 = 70 × 42,3, 3655 = 105 × 74 … ähnliche Formate passen)
LAYOUTS: dict[str, Layout] = {
    "3x8": Layout(3, 8, 70.0, 36.0, 4.5, 0.0),
    "3x7": Layout(3, 7, 70.0, 42.3, 0.15, 0.0),
    "2x4": Layout(2, 4, 105.0, 74.0, 0.5, 0.0),
    # Etikettendrucker (eine Seite = ein Etikett), z. B. Brother DK-11209, Dymo 11352, Dymo 99012
    "62x29": Layout(1, 1, 62.0, 29.0, 0.0, 0.0, page=(62.0, 29.0)),
    "54x25": Layout(1, 1, 54.0, 25.0, 0.0, 0.0, page=(54.0, 25.0)),
    "89x36": Layout(1, 1, 89.0, 36.0, 0.0, 0.0, page=(89.0, 36.0)),
}
DESIGNS = ("plain", "frame", "notched", "handwritten")
_K = 0.5523  # Bézier-Annäherung eines Viertelkreises
FONT_FILE = Path(__file__).parent / "fonts" / "Kalam-Bold.ttf"
DEFAULT_LAYOUT = "3x8"


@dataclass(frozen=True)
class Label:
    name: str
    qr: str
    content: str = ""
    best_before: str = ""
    nutrition: str = ""  # z. B. "372 kcal/100 g · Nutri-Score A · Gluten"


_TEXT = {
    "de": {"best_before": "MHD"},
    "en": {"best_before": "Best before"},
}


def _pdf_text(value: str) -> bytes:
    """Text für Helvetica (WinAnsi): Umlaute bleiben, Unbekanntes wird '?', Klammern werden maskiert."""
    raw = value.encode("cp1252", errors="replace")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


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


_HELVETICA_REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 552, 400, 549, 333, 333, 333, 576, 537, 333, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 549, 611, 556, 556, 556, 556, 500, 556, 500]
_HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 552, 400, 549, 333, 333, 333, 576, 556, 333, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 549, 611, 611, 611, 611, 611, 556, 611, 556]


@cache
def _kalam() -> tuple[bytes, list[int], dict[str, int]]:
    """Schriftdatei, Breiten für WinAnsi 32–255 (in 1/1000 em) und Kennzahlen für den Font-Deskriptor."""
    data = FONT_FILE.read_bytes()
    count = struct.unpack(">H", data[4:6])[0]
    tables = {}
    for i in range(count):
        tag, _sum, offset, length = struct.unpack(">4sIII", data[12 + 16 * i : 28 + 16 * i])
        tables[tag.decode()] = (offset, length)

    def table(tag: str) -> bytes:
        offset, length = tables[tag]
        return data[offset : offset + length]

    head, hhea, hmtx = table("head"), table("hhea"), table("hmtx")
    upem = struct.unpack(">H", head[18:20])[0]
    bbox = struct.unpack(">hhhh", head[36:44])
    ascent, descent = struct.unpack(">hh", hhea[4:8])
    metrics = struct.unpack(">H", hhea[34:36])[0]
    advances = [struct.unpack(">H", hmtx[4 * i : 4 * i + 2])[0] for i in range(metrics)]
    # cmap Format 4 (Unicode BMP)
    cmap = table("cmap")
    glyph_of: dict[int, int] = {}
    for i in range(struct.unpack(">H", cmap[2:4])[0]):
        platform, encoding, offset = struct.unpack(">HHI", cmap[4 + 8 * i : 12 + 8 * i])
        if struct.unpack(">H", cmap[offset : offset + 2])[0] != 4 or (platform, encoding) not in ((3, 1), (0, 3), (0, 4)):
            continue
        sub = cmap[offset:]
        segs = struct.unpack(">H", sub[6:8])[0] // 2
        ends = struct.unpack(f">{segs}H", sub[14 : 14 + 2 * segs])
        starts = struct.unpack(f">{segs}H", sub[16 + 2 * segs : 16 + 4 * segs])
        deltas = struct.unpack(f">{segs}h", sub[16 + 4 * segs : 16 + 6 * segs])
        range_pos = 16 + 6 * segs
        ranges = struct.unpack(f">{segs}H", sub[range_pos : range_pos + 2 * segs])
        for seg in range(segs):
            for code in range(starts[seg], ends[seg] + 1):
                if code == 0xFFFF:
                    continue
                if ranges[seg] == 0:
                    glyph = (code + deltas[seg]) & 0xFFFF
                else:
                    pos = range_pos + 2 * seg + ranges[seg] + 2 * (code - starts[seg])
                    glyph = struct.unpack(">H", sub[pos : pos + 2])[0]
                    glyph = (glyph + deltas[seg]) & 0xFFFF if glyph else 0
                if glyph:
                    glyph_of[code] = glyph
        break
    widths = []
    for b in range(32, 256):
        try:
            char = bytes([b]).decode("cp1252")
        except UnicodeDecodeError:
            widths.append(0)
            continue
        glyph = glyph_of.get(ord(char), 0)
        advance = advances[min(glyph, metrics - 1)] if glyph else 0
        widths.append(round(advance * 1000 / upem))
    scale = 1000 / upem
    info = {
        "ascent": round(ascent * scale),
        "descent": round(descent * scale),
        "bbox": [round(v * scale) for v in bbox],
    }
    return data, widths, info


# Schriften im PDF: F1 Helvetica, F2 Helvetica-Bold, F3 Kalam (Handschrift)
def _widths(font: str) -> list[int]:
    if font == "F3":
        return _kalam()[1]
    return _HELVETICA_BOLD if font == "F2" else _HELVETICA_REGULAR


def _measure(text: str, font: str, size: float) -> float:
    widths = _widths(font)
    raw = text.encode("cp1252", errors="replace")
    return sum(widths[b - 32] if b >= 32 else 0 for b in raw) * size / 1000


def _fit(text: str, width_pt: float, size: float, font: str = "F1") -> str:
    """Text so kürzen, dass er in die Breite passt (mit … am Ende)."""
    text = " ".join(text.split())
    if _measure(text, font, size) <= width_pt:
        return text
    while text and _measure(text + "…", font, size) > width_pt:
        text = text[:-1]
    return text.rstrip() + "…"


def _wrap(text: str, width_pt: float, size: float, max_lines: int, font: str = "F1") -> list[str] | None:
    """Wortweise umbrechen; None, wenn es in `max_lines` Zeilen nicht passt (ohne Wort zu zerschneiden)."""
    words = text.split()
    lines: list[str] = []
    while words:
        line = words.pop(0)
        if _measure(line, font, size) > width_pt:
            return None
        while words and _measure(f"{line} {words[0]}", font, size) <= width_pt:
            line += " " + words.pop(0)
        lines.append(line)
        if len(lines) > max_lines:
            return None
    return lines


def _rounded(x: float, y: float, w: float, h: float, r: float) -> bytes:
    k = _K * r
    return (
        f"{x + r:.2f} {y:.2f} m {x + w - r:.2f} {y:.2f} l "
        f"{x + w - r + k:.2f} {y:.2f} {x + w:.2f} {y + r - k:.2f} {x + w:.2f} {y + r:.2f} c "
        f"{x + w:.2f} {y + h - r:.2f} l "
        f"{x + w:.2f} {y + h - r + k:.2f} {x + w - r + k:.2f} {y + h:.2f} {x + w - r:.2f} {y + h:.2f} c "
        f"{x + r:.2f} {y + h:.2f} l "
        f"{x + r - k:.2f} {y + h:.2f} {x:.2f} {y + h - r + k:.2f} {x:.2f} {y + h - r:.2f} c "
        f"{x:.2f} {y + r:.2f} l "
        f"{x:.2f} {y + r - k:.2f} {x + r - k:.2f} {y:.2f} {x + r:.2f} {y:.2f} c h"
    ).encode()


def _notched(x: float, y: float, w: float, h: float, r: float) -> bytes:
    """Rechteck mit nach innen gewölbten Ecken (wie ein Eintrittskarten-Etikett)."""
    k = _K * r
    return (
        f"{x + r:.2f} {y:.2f} m {x + w - r:.2f} {y:.2f} l "
        f"{x + w - r:.2f} {y + k:.2f} {x + w - k:.2f} {y + r:.2f} {x + w:.2f} {y + r:.2f} c "
        f"{x + w:.2f} {y + h - r:.2f} l "
        f"{x + w - k:.2f} {y + h - r:.2f} {x + w - r:.2f} {y + h - k:.2f} {x + w - r:.2f} {y + h:.2f} c "
        f"{x + r:.2f} {y + h:.2f} l "
        f"{x + r:.2f} {y + h - k:.2f} {x + k:.2f} {y + h - r:.2f} {x:.2f} {y + h - r:.2f} c "
        f"{x:.2f} {y + r:.2f} l "
        f"{x + k:.2f} {y + r:.2f} {x + r:.2f} {y + k:.2f} {x + r:.2f} {y:.2f} c h"
    ).encode()


def _bracket(x: float, y: float, w: float, h: float) -> bytes:
    """Klassisches Glas-Etikett: gewölbte Ecken, oben und unten leicht nach außen, seitlich nach innen geschwungen."""
    r = min(w, h) * 0.16
    k = _K * r
    bump = h * 0.06  # Wölbung oben/unten
    dent = w * 0.035  # Einzug an den Seiten
    mx, my = x + w / 2, y + h / 2
    return (
        f"{x + r:.2f} {y + bump:.2f} m "
        f"{x + w * 0.3:.2f} {y + bump:.2f} {mx - w * 0.12:.2f} {y:.2f} {mx:.2f} {y:.2f} c "
        f"{mx + w * 0.12:.2f} {y:.2f} {x + w * 0.7:.2f} {y + bump:.2f} {x + w - r:.2f} {y + bump:.2f} c "
        f"{x + w - r:.2f} {y + bump + k:.2f} {x + w - k:.2f} {y + bump + r:.2f} {x + w:.2f} {y + bump + r:.2f} c "
        f"{x + w - dent:.2f} {my - h * 0.12:.2f} {x + w - dent:.2f} {my + h * 0.12:.2f} {x + w:.2f} {y + h - bump - r:.2f} c "
        f"{x + w - k:.2f} {y + h - bump - r:.2f} {x + w - r:.2f} {y + h - bump - k:.2f} {x + w - r:.2f} {y + h - bump:.2f} c "
        f"{x + w * 0.7:.2f} {y + h - bump:.2f} {mx + w * 0.12:.2f} {y + h:.2f} {mx:.2f} {y + h:.2f} c "
        f"{mx - w * 0.12:.2f} {y + h:.2f} {x + w * 0.3:.2f} {y + h - bump:.2f} {x + r:.2f} {y + h - bump:.2f} c "
        f"{x + r:.2f} {y + h - bump - k:.2f} {x + k:.2f} {y + h - bump - r:.2f} {x:.2f} {y + h - bump - r:.2f} c "
        f"{x + dent:.2f} {my + h * 0.12:.2f} {x + dent:.2f} {my - h * 0.12:.2f} {x:.2f} {y + bump + r:.2f} c "
        f"{x + k:.2f} {y + bump + r:.2f} {x + r:.2f} {y + bump + k:.2f} {x + r:.2f} {y + bump:.2f} c h"
    ).encode()


def _design_ops(design: str, x: float, y: float, w: float, h: float) -> tuple[list[bytes], float, float]:
    """(Rahmen, Abstand nach innen waagrecht, senkrecht in pt) – alles schwarz, keine Flächen."""
    m = 1.5 * MM
    x, y, w, h = x + m, y + m, w - 2 * m, h - 2 * m
    if design == "frame":
        return [b"0 G 0.8 w", _rounded(x, y, w, h, 3 * MM) + b" S"], 2.0 * MM, 2.0 * MM
    if design == "notched":
        d = 1.1 * MM
        return [
            b"0 G 0.9 w", _notched(x, y, w, h, 3.5 * MM) + b" S",
            b"0.35 w", _notched(x + d, y + d, w - 2 * d, h - 2 * d, 3.5 * MM - d) + b" S",
        ], 2.6 * MM, 2.6 * MM
    if design == "handwritten":
        d = 1.0 * MM
        return [
            b"0 G 1.1 w", _bracket(x, y, w, h) + b" S",
            b"0.35 w", _bracket(x + d, y + d, w - 2 * d, h - 2 * d) + b" S",
        ], w * 0.07 + 2 * MM, h * 0.06 + 2.4 * MM
    return [], 0.0, 0.0


def _text_line(text: str, x: float, y: float, size: float, font: str) -> bytes:
    return b"BT /" + font.encode() + f" {size:.2f} Tf {x:.3f} {y:.3f} Td (".encode() + _pdf_text(text) + b") Tj ET"


def _layout_text(
    label: Label, show_name: bool, show_content: bool, show_nutrition: bool, width: float, height: float,
    language: str, bold: str, regular: str, big: bool, show_best_before: bool = False,
) -> list[tuple[str, float, str]]:
    """Zeilen (Text, Größe, Schrift) so groß wie möglich, die in width × height passen.

    Der Name (bzw. der Inhalt, wenn kein Name gedruckt wird) bricht auf bis zu zwei Zeilen um, statt
    abgeschnitten zu werden; Inhalt, MHD und Nährwerte sind kleiner.
    """
    main = label.name if show_name else (label.content if show_content and label.content else "")
    content = label.content if show_content and show_name else ""
    if content and content.casefold() == main.casefold():
        content = ""  # Name und Inhalt gleich ("Zucker"): nicht doppelt drucken
    extras: list[str] = []
    if show_best_before and label.best_before:
        extras.append(f"{_TEXT[language]['best_before']}: {label.best_before}")
    if show_nutrition and label.nutrition:
        extras.append(label.nutrition)
    if not main and not content and not extras:
        main = label.name
    # Obergrenze, damit kurze Namen ("Zucker") nicht viel größer werden als lange
    top = min(height * 0.34, 40.0) if big else min(height * 0.24, 22.0)
    size = top
    while size >= 6.0:
        small = max(5.5, min(size * 0.6, 11.0))
        lines: list[tuple[str, float, str]] = []
        main_lines = _wrap(main, width, size, 2, bold) if main else []
        if main_lines is None:
            size -= 0.5
            continue
        lines += [(line, size, bold) for line in main_lines]
        if content:
            content_lines = _wrap(content, width, small, 2, regular)
            if content_lines is None:
                content_lines = [_fit(content, width, small, regular)]
            lines += [(line, small, regular) for line in content_lines]
        for extra in extras:
            extra_lines = _wrap(extra, width, small * 0.95, 2, regular) or [_fit(extra, width, small * 0.95, regular)]
            lines += [(line, small * 0.95, regular) for line in extra_lines]
        total = sum(s * 1.18 for _, s, _ in lines)
        if total <= height:
            return lines
        size -= 0.5
    # passt auch klein nicht: eine gekürzte Zeile
    return [(_fit(main or label.name, width, 6.0, bold), 6.0, bold)]


def _label_ops(
    label: Label,
    layout: Layout,
    index: int,
    border: bool,
    language: str,
    show_qr: bool = True,
    show_name: bool = True,
    show_content: bool = False,
    design: str = "plain",
    show_nutrition: bool = False,
    show_best_before: bool = False,
) -> list[bytes]:
    col, row = index % layout.cols, index // layout.cols
    x_mm = layout.left + col * (layout.width + layout.gap_x)
    y_top_mm = layout.top + row * (layout.height + layout.gap_y)
    x = x_mm * MM
    y = (layout.page[1] - y_top_mm - layout.height) * MM  # PDF zählt von unten
    w, h = layout.width * MM, layout.height * MM
    frame, inset_x, inset_y = _design_ops(design, x, y, w, h)
    pad = 2.5 * MM
    pad_x, pad_y = pad + inset_x, pad + inset_y
    hand = design == "handwritten"
    bold, regular = ("F3", "F3") if hand else ("F2", "F1")
    ops: list[bytes] = [b"q 0 g 0 G"]
    if border:
        ops += [b"0.6 G 0.3 w", f"{x:.3f} {y:.3f} {w:.3f} {h:.3f} re S".encode(), b"0 G"]

    has_text = show_name or show_content or show_best_before or show_nutrition or not show_qr
    if show_qr:
        qr_size = min(h - 2 * pad_y, w * 0.38) if has_text else min(w - 2 * pad_x, h - 2 * pad_y)
        qr_x = x + pad_x if has_text else x + (w - qr_size) / 2
        ops += _qr_ops(label.qr, qr_x, y + (h - qr_size) / 2, qr_size)
        text_x = qr_x + qr_size + 2.5 * MM
        text_w = x + w - pad_x - text_x
    else:
        text_x, text_w = x + pad_x, w - 2 * pad_x
    text_h = h - 2 * pad_y
    if has_text:
        lines = _layout_text(
            label, show_name, show_content, show_nutrition, text_w, text_h, language, bold, regular, not show_qr,
            show_best_before,
        )
        total = sum(size * 1.18 for _, size, _ in lines)
        cursor = y + h / 2 + total / 2
        for text, size, font in lines:
            cursor -= size * 0.95
            line_x = text_x if show_qr else text_x + max(0.0, (text_w - _measure(text, font, size)) / 2)
            ops.append(_text_line(text, line_x, cursor, size, font))
            cursor -= size * 0.23
    ops += frame
    ops.append(b"Q")
    return ops


def build_pdf(
    labels: list[Label],
    layout_key: str = DEFAULT_LAYOUT,
    skip: int = 0,
    border: bool = False,
    language: str = "en",
    *,
    show_qr: bool = True,
    show_name: bool = True,
    show_content: bool = False,
    design: str = "plain",
    show_nutrition: bool = False,
    show_best_before: bool = False,
) -> bytes:
    """PDF mit allen Etiketten; `skip` lässt am Anfang schon benutzte Felder eines Bogens frei."""
    if design == "vintage":
        design = "handwritten"  # früherer Name
    layout = LAYOUTS.get(layout_key, LAYOUTS[DEFAULT_LAYOUT])
    language = "de" if language.lower().startswith("de") else "en"
    skip = max(0, min(skip, layout.per_page - 1))
    slots = [None] * skip + list(labels)
    pages: list[list[bytes]] = []
    for start in range(0, max(len(slots), 1), layout.per_page):
        ops: list[bytes] = []
        for i, label in enumerate(slots[start : start + layout.per_page]):
            if label is not None:
                ops += _label_ops(
                    label, layout, i, border, language, show_qr, show_name, show_content, design, show_nutrition,
                    show_best_before,
                )
        pages.append(ops)

    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog = add(b"")  # wird unten gefüllt
    pages_id = add(b"")
    font_regular = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    font_bold = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    fonts = f"/F1 {font_regular} 0 R /F2 {font_bold} 0 R"
    if design == "handwritten":
        data, widths, info = _kalam()
        file_id = add(b"<< /Length %d /Length1 %d >>\nstream\n" % (len(data), len(data)) + data + b"\nendstream")
        descriptor = add(
            (
                f"<< /Type /FontDescriptor /FontName /Kalam-Bold /Flags 32 /FontBBox [{' '.join(map(str, info['bbox']))}] "
                f"/ItalicAngle 0 /Ascent {info['ascent']} /Descent {info['descent']} /CapHeight {info['ascent']} "
                f"/StemV 120 /FontFile2 {file_id} 0 R >>"
            ).encode()
        )
        font_hand = add(
            (
                f"<< /Type /Font /Subtype /TrueType /BaseFont /Kalam-Bold /FirstChar 32 /LastChar 255 "
                f"/Widths [{' '.join(map(str, widths))}] /FontDescriptor {descriptor} 0 R /Encoding /WinAnsiEncoding >>"
            ).encode()
        )
        fonts += f" /F3 {font_hand} 0 R"
    kids: list[int] = []
    width, height = layout.page[0] * MM, layout.page[1] * MM
    for ops in pages:
        stream = b"\n".join(ops)
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        kids.append(
            add(
                (
                    f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {width:.2f} {height:.2f}] "
                    f"/Resources << /Font << {fonts} >> >> "
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


_NUTRITION_TEXT = {"de": {"portion": "Portion"}, "en": {"portion": "portion"}}


def nutrition_line(attrs: dict, language: str) -> str:
    """Kurze Nährwertzeile fürs Etikett: kcal (pro Portion bzw. 100 g), Nutri-Score, Allergene."""
    de = language.lower().startswith("de")
    parts = []

    def num(value) -> str:
        text = f"{value:g}" if isinstance(value, (int, float)) else str(value)
        return text.replace(".", ",") if de else text

    if attrs.get("kcal_portion") is not None:
        parts.append(f"{num(attrs['kcal_portion'])} kcal/{_NUTRITION_TEXT['de' if de else 'en']['portion']}")
    if attrs.get("kcal_100g") is not None:
        parts.append(f"{num(attrs['kcal_100g'])} kcal/100 g")
    if attrs.get("nutri_score"):
        parts.append(f"Nutri-Score {attrs['nutri_score']}")
    if attrs.get("allergens"):
        parts.append(str(attrs["allergens"]))
    return " · ".join(parts)


def collect_labels(
    hass: HomeAssistant,
    codes: list[str] | None,
    with_content: bool,
    with_nutrition: bool = False,
    with_best_before: bool | None = None,
) -> list[Label]:
    """Etiketten der gewünschten Dosen (alle, wenn `codes` leer ist), alphabetisch nach Name."""
    registry = er.async_get(hass)
    wanted = {c.upper() for c in codes or []}
    language = hass.config.language or "en"
    labels: list[Label] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get("cc")
        if not cc or (wanted and cc.upper() not in wanted):
            continue
        content = best = nutrition = ""
        if with_nutrition:
            entity_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
            state = hass.states.get(entity_id) if entity_id else None
            if state is not None:
                nutrition = nutrition_line(dict(state.attributes), language)
        wanted_parts = [("text", "content")] if with_content else []
        if with_content if with_best_before is None else with_best_before:
            wanted_parts.append(("date", "best_before"))
        if wanted_parts:
            for platform, key in wanted_parts:
                entity_id = registry.async_get_entity_id(platform, DOMAIN, f"{cc}_{key}")
                state = hass.states.get(entity_id) if entity_id else None
                value = state.state if state and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE) else ""
                if key == "content":
                    content = value
                else:
                    best = _format_date(value, language) if value else ""
        labels.append(Label(entry.title or cc, scan_app_url(cc), content, best, nutrition))
    labels.sort(key=lambda label: label.name.casefold())
    return labels


class LabelSheetView(HomeAssistantView):
    """GET /api/larder/labels.pdf?device=<id>,<id>&layout=3x8&skip=0&content=1&bestbefore=1&border=0 (oder cc=A,B; ohne: alle)"""

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
        show_content = query.get("content") == "1"
        show_nutrition = query.get("nutrition") == "1"
        # Inhalt und MHD getrennt (seit 2.12.1); alte Links mit nur content=1 drucken beides
        show_best_before = query.get("bestbefore", "1" if show_content else "0") == "1"
        labels = collect_labels(hass, codes, show_content, show_nutrition, show_best_before)
        if not labels:
            return self.json_message("no containers", HTTPStatus.NOT_FOUND)
        try:
            skip = int(query.get("skip", "0"))
        except ValueError:
            skip = 0
        design = query.get("design", "plain")
        design = "handwritten" if design == "vintage" else design
        pdf = await hass.async_add_executor_job(
            partial(
                build_pdf,
                labels,
                query.get("layout", DEFAULT_LAYOUT),
                skip,
                query.get("border") == "1",
                hass.config.language or "en",
                show_qr=query.get("qr", "1") != "0",
                show_name=query.get("name", "1") != "0",
                show_content=show_content,
                design=design if design in DESIGNS else "plain",
                show_nutrition=show_nutrition,
                show_best_before=show_best_before,
            )
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
