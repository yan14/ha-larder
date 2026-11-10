"""Larder: pro Dose ein Gerät mit Befüll-Datum, Inhalt und Leeren-Button."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr

from .calendar_sync import async_get_calendar_sync
from .const import CONF_AREA, CONF_CC, DOMAIN, PLATFORMS
from .nfc import async_get_nfc
from .entity import LarderConfigEntry, LarderRuntime
from .estimate import async_get_estimator
from .expiry import async_setup_services
from .migrate import async_adopt_legacy_registry, async_setup_legacy_compat
from .panel import async_setup_panel, async_teardown_panel
from .scan import async_setup_webhook, async_teardown_webhook
from .websocket import async_setup_websocket


async def async_setup_entry(hass: HomeAssistant, entry: LarderConfigEntry) -> bool:
    """Dose einrichten (der Scan-Webhook wird einmalig für alle Dosen registriert)."""
    entry.runtime_data = LarderRuntime()
    async_adopt_legacy_registry(hass, entry)  # Gerät/Entitäten aus "Zwilling Food Storage" übernehmen
    await async_setup_legacy_compat(hass)
    await async_get_estimator(hass)
    async_setup_websocket(hass)
    async_setup_services(hass)
    (await async_get_calendar_sync(hass)).async_start()
    (await async_get_nfc(hass)).async_start()
    await async_setup_webhook(hass)
    await async_setup_panel(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _async_apply_initial_area(hass, entry)
    return True


def _async_apply_initial_area(hass: HomeAssistant, entry: LarderConfigEntry) -> None:
    """Beim Anlegen gewählten Bereich einmalig auf das Gerät übertragen.

    Danach wird der Wert aus dem Eintrag entfernt, damit ein später im Gerät geänderter
    oder geleerter Bereich nicht bei jedem Neuladen überschrieben wird.
    """
    area_id = entry.data.get(CONF_AREA)
    if CONF_AREA not in entry.data:
        return
    if area_id and ar.async_get(hass).async_get_area(area_id) is not None:
        device = dr.async_get(hass).async_get_device(
            identifiers={(DOMAIN, entry.data[CONF_CC])}
        )
        if device is not None and device.area_id is None:
            dr.async_get(hass).async_update_device(device.id, area_id=area_id)
    data = {key: value for key, value in entry.data.items() if key != CONF_AREA}
    hass.config_entries.async_update_entry(entry, data=data)


async def async_unload_entry(hass: HomeAssistant, entry: LarderConfigEntry) -> bool:
    """Dose entladen; beim Entladen der letzten Dose werden Webhook und Panel abgemeldet."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded and not any(
        other.entry_id != entry.entry_id
        for other in hass.config_entries.async_loaded_entries(DOMAIN)
    ):
        async_teardown_webhook(hass)
        async_teardown_panel(hass)
        (await async_get_calendar_sync(hass)).async_stop()
        (await async_get_nfc(hass)).async_stop()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: LarderConfigEntry) -> None:
    """Dose wurde gelöscht: Kalendertermin entfernen."""
    if cc := entry.data.get(CONF_CC):
        await (await async_get_calendar_sync(hass)).async_remove_dose(cc)
        await (await async_get_nfc(hass)).async_unlink(cc)
