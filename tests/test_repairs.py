"""Tests: repair hints for containers without an area, without best-before and long expired containers."""

from custom_components.larder.const import DOMAIN
from custom_components.larder.estimate import async_get_estimator
from custom_components.larder.repair_hints import (
    ISSUE_LONG_EXPIRED,
    ISSUE_NO_AREA,
    ISSUE_NO_DATE,
    async_get_repairs,
    find_problems,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr, issue_registry as ir

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
    await _fill(hass, "BBBB", "Gouda", -2)  # only just expired: no hint
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text", "CCCC"), "value": "Suppe"}, blocking=True
    )  # filled without best-before date
    await hass.async_block_till_done()

    problems = find_problems(hass)
    assert problems == {ISSUE_NO_AREA: ["Dose DDDD"], ISSUE_NO_DATE: ["Dose CCCC"], ISSUE_LONG_EXPIRED: ["Dose AAAA"]}

    repairs = await async_get_repairs(hass)
    repairs.async_update()
    issues = _issues(hass)
    assert set(issues) == {ISSUE_NO_AREA, ISSUE_NO_DATE, ISSUE_LONG_EXPIRED}
    assert issues[ISSUE_LONG_EXPIRED].translation_placeholders["containers"] == "- Dose AAAA"
    assert issues[ISSUE_LONG_EXPIRED].translation_placeholders["days"] == "7"
    assert issues[ISSUE_NO_AREA].is_fixable is True
    # "Learn more": one container directly, otherwise filtered (here one container each)
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "DDDD")})
    assert issues[ISSUE_NO_AREA].learn_more_url == f"/larder?open={device.id}"

    # fixed: area assigned, best-before entered, container emptied → hints gone
    await _area(hass, "DDDD", "Keller")
    await _fill(hass, "CCCC", "Suppe", 3)
    await _fill(hass, "AAAA", "", -10)
    await hass.async_block_till_done()
    repairs.async_update()
    assert _issues(hass) == {}


async def test_repair_hints_can_be_switched_off(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")  # without area
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
    assert text.count("\n- ") == 10  # 10 names + line "and 2 more"
    assert text.endswith("2 more")


async def test_links_filter_when_several(hass: HomeAssistant) -> None:
    for cc in ("AAAA", "BBBB"):
        await _setup(hass, cc)
    repairs = await async_get_repairs(hass)
    repairs.async_update()
    assert _issues(hass)[ISSUE_NO_AREA].learn_more_url == "/larder?problem=noarea"


async def test_fix_flows(hass: HomeAssistant) -> None:
    from custom_components.larder.history import async_get_history
    from homeassistant.components.repairs import repairs_flow_manager
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "repairs", {})
    for cc in ("AAAA", "BBBB", "CCCC"):
        await _setup(hass, cc)
    await _area(hass, "CCCC", "Keller")
    await _fill(hass, "CCCC", "Lachs", -20)
    repairs = await async_get_repairs(hass)
    repairs.async_update()
    flows = repairs_flow_manager(hass)

    # without area: fields per container, saving assigns
    result = await flows.async_init(DOMAIN, data={"issue_id": ISSUE_NO_AREA})
    assert result["step_id"] == "area"
    assert [str(k) for k in result["data_schema"].schema] == ["Dose AAAA", "Dose BBBB"]
    area = ar.async_get(hass).async_get_or_create("Küche")
    result = await flows.async_configure(result["flow_id"], {"Dose AAAA": area.id})
    assert result["type"] == "create_entry"
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    assert device.area_id == area.id
    assert [name for name in find_problems(hass)[ISSUE_NO_AREA]] == ["Dose BBBB"]

    # long expired: empty the ticked containers, thrown away in the history
    result = await flows.async_init(DOMAIN, data={"issue_id": ISSUE_LONG_EXPIRED})
    assert result["step_id"] == "empty"
    result = await flows.async_configure(result["flow_id"], {"containers": ["CCCC"]})
    assert result["type"] == "create_entry"
    assert hass.states.get(_eid(hass, "text", "CCCC")).state == ""
    assert (await async_get_history(hass)).list("CCCC")[0]["outcome"] == "thrown"
    assert ISSUE_LONG_EXPIRED not in _issues(hass)


async def test_estimate_fix_names_contents_place_and_links(hass: HomeAssistant) -> None:
    """6.6.1: the hint says what is in the container, where it is and links to it; what is left is shown again."""
    from homeassistant.components.repairs import repairs_flow_manager
    from homeassistant.setup import async_setup_component

    hass.config.language = "de"
    assert await async_setup_component(hass, "repairs", {})
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _area(hass, "AAAA", "Kühlschrank")
    await _area(hass, "BBBB", "Kühlschrank")
    for cc, content in (("AAAA", "Hackfleisch"), ("BBBB", "Omas Geheimrezept")):
        await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", cc), "value": content}, blocking=True)
    repairs = await async_get_repairs(hass)
    repairs.async_update()
    flows = repairs_flow_manager(hass)
    result = await flows.async_init(DOMAIN, data={"issue_id": ISSUE_NO_DATE})
    assert result["step_id"] == "estimate"
    text = result["description_placeholders"]["containers"]
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    assert f"- **Hackfleisch** – Dose AAAA, Kühlschrank → [öffnen](/larder?open={device.id})" in text
    # the table knows mince but not grandma's recipe: that one is shown with its link
    result = await flows.async_configure(result["flow_id"], {})
    assert result["step_id"] == "estimate_left"
    left = result["description_placeholders"]["containers"]
    assert "Omas Geheimrezept" in left and "Hackfleisch" not in left
    result = await flows.async_configure(result["flow_id"], {})
    assert result["type"] == "create_entry"
