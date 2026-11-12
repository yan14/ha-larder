"""Tests: Reparaturhinweise für Dosen ohne Bereich, ohne MHD und lange abgelaufene Dosen."""

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr, issue_registry as ir

from custom_components.larder.const import DOMAIN
from custom_components.larder.estimate import async_get_estimator
from custom_components.larder.repair_hints import (
    ISSUE_LONG_EXPIRED,
    ISSUE_NO_AREA,
    ISSUE_NO_DATE,
    async_get_repairs,
    find_problems,
)

from .test_recipes import _eid, _fill, _setup, auto_enable_custom_integrations  # noqa: F401


def _issues(hass: HomeAssistant) -> dict[str, ir.IssueEntry]:
    return {issue_id: issue for (domain, issue_id), issue in ir.async_get(hass).issues.items() if domain == DOMAIN}


async def _area(hass: HomeAssistant, cc: str, name: str) -> None:
    area = ar.async_get(hass).async_get_or_create(name)
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)


async def test_repair_hints_appear_and_disappear(hass: HomeAssistant) -> None:
    for cc in ("AAAA", "BBBB", "CCCC", "DDDD"):
        await _setup(hass, cc)
    for cc in ("AAAA", "BBBB", "CCCC"):
        await _area(hass, cc, "Küche")
    await _fill(hass, "AAAA", "Lachs", -10)  # lange abgelaufen
    await _fill(hass, "BBBB", "Gouda", -2)  # erst kurz abgelaufen: kein Hinweis
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text", "CCCC"), "value": "Suppe"}, blocking=True
    )  # gefüllt ohne MHD
    await hass.async_block_till_done()

    problems = find_problems(hass)
    assert problems == {ISSUE_NO_AREA: ["Dose DDDD"], ISSUE_NO_DATE: ["Dose CCCC"], ISSUE_LONG_EXPIRED: ["Dose AAAA"]}

    repairs = await async_get_repairs(hass)
    repairs.async_update()
    issues = _issues(hass)
    assert set(issues) == {ISSUE_NO_AREA, ISSUE_NO_DATE, ISSUE_LONG_EXPIRED}
    assert issues[ISSUE_LONG_EXPIRED].translation_placeholders["containers"] == "- Dose AAAA"
    assert issues[ISSUE_LONG_EXPIRED].translation_placeholders["days"] == "7"
    assert issues[ISSUE_NO_AREA].is_fixable is False

    # behoben: Bereich zugewiesen, MHD eingetragen, Dose geleert → Hinweise weg
    await _area(hass, "DDDD", "Keller")
    await _fill(hass, "CCCC", "Suppe", 3)
    await _fill(hass, "AAAA", "", -10)
    await hass.async_block_till_done()
    repairs.async_update()
    assert _issues(hass) == {}


async def test_repair_hints_can_be_switched_off(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")  # ohne Bereich
    repairs = await async_get_repairs(hass)
    repairs.async_update()
    assert set(_issues(hass)) == {ISSUE_NO_AREA}

    estimator = await async_get_estimator(hass)
    await estimator.async_update_settings({"repair_hints": False})
    repairs.async_update()
    assert _issues(hass) == {}


async def test_long_list_is_shortened(hass: HomeAssistant) -> None:
    for i in range(12):
        await _setup(hass, f"A{i:03d}")
    repairs = await async_get_repairs(hass)
    repairs.async_update()
    text = _issues(hass)[ISSUE_NO_AREA].translation_placeholders["containers"]
    assert text.count("\n- ") == 10  # 10 Namen + Zeile "und 2 weitere"
    assert text.endswith("2 more")
