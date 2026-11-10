"""Übernahme der früheren Integration "Zwilling Food Storage" (Domain `zwilling_storage`).

Home Assistant kann die Domain eines vorhandenen Eintrags nicht ändern. Deshalb legt Larder die
Einträge neu an und hängt Geräte und Entitäten der alten Domain um. Entity-IDs, Verlauf,
Bereiche, Labels und die letzten Werte bleiben dabei erhalten.

Ablauf (Config-Flow-Schritt "Von Zwilling Food Storage übernehmen"):

1. Alte Einträge entladen (Webhook, Panel und Entitäten der alten Integration verschwinden).
2. Gespeicherte Daten kopieren (Webhook-ID, Schätzungen, NFC-Tags, Kalender-Zuordnung).
3. Pro Dose einen Larder-Eintrag anlegen. Beim Einrichten übernimmt `async_adopt_legacy_registry`
   das Gerät und seine Entitäten.
4. Alte Einträge entfernen und den alten Ordner aufräumen.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

from homeassistant.config_entries import SOURCE_IGNORE, SOURCE_IMPORT, ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store

from .const import (
    CONF_CC,
    DOMAIN,
    LEGACY_DOMAIN,
    SERVICE_CLEAR_BEST_BEFORE,
    SERVICE_CLEAR_FILLED_AT,
    SERVICE_ESTIMATE_BEST_BEFORE,
    SERVICE_GET_EXPIRING,
    SERVICE_MARK_OPENED,
)

_LOGGER = logging.getLogger(__name__)

# (Name der Datei in .storage nach dem Domain-Präfix, Schlüssel der geladenen Instanz in hass.data)
_STORES: tuple[tuple[str, str | None], ...] = (
    ("webhook", "webhook_id"),
    ("estimator", "estimator"),
    ("calendar", "calendar_sync"),
    ("nfc", "nfc"),
)
_STORAGE_VERSION = 1

MARKER_KEY = f"{DOMAIN}.migration"
DATA_LEGACY_COMPAT = "legacy_compat"
LEGACY_SERVICES = (
    SERVICE_GET_EXPIRING,
    SERVICE_ESTIMATE_BEST_BEFORE,
    SERVICE_CLEAR_BEST_BEFORE,
    SERVICE_CLEAR_FILLED_AT,
    SERVICE_MARK_OPENED,
)


class MigrationError(Exception):
    """Übernahme nicht möglich; `reason` ist der Abbruchgrund für die Oberfläche."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def legacy_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """Einträge der alten Domain (ohne ignorierte)."""
    return [
        entry
        for entry in hass.config_entries.async_entries(LEGACY_DOMAIN)
        if entry.source != SOURCE_IGNORE
    ]


async def async_copy_stores(hass: HomeAssistant) -> list[str]:
    """Daten der alten Domain in die neuen Dateien kopieren, ohne Vorhandenes zu überschreiben."""
    loaded = hass.data.get(DOMAIN, {})
    copied: list[str] = []
    for name, instance_key in _STORES:
        if instance_key and instance_key in loaded:
            _LOGGER.warning("%s ist schon geladen, alte Daten werden nicht übernommen", name)
            continue
        new_store: Store = Store(hass, _STORAGE_VERSION, f"{DOMAIN}.{name}")
        if await new_store.async_load():
            continue
        old_data = await Store(hass, _STORAGE_VERSION, f"{LEGACY_DOMAIN}.{name}").async_load()
        if old_data:
            await new_store.async_save(old_data)
            copied.append(name)
    return copied


async def async_migrate_legacy(hass: HomeAssistant) -> int:
    """Alle Dosen der alten Domain übernehmen und zurückgeben, wie viele es waren."""
    legacy = legacy_entries(hass)
    if not legacy:
        return 0

    for entry in legacy:
        if entry.state is not ConfigEntryState.NOT_LOADED and not await hass.config_entries.async_unload(
            entry.entry_id
        ):
            raise MigrationError("unload_failed")

    await async_copy_stores(hass)

    for entry in legacy:
        await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": SOURCE_IMPORT},
            data={
                "title": entry.title,
                "data": dict(entry.data),
                "options": dict(entry.options),
            },
        )

    for entry in legacy:
        await hass.config_entries.async_remove(entry.entry_id)

    await Store(hass, _STORAGE_VERSION, MARKER_KEY).async_save({"from": LEGACY_DOMAIN, "count": len(legacy)})
    await async_enable_legacy_compat(hass)
    await hass.async_add_executor_job(
        remove_legacy_folder, Path(hass.config.path("custom_components", LEGACY_DOMAIN))
    )
    return len(legacy)


def remove_legacy_folder(path: Path) -> bool:
    """Alten Integrationsordner löschen (nur wenn er wirklich die frühere Integration ist)."""
    try:
        manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if manifest.get("domain") != LEGACY_DOMAIN or "@yan14" not in manifest.get("codeowners", []):
        return False
    try:
        shutil.rmtree(path)
    except OSError:
        _LOGGER.warning("Alter Ordner %s konnte nicht gelöscht werden", path, exc_info=True)
        return False
    _LOGGER.info("Alter Ordner %s gelöscht", path)
    return True


def async_adopt_legacy_registry(hass: HomeAssistant, entry: ConfigEntry) -> int:
    """Gerät und Entitäten der alten Domain auf diesen Eintrag umhängen (idempotent).

    Gibt die Zahl der übernommenen Entitäten zurück. Muss vor dem Einrichten der Plattformen
    laufen, damit die Entitäten ihre bisherigen Entity-IDs behalten.
    """
    cc = entry.data.get(CONF_CC)
    if not cc:
        return 0
    device_registry = dr.async_get(hass)
    device = device_registry.async_get_device(identifiers={(LEGACY_DOMAIN, cc)})
    if device is None:
        return 0

    entity_registry = er.async_get(hass)
    adopted = 0
    for registry_entry in er.async_entries_for_device(entity_registry, device.id, include_disabled_entities=True):
        if registry_entry.platform != LEGACY_DOMAIN:
            continue
        try:
            entity_registry.async_update_entity_platform(
                registry_entry.entity_id, DOMAIN, new_config_entry_id=entry.entry_id
            )
            adopted += 1
        except ValueError:
            _LOGGER.warning("%s konnte nicht übernommen werden", registry_entry.entity_id, exc_info=True)

    legacy_ids = [
        entry_id
        for entry_id in device.config_entries
        if (other := hass.config_entries.async_get_entry(entry_id)) is not None
        and other.domain == LEGACY_DOMAIN
    ]
    device_registry.async_update_device(
        device.id,
        new_identifiers={(DOMAIN, cc)},
        add_config_entry_id=entry.entry_id,
    )
    for legacy_id in legacy_ids:
        device_registry.async_update_device(device.id, remove_config_entry_id=legacy_id)
    return adopted


async def async_enable_legacy_compat(hass: HomeAssistant) -> None:
    """Alte Service-Namen (`zwilling_storage.*`) und das alte Ereignis weiter bedienen.

    Nur auf Installationen, die von der früheren Integration übernommen wurden, damit
    bestehende Automationen und Blueprints weiterlaufen.
    """
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_LEGACY_COMPAT):
        return
    domain_data[DATA_LEGACY_COMPAT] = True

    for name in LEGACY_SERVICES:
        if hass.services.has_service(LEGACY_DOMAIN, name):
            continue  # die alte Integration läuft noch (vor der Übernahme)

        async def forward(call: ServiceCall, _name: str = name) -> ServiceResponse:
            _LOGGER.warning(
                "Der Service %s.%s ist veraltet, bitte %s.%s verwenden", LEGACY_DOMAIN, _name, DOMAIN, _name
            )
            return await hass.services.async_call(
                DOMAIN,
                _name,
                dict(call.data),
                blocking=True,
                context=call.context,
                return_response=call.return_response,
            )

        hass.services.async_register(
            LEGACY_DOMAIN, name, forward, supports_response=SupportsResponse.OPTIONAL
        )


async def async_setup_legacy_compat(hass: HomeAssistant) -> None:
    """Beim Start die Übergangshilfen einschalten, wenn die Übernahme früher stattgefunden hat."""
    if await Store(hass, _STORAGE_VERSION, MARKER_KEY).async_load():
        await async_enable_legacy_compat(hass)
