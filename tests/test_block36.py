"""Tests block 36 (5.3): compartments and tags made easy – unknown tags ask what they are."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import async_capture_events, async_fire_time_changed

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .test_ai_estimate import _setup, auto_enable_custom_integrations  # noqa: F401
from .test_nfc import _notify, _phone, _ws


async def _scan(hass: HomeAssistant, tag_id: str, device_id: str, name: str | None = None) -> None:
    hass.bus.async_fire("tag_scanned", {"tag_id": tag_id, "device_id": device_id, **({"name": name} if name else {})})
    await hass.async_block_till_done()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=5))
    await hass.async_block_till_done()


async def test_unknown_tag_asks_once_ignore_and_named(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "34OL")
    phone = _phone(hass)
    calls = _notify(hass)
    events = async_capture_events(hass, "larder_unknown_tag")
    await _scan(hass, "neu-1", phone)
    assert [e.data["tag_id"] for e in events] == ["neu-1"]
    assert len(calls) == 1 and calls[0]["data"]["url"] == "/larder?assign_tag=neu-1"
    assert "Neuer NFC-Tag" in calls[0]["message"]
    # right after that: not again
    await _scan(hass, "neu-1", phone)
    assert len(calls) == 1
    # a tag with a name in Home Assistant belongs to something else
    await _scan(hass, "haustuer", phone, name="Haustür")
    assert len(calls) == 1
    # linked in the meantime (dashboard): no question
    hass.bus.async_fire("tag_scanned", {"tag_id": "neu-2", "device_id": phone})
    await hass.async_block_till_done()
    res = await _ws(hass, hass_ws_client, {"type": "larder/place_link", "tag_id": "neu-2", "area_id": "", "compartment": "Box"})
    assert res["success"], res
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=5))
    await hass.async_block_till_done()
    assert len(calls) == 1
    # ignore: never again
    res = await _ws(hass, hass_ws_client, {"type": "larder/tag_ignore", "tag_id": "neu-3"})
    assert res["success"]
    await _scan(hass, "neu-3", phone)
    assert len(calls) == 1 and len(events) == 1
