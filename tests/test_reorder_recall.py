"""Tests Block 16: Bald leer (Prognose) und Rückrufwarnungen (lebensmittelwarnung.de)."""

from datetime import timedelta
from email.utils import format_datetime
from pathlib import Path

from pytest_homeassistant_custom_component.common import async_capture_events
import yaml

from custom_components.larder.recall import FEED_URL, async_get_recalls, match, parse_feed
from custom_components.larder.stock import async_check_running_low, async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _eid, _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_shopping import _todo
from .test_stock import _packs


def _rss(*items: tuple[str, str, int]) -> str:
    """RSS wie beim Portal: Titel, Beschreibung (HTML) und Alter in Tagen."""
    now = dt_util.now()
    body = "".join(
        f"<item><title>{title}</title><link>https://www.lebensmittelwarnung.de/meldung/{i}</link>"
        f"<guid>lmw-{i}</guid><pubDate>{format_datetime(now - timedelta(days=age))}</pubDate>"
        f"<description><![CDATA[{desc}]]></description></item>"
        for i, (title, desc, age) in enumerate(items)
    )
    return f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>LMW</title>{body}</channel></rss>'


KETCHUP = (
    "Heinz Tomato Ketchup 500 ml",
    '<img src="https://www.lebensmittelwarnung.de/bild.png" /><br/><b>Bildquelle</b> © Heinz<br/>'
    "<b>Chargennummer / Los-Kennzeichnung:</b> EAN-Code: 4000000000017, Los L123<br/>"
    "<b>Kontakt:</b> Kundenservice<br/><b>Grund der Meldung:</b>   Glassplitter nicht ausgeschlossen<br/>"
    "<b>Hersteller / Inverkehrbringer:</b> H.J. Heinz GmbH,\nMusterweg 1<br/>"
    "<b>Produktbezeichnung/ -beschreibung:</b> Tomato Ketchup, Marke: Heinz, 500 ml<br/>"
    "<b>Betroffene Bundesländer nach derzeitigem Stand:</b>   Bayern, Hessen<br/>",
    3,
)
SALAMI = (
    "K-Classic Salami 1A",
    "<b>Grund der Warnung:</b> Listerien<br/><b>Betroffene Länder:</b> Berlin",  # älteres Format
    5,
)
OLD = ("Alte Warnung Senf", "<b>Grund der Warnung:</b> alt", 60)


def test_parse_feed_fields_age_and_state() -> None:
    warnings = parse_feed(_rss(KETCHUP, SALAMI, OLD))
    assert [w["title"] for w in warnings] == [KETCHUP[0], SALAMI[0]]  # die alte fällt weg
    ketchup = warnings[0]
    assert ketchup["reason"] == "Glassplitter nicht ausgeschlossen"
    assert ketchup["manufacturer"] == "H.J. Heinz GmbH" and ketchup["states"] == "Bayern, Hessen"
    assert ketchup["link"] == "https://www.lebensmittelwarnung.de/meldung/0" and ketchup["date"]
    assert ketchup["product"] == "Tomato Ketchup, Marke: Heinz, 500 ml"
    assert warnings[1]["reason"] == "Listerien" and warnings[1]["states"] == "Berlin"
    # nur Bayern: die Salami-Warnung gilt nur für Berlin
    assert [w["title"] for w in parse_feed(_rss(KETCHUP, SALAMI), state="Bayern")] == [KETCHUP[0]]


def test_match_needs_brand_and_name_or_barcode() -> None:
    warning = parse_feed(_rss(KETCHUP))[0]
    assert match(warning, {"content": "Ketchup", "brand": "Heinz"}) == "brand"
    assert match(warning, {"content": "Ketchup", "brand": "Hela"}) is None  # andere Marke
    assert match(warning, {"content": "Ketchup"}) is None  # ohne Marke reicht ein Wort nicht
    assert match(warning, {"content": "Tomato Ketchup"}) == "name"  # mehrteilig, alle Wörter
    assert match(warning, {"content": "Senf", "ean": "4000000000017"}) == "barcode"
    assert match(warning, {"content": "Mayo", "brand": "Heinz"}) is None  # Marke allein reicht nicht


