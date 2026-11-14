"""Config Flow: QR-Code-Inhalt einfügen, Dose als Gerät anlegen."""

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
    CONF_MEAL_CALENDAR,
    CONF_NFC_NOTIFY,
    CONF_OPENED_DAYS,
    CONF_QR_CODE,
    CONF_RECIPE_DAYS,
    CONF_REPAIR_HINTS,
    CONF_SHOPPING_DETAILS,
    CONF_SIZE,
    CONF_SOON_DAYS,
    CONF_SOURCE,
    CONF_STOCK_LEAD_DAYS,
    CONF_TC,
    CONF_TEMPERATURE_WARNING,
    CONF_THAW_DAYS,
    CONF_THAWED_DAYS,
    CONF_TODO_ENTITY,
    CONF_VACUUM_DEFAULT,
    CONF_WATCH_ALLERGENS,
    DEFAULT_OPENED_DAYS,
    DEFAULT_RECIPE_DAYS,
    DEFAULT_THAW_DAYS,
    DEFAULT_THAWED_DAYS,
    DISPOSABLE_KINDS,
    DOMAIN,
    ESTIMATE_MODES,
    ESTIMATE_TABLE,
    KIND_BAG,
    MAX_RECIPE_DAYS,
    MAX_SOON_DAYS,
    SIGNAL_SETTINGS_CHANGED,
    SOON_DAYS,
    SOURCE_GENERATED,
    SOURCE_ZWILLING,
)
from .estimate import SETTINGS, async_get_estimator
from .product import ALLERGEN_KEYS
from .qr import generate_code, parse_qr
from .scan import async_get_webhook_id, webhook_urls

_INITIAL_KEYS = ("vacuum", "shopping", "flexible", "home_area")


def _area_data(user_input: dict[str, Any]) -> dict[str, Any]:
    """Gewählten Bereich und die Vorgaben der Dose (falls angegeben) einmalig in den Eintrag schreiben."""
    data: dict[str, Any] = {}
    if area_id := user_input.get(CONF_AREA):
        data[CONF_AREA] = area_id
    initial = {key: user_input[key] for key in _INITIAL_KEYS if user_input.get(key) is not None}
    if initial:
        data[CONF_INITIAL] = initial
    return data


def _option_fields() -> dict:
    """Optionale Vorgaben der Dose (im Dialog des Dashboards gesetzt)."""
    return {
        vol.Optional("vacuum"): BooleanSelector(),
        vol.Optional("shopping"): BooleanSelector(),
        vol.Optional("flexible"): BooleanSelector(),
        vol.Optional("home_area"): AreaSelector(),
    }


class LarderConfigFlow(ConfigFlow, domain=DOMAIN):
    """Eine Config Entry entspricht einer Dose (eindeutig über 'cc')."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return LarderOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Auswahl: vorhandenen Zwilling-QR-Code einlesen oder neuen erstellen."""
        return self.async_show_menu(step_id="user", menu_options=["scan", "create"])

    async def async_step_scan(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Inhalt eines vorhandenen Zwilling-QR-Codes einfügen."""
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
        """Neue Dose mit selbst erzeugter, eindeutiger ID anlegen."""
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
        """Beutel oder Packung aus dem Dashboard anlegen (siehe disposable.py), immer mit neuer ID."""
        from .disposable import async_get_retired  # noqa: PLC0415 - vermeidet einen Import-Kreis

        retired = await async_get_retired(self.hass)
        code = generate_code({*self._async_current_ids(), *retired.codes})  # Codes nie wiederverwenden
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
        """Dose umbenennen (die ID bleibt, damit gedruckte Codes und NFC-Tags gültig bleiben)."""
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
    """Globale Einstellungen: Webhook-URL (nur Anzeige) und Schätzung des MHD (Tabelle/KI)."""

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
                # Leere Auswahlfelder fehlen in user_input: dann ist die Einstellung bewusst geleert
                await estimator.async_update_settings(
                    {conf: user_input.get(conf, default) for conf, (_attr, default, _n) in SETTINGS.items()}
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
                vol.Optional(CONF_SHOPPING_DETAILS, default=True): BooleanSelector(),
                vol.Optional(CONF_STOCK_LEAD_DAYS, default=7): NumberSelector(
                    NumberSelectorConfig(min=1, max=60, step=1, mode=NumberSelectorMode.BOX)
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
