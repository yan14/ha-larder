"""Konstanten für die Zwilling-Food-Storage-Integration."""

from homeassistant.const import Platform

DOMAIN = "zwilling_storage"

PLATFORMS: list[Platform] = [
    Platform.BUTTON,
    Platform.DATE,
    Platform.DATETIME,
    Platform.IMAGE,
    Platform.TEXT,
]

CONF_QR_CODE = "qr_code"
CONF_CC = "cc"  # eindeutige ID der Dose (Parameter "cc" im QR-Code)
CONF_TC = "tc"  # Typ-/Produktcode (Parameter "tc")
CONF_SIZE = "size"  # Größe (Parameter "s")
CONF_AREA = "area_id"  # Bereich, der beim Anlegen vorgewählt wurde (wird einmalig angewendet)
CONF_SOURCE = "source"  # "zwilling" (QR eingelesen) oder "generated" (neu erzeugt)

SOURCE_ZWILLING = "zwilling"
SOURCE_GENERATED = "generated"

MANUFACTURER = "ZWILLING"

# Seitenleisten-Panel "Zwilling Dosen"
PANEL_URL_PATH = "zwilling-storage"

# Deep Link, den die Home-Assistant-App (iOS/Android) öffnen kann, z. B. per Kamera-App.
APP_URL_PREFIX = "homeassistant://navigate"


def device_path(device_id: str) -> str:
    """Frontend-Pfad der Geräteseite."""
    return f"/config/devices/device/{device_id}"


def device_app_url(device_id: str) -> str:
    """Link, der die Geräteseite direkt in der Home-Assistant-App öffnet."""
    return f"{APP_URL_PREFIX}{device_path(device_id)}"


def panel_path(add_code: str | None = None) -> str:
    """Frontend-Pfad des Dosen-Panels, optional mit vorbelegtem Code zum Hinzufügen."""
    if add_code:
        return f"/{PANEL_URL_PATH}?add={add_code}"
    return f"/{PANEL_URL_PATH}"


def panel_app_url(add_code: str | None = None) -> str:
    """Link, der das Dosen-Panel direkt in der Home-Assistant-App öffnet."""
    return f"{APP_URL_PREFIX}{panel_path(add_code)}"
