"""Shopping lists: put things on Home Assistant to-do lists.

* **Default lists** (settings): one for food and, optionally, one for household items (empty = the food list).
* **List per product**: a product can use another list (e.g. pharmacy, butcher), chosen on its card or in the
  add dialog and remembered by product name, so the next pack of the same product goes there too.

`shopping_list_for` picks the list for every way onto the list: emptied containers (switch "Shopping list",
off by default so leftovers are not bought again), minimum stock, running low, meal plan, "Again …?" and 🛒.
"""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import DATA_STOCK, DOMAIN, KIND_HOUSEHOLD

_LOGGER = logging.getLogger(__name__)


def _key(content: str | None) -> str:
    return " ".join((content or "").split()).casefold()


def default_list(hass: HomeAssistant, kind: str | None = None) -> str | None:
    """Default list of the settings: household items use their own list if one is chosen, else the food list."""
    estimator = hass.data.get(DOMAIN, {}).get("estimator")
    food = getattr(estimator, "todo_entity", None)
    if kind == KIND_HOUSEHOLD:
        return getattr(estimator, "todo_household", None) or food
    return food


def product_list(hass: HomeAssistant, content: str | None) -> str | None:
    """List chosen for this product (None = default); a list that no longer exists counts as none."""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    chosen = (getattr(stock, "lists", None) or {}).get(_key(content))
    return chosen if chosen and hass.states.get(chosen) is not None else None


def shopping_list_for(hass: HomeAssistant, content: str | None, kind: str | None = None) -> str | None:
    """The list a product goes onto: its own list, else the default for its kind (food or household)."""
    if kind is None:
        stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
        known = (getattr(stock, "minimums", None) or {}).get(_key(content)) or {}
        kind = (known.get("product") or {}).get("kind")
    return product_list(hass, content) or default_list(hass, kind)


def any_list(hass: HomeAssistant) -> bool:
    """Is any shopping list set up (a default list or a list for a product)?"""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    return bool(default_list(hass) or default_list(hass, KIND_HOUSEHOLD) or (getattr(stock, "lists", None) or {}))


def _base(item: str) -> str:
    """Item without the addition in brackets: "Haferflocken (Kölln, 500 g)" counts as "Haferflocken"."""
    return item.split(" (", 1)[0].strip().casefold()


async def async_add_to_shopping_list(hass: HomeAssistant, entity_id: str, item: str) -> bool:
    """Put an item on the to-do list. True if an item was created.

    If the same item (case and addition in brackets do not matter) is already open on the list, nothing is
    created twice. Errors of the list (not reachable, read-only) are only logged,
    emptying the container must not fail because of them.
    """
    item = item.strip()
    if not item:
        return False
    try:
        listed = await hass.services.async_call(
            "todo",
            "get_items",
            {"entity_id": entity_id, "status": "needs_action"},
            blocking=True,
            return_response=True,
        )
        open_items = ((listed or {}).get(entity_id) or {}).get("items") or []
        if any(_base(str(i.get("summary", ""))) == _base(item) for i in open_items):
            return False
        await hass.services.async_call(
            "todo", "add_item", {"entity_id": entity_id, "item": item}, blocking=True
        )
    except HomeAssistantError:
        _LOGGER.warning("Eintrag konnte nicht auf %s gesetzt werden", entity_id, exc_info=True)
        return False
    return True
