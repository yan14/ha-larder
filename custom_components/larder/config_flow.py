"""Config flow: paste the QR code content, create the container as a device."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_NAME
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.selector import (
    AreaSelector,
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
)

from .calendar_sync import async_get_calendar_sync
from .const import (
    CONF_AI_TASK_ENTITY,
    CONF_AREA,
    CONF_CALENDAR_ENTITY,
    CONF_CC,
    CONF_ESTIMATE_MODE,
    CONF_INITIAL,
    CONF_KIND,
    CONF_LONG_SOON_DAYS,
    CONF_MEAL_CALENDAR,
    CONF_NFC_NOTIFY,
    CONF_OPENED_DAYS,
    CONF_PLAN_DAYS,
    CONF_PLAN_SOURCE,
    CONF_QR_CODE,
    CONF_RECALL_CHECK,
    CONF_RECALL_STATE,
    CONF_RECIPE_DAYS,
    CONF_REORDER_SHOPPING,
    CONF_REPAIR_HINTS,
    CONF_SECTION_ORDER,
    CONF_SHOPPING_DETAILS,
    CONF_SIZE,
    CONF_SOON_DAYS,
    CONF_SOURCE,
    CONF_STOCK_LEAD_DAYS,
    CONF_SUPPLY_CHECK,
    CONF_SUPPLY_DAYS,
    CONF_SUPPLY_PERSONS,
    CONF_TC,
    CONF_TEMPERATURE_WARNING,
    CONF_THAW_DAYS,
    CONF_THAWED_DAYS,
    CONF_TODO_ENTITY,
    CONF_TODO_HOUSEHOLD,
    CONF_TODO_PHARMACY,
    CONF_VACUUM_DEFAULT,
    CONF_WATCH_ALLERGENS,
    DEFAULT_LONG_SOON_DAYS,
    DEFAULT_OPENED_DAYS,
    DEFAULT_RECIPE_DAYS,
    DEFAULT_THAW_DAYS,
    DEFAULT_THAWED_DAYS,
    DISPOSABLE_KINDS,
    DOMAIN,
    ESTIMATE_MODES,
    ESTIMATE_TABLE,
    KIND_BAG,
    MAIN_UNIQUE_ID,
    MAX_RECIPE_DAYS,
    MAX_SOON_DAYS,
    PLAN_SOURCES,
    RECALL_STATES,
    SIGNAL_SETTINGS_CHANGED,
    SOON_DAYS,
    SOURCE_GENERATED,
    SOURCE_MAIN,
    SOURCE_ZWILLING,
)
from .estimate import SETTINGS, async_get_estimator
from .product import ALLERGEN_KEYS
from .qr import generate_code, parse_qr
from .scan import async_get_webhook_id, webhook_urls

_INITIAL_KEYS = ("vacuum", "shopping", "flexible", "home_area")


def _area_data(user_input: dict[str, Any]) -> dict[str, Any]:
    """Write the chosen area and the container's presets (if given) into the entry once."""
    data: dict[str, Any] = {}
    if area_id := user_input.get(CONF_AREA):
        data[CONF_AREA] = area_id
    initial = {key: user_input[key] for key in _INITIAL_KEYS if user_input.get(key) is not None}
    if initial:
        data[CONF_INITIAL] = initial
    return data


def _option_fields() -> dict:
    """Optional presets of the container (set in the dashboard dialog)."""
    return {
        vol.Optional("vacuum"): BooleanSelector(),
        vol.Optional("shopping"): BooleanSelector(),
        vol.Optional("flexible"): BooleanSelector(),
        vol.Optional("home_area"): AreaSelector(),
    }


