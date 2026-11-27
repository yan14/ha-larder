"""Larder: one device per container with fill date, content and an empty button.

Since 4.7 there is also a main entry "Larder" without a device: adding the integration creates it in one step,
so the dashboard is there right away; installations from before get it automatically.
"""

from __future__ import annotations

from homeassistant.config_entries import SOURCE_IMPORT
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr

from . import shelf_life
from .area_storage import async_setup_area_storage_websocket
from .calendar_sync import async_get_calendar_sync, async_setup_calendar_service
from .const import CONF_AREA, CONF_CC, CONF_INITIAL, CONF_SOURCE, DOMAIN, MAIN_UNIQUE_ID, PLATFORMS, SOURCE_MAIN
from .content_photo import async_setup_content_photo
from .cooking import async_setup_cooking_websocket
from .datacare import async_setup_datacare_websocket
from .date_photo import async_setup_date_photo
from .devices import async_invalidate_entries, device_of
from .disposable import async_get_retired, async_setup_disposable_websocket
from .entity import LarderConfigEntry, LarderRuntime, is_main
from .estimate import async_get_estimator
from .expiry import async_setup_services
from .export import async_setup_export
from .freezing import async_setup_freezing_websocket
from .grocy import async_setup_grocy_websocket
from .history import async_setup_history_websocket
from .household import async_setup_household_websocket
from .labels import async_setup_labels
from .learning import async_setup_learning_websocket
from .nfc import async_get_nfc
from .notify_actions import async_setup_notify_actions
from .order import async_setup_order
from .panel import async_setup_panel, async_teardown_panel
from .place_suggest import async_setup_place_suggest_websocket
from .places import async_get_places, async_setup_place_websocket
from .plan import async_get_plan, async_setup_plan_websocket
from .product import async_setup_product_websocket
from .product_history import async_setup_product_history_websocket
from .put_away_review import async_setup_put_away_websocket
from .recall import async_get_recalls, async_setup_recall_websocket
from .receipt_photo import async_setup_receipt_photo
from .recipe_book import async_setup_recipe_book_websocket
from .recipe_link import async_setup_recipe_link_websocket
from .recipe_photo import async_setup_recipe_photo
from .recipes import async_setup_recipe_service
from .repair_hints import async_get_repairs
from .rescue import async_setup_rescue_service
from .scan import async_setup_webhook, async_teardown_webhook
from .shopping_mode import async_setup_shopping_mode_websocket
from .singleton import async_singleton
from .sizes import async_get_sizes, async_setup_sizes_websocket
from .stats import async_setup_statistics
from .stock import async_get_stock, async_setup_stock_websocket
from .supply import async_setup_supply_websocket
from .table_rows import async_setup_table_rows_websocket
from .temperature import async_get_temperature_watch
from .voucher_photo import async_setup_voucher_photo
from .vouchers import async_get_vouchers, async_setup_voucher_websocket
from .websocket import async_setup_websocket
from .week_plan import async_setup_week_plan_websocket


