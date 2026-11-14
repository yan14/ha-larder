"""Larder: pro Dose ein Gerät mit Befüll-Datum, Inhalt und Leeren-Button."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr

from .calendar_sync import async_get_calendar_sync, async_setup_calendar_service
from .const import CONF_AREA, CONF_CC, CONF_INITIAL, DOMAIN, PLATFORMS
from .content_photo import async_setup_content_photo
from .disposable import async_get_retired, async_setup_disposable_websocket
from .entity import LarderConfigEntry, LarderRuntime
from .estimate import async_get_estimator
from .expiry import async_setup_services
from .export import async_setup_export
from .history import async_setup_history_websocket
from .labels import async_setup_labels
from .learning import async_setup_learning_websocket
from .nfc import async_get_nfc
from .panel import async_setup_panel, async_teardown_panel
from .plan import async_get_plan, async_setup_plan_websocket
from .product import async_setup_product_websocket
from .receipt_photo import async_setup_receipt_photo
from .recipe_book import async_setup_recipe_book_websocket
from .recipe_photo import async_setup_recipe_photo
from .recipes import async_setup_recipe_service
from .repair_hints import async_get_repairs
from .scan import async_setup_webhook, async_teardown_webhook
from .stats import async_setup_statistics
from .stock import async_get_stock, async_setup_stock_websocket
from .temperature import async_get_temperature_watch
from .websocket import async_setup_websocket


async def async_setup_entry(hass: HomeAssistant, entry: LarderConfigEntry) -> bool:
    """Dose einrichten (der Scan-Webhook wird einmalig für alle Dosen registriert)."""
    entry.runtime_data = LarderRuntime()
    await async_get_estimator(hass)
    async_setup_websocket(hass)
    async_setup_services(hass)
    async_setup_recipe_service(hass)
    async_setup_calendar_service(hass)
    async_setup_recipe_book_websocket(hass)
    async_setup_recipe_photo(hass)
    async_setup_content_photo(hass)
    async_setup_receipt_photo(hass)
    async_setup_labels(hass)
    async_setup_export(hass)
    async_setup_history_websocket(hass)
    async_setup_statistics(hass)
    async_setup_plan_websocket(hass)
    async_setup_product_websocket(hass)
    async_setup_disposable_websocket(hass)
    await async_get_retired(hass)
    async_setup_stock_websocket(hass)
    async_setup_learning_websocket(hass)
    (await async_get_stock(hass)).async_start()
    (await async_get_plan(hass)).async_start()
    (await async_get_calendar_sync(hass)).async_start()
    (await async_get_nfc(hass)).async_start()
    (await async_get_repairs(hass)).async_start()
    (await async_get_temperature_watch(hass)).async_start()
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
    if CONF_AREA not in entry.data and CONF_INITIAL not in entry.data:
        return
    if area_id and ar.async_get(hass).async_get_area(area_id) is not None:
        device = dr.async_get(hass).async_get_device(
            identifiers={(DOMAIN, entry.data[CONF_CC])}
        )
        if device is not None and device.area_id is None:
            dr.async_get(hass).async_update_device(device.id, area_id=area_id)
    data = {key: value for key, value in entry.data.items() if key not in (CONF_AREA, CONF_INITIAL)}
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
        (await async_get_repairs(hass)).async_stop()
        (await async_get_temperature_watch(hass)).async_stop()
        (await async_get_plan(hass)).async_stop()
        (await async_get_stock(hass)).async_stop()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: LarderConfigEntry) -> None:
    """Dose wurde gelöscht: Kalendertermin entfernen."""
    if cc := entry.data.get(CONF_CC):
        await (await async_get_calendar_sync(hass)).async_remove_dose(cc)
        await (await async_get_nfc(hass)).async_unlink(cc)
