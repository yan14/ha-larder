"""Repair hints (Settings → System → Repairs) for containers that need attention.

Three collective hints, one per kind (not per container, so the list stays clear):
- containers without an area (the estimate does not know where the food is stored),
- filled containers without a best-before date,
- containers that expired at least LONG_EXPIRED_DAYS days ago.

A hint disappears on its own as soon as no container is affected any more. It can be switched off
in the settings of the integration ("Repair hints").
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    issue_registry as ir,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import (
    TrackStates,
    async_call_later,
    async_track_state_change_filtered,
    async_track_time_change,
)

from .const import DOMAIN, PACK_KINDS, SIGNAL_SETTINGS_CHANGED, larder_id
from .entity import kind_of
from .estimate import storage_context
from .expiry import days_left
from .singleton import async_singleton

DATA_REPAIRS = "repairs"
LONG_EXPIRED_DAYS = 7
DEBOUNCE_SECONDS = 5
MAX_LISTED = 10  # a hint names this many containers, the rest is counted

ISSUE_NO_AREA = "containers_without_area"
ISSUE_NO_DATE = "filled_without_best_before"
ISSUE_LONG_EXPIRED = "long_expired"
ISSUES = (ISSUE_NO_AREA, ISSUE_NO_DATE, ISSUE_LONG_EXPIRED)
ISSUE_AREA_SCOPES = "area_scopes"  # 4.0: assign areas to food / household (automatic suggestion)


def _state(hass: HomeAssistant, registry: er.EntityRegistry, platform: str, unique_id: str) -> str | None:
    entity_id = registry.async_get_entity_id(platform, DOMAIN, unique_id)
    state = hass.states.get(entity_id) if entity_id else None
    if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
        return None
    return state.state


# filter in the dashboard (link "Learn more"): /larder?problem=…
DASHBOARD_FILTER = {ISSUE_NO_AREA: "noarea", ISSUE_NO_DATE: "nodate", ISSUE_LONG_EXPIRED: "longexpired"}


def find_problems(hass: HomeAssistant, today: date | None = None) -> dict[str, list[str]]:
    """Names of the affected containers per hint (alphabetically)."""
    return {key: [name for name, _cc in items] for key, items in find_problem_containers(hass, today).items()}


def find_problem_containers(hass: HomeAssistant, today: date | None = None) -> dict[str, list[tuple[str, str]]]:
    """(Name, cc) of the affected containers per hint, alphabetically by name."""
    registry = er.async_get(hass)
    found: dict[str, list[tuple[str, str]]] = {key: [] for key in ISSUES}
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get("cc")
        if not cc:
            continue
        name = entry.title or cc
        pack = kind_of(entry) in PACK_KINDS  # stock without a container: area and date are optional
        if not pack and storage_context(hass, cc).area_name is None:
            found[ISSUE_NO_AREA].append((name, cc))
        content = (_state(hass, registry, "text", f"{cc}_content") or "").strip()
        best = _state(hass, registry, "date", f"{cc}_best_before")
        if not content:
            continue
        if best is None:
            if not pack:
                found[ISSUE_NO_DATE].append((name, cc))
            continue
        try:
            left = days_left(date.fromisoformat(best), today)
        except ValueError:
            continue
        if left <= -LONG_EXPIRED_DAYS:
            found[ISSUE_LONG_EXPIRED].append((name, cc))
    for items in found.values():
        items.sort(key=lambda item: item[0].casefold())
    return found


def _listing(names: list[str], language: str) -> str:
    shown = names[:MAX_LISTED]
    text = "\n".join(f"- {n}" for n in shown)
    if len(names) > len(shown):
        more = len(names) - len(shown)
        text += f"\n- … {'und' if language.lower().startswith('de') else 'and'} {more} {'weitere' if language.lower().startswith('de') else 'more'}"
    return text


class Repairs:
    """Keeps the repair hints up to date (on changes of the containers and once a day)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._unsubs: list[CALLBACK_TYPE] = []
        self._timer: CALLBACK_TYPE | None = None

    @callback
    def async_start(self) -> None:
        if self._unsubs:
            return
        hass = self.hass
        self._unsubs.append(
            async_track_state_change_filtered(
                hass, TrackStates(False, set(), {"date", "text"}), self._state_changed
            ).async_remove
        )
        self._unsubs.append(hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, self._device_changed))
        self._unsubs.append(hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, lambda _e: self.async_schedule()))
        self._unsubs.append(async_track_time_change(hass, self._daily, hour=0, minute=1, second=0))
        self._unsubs.append(async_dispatcher_connect(hass, SIGNAL_SETTINGS_CHANGED, self.async_schedule))
        if hass.is_running:
            self.async_schedule()
        else:
            self._unsubs.append(
                hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, lambda _e: self.async_schedule())
            )

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        if self._timer:
            self._timer()
            self._timer = None
        for key in (*ISSUES, ISSUE_AREA_SCOPES):
            ir.async_delete_issue(self.hass, DOMAIN, key)

    @callback
    def _state_changed(self, event: Event) -> None:
        entry = er.async_get(self.hass).async_get(event.data["entity_id"])
        if entry is not None and entry.platform == DOMAIN:
            self.async_schedule()

    @callback
    def _device_changed(self, event: Event) -> None:
        device = dr.async_get(self.hass).async_get(event.data.get("device_id", ""))
        if device is None or larder_id(device):
            self.async_schedule()

    @callback
    def _daily(self, _now: datetime) -> None:
        self.async_schedule()

    @callback
    def async_schedule(self) -> None:
        if self._timer:
            self._timer()

        @callback
        def run(_now: datetime) -> None:
            self._timer = None
            self.async_update()

        self._timer = async_call_later(self.hass, DEBOUNCE_SECONDS, run)

    @callback
    def async_update(self, today: date | None = None) -> None:
        hass = self.hass
        estimator = hass.data.get(DOMAIN, {}).get("estimator")
        enabled = getattr(estimator, "repair_hints", True)
        problems = find_problem_containers(hass, today) if enabled else {}
        language = hass.config.language or "en"
        devices = dr.async_get(hass)
        self._update_area_scopes()
        for key in ISSUES:
            items = problems.get(key) or []
            names = [name for name, _cc in items]
            if not names:
                ir.async_delete_issue(hass, DOMAIN, key)
                continue
            placeholders: dict[str, Any] = {
                "count": str(len(names)),
                "containers": _listing(names, language),
                "days": str(LONG_EXPIRED_DAYS),
            }
            # "Learn more" jumps into the dashboard: one container directly, several filtered
            url = f"/{DOMAIN}?problem={DASHBOARD_FILTER[key]}"
            if len(items) == 1:
                device = devices.async_get_device(identifiers={(DOMAIN, items[0][1])})
                if device is not None:
                    url = f"/{DOMAIN}?open={device.id}"
            ir.async_create_issue(
                hass,
                DOMAIN,
                key,
                is_fixable=True,
                is_persistent=False,
                severity=ir.IssueSeverity.WARNING,
                translation_key=key,
                translation_placeholders=placeholders,
                learn_more_url=url,
            )


    @callback
    def _update_area_scopes(self) -> None:
        """Since 4.0 areas are for food, household or both: offer the automatic assignment until one exists."""
        from .household import plan_area_scopes, scopes_assigned  # noqa: PLC0415 - avoids an import cycle

        hass = self.hass
        plan = [] if scopes_assigned(hass) else plan_area_scopes(hass)
        if not plan:
            ir.async_delete_issue(hass, DOMAIN, ISSUE_AREA_SCOPES)
            return
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_AREA_SCOPES,
            is_fixable=True,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_AREA_SCOPES,
            translation_placeholders={"areas": scope_listing(plan, hass.config.language or "en")},
            learn_more_url=f"/{DOMAIN}?view=areas",
        )


def scope_listing(plan: list[dict[str, Any]], language: str) -> str:
    de = language.lower().startswith("de")
    names = {"food": "Lebensmittel" if de else "food", "household": "Haushalt" if de else "household"}
    return "\n".join(f"- {p['name']}: {names[p['scope']]}" for p in plan)


async def async_get_repairs(hass: HomeAssistant) -> Repairs:
    async def create() -> Repairs:
        return Repairs(hass)

    return await async_singleton(hass, DATA_REPAIRS, create)