class LarderConfigFlow(ConfigFlow, domain=DOMAIN):
    """One config entry is one container (unique by 'cc')."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return LarderOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """First time: create the main entry "Larder" right away (the dashboard appears in the sidebar).

        Afterwards (and for the dashboard, which uses this flow to add containers): read an existing
        Zwilling QR code or create a new one.
        """
        if not any(e.unique_id == MAIN_UNIQUE_ID for e in self._async_current_entries(include_ignore=False)):
            return await self._async_create_main()
        return self.async_show_menu(step_id="user", menu_options=["scan", "create"])

    async def _async_create_main(self) -> ConfigFlowResult:
        await self.async_set_unique_id(MAIN_UNIQUE_ID)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title="Larder", data={CONF_SOURCE: SOURCE_MAIN})

    async def async_step_scan(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Paste the content of an existing Zwilling QR code."""
        errors: dict[str, str] = {}

        if user_input is not None:
            parsed = parse_qr(user_input[CONF_QR_CODE])
            if parsed is None:
                errors[CONF_QR_CODE] = "invalid_code"
            else:
                await self.async_set_unique_id(parsed.cc)
                self._abort_if_unique_id_configured()

                name = (user_input.get(CONF_NAME) or "").strip() or f"Dose {parsed.cc}"
                return self.async_create_entry(
                    title=name,
                    data={
                        CONF_CC: parsed.cc,
                        CONF_TC: parsed.tc,
                        CONF_SIZE: parsed.size,
                        CONF_SOURCE: SOURCE_ZWILLING,
                        **_area_data(user_input),
                    },
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_QR_CODE): TextSelector(),
                vol.Optional(CONF_NAME): TextSelector(),
                vol.Optional(CONF_AREA): AreaSelector(),
                **_option_fields(),
            }
        )
        return self.async_show_form(
            step_id="scan",
            data_schema=self.add_suggested_values_to_schema(schema, user_input),
            errors=errors,
        )

    async def async_step_create(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Create a new container with a generated, unique ID."""
        if user_input is not None:
            code = generate_code(self._async_current_ids())
            await self.async_set_unique_id(code)
            self._abort_if_unique_id_configured()

            name = (user_input.get(CONF_NAME) or "").strip() or f"Dose {code}"
            return self.async_create_entry(
                title=name,
                data={
                    CONF_CC: code,
                    CONF_TC: None,
                    CONF_SIZE: None,
                    CONF_SOURCE: SOURCE_GENERATED,
                    **_area_data(user_input),
                },
            )

        return self.async_show_form(
            step_id="create",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_NAME): TextSelector(),
                    vol.Optional(CONF_AREA): AreaSelector(),
                    **_option_fields(),
                }
            ),
        )


    async def async_step_import(self, data: dict[str, Any]) -> ConfigFlowResult:
        """Create a bag or pack from the dashboard (see disposable.py), always with a new ID.

        Also creates the main entry for installations from before 4.7 (see __init__.py).
        """
        if data.get(CONF_SOURCE) == SOURCE_MAIN:
            return await self._async_create_main()
        from .disposable import async_get_retired  # noqa: PLC0415 - avoids an import cycle

        retired = await async_get_retired(self.hass)
        code = generate_code({*self._async_current_ids(), *retired.codes})  # never reuse codes
        await self.async_set_unique_id(code)
        self._abort_if_unique_id_configured()
        kind = data.get(CONF_KIND)
        return self.async_create_entry(
            title=data.get("name") or code,
            data={
                CONF_CC: code,
                CONF_TC: None,
                CONF_SIZE: None,
                CONF_SOURCE: SOURCE_GENERATED,
                CONF_KIND: kind if kind in DISPOSABLE_KINDS else KIND_BAG,
                **{key: data[key] for key in (CONF_AREA, CONF_INITIAL) if data.get(key)},
            },
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Rename a container (the ID stays, so printed codes and NFC tags remain valid)."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            name = (user_input.get(CONF_NAME) or "").strip()
            if not name:
                errors[CONF_NAME] = "name_required"
            else:
                return self.async_update_reload_and_abort(entry, title=name)
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema({vol.Required(CONF_NAME): TextSelector()}), {CONF_NAME: entry.title}
            ),
            description_placeholders={"cc": entry.data.get(CONF_CC, "")},
            errors=errors,
        )


class LarderOptionsFlow(OptionsFlow):
    """Global settings: webhook URL (display only) and best-before estimate (table/AI)."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        estimator = await async_get_estimator(self.hass)

        errors: dict[str, str] = {}
        if user_input is not None:
            sync = await async_get_calendar_sync(self.hass)
            calendar = user_input.get(CONF_CALENDAR_ENTITY)
            if calendar and sync.supports(calendar) is False:
                errors[CONF_CALENDAR_ENTITY] = "calendar_not_supported"
            else:
                # empty selectors are missing in user_input: the setting was cleared on purpose
                # only the settings of this form: the order of the store sections (set in the dashboard) stays
                await estimator.async_update_settings(
                    {
                        conf: user_input.get(conf, default)
                        for conf, (_attr, default, _n) in SETTINGS.items()
                        if conf != CONF_SECTION_ORDER
                    }
                )
                await sync.async_sync_all()
                async_dispatcher_send(self.hass, SIGNAL_SETTINGS_CHANGED)
                return self.async_create_entry(data=self.config_entry.options)

        webhook_id = await async_get_webhook_id(self.hass)
        url, path = webhook_urls(self.hass, webhook_id)
        schema = vol.Schema(
            {
                vol.Optional(CONF_ESTIMATE_MODE, default=ESTIMATE_TABLE): SelectSelector(
                    SelectSelectorConfig(
                        options=ESTIMATE_MODES,
                        translation_key=CONF_ESTIMATE_MODE,
                        mode=SelectSelectorMode.LIST,
                    )
                ),
                vol.Optional(CONF_OPENED_DAYS, default=DEFAULT_OPENED_DAYS): NumberSelector(
                    NumberSelectorConfig(min=1, max=30, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_THAWED_DAYS, default=DEFAULT_THAWED_DAYS): NumberSelector(
                    NumberSelectorConfig(min=1, max=30, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_RECIPE_DAYS, default=DEFAULT_RECIPE_DAYS): NumberSelector(
                    NumberSelectorConfig(min=0, max=MAX_RECIPE_DAYS, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_SOON_DAYS, default=SOON_DAYS): NumberSelector(
                    NumberSelectorConfig(min=0, max=MAX_SOON_DAYS, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_LONG_SOON_DAYS, default=DEFAULT_LONG_SOON_DAYS): NumberSelector(
                    NumberSelectorConfig(min=1, max=365, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_VACUUM_DEFAULT, default=True): BooleanSelector(),
                vol.Optional(CONF_NFC_NOTIFY, default=True): BooleanSelector(),
                vol.Optional(CONF_REPAIR_HINTS, default=True): BooleanSelector(),
                vol.Optional(CONF_TEMPERATURE_WARNING, default=True): BooleanSelector(),
                vol.Optional(CONF_CALENDAR_ENTITY): EntitySelector(
                    EntitySelectorConfig(domain="calendar")
                ),
                vol.Optional(CONF_TODO_ENTITY): EntitySelector(
                    EntitySelectorConfig(domain="todo")
                ),
                vol.Optional(CONF_TODO_HOUSEHOLD): EntitySelector(
                    EntitySelectorConfig(domain="todo")
                ),
                vol.Optional(CONF_TODO_PHARMACY): EntitySelector(
                    EntitySelectorConfig(domain="todo")
                ),
                vol.Optional(CONF_SHOPPING_DETAILS, default=True): BooleanSelector(),
                vol.Optional(CONF_STOCK_LEAD_DAYS, default=7): NumberSelector(
                    NumberSelectorConfig(min=1, max=60, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_REORDER_SHOPPING, default=False): BooleanSelector(),
                vol.Optional(CONF_RECALL_CHECK, default=True): BooleanSelector(),
                vol.Optional(CONF_RECALL_STATE): SelectSelector(
                    SelectSelectorConfig(options=list(RECALL_STATES), mode=SelectSelectorMode.DROPDOWN)
                ),
                vol.Optional(CONF_WATCH_ALLERGENS): SelectSelector(
                    SelectSelectorConfig(
                        options=list(ALLERGEN_KEYS),
                        translation_key=CONF_WATCH_ALLERGENS,
                        multiple=True,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(CONF_MEAL_CALENDAR): EntitySelector(
                    EntitySelectorConfig(domain="calendar")
                ),
                vol.Optional(CONF_THAW_DAYS, default=DEFAULT_THAW_DAYS): NumberSelector(
                    NumberSelectorConfig(min=0, max=3, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_PLAN_SOURCE, default="book_ai"): SelectSelector(
                    SelectSelectorConfig(options=list(PLAN_SOURCES), translation_key=CONF_PLAN_SOURCE, mode=SelectSelectorMode.LIST)
                ),
                vol.Optional(CONF_PLAN_DAYS, default=5): NumberSelector(
                    NumberSelectorConfig(min=1, max=14, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_SUPPLY_CHECK, default=True): BooleanSelector(),
                vol.Optional(CONF_SUPPLY_PERSONS, default=2): NumberSelector(
                    NumberSelectorConfig(min=1, max=20, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_SUPPLY_DAYS, default=10): NumberSelector(
                    NumberSelectorConfig(min=3, max=30, step=1, mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(CONF_AI_TASK_ENTITY): EntitySelector(
                    EntitySelectorConfig(domain="ai_task")
                ),
            }
        )
        suggested = user_input if user_input is not None else {k: v for k, v in estimator.settings().items() if v is not None}
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(schema, suggested),
            description_placeholders={"webhook_url": url, "webhook_path": path},
            errors=errors,
        )
