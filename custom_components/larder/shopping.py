"""Shopping list: put the content of an emptied container on a Home Assistant to-do list.

The list is chosen in the settings (e.g. "Shopping list", Todoist, Bring! or any other
to-do entity). Whether a container puts something on the list when emptied is decided by the switch
"Shopping list" of that container (off by default, so e.g. leftovers are not bought again).
"""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

_LOGGER = logging.getLogger(__name__)


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
