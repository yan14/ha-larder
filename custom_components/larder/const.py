"""Constants for the Larder integration."""

from typing import Any

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

# Units of the quantity (entity "Unit"); the keys are also the options of the select.
UNIT_PORTIONS = "portions"
UNITS = [UNIT_PORTIONS, "pieces", "slices", "grams", "milliliters"]
DEFAULT_UNIT = UNIT_PORTIONS

CONF_QR_CODE = "qr_code"
CONF_CC = "cc"  # unique ID of the container (parameter "cc" in the QR code)
CONF_TC = "tc"  # type/product code (parameter "tc")
CONF_SIZE = "size"  # size (parameter "s")
CONF_INITIAL = "initial"  # presets on creation: vacuum, shopping, flexible, home_area (once)
CONF_AREA = "area_id"  # area preselected on creation (applied once)
CONF_KIND = "kind"  # kind: container (reusable), bag (disposable, with code) or pack (without code)
KIND_CONTAINER = "container"
KIND_BAG = "bag"
KIND_PACK = "pack"
KIND_HOUSEHOLD = "household"  # household item: like a pack, counted in pieces, no best-before date
KINDS = (KIND_CONTAINER, KIND_BAG, KIND_PACK, KIND_HOUSEHOLD)
PACK_KINDS = (KIND_PACK, KIND_HOUSEHOLD)  # stock without a container
DISPOSABLE_KINDS = (KIND_BAG, KIND_PACK, KIND_HOUSEHOLD)  # disappear after emptying
CONF_SOURCE = "source"  # "zwilling" (QR code read) or "generated" (newly created)

SOURCE_ZWILLING = "zwilling"
SOURCE_GENERATED = "generated"

MANUFACTURER = "ZWILLING"

# AI estimate of the best-before date (optional, needs the Home Assistant integration "AI Task")
CONF_AI_ENABLED = "ai_enabled"  # old (up to 0.5), migrated to CONF_ESTIMATE_MODE
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
CONF_TODO_ENTITY = "todo_entity"  # default shopping list (food; also household without its own list)
CONF_TODO_HOUSEHOLD = "todo_household"  # default shopping list for household items (optional)
CONF_MEAL_CALENDAR = "meal_calendar"  # calendar for the week plan (optional)
CONF_THAW_DAYS = "thaw_days"  # thaw reminder this many days before the planned day
DEFAULT_THAW_DAYS = 1
CONF_TEMPERATURE_WARNING = "temperature_warning"  # warning if a storage place with a sensor is too warm
CONF_REPAIR_HINTS = "repair_hints"  # repair hints for containers without area, without date, long expired
CONF_WATCH_ALLERGENS = "watch_allergens"  # allergens the household watches out for
CONF_STOCK_LEAD_DAYS = "stock_lead_days"  # days until the next shopping trip (suggested minimum stock)
CONF_REORDER_SHOPPING = "reorder_shopping"  # put "running low" on the shopping list right away
CONF_RECALL_CHECK = "recall_check"  # check recall warnings (lebensmittelwarnung.de)
CONF_PLAN_SOURCE = "plan_source"  # week plan suggestion: recipe book, AI, recipe book else AI, both
CONF_PLAN_DAYS = "plan_days"  # week plan suggestion: this many days
PLAN_SOURCES = ("book", "ai", "book_ai", "both")
CONF_RECALL_STATE = "recall_state"  # only warnings for this federal state (empty = all)
RECALL_STATES = (
    "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hessen",
    "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen", "Rheinland-Pfalz", "Saarland",
    "Sachsen", "Sachsen-Anhalt", "Schleswig-Holstein", "Thüringen",
)
CONF_SHOPPING_DETAILS = "shopping_details"  # brand and package on the shopping list too
CONF_VACUUM_DEFAULT = "vacuum_default"  # default of the "Vacuum" switch for new containers
EVENT_DOSE_SCANNED = f"{DOMAIN}_dose_scanned"  # linked NFC tag was scanned
CONF_RECIPE_DAYS = "recipe_days"  # period for recipe ideas: containers expiring within this many days
DEFAULT_RECIPE_DAYS = 3
MAX_RECIPE_DAYS = 365
DEFAULT_OPENED_DAYS = 3  # an opened container keeps this long
DEFAULT_THAWED_DAYS = 2  # thawed food keeps this long
SERVICE_ESTIMATE_BEST_BEFORE = "estimate_best_before"
SERVICE_CLEAR_BEST_BEFORE = "clear_best_before"
SERVICE_REBUILD_CALENDAR = "rebuild_calendar"
SERVICE_CLEAR_FILLED_AT = "clear_filled_at"
SERVICE_GET_EXPIRING = "get_expiring"
SERVICE_SUGGEST_RECIPES = "suggest_recipes"
SERVICE_MARK_OPENED = "mark_opened"
SERVICE_MARK_THAWED = "mark_thawed"
SOON_DAYS = 3  # from this many days left a container counts as "expires soon" (default, adjustable)
CONF_SOON_DAYS = "soon_days"
MAX_SOON_DAYS = 30
SIGNAL_SETTINGS_CHANGED = f"{DOMAIN}_settings_changed"
SIGNAL_STOCK_CHANGED = f"{DOMAIN}_stock_changed"  # minimum stocks changed
DATA_STOCK = "stock"

# sidebar panel "Larder"
PANEL_URL_PATH = "larder"

# Deep link the Home Assistant app (iOS/Android) can open, e.g. from the camera app.
APP_URL_PREFIX = "homeassistant://navigate"


def device_path(device_id: str) -> str:
    """Frontend path of the device page."""
    return f"/config/devices/device/{device_id}"


def device_app_url(device_id: str) -> str:
    """Link that opens the device page directly in the Home Assistant app."""
    return f"{APP_URL_PREFIX}{device_path(device_id)}"


def panel_path(add_code: str | None = None, open_device: str | None = None) -> str:
    """Frontend path of the container panel, optionally with a code to add or a container to open."""
    if add_code:
        return f"/{PANEL_URL_PATH}?add={add_code}"
    if open_device:
        return f"/{PANEL_URL_PATH}?open={open_device}"
    return f"/{PANEL_URL_PATH}"


def scan_path(cc: str) -> str:
    """Target of an own QR code: the dashboard with the container's ID (independent of the device ID)."""
    return f"/{PANEL_URL_PATH}?cc={cc}"


def scan_app_url(cc: str) -> str:
    """Content of own QR codes: opens the dashboard at this container in the Home Assistant app."""
    return f"{APP_URL_PREFIX}{scan_path(cc)}"


def panel_app_url(add_code: str | None = None, open_device: str | None = None) -> str:
    """Link that opens the container panel directly in the Home Assistant app."""
    return f"{APP_URL_PREFIX}{panel_path(add_code, open_device)}"


def larder_ids(device: Any) -> list[str]:
    """IDs (cc) of a device that belong to Larder.

    Other integrations may use identifiers with more than two parts, e.g. ("zha", "…", "…"), so they are
    never unpacked as pairs.
    """
    return [
        str(ident[1])
        for ident in (getattr(device, "identifiers", None) or ())
        if len(ident) >= 2 and ident[0] == DOMAIN
    ]


def larder_id(device: Any) -> str | None:
    """The Larder ID (cc) of a device, or None for devices of other integrations."""
    ids = larder_ids(device)
    return ids[0] if ids else None
