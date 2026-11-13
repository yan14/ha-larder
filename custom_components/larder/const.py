"""Konstanten für die Larder-Integration."""

from homeassistant.const import Platform

DOMAIN = "larder"

PLATFORMS: list[Platform] = [
    Platform.BUTTON,
    Platform.DATE,
    Platform.DATETIME,
    Platform.IMAGE,
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.TEXT,
]

# Einheiten der Menge (Entität "Einheit"); die Schlüssel sind zugleich die Optionen der Auswahl.
UNIT_PORTIONS = "portions"
UNITS = [UNIT_PORTIONS, "pieces", "slices", "grams", "milliliters"]
DEFAULT_UNIT = UNIT_PORTIONS

CONF_QR_CODE = "qr_code"
CONF_CC = "cc"  # eindeutige ID der Dose (Parameter "cc" im QR-Code)
CONF_TC = "tc"  # Typ-/Produktcode (Parameter "tc")
CONF_SIZE = "size"  # Größe (Parameter "s")
CONF_INITIAL = "initial"  # Vorgaben beim Anlegen: vacuum, shopping, flexible, home_area (einmalig)
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
CONF_OPENED_DAYS = "opened_days"
CONF_THAWED_DAYS = "thawed_days"
CONF_CALENDAR_ENTITY = "calendar_entity"
CONF_NFC_NOTIFY = "nfc_notify"
CONF_EXPERIMENTAL = "experimental_panel"  # zweites Panel "Larder experimental" in der Seitenleiste
CONF_TODO_ENTITY = "todo_entity"  # To-do-Liste für "Beim Leeren auf die Einkaufsliste"
CONF_MEAL_CALENDAR = "meal_calendar"  # Kalender für den Wochenplan (optional)
CONF_THAW_DAYS = "thaw_days"  # Auftau-Erinnerung so viele Tage vor dem geplanten Tag
DEFAULT_THAW_DAYS = 1
CONF_TEMPERATURE_WARNING = "temperature_warning"  # Warnung, wenn ein Lagerort mit Sensor zu warm ist
CONF_REPAIR_HINTS = "repair_hints"  # Reparaturhinweise für Dosen ohne Bereich, ohne MHD, lange abgelaufen
CONF_VACUUM_DEFAULT = "vacuum_default"  # Vorbelegung des Schalters "Vakuum" bei neuen Dosen
EVENT_DOSE_SCANNED = f"{DOMAIN}_dose_scanned"  # verknüpfter NFC-Tag wurde gescannt
CONF_RECIPE_DAYS = "recipe_days"  # Zeitraum für Rezeptideen: Dosen, die in so vielen Tagen ablaufen
DEFAULT_RECIPE_DAYS = 3
MAX_RECIPE_DAYS = 365
DEFAULT_OPENED_DAYS = 3  # so lange hält eine geöffnete Dose noch
DEFAULT_THAWED_DAYS = 2  # so lange hält aufgetautes Essen noch
SERVICE_ESTIMATE_BEST_BEFORE = "estimate_best_before"
SERVICE_CLEAR_BEST_BEFORE = "clear_best_before"
SERVICE_REBUILD_CALENDAR = "rebuild_calendar"
SERVICE_CLEAR_FILLED_AT = "clear_filled_at"
SERVICE_GET_EXPIRING = "get_expiring"
SERVICE_SUGGEST_RECIPES = "suggest_recipes"
SERVICE_MARK_OPENED = "mark_opened"
SERVICE_MARK_THAWED = "mark_thawed"
SOON_DAYS = 3  # ab so vielen Resttagen gilt eine Dose als "läuft bald ab" (Vorgabe, einstellbar)
CONF_SOON_DAYS = "soon_days"
MAX_SOON_DAYS = 30
SIGNAL_SETTINGS_CHANGED = f"{DOMAIN}_settings_changed"

# Seitenleisten-Panel "Larder"
PANEL_URL_PATH = "larder"
PANEL_EXPERIMENTAL_PATH = "larder-experimental"

# Deep Link, den die Home-Assistant-App (iOS/Android) öffnen kann, z. B. per Kamera-App.
APP_URL_PREFIX = "homeassistant://navigate"


def device_path(device_id: str) -> str:
    """Frontend-Pfad der Geräteseite."""
    return f"/config/devices/device/{device_id}"


def device_app_url(device_id: str) -> str:
    """Link, der die Geräteseite direkt in der Home-Assistant-App öffnet."""
    return f"{APP_URL_PREFIX}{device_path(device_id)}"


def panel_path(add_code: str | None = None, open_device: str | None = None) -> str:
    """Frontend-Pfad des Dosen-Panels, optional mit Code zum Hinzufügen oder Dose zum Öffnen."""
    if add_code:
        return f"/{PANEL_URL_PATH}?add={add_code}"
    if open_device:
        return f"/{PANEL_URL_PATH}?open={open_device}"
    return f"/{PANEL_URL_PATH}"


def scan_path(cc: str) -> str:
    """Ziel eines eigenen QR-Codes: das Dashboard mit der ID der Dose (unabhängig von der Geräte-ID)."""
    return f"/{PANEL_URL_PATH}?cc={cc}"


def scan_app_url(cc: str) -> str:
    """Inhalt der eigenen QR-Codes: öffnet in der Home-Assistant-App das Dashboard bei dieser Dose."""
    return f"{APP_URL_PREFIX}{scan_path(cc)}"


def panel_app_url(add_code: str | None = None, open_device: str | None = None) -> str:
    """Link, der das Dosen-Panel direkt in der Home-Assistant-App öffnet."""
    return f"{APP_URL_PREFIX}{panel_path(add_code, open_device)}"
