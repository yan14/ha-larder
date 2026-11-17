"""Store sections (4.7): the shopping list in the order you walk through the store.

Every product has a section (fruit & vegetables, bakery, fridge …). Larder suggests it from the kind and the
category of the product and remembers a section chosen on the card by product name. When Larder writes an item
onto a to-do list that can move items (e.g. the shopping list, Local To-do), the item is moved behind the last open
item of the same or an earlier section; the order of the sections is a setting, because stores differ.
Lists that cannot move items stay as they are.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_STOCK, DOMAIN, KIND_HOUSEHOLD, KIND_MEDICINE

_LOGGER = logging.getLogger(__name__)

# default order of a typical German supermarket
SECTIONS: tuple[str, ...] = (
    "produce", "bakery", "meat", "fridge", "dry", "breakfast", "drinks", "frozen", "drugstore", "pharmacy", "other",
)

_BY_CATEGORY = {
    "produce": "produce",
    "bread": "bakery",
    "raw_meat": "meat",
    "fish": "meat",
    "deli": "meat",
    "dairy": "fridge",
    "egg": "fridge",
    "dish": "fridge",
    "dry": "dry",
    "sweet": "breakfast",
    "coffee": "breakfast",
}

# keywords that beat the category (German and English)
_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("frozen", ("tiefkühl", "tk-", "tk ", "gefroren", "eiscreme", "speiseeis", "pommes", "fischstäbchen", "frozen", "ice cream")),
    ("drinks", ("wasser", "sprudel", "saft", "schorle", "limo", "cola", "bier", "wein", "sekt", "getränk", "eistee",
                "water", "juice", "lemonade", "soda", "beer", "wine", "drink")),
)


def _norm(text: str | None) -> str:
    return f" {' '.join((text or '').casefold().split())} "


def suggest_section(content: str | None, kind: str | None = None, category: str | None = None) -> str:
    """Section suggested for a product: by kind, keywords, then category; else "other"."""
    if kind == KIND_HOUSEHOLD:
        return "drugstore"
    if kind == KIND_MEDICINE:
        return "pharmacy"
    text = _norm(content)
    for section, words in _KEYWORDS:
        if any(w in text for w in words):
            return section
    if category is None and content:
        from .shelf_life import category_for  # noqa: PLC0415 - large table, loaded on use

        category = category_for(content)
    return _BY_CATEGORY.get(category or "", "other")


def section_order(hass: HomeAssistant) -> list[str]:
    """Order of the sections from the settings; unknown ones dropped, missing ones appended."""
    estimator = hass.data.get(DOMAIN, {}).get("estimator")
    chosen = [s for s in (getattr(estimator, "section_order", None) or []) if s in SECTIONS]
    return [*dict.fromkeys(chosen), *(s for s in SECTIONS if s not in chosen)]


def normalize_order(value: Any, default: list[str]) -> list[str]:
    """Setting "order of the sections" (list of keys)."""
    if not isinstance(value, list | tuple):
        return list(default)
    chosen = [str(v) for v in value if str(v) in SECTIONS]
    return [*dict.fromkeys(chosen), *(s for s in SECTIONS if s not in chosen)]


def _base(item: str) -> str:
    return " ".join(item.split(" (", 1)[0].split()).casefold()


def section_of(hass: HomeAssistant, content: str | None, kind: str | None = None) -> str:
    """Section of a product: chosen on the card, else suggested (kind known from the stock if not given)."""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    key = _base(content or "")
    own = (getattr(stock, "sections", None) or {}).get(key)
    if own in SECTIONS:
        return own
    if kind is None:
        known = (getattr(stock, "minimums", None) or {}).get(key) or {}
        kind = (known.get("product") or {}).get("kind")
    return suggest_section(content, kind)


async def async_sort_into_section(hass: HomeAssistant, entity_id: str, item: str) -> bool:
    """Move a newly added item behind the last open item of the same or an earlier section.

    True if it was moved. Lists without "move" support and errors leave the list as it is.
    """
    try:
        from homeassistant.components.todo import (  # noqa: PLC0415
            DATA_COMPONENT,
            TodoItemStatus,
            TodoListEntityFeature,
        )

        component = hass.data.get(DATA_COMPONENT)
        entity = component.get_entity(entity_id) if component else None
        if entity is None or not (entity.supported_features or 0) & TodoListEntityFeature.MOVE_TODO_ITEM:
            return False
        items = [i for i in (entity.todo_items or []) if i.status == TodoItemStatus.NEEDS_ACTION and i.uid]
        new = next((i for i in reversed(items) if (i.summary or "").strip() == item.strip()), None)
        if new is None:
            return False
        order = section_order(hass)
        rank = {s: n for n, s in enumerate(order)}
        mine = rank[section_of(hass, item)]
        previous: str | None = None
        moved_past = False
        for other in items:
            if other.uid == new.uid:
                continue
            if rank[section_of(hass, other.summary or "")] <= mine:
                previous = other.uid
            else:
                moved_past = True
        if previous is None and not moved_past:
            return False  # nothing else open
        # already in place: directly behind `previous` (or first) and nothing later belongs before it
        index = [i.uid for i in items].index(new.uid)
        before = [i.uid for i in items[:index]]
        if (before[-1] if before else None) == previous:
            return False
        await entity.async_move_todo_item(uid=new.uid, previous_uid=previous)
    except Exception:  # noqa: BLE001 - sorting is a convenience, never fail adding the item
        _LOGGER.debug("Eintrag auf %s konnte nicht einsortiert werden", entity_id, exc_info=True)
        return False
    return True
