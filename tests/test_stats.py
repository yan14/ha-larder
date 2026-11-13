"""Tests: Statistik aus dem Verlauf und dem aktuellen Bestand (Service und WebSocket)."""

from datetime import timedelta

from custom_components.larder.history import async_get_history
from custom_components.larder.stats import build_statistics
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .test_recipes import _fill, _setup, auto_enable_custom_integrations  # noqa: F401


def _record(content, outcome, days_ago, expired=False, stored=None, area="Küche"):
    return {
        "cc": "X",
        "content": content,
        "outcome": outcome,
        "expired": expired,
        "days_stored": stored,
        "area": area,
        "emptied": (dt_util.now() - timedelta(days=days_ago)).isoformat(),
    }


async def test_statistics_from_history(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _setup(hass, "CCCC")
    await _fill(hass, "AAAA", "Lachs", -1)
    await _fill(hass, "BBBB", "Gouda", 2)
    records = [
        _record("Bolognese", "eaten", 1, stored=10),
        _record("Bolognese", "eaten", 5, stored=6),
        _record("Käse, Salami", "thrown", 3, area="Keller"),
        _record("Käse", None, 4, expired=True),  # ohne Antwort, abgelaufen: zählt als weggeworfen
        _record("Suppe", None, 2),  # ohne Antwort, nicht abgelaufen: unbekannt
        _record("Alt", "eaten", 200, stored=3),  # außerhalb von 90 Tagen
    ]
    st = build_statistics(hass, records, 90)
    assert (st["emptied"], st["eaten"], st["thrown"], st["unknown"]) == (5, 2, 2, 1)
    assert st["waste_percent"] == 50
    assert st["avg_days_stored"] == 8.0
    assert st["top_thrown"][0] == {"content": "Käse", "count": 2}
    assert {"content": "Salami", "count": 1} in st["top_thrown"]
    assert st["top_eaten"] == [{"content": "Bolognese", "count": 2}]
    assert st["thrown_by_area"] == [{"area": "Keller", "count": 1}, {"area": "Küche", "count": 1}]
    assert len(st["months"]) == 6 and st["months"][-1]["month"] == dt_util.now().strftime("%Y-%m")
    assert st["containers"] == {"total": 3, "filled": 2, "empty": 1, "expired": 1, "soon": 1, "undated": 0}
    # ohne Zeitraum: alles
    assert build_statistics(hass, records)["emptied"] == 6
    assert build_statistics(hass, [], 30)["waste_percent"] is None


async def test_service_and_websocket(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    history = await async_get_history(hass)
    history.add(_record("Lachs", "eaten", 1, stored=2))
    out = await hass.services.async_call("larder", "get_statistics", {"days": 30}, blocking=True, return_response=True)
    assert out["eaten"] == 1 and out["days"] == 30
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "larder/statistics"})
    msg = await ws.receive_json()
    assert msg["success"] and msg["result"]["emptied"] == 1 and msg["result"]["days"] is None
