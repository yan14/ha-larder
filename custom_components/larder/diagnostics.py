"""Diagnosedaten einer Dose (Einstellungen → Geräte & Dienste → Larder → ⋮ → Diagnose herunterladen)."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er

from .const import DOMAIN
from .entity import LarderConfigEntry
from .estimate import async_get_estimator, storage_context


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: LarderConfigEntry) -> dict[str, Any]:
    """Was zur Fehlersuche hilft: Einstellungen, die Dose, ihr Bereich und die Zustände ihrer Entitäten.

    Nicht enthalten: die geheime Webhook-ID des Kurzbefehls und die gemerkten Schätzungen selbst (nur ihre Anzahl).
    """
    cc = entry.data.get("cc")
    estimator = await async_get_estimator(hass)
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)}) if cc else None
    entities = []
    if device:
        for ent in er.async_entries_for_device(er.async_get(hass), device.id):
            state = hass.states.get(ent.entity_id)
            entities.append(
                {
                    "entity_id": ent.entity_id,
                    "unique_id": ent.unique_id,
                    "disabled": ent.disabled_by is not None,
                    "state": state.state if state else None,
                    "attributes": dict(state.attributes) if state else None,
                }
            )
    context = storage_context(hass, cc) if cc else None
    sources: dict[str, int] = {}
    for item in estimator.list_entries():
        sources[item["source"]] = sources.get(item["source"], 0) + 1
    return {
        "entry": {"title": entry.title, "data": dict(entry.data), "version": entry.version},
        "settings": estimator.settings(),
        "estimates": {"count": sum(sources.values()), "by_source": sources},
        "containers": len(hass.config_entries.async_entries(DOMAIN)),
        "device": {"area_id": device.area_id, "model": device.model} if device else None,
        "storage": {
            "area": context.area_name,
            "temperature_c": context.temperature_c,
            "labels": list(context.label_texts),
            "max_days": context.max_days,
        }
        if context
        else None,
        "entities": entities,
    }