async def test_recalls_on_start_page_card_event_and_read(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    aioclient_mock.get(FEED_URL, text=_rss(KETCHUP, SALAMI))
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorratskammer")
    made = await _packs(
        hass, hass_ws_client,
        [{"content": "Ketchup", "quantity": 2, "unit": "pieces", "product": {"brand": "Heinz"}},
         {"content": "Senf", "quantity": 1, "unit": "pieces", "product": {"brand": "Develey"}}],
        pantry.id, "Schrank",
    )
    events = async_capture_events(hass, "larder_recall")
    recalls = await async_get_recalls(hass)
    new = await recalls.async_refresh()
    await hass.async_block_till_done()
    assert [w["title"] for w in new] == [KETCHUP[0]]
    assert len(events) == 1 and events[0].data["products"] == ["Ketchup"]
    assert events[0].data["places"] == ["Vorratskammer · Schrank"] and "Glassplitter" in events[0].data["message"]
    # Karte der Packung
    attrs = hass.states.get(_eid(hass, "text", made[0]["cc"])).attributes
    assert attrs["recall"]["title"] == KETCHUP[0] and attrs["recall"]["link"].startswith("https://")
    assert "recall" not in hass.states.get(_eid(hass, "text", made[1]["cc"])).attributes
    # Startseite
    res = await _ws(hass, hass_ws_client, type="larder/recalls")
    item = res["result"]["items"][0]
    assert item["items"][0]["via"] == "brand" and item["items"][0]["compartment"] == "Schrank"
    # erneuter Abruf meldet nichts doppelt
    assert await recalls.async_refresh() == []
    # gelesen: weg von Startseite und Karte, auch nach dem nächsten Abruf
    res = await _ws(hass, hass_ws_client, type="larder/recall_read", recall_id=item["id"])
    assert res["result"]["items"] == []
    await hass.async_block_till_done()
    assert "recall" not in hass.states.get(_eid(hass, "text", made[0]["cc"])).attributes
    await recalls.async_refresh()
    assert (await _ws(hass, hass_ws_client, type="larder/recalls"))["result"]["items"] == []
    assert len(events) == 1


async def test_recalls_off_and_feed_errors(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    aioclient_mock.get(FEED_URL, status=500)
    entry = await _setup(hass, "AAAA")
    recalls = await async_get_recalls(hass)
    assert await recalls.async_refresh() == [] and recalls.error
    await _options(hass, entry, recall_check=False)
    assert await recalls.async_refresh() == [] and recalls.warnings == []
    assert len(aioclient_mock.mock_calls) == 1  # ausgeschaltet: kein Abruf


async def test_running_low_start_page_event_and_shopping(hass: HomeAssistant, hass_ws_client) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen", stock_lead_days=7)
    await _packs(hass, hass_ws_client, [{"content": "Milch", "quantity": 3, "unit": "pieces"}])
    stock = await async_get_stock(hass)
    await stock.async_set_minimum("Milch", 1)
    today = dt_util.now().date()
    # etwa eine Packung alle zwei Tage → 3 Packungen reichen keine Woche
    stock.takes = [{"key": "milch", "day": (today - timedelta(days=d)).isoformat(), "n": 1} for d in (1, 3, 5, 7, 9, 11, 13)]
    events = async_capture_events(hass, "larder_running_low")
    new = await async_check_running_low(hass)
    await hass.async_block_till_done()
    assert [p["name"] for p in new] == ["Milch"] and len(events) == 1
    assert events[0].data["lasts_days"] <= 7 and "Milch" in events[0].data["message"]
    assert todo.summaries == []  # ohne Einstellung nicht gleich auf die Liste
    assert await async_check_running_low(hass) == []  # nur einmal melden
    res = await _ws(hass, hass_ws_client, type="larder/running_low")
    assert [i["name"] for i in res["result"]["items"]] == ["Milch"] and res["result"]["shopping_list"] is True
    # 🛒: auf die Liste und eine Woche ausgeblendet
    res = await _ws(hass, hass_ws_client, type="larder/running_low_action", content="Milch", action="shop")
    assert res["result"]["added"] is True and res["result"]["items"] == []
    assert todo.summaries == ["Milch"]


async def test_running_low_goes_to_shopping_list_when_set(hass: HomeAssistant, hass_ws_client) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen", reorder_shopping=True)
    await _packs(hass, hass_ws_client, [{"content": "Butter", "quantity": 2, "unit": "pieces"}])
    stock = await async_get_stock(hass)
    await stock.async_set_minimum("Butter", 1)
    today = dt_util.now().date()
    stock.takes = [{"key": "butter", "day": (today - timedelta(days=d)).isoformat(), "n": 1} for d in (2, 6, 10, 14)]
    await async_check_running_low(hass)
    await hass.async_block_till_done()
    assert todo.summaries == ["Butter"]
    # ✕ blendet aus, ohne Liste
    res = await _ws(hass, hass_ws_client, type="larder/running_low")
    assert res["result"]["items"]
    res = await _ws(hass, hass_ws_client, type="larder/running_low_action", content="Butter", action="dismiss")
    assert res["result"]["items"] == [] and todo.summaries == ["Butter"]


def test_blueprint_stock_alerts() -> None:
    class Loader(yaml.SafeLoader):
        pass

    Loader.add_constructor("!input", lambda loader, node: loader.construct_scalar(node))
    path = Path(__file__).parents[1] / "blueprints/automation/larder/stock_alerts.yaml"
    bp = yaml.load(path.read_text(encoding="utf-8"), Loader=Loader)  # noqa: S506
    assert {t["event_type"] for t in bp["triggers"]} == {"larder_running_low", "larder_recall"}
    assert set(bp["blueprint"]["input"]) == {"notify_action", "running_low", "recalls"}
