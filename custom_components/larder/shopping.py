"""Einkaufsliste: Inhalt einer geleerten Dose auf eine To-do-Liste von Home Assistant setzen.

Die Liste wird in den Einstellungen gewählt (z. B. "Einkaufsliste", Todoist, Bring! oder jede andere
To-do-Entität). Ob eine Dose beim Leeren etwas auf die Liste setzt, entscheidet der Schalter
"Einkaufsliste" der jeweiligen Dose (standardmäßig aus, damit z. B. Reste nicht nachgekauft werden).
"""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

_LOGGER = logging.getLogger(__name__)


def _base(item: str) -> str:
    """Eintrag ohne Zusatz in Klammern: "Haferflocken (Kölln, 500 g)" gilt als "Haferflocken"."""
    return item.split(" (", 1)[0].strip().casefold()


async def async_add_to_shopping_list(hass: HomeAssistant, entity_id: str, item: str) -> bool:
    """Eintrag auf die To-do-Liste setzen. True, wenn ein Eintrag angelegt wurde.

    Steht derselbe Eintrag (Groß-/Kleinschreibung und Zusatz in Klammern egal) schon offen auf der Liste, wird nichts
    doppelt angelegt. Fehler der Liste (nicht erreichbar, schreibgeschützt) werden nur protokolliert,
    das Leeren der Dose soll daran nicht scheitern.
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