async def async_setup_entry(hass: HomeAssistant, entry: LarderConfigEntry) -> bool:
    """Set up a container (the scan webhook is registered once for all containers)."""
    entry.runtime_data = LarderRuntime()
    async_invalidate_entries(hass)  # 5.4: index ID → entry
    shelf_life.set_default_language(hass.config.language)  # 6.2 (#172): words of the system language first
    # 6.11.1: the shelf-life keyword patterns compiled once outside the event loop (else the first state is slow)
    await async_singleton(hass, "shelf_life_warm", lambda: _async_warm_up(hass))
    await async_get_estimator(hass)
    async_setup_websocket(hass)
    async_setup_services(hass)
    async_setup_recipe_service(hass)
    async_setup_calendar_service(hass)
    async_setup_recipe_book_websocket(hass)
    async_setup_recipe_photo(hass)
    async_setup_content_photo(hass)
    async_setup_receipt_photo(hass)
    async_setup_date_photo(hass)
    async_setup_voucher_photo(hass)
    async_setup_labels(hass)
    async_setup_export(hass)
    async_setup_history_websocket(hass)
    async_setup_statistics(hass)
    async_setup_plan_websocket(hass)
    async_setup_product_websocket(hass)
    async_setup_disposable_websocket(hass)
    await async_get_retired(hass)
    async_setup_stock_websocket(hass)
    async_setup_recall_websocket(hass)
    async_setup_place_websocket(hass)
    await async_get_places(hass)
    async_setup_sizes_websocket(hass)
    async_setup_household_websocket(hass)
    async_setup_week_plan_websocket(hass)
    async_setup_supply_websocket(hass)
    async_setup_datacare_websocket(hass)
    async_setup_shopping_mode_websocket(hass)
    async_setup_product_history_websocket(hass)
    async_setup_grocy_websocket(hass)
    async_setup_put_away_websocket(hass)
    async_setup_place_suggest_websocket(hass)
    async_setup_area_storage_websocket(hass)
    async_setup_table_rows_websocket(hass)
    async_setup_cooking_websocket(hass)
    async_setup_freezing_websocket(hass)
    async_setup_rescue_service(hass)
    async_setup_order(hass)
    async_setup_recipe_link_websocket(hass)
    async_setup_voucher_websocket(hass)
    async_setup_notify_actions(hass)
    await async_get_sizes(hass)
    async_setup_learning_websocket(hass)
    (await async_get_stock(hass)).async_start()
    (await async_get_recalls(hass)).async_start()
    (await async_get_plan(hass)).async_start()
    (await async_get_calendar_sync(hass)).async_start()
    (await async_get_nfc(hass)).async_start()
    (await async_get_repairs(hass)).async_start()
    (await async_get_temperature_watch(hass)).async_start()
    await async_setup_webhook(hass)
    await async_setup_panel(hass)
    if is_main(entry):
        # 5.3 (#131): overview sensors for automations
        await hass.config_entries.async_forward_entry_setups(entry, [Platform.SENSOR])
        return True
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _async_apply_initial_area(hass, entry)
    _async_ensure_main(hass)
    return True


async def _async_warm_up(hass: HomeAssistant) -> bool:
    await hass.async_add_executor_job(shelf_life.warm_up)
    return True


def _async_ensure_main(hass: HomeAssistant) -> None:
    """Installations from before 4.7: create the main entry once (holds settings, keeps the dashboard)."""
    if any(e.unique_id == MAIN_UNIQUE_ID for e in hass.config_entries.async_entries(DOMAIN)):
        return
    if any(f["context"].get("unique_id") == MAIN_UNIQUE_ID for f in hass.config_entries.flow.async_progress_by_handler(DOMAIN)):
        return
    hass.async_create_task(
        hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_IMPORT}, data={CONF_SOURCE: SOURCE_MAIN}),
        eager_start=False,
    )


def _async_apply_initial_area(hass: HomeAssistant, entry: LarderConfigEntry) -> None:
    """Apply the area chosen on creation to the device once.

    After that the value is removed from the entry, so an area changed or cleared later
    on the device is not overwritten on every reload.
    """
    area_id = entry.data.get(CONF_AREA)
    if CONF_AREA not in entry.data and CONF_INITIAL not in entry.data:
        return
    if area_id and ar.async_get(hass).async_get_area(area_id) is not None:
        device = device_of(hass, entry.data[CONF_CC])
        if device is not None and device.area_id is None:
            dr.async_get(hass).async_update_device(device.id, area_id=area_id)
    data = {key: value for key, value in entry.data.items() if key not in (CONF_AREA, CONF_INITIAL)}
    hass.config_entries.async_update_entry(entry, data=data)


async def async_unload_entry(hass: HomeAssistant, entry: LarderConfigEntry) -> bool:
    """Unload a container; with the last one the webhook and the panel are removed."""
    async_invalidate_entries(hass)
    unloaded = await hass.config_entries.async_unload_platforms(entry, [Platform.SENSOR] if is_main(entry) else PLATFORMS)
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
        (await async_get_recalls(hass)).async_stop()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: LarderConfigEntry) -> None:
    """A container was deleted: remove its calendar event."""
    async_invalidate_entries(hass)
    if cc := entry.data.get(CONF_CC):
        await (await async_get_vouchers(hass)).async_forget(cc)
        await (await async_get_calendar_sync(hass)).async_remove_dose(cc)
        await (await async_get_nfc(hass)).async_unlink(cc)
