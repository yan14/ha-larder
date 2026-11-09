"""Config Flow: QR-Code-Inhalt einfügen, Dose als Gerät anlegen."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_NAME
from homeassistant.helpers.selector import TextSelector

from .const import CONF_CC, CONF_QR_CODE, CONF_SIZE, CONF_TC, DOMAIN
from .qr import parse_qr


class ZwillingStorageConfigFlow(ConfigFlow, domain=DOMAIN):
    """Eine Config Entry entspricht einer Dose (eindeutig über 'cc')."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
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
                    },
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_QR_CODE): TextSelector(),
                vol.Optional(CONF_NAME): TextSelector(),
            }
        )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(schema, user_input),
            errors=errors,
        )
