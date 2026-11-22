"""Overview sensors for automations (5.3, #131), on the main entry "Larder" (no device).

* `sensor.larder_expired` – food entries past their best-before date (attribute `items`)
* `sensor.larder_expiring_soon` – food entries expiring within "expires soon" (attribute `items`)
* `sensor.larder_stock_value` – value of the packs in stock (in the currency of Home Assistant)
* `sensor.larder_shopping_open` – open items on the shopping lists Larder uses
* `sensor.larder_supply_days` – days the emergency supply lasts (BBK check)

They update when contents, dates, amounts or the shopping lists change (shortly after) and every 10 minutes.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED, UnitOfTime
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_time_interval

from .const import DOMAIN

REFRESH = timedelta(minutes=10)
DEBOUNCE = 2  # seconds
MAX_ITEMS = 20

NAMES = {
    "de": {
        "expired": "Larder abgelaufen",
        "expiring_soon": "Larder läuft bald ab",
        "stock_value": "Larder Bestandswert",
        "shopping_open": "Larder Einkaufsliste offen",
        "supply_days": "Larder Notvorrat Tage",
    },
    "en": {
        "expired": "Larder expired",
        "expiring_soon": "Larder expiring soon",
        "stock_value": "Larder stock value",
        "shopping_open": "Larder shopping list open",
        "supply_days": "Larder emergency supply days",
    },
}
ICONS = {
    "expired": "mdi:food-off",
    "expiring_soon": "mdi:clock-alert-outline",
    "stock_value": "mdi:cash",
    "shopping_open": "mdi:cart-outline",
    "supply_days": "mdi:shield-home-outline",
}


def _expiring(hass: HomeAssistant, expired: bool) -> tuple[int, dict[str, Any]]:
    from .expiry import STATUS_EXPIRED, STATUS_SOON, collect_expiring  # noqa: PLC0415

    wanted = STATUS_EXPIRED if expired else STATUS_SOON
    items = [i for i in collect_expiring(hass, None, include_expired=True, vouchers=False) if i["status"] == wanted]
    names = [f"{i['content'] or i['name']}" for i in items]
    return len(items), {"items": names[:MAX_ITEMS]}


async def _stock_value(hass: HomeAssistant) -> tuple[float | None, dict[str, Any]]:
    from .stock import async_get_stock, stock_overview  # noqa: PLC0415

    stock = await async_get_stock(hass)
    products = stock_overview(hass, stock.minimums, stock)
    values = [p["value"] for p in products if p.get("value")]
    unpriced = sum(1 for p in products if p["count"] and not p.get("value"))
    return round(sum(values), 2), {"products_priced": len(values), "products_without_price": unpriced}


async def _shopping_open(hass: HomeAssistant) -> tuple[int, dict[str, Any]]:
    from .shopping_mode import shopping_lists  # noqa: PLC0415
    from .stock import async_get_stock  # noqa: PLC0415

    lists = shopping_lists(hass, await async_get_stock(hass))
    counts = {}
    for entity_id in lists:
        state = hass.states.get(entity_id)
        try:
            counts[entity_id] = int(float(state.state)) if state else 0
        except ValueError:
            counts[entity_id] = 0
    return sum(counts.values()), {"lists": counts}


async def _supply_days(hass: HomeAssistant) -> tuple[int | None, dict[str, Any]]:
    from .estimate import async_get_estimator  # noqa: PLC0415
    from .supply import supply_report  # noqa: PLC0415

    estimator = await async_get_estimator(hass)
    if not estimator.supply_check:
        return None, {}
    report = supply_report(hass, int(estimator.supply_persons), int(estimator.supply_days), hass.config.language or "en")
    return report["days_covered"], {"target_days": int(estimator.supply_days), "persons": int(estimator.supply_persons)}


class LarderSummarySensor(SensorEntity):
    """One overview value; computed by `compute` (sync for the expiry counts, else async)."""

    _attr_has_entity_name = False
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, key: str, compute: Callable, is_async: bool) -> None:
        de = (hass.config.language or "en").lower().startswith("de")
        self._key = key
        self._compute = compute
        self._is_async = is_async
        self._attr_name = NAMES["de" if de else "en"][key]
        self._attr_unique_id = f"{entry.unique_id or entry.entry_id}_{key}"
        self._attr_icon = ICONS[key]
        self.entity_id = f"sensor.larder_{key}"
        self._attr_extra_state_attributes: dict[str, Any] = {}
        self._unsub_later: Callable[[], None] | None = None
        if key in ("expired", "expiring_soon", "shopping_open"):
            self._attr_state_class = SensorStateClass.MEASUREMENT
        if key == "stock_value":
            self._attr_device_class = SensorDeviceClass.MONETARY
            self._attr_native_unit_of_measurement = hass.config.currency
            self._attr_state_class = SensorStateClass.TOTAL
        if key == "supply_days":
            self._attr_native_unit_of_measurement = UnitOfTime.DAYS

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_track_time_interval(self.hass, self._refresh_now, REFRESH))
        self.async_on_remove(self.hass.bus.async_listen(EVENT_STATE_CHANGED, self._state_changed))
        self.async_on_remove(self._cancel_later)
        await self.async_update_value()

    @callback
    def _cancel_later(self) -> None:
        if self._unsub_later:
            self._unsub_later()
            self._unsub_later = None

    @callback
    def _state_changed(self, event: Event) -> None:
        entity_id = event.data.get("entity_id") or ""
        if entity_id.startswith("sensor.larder_"):
            return
        if entity_id.startswith("todo."):
            relevant = self._key == "shopping_open"
        else:
            entry = er.async_get(self.hass).async_get(entity_id)
            relevant = entry is not None and entry.platform == DOMAIN
        if relevant and self._unsub_later is None:
            self._unsub_later = async_call_later(self.hass, DEBOUNCE, self._refresh_now)

    async def _refresh_now(self, _now: Any = None) -> None:
        self._unsub_later = None
        await self.async_update_value()
        self.async_write_ha_state()

    async def async_update_value(self) -> None:
        value, attrs = await self._compute(self.hass) if self._is_async else self._compute(self.hass)
        self._attr_native_value = value
        self._attr_extra_state_attributes = attrs


def summary_sensors(hass: HomeAssistant, entry: ConfigEntry) -> list[LarderSummarySensor]:
    return [
        LarderSummarySensor(hass, entry, "expired", lambda h: _expiring(h, True), False),
        LarderSummarySensor(hass, entry, "expiring_soon", lambda h: _expiring(h, False), False),
        LarderSummarySensor(hass, entry, "stock_value", _stock_value, True),
        LarderSummarySensor(hass, entry, "shopping_open", _shopping_open, True),
        LarderSummarySensor(hass, entry, "supply_days", _supply_days, True),
    ]
