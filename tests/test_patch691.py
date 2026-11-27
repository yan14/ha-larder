"""Tests 6.9.1: a food pack becomes a bag (for an NFC tag)."""

from custom_components.larder.const import DOMAIN, KIND_BAG
from custom_components.larder.devices import entry_of
from custom_components.larder.entity import kind_of
from custom_components.larder.stock import pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


async def test_pack_becomes_a_bag(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _packs(hass, hass_ws_client, [{"content": "Rinderfilet", "quantity": 1, "unit": "pieces"}], None, "")
    pack = next(p for p in pack_entries(hass) if p["content"] == "Rinderfilet")
    res = await _ws(hass, hass_ws_client, type="larder/convert_kind", device_id=pack["device_id"], kind="bag")
    assert res["result"] == {"kind": "bag"}
    await hass.async_block_till_done()
    entry = entry_of(hass, pack["cc"])
    assert kind_of(entry) == KIND_BAG and entry.title == "Beutel 1"
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, pack["cc"])})
    assert device.name == "Beutel 1"
    # a bag cannot become a bag again, a household item cannot become a bag
    res = await _ws(hass, hass_ws_client, type="larder/convert_kind", device_id=pack["device_id"], kind="bag")
    assert res["success"] is False
