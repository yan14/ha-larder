"""Buttons in push notifications (5.2, #127): act on an expiring entry without opening the app.

The daily summary (blueprint, *one push per entry*) adds to each entry the buttons Used up · Thrown away ·
+2 days · On the list. The Home Assistant app reports a tap as the event `mobile_app_notification_action`
with the action `LARDER_<WHAT>_<container ID>`; Larder carries it out here:

* **Used up / Thrown away:** a pack is one less (the last one empties it), a container or bag is emptied,
  with the answer in the history.
* **+2 days:** the best-before date two days later.
* **On the list:** the product onto its shopping list (with brand and package, remembered for "bought").
"""

from __future__ import annotations

from datetime import timedelta
import logging
import re
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .const import DOMAIN, PACK_KINDS, pick
from .devices import entry_of

_LOGGER = logging.getLogger(__name__)

PREFIX = "LARDER_"
WHATS = ("EATEN", "THROWN", "PLUS2", "SHOP")
ACTION_RE = re.compile(rf"^{PREFIX}({'|'.join(WHATS)})_(.+)$")
DATA_UNSUB = "notify_actions_unsub"
EVENT_DONE = f"{DOMAIN}_notification_action_done"
EXTEND_DAYS = 2

TITLES = {
    "de": {"EATEN": "Verbraucht", "THROWN": "Weggeworfen", "PLUS2": "+2 Tage", "SHOP": "Auf die Liste"},
    "en": {"EATEN": "Used up", "THROWN": "Thrown away", "PLUS2": "+2 days", "SHOP": "On the list"},
    "fr": {"EATEN": "Consommé", "THROWN": "Jeté", "PLUS2": "+2 jours", "SHOP": "Sur la liste"},
    "nl": {"EATEN": "Op", "THROWN": "Weggegooid", "PLUS2": "+2 dagen", "SHOP": "Op de lijst"},
}


def item_actions(item: dict[str, Any], language: str) -> list[dict[str, str]]:
    """The buttons for one expiring entry (not for vouchers); used up first (Android shows only three)."""
    if item.get("kind") == "voucher" or not item.get("cc"):
        return []
    titles = pick(TITLES, language)
    whats = ["EATEN", "THROWN", "PLUS2"] + (["SHOP"] if item.get("content") else [])
    return [{"action": f"{PREFIX}{what}_{item['cc']}", "title": titles[what]} for what in whats]


def parse_action(action: Any) -> tuple[str, str] | None:
    match = ACTION_RE.match(str(action or ""))
    return (match.group(1), match.group(2)) if match else None


def _entity(hass: HomeAssistant, platform: str, cc: str, key: str) -> str | None:
    return er.async_get(hass).async_get_entity_id(platform, DOMAIN, f"{cc}_{key}")


async def async_run_action(hass: HomeAssistant, what: str, cc: str) -> dict[str, Any]:
    """Carry out one button of a notification; raises HomeAssistantError if the entry is gone."""
    from .entity import kind_of  # noqa: PLC0415
    from .history import async_get_history  # noqa: PLC0415
    from .stock import async_shop_product, async_take_one  # noqa: PLC0415

    entry = entry_of(hass, cc)
    if entry is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    content_id = _entity(hass, "text", cc, "content")
    state = hass.states.get(content_id) if content_id else None
    content = (state.state if state and state.state not in ("unknown", "unavailable") else "").strip()
    kind = kind_of(entry)
    if what in ("EATEN", "THROWN"):
        outcome = "eaten" if what == "EATEN" else "thrown"
        if kind in PACK_KINDS:
            return {"what": what, "content": content, **(await async_take_one(hass, cc, outcome))}
        button = _entity(hass, "button", cc, "empty_container")
        if not button:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
        history = await async_get_history(hass)
        history.set_pending(cc, outcome)
        try:
            await hass.services.async_call("button", "press", {"entity_id": button}, blocking=True)
        finally:
            history.pop_pending(cc)
        return {"what": what, "content": content}
    if what == "PLUS2":
        date_id = _entity(hass, "date", cc, "best_before")
        date_state = hass.states.get(date_id) if date_id else None
        try:
            base = dt_util.parse_date(date_state.state) if date_state else None
        except ValueError:
            base = None
        base = base or dt_util.now().date()
        new = base + timedelta(days=EXTEND_DAYS)
        await hass.services.async_call("date", "set_value", {"entity_id": date_id, "date": new.isoformat()}, blocking=True)
        return {"what": what, "content": content, "best_before": new.isoformat()}
    if not content:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    added, text = await async_shop_product(hass, content)
    return {"what": what, "content": content, "added": added, "item": text}


@callback
def async_setup_notify_actions(hass: HomeAssistant) -> None:
    """Listen once for taps on Larder's buttons in notifications."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_UNSUB):
        return

    async def handle(event: Event) -> None:
        parsed = parse_action(event.data.get("action"))
        if parsed is None:
            return
        what, cc = parsed
        try:
            result = await async_run_action(hass, what, cc)
        except HomeAssistantError:
            _LOGGER.debug("Notification action %s for %s not possible", what, cc, exc_info=True)
            return
        hass.bus.async_fire(EVENT_DONE, {"cc": cc, **result})

    domain_data[DATA_UNSUB] = hass.bus.async_listen("mobile_app_notification_action", handle)
