"""Konstanten für die Zwilling-Food-Storage-Integration."""

from homeassistant.const import Platform

DOMAIN = "zwilling_storage"

PLATFORMS: list[Platform] = [
    Platform.BUTTON,
    Platform.DATE,
    Platform.DATETIME,
    Platform.IMAGE,
    Platform.SWITCH,
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

# KI-Schätzung des MHD (optional, benötigt die Home-Assistant-Integration "AI Task")
CONF_AI_ENABLED = "ai_enabled"  # alt (bis 0.5), wird zu CONF_ESTIMATE_MODE migriert
CONF_ESTIMATE_MODE = "estimate_mode"
ESTIMATE_OFF = "off"
ESTIMATE_TABLE = "table"
ESTIMATE_TABLE_AI = "table_ai"
ESTIMATE_AI = "ai"
ESTIMATE_MODES = [ESTIMATE_OFF, ESTIMATE_TABLE, ESTIMATE_TABLE_AI, ESTIMATE_AI]
CONF_AI_TASK_ENTITY = "ai_task_entity"
SERVICE_ESTIMATE_BEST_BEFORE = "estimate_best_before"
SERVICE_CLEAR_BEST_BEFORE = "clear_best_before"
SERVICE_CLEAR_FILLED_AT = "clear_filled_at"
SIGNAL_SETTINGS_CHANGED = f"{DOMAIN}_settings_changed"

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
