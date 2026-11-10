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
from homeassistant.helpers.selector import TextSelector

from .const import (
    CONF_CC,
    CONF_QR_CODE,
    CONF_SIZE,
    CONF_SOURCE,
    CONF_TC,
    DOMAIN,
    SOURCE_GENERATED,
    SOURCE_ZWILLING,
)
from .qr import generate_code, parse_qr
from .scan import async_get_webhook_id, webhook_urls


class ZwillingStorageConfigFlow(ConfigFlow, domain=DOMAIN):
    """Eine Config Entry entspricht einer Dose (eindeutig über 'cc')."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return ZwillingOptionsFlow()

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
                    },
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_QR_CODE): TextSelector(),
                vol.Optional(CONF_NAME): TextSelector(),
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
                },
            )

        return self.async_show_form(
            step_id="create",
            data_schema=vol.Schema({vol.Optional(CONF_NAME): TextSelector()}),
        )


class ZwillingOptionsFlow(OptionsFlow):
    """Zeigt die geheime Webhook-URL für den iOS-Kurzbefehl an."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=self.config_entry.options)

        webhook_id = await async_get_webhook_id(self.hass)
        url, path = webhook_urls(self.hass, webhook_id)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({}),
            description_placeholders={"webhook_url": url, "webhook_path": path},
        )
