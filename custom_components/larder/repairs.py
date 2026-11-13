"""Reparaturen: "Beheben"-Dialoge für die Hinweise aus repair_hints.py.

- Dosen ohne Bereich: pro Dose ein Bereichsfeld, Speichern weist die Bereiche zu.
- Gefüllt ohne MHD: MHD für alle schätzen (was die Schätzung nicht schafft, bleibt im Hinweis).
- Lange abgelaufen: Dosen ankreuzen und leeren (im Verlauf als weggeworfen).
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import data_entry_flow
from homeassistant.components.repairs import RepairsFlow
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, device_registry as dr, entity_registry as er
from homeassistant.helpers.selector import AreaSelector

from .const import DOMAIN
from .history import async_get_history
from .repair_hints import (
    ISSUE_LONG_EXPIRED,
    ISSUE_NO_AREA,
    ISSUE_NO_DATE,
    async_get_repairs,
    find_problem_containers,
)


def _labels(items: list[tuple[str, str]]) -> dict[str, str]:
    """Feldname je Dose (cc → Anzeigename); gleiche Namen bekommen die ID dazu."""
    names = [name for name, _cc in items]
    return {cc: (name if names.count(name) == 1 else f"{name} ({cc})") for name, cc in items}


class LarderFixFlow(RepairsFlow):
    def __init__(self, issue_id: str) -> None:
        self.issue_id = issue_id

    def _items(self) -> list[tuple[str, str]]:
        return find_problem_containers(self.hass).get(self.issue_id, [])

    async def _done(self) -> data_entry_flow.FlowResult:
        (await async_get_repairs(self.hass)).async_update()
        return self.async_create_entry(data={})

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> data_entry_flow.FlowResult:
        if self.issue_id == ISSUE_NO_AREA:
            return await self.async_step_area()
        if self.issue_id == ISSUE_NO_DATE:
            return await self.async_step_estimate()
        if self.issue_id == ISSUE_LONG_EXPIRED:
            return await self.async_step_empty()
        return self.async_abort(reason="nothing_to_fix")

    async def async_step_area(self, user_input: dict[str, Any] | None = None) -> data_entry_flow.FlowResult:
        labels = _labels(self._items())
        if not labels:
            return await self._done()
        if user_input is not None:
            devices = dr.async_get(self.hass)
            for cc, label in labels.items():
                if area_id := user_input.get(label):
                    device = devices.async_get_device(identifiers={(DOMAIN, cc)})
                    if device is not None:
                        devices.async_update_device(device.id, area_id=area_id)
            return await self._done()
        schema = vol.Schema({vol.Optional(label): AreaSelector() for label in labels.values()})
        return self.async_show_form(step_id="area", data_schema=schema)

    async def async_step_estimate(self, user_input: dict[str, Any] | None = None) -> data_entry_flow.FlowResult:
        items = self._items()
        if not items:
            return await self._done()
        if user_input is not None:
            registry = er.async_get(self.hass)
            entity_ids = [
                eid for _name, cc in items if (eid := registry.async_get_entity_id("date", DOMAIN, f"{cc}_best_before"))
            ]
            try:
                await self.hass.services.async_call(
                    DOMAIN, "estimate_best_before", {"entity_id": entity_ids}, blocking=True
                )
            except HomeAssistantError:
                pass  # was nicht geschätzt werden konnte, bleibt im Hinweis
            return await self._done()
        return self.async_show_form(
            step_id="estimate",
            data_schema=vol.Schema({}),
            description_placeholders={"containers": "\n".join(f"- {name}" for name, _cc in items)},
        )

    async def async_step_empty(self, user_input: dict[str, Any] | None = None) -> data_entry_flow.FlowResult:
        labels = _labels(self._items())
        if not labels:
            return await self._done()
        if user_input is not None:
            registry = er.async_get(self.hass)
            history = await async_get_history(self.hass)
            for cc in user_input.get("containers", []):
                button = registry.async_get_entity_id("button", DOMAIN, f"{cc}_empty_container")
                if not button:
                    continue
                history.set_pending(cc, "thrown")
                try:
                    await self.hass.services.async_call("button", "press", {"entity_id": button}, blocking=True)
                except HomeAssistantError:
                    pass
                history.pop_pending(cc)
            return await self._done()
        schema = vol.Schema({vol.Optional("containers", default=list(labels)): cv.multi_select(labels)})
        return self.async_show_form(step_id="empty", data_schema=schema)


async def async_create_fix_flow(
    hass: HomeAssistant, issue_id: str, data: dict[str, Any] | None
) -> RepairsFlow:
    return LarderFixFlow(issue_id)
