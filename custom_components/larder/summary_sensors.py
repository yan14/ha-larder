"""Overview sensors for automations (5.3, #131), on the main entry "Larder" (no device).

* `sensor.larder_expired` – food entries past their best-before date (attribute `items`)
* `sensor.larder_expiring_soon` – food entries expiring within "expires soon" (attribute `items`)
* `sensor.larder_stock_value` – value of the packs in stock (in the currency of Home Assistant)
* `sensor.larder_shopping_open` – open items on the shopping lists Larder uses
* `sensor.larder_supply_days` – days the emergency supply lasts (BBK check)

They update when contents, dates, amounts or the shopping lists change (shortly after) and every 10 minutes.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED, UnitOfTime
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_time_interval

from .const import DOMAIN, pick

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
    "fr": {
        "expired": "Larder périmés",
        "expiring_soon": "Larder bientôt périmés",
        "stock_value": "Larder valeur du stock",
        "shopping_open": "Larder liste de courses ouverte",
        "supply_days": "Larder jours de réserves d'urgence",
    },
    "nl": {
        "expired": "Larder verlopen",
        "expiring_soon": "Larder verloopt binnenkort",
        "stock_value": "Larder voorraadwaarde",
        "shopping_open": "Larder boodschappenlijst open",
        "supply_days": "Larder dagen noodvoorraad",
    },
}
ICONS = {
    "expired": "mdi:food-off",
    "expiring_soon": "mdi:clock-alert-outline",
    "stock_value": "mdi:cash",
    "shopping_open": "mdi:cart-outline",
    "supply_days": "mdi:shield-home-outline",
}


def _expiring_both(hass: HomeAssistant) -> tuple[tuple[int, dict[str, Any]], tuple[int, dict[str, Any]]]:
    """Expired and expiring soon from one pass over the entries."""
    from .expiry import STATUS_EXPIRED, STATUS_SOON, collect_expiring  # noqa: PLC0415

    items = collect_expiring(hass, None, include_expired=True, vouchers=False)
    out = []
    for wanted in (STATUS_EXPIRED, STATUS_SOON):
        names = [f"{i['content'] or i['name']}" for i in items if i["status"] == wanted]
        out.append((len(names), {"items": names[:MAX_ITEMS]}))
    return out[0], out[1]


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


class SummaryData:
    """All overview values, computed together once per change (5.4) instead of once per sensor."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.values: dict[str, tuple[Any, dict[str, Any]]] = {}
        self._sensors: list[LarderSummarySensor] = []
        self._unsub_later: Callable[[], None] | None = None
        self._unsubs: list[Callable[[], None]] = []
        self._lock = asyncio.Lock()

    @callback
    def add(self, sensor: LarderSummarySensor) -> None:
        self._sensors.append(sensor)
        if len(self._sensors) == 1:
            self._unsubs = [
                async_track_time_interval(self.hass, self._refresh_now, REFRESH),
                self.hass.bus.async_listen(EVENT_STATE_CHANGED, self._state_changed),
            ]

    @callback
    def remove(self, sensor: LarderSummarySensor) -> None:
        if sensor in self._sensors:
            self._sensors.remove(sensor)
        if not self._sensors:
            for unsub in self._unsubs:
                unsub()
            self._unsubs = []
            if self._unsub_later:
                self._unsub_later()
                self._unsub_later = None

    @callback
    def _state_changed(self, event: Event) -> None:
        if self._unsub_later is not None:
            return  # a refresh is already on its way
        entity_id = event.data.get("entity_id") or ""
        if entity_id.startswith("sensor.larder_"):
            return
        if entity_id.startswith("todo."):
            relevant = True
        else:
            entry = er.async_get(self.hass).async_get(entity_id)
            relevant = entry is not None and entry.platform == DOMAIN
        if relevant:
            self._unsub_later = async_call_later(self.hass, DEBOUNCE, self._refresh_now)

    async def _refresh_now(self, _now: Any = None) -> None:
        self._unsub_later = None
        await self.async_refresh()
        for sensor in self._sensors:
            sensor.async_write_ha_state()

    async def async_refresh(self) -> None:
        async with self._lock:
            expired, soon = _expiring_both(self.hass)
            self.values = {
                "expired": expired,
                "expiring_soon": soon,
                "stock_value": await _stock_value(self.hass),
                "shopping_open": await _shopping_open(self.hass),
                "supply_days": await _supply_days(self.hass),
            }


class LarderSummarySensor(SensorEntity):
    """One overview value from the shared `SummaryData`."""

    _attr_has_entity_name = False
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, key: str, data: SummaryData) -> None:
        self._key = key
        self._data = data
        self._attr_name = pick(NAMES, hass.config.language)[key]
        self._attr_unique_id = f"{entry.unique_id or entry.entry_id}_{key}"
        self._attr_icon = ICONS[key]
        self.entity_id = f"sensor.larder_{key}"
        if key in ("expired", "expiring_soon", "shopping_open"):
            self._attr_state_class = SensorStateClass.MEASUREMENT
        if key == "stock_value":
            self._attr_device_class = SensorDeviceClass.MONETARY
            self._attr_native_unit_of_measurement = hass.config.currency
            self._attr_state_class = SensorStateClass.TOTAL
        if key == "supply_days":
            self._attr_native_unit_of_measurement = UnitOfTime.DAYS

    @property
    def native_value(self) -> Any:
        return (self._data.values.get(self._key) or (None, {}))[0]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return (self._data.values.get(self._key) or (None, {}))[1]

    async def async_added_to_hass(self) -> None:
        self._data.add(self)
        self.async_on_remove(lambda: self._data.remove(self))
        if self._key not in self._data.values:
            await self._data.async_refresh()


def summary_sensors(hass: HomeAssistant, entry: ConfigEntry) -> list[LarderSummarySensor]:
    data = SummaryData(hass)
    return [LarderSummarySensor(hass, entry, key, data) for key in NAMES["en"]]
