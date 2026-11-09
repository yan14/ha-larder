"""Konstanten für die Zwilling-Food-Storage-Integration."""

from homeassistant.const import Platform

DOMAIN = "zwilling_storage"

PLATFORMS: list[Platform] = [Platform.DATETIME, Platform.TEXT]

CONF_QR_CODE = "qr_code"
CONF_CC = "cc"  # eindeutige ID der Dose (Parameter "cc" im QR-Code)
CONF_TC = "tc"  # Typ-/Produktcode (Parameter "tc")
CONF_SIZE = "size"  # Größe (Parameter "s")

MANUFACTURER = "ZWILLING"
