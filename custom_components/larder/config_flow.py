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

from .const import (
    CONF_CALENDAR_ENTITY,
    CONF_ESTIMATE_MODE,
    CONF_NFC_NOTIFY,
    CONF_OPENED_DAYS,
    DEFAULT_OPENED_DAYS,
    ESTIMATE_MODES,
    ESTIMATE_TABLE,
    CONF_AI_TASK_ENTITY,
    CONF_AREA,
    CONF_CC,
    CONF_QR_CODE,
    CONF_SIZE,
    CONF_SOURCE,
    CONF_TC,
    DOMAIN,
    SIGNAL_SETTINGS_CHANGED,
    SOURCE_GENERATED,
    SOURCE_ZWILLING,
)
from .calendar_sync import async_get_calendar_sync
from .estimate import async_get_estimator
from .migrate import MigrationError, async_migrate_legacy, legacy_entries
from .qr import generate_code, parse_qr
from .scan import async_get_webhook_id, webhook_urls


def _area_data(user_input: dict[str, Any]) -> dict[str, str]:
    """Gewählten Bereich nur dann in den Eintrag schreiben, wenn einer gewählt wurde."""
    area_id = user_input.get(CONF_AREA)
    return {CONF_AREA: area_id} if area_id else {}


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
        options = ["scan", "create"]
        if legacy_entries(self.hass):
            options.insert(0, "migrate")  # Dosen der früheren Integration "Zwilling Food Storage"
        return self.async_show_menu(step_id="user", menu_options=options)

    async def async_step_migrate(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Alle Dosen der früheren Integration übernehmen (siehe migrate.py)."""
        count = len(legacy_entries(self.hass))
        if user_input is None:
            return self.async_show_form(
                step_id="migrate",
                data_schema=vol.Schema({}),
                description_placeholders={"count": str(count)},
            )
        try:
            migrated = await async_migrate_legacy(self.hass)
        except MigrationError as err:
            return self.async_abort(reason=err.reason)
        return self.async_abort(
            reason="migrated", description_placeholders={"count": str(migrated)}
        )

    async def async_step_import(self, import_data: dict[str, Any]) -> ConfigFlowResult:
        """Dose aus der früheren Integration anlegen (nur intern von der Übernahme genutzt)."""
        data = dict(import_data["data"])
        await self.async_set_unique_id(data[CONF_CC])
        self._abort_if_unique_id_configured()
        return self.async_create_entry(
            title=import_data["title"], data=data, options=import_data.get("options") or {}
        )

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
                }
            ),
        )


class LarderOptionsFlow(OptionsFlow):
    """Globale Einstellungen: Webhook-URL (nur Anzeige) und Schätzung des MHD (Tabelle/KI)."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        estimator = await async_get_estimator(self.hass)

        if user_input is not None:
            await estimator.async_update_settings(
                user_input.get(CONF_ESTIMATE_MODE, ESTIMATE_TABLE),
                user_input.get(CONF_AI_TASK_ENTITY) or None,
                user_input.get(CONF_OPENED_DAYS, DEFAULT_OPENED_DAYS),
                user_input.get(CONF_CALENDAR_ENTITY) or None,
                user_input.get(CONF_NFC_NOTIFY, True),
            )
            sync = await async_get_calendar_sync(self.hass)
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
                vol.Optional(CONF_NFC_NOTIFY, default=True): BooleanSelector(),
                vol.Optional(CONF_CALENDAR_ENTITY): EntitySelector(
                    EntitySelectorConfig(domain="calendar")
                ),
                vol.Optional(CONF_AI_TASK_ENTITY): EntitySelector(
                    EntitySelectorConfig(domain="ai_task")
                ),
            }
        )
        suggested = {
            CONF_ESTIMATE_MODE: estimator.mode,
            CONF_OPENED_DAYS: estimator.opened_days,
            CONF_NFC_NOTIFY: estimator.nfc_notify,
        }
        if estimator.ai_task_entity:
            suggested[CONF_AI_TASK_ENTITY] = estimator.ai_task_entity
        if estimator.calendar_entity:
            suggested[CONF_CALENDAR_ENTITY] = estimator.calendar_entity
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(schema, suggested),
            description_placeholders={"webhook_url": url, "webhook_path": path},
        )
