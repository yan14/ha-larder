"""Group and convert products (6.11, Block 60).

* **Parent products** (#254): a product can belong to a group chosen by hand (*Milk* over *whole milk* and
  *low-fat milk*). The products stay separate – nothing is ever merged or grouped automatically. The group
  shows the total, can have its own minimum stock and a recipe asking for the group accepts every member.
  A product named exactly like the group counts as a member too (what the shopping list puts back into stock).
* **Size per pack** (#255): what one counted piece holds (500 g, 1 l, 6 pieces). Your own value wins, else it
  is read from the package size (Open Food Facts, *500 g*, *6 x 0,33 l*).
* **Unit price** (#256): price per kg, litre or piece from the price per pack and the size.
* **Amount per tap** (#257): how much −1 takes (2 slices, 100 g).
"""

from __future__ import annotations

import re
from typing import Any

SIZE_UNITS = ("g", "ml", "pcs")
_NUM = r"(\d+(?:[.,]\d+)?)"
_FACTOR = {"g": ("g", 1), "gr": ("g", 1), "kg": ("g", 1000), "mg": ("g", 0.001), "ml": ("ml", 1), "cl": ("ml", 10), "dl": ("ml", 100), "l": ("ml", 1000), "ltr": ("ml", 1000), "liter": ("ml", 1000), "litre": ("ml", 1000)}
_SIZE = re.compile(rf"(?:{_NUM}\s*[x×*]\s*)?{_NUM}\s*(kg|mg|gr|g|ml|cl|dl|ltr|liter|litre|l)\b", re.IGNORECASE)
_PIECES = re.compile(rf"^\s*{_NUM}\s*(?:stück|stk|st\.|pcs|pieces|piece|x)\s*$", re.IGNORECASE)
# a recipe line starting with an amount: "200 g Mehl", "0,5 l Milch", "1 kg Kartoffeln"
_LINE = re.compile(rf"^\s*{_NUM}\s*(kg|g|ml|cl|dl|l)\.?\s+\S", re.IGNORECASE)


def _num(text: str) -> float:
    return float(text.replace(",", "."))


def parse_size(text: Any) -> tuple[float, str] | None:
    """(amount, unit) of a package size text in g, ml or pieces; None if it cannot be read."""
    value = str(text or "").strip()
    if not value:
        return None
    if match := _SIZE.search(value):
        times = _num(match.group(1)) if match.group(1) else 1
        unit, factor = _FACTOR[match.group(3).casefold()]
        amount = round(times * _num(match.group(2)) * factor, 1)
        return (amount, unit) if amount > 0 else None
    if match := _PIECES.match(value):
        amount = _num(match.group(1))
        return (amount, "pcs") if amount > 0 else None
    return None


def line_amount(line: str) -> tuple[float, str] | None:
    """Amount at the start of an ingredient line in g or ml ("200 g Mehl" → (200, "g"))."""
    if not (match := _LINE.match(str(line or ""))):
        return None
    unit, factor = _FACTOR[match.group(2).casefold()]
    return round(_num(match.group(1)) * factor, 1), unit


def unit_price(price: float | None, size: dict[str, Any] | None, pack_size: int = 1) -> dict[str, Any] | None:
    """Price per kg, litre or piece from the price of one pack (`pack_size` counted pieces of `size` each)."""
    if not price or not size or not size.get("amount"):
        return None
    total = float(size["amount"]) * max(1, int(pack_size or 1))
    if size["unit"] == "g":
        return {"price": round(price / total * 1000, 2), "per": "kg"}
    if size["unit"] == "ml":
        return {"price": round(price / total * 1000, 2), "per": "l"}
    return {"price": round(price / total, 2), "per": "piece"}


def amount_text(amount: float, unit: str) -> str:
    """1500 g → "1.5 kg", 330 ml → "330 ml" (the dashboard formats numbers itself; for messages and tests)."""
    if unit == "g" and amount >= 1000:
        return f"{amount / 1000:g} kg"
    if unit == "ml" and amount >= 1000:
        return f"{amount / 1000:g} l"
    return f"{amount:g} {'pcs' if unit == 'pcs' else unit}"


def container_amount(quantity: Any, unit: Any) -> tuple[float, str] | None:
    """Amount of a container filled in grams or millilitres."""
    try:
        value = float(quantity or 0)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return (value, "g") if unit == "grams" else (value, "ml") if unit == "milliliters" else None
