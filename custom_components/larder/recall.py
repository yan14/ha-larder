"""Rückrufwarnungen: der öffentliche Feed von lebensmittelwarnung.de, abgeglichen mit dem Vorrat.

* Abruf alle 6 Stunden (und kurz nach dem Start), nur Warnungen der letzten 30 Tage, optional ein Bundesland.
* Abgleich mit Dosen, Beuteln und Packungen: Strichcode im Text, oder Marke **und** ein Wort des Inhalts,
  oder (ohne Marke) alle Wörter eines mehrteiligen Inhalts. Ein Treffer ist ein Hinweis, keine Gewissheit:
  die Warnung zeigt, was übereingestimmt hat, und verlinkt auf die Originalmeldung.
* Treffer stehen auf der Startseite (bis "Gelesen") und an der Karte; neue Treffer feuern `larder_recall`.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
import hashlib
import html
import logging
import re
from typing import Any
from xml.etree import ElementTree as ET

import aiohttp
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.util import dt as dt_util

from .const import CONF_CC, DOMAIN, SIGNAL_STOCK_CHANGED
from .entity import kind_of
from .estimate import async_get_estimator
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

# offizieller RSS-Feed (alle Bundesländer, Lebensmittel)
FEED_URL = (
    "https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/"
    "rssnewsfeed_Alle_DE.xml?nn=314268&type=lebensmittel"
)
SOURCE_URL = "https://www.lebensmittelwarnung.de"
EVENT_RECALL = f"{DOMAIN}_recall"
DATA_RECALLS = "recalls"
INTERVAL = timedelta(hours=6)
START_DELAY = 90  # Sekunden nach dem Start
MAX_AGE_DAYS = 30
TIMEOUT = 20
MAX_BYTES = 3_000_000

# Wörter, die in Produktnamen vorkommen, aber nichts über das Produkt sagen
_STOP = {
    "und", "mit", "ohne", "der", "die", "das", "für", "aus", "von", "vom", "zum", "zur", "the", "and", "with",
    "bio", "frisch", "packung", "glas", "dose", "beutel", "stück", "gramm", "sorte", "sorten", "marke", "classic",
}
# Felder der Beschreibung ("<b>Label:</b> Wert"), erkannt am Anfang des Labels
_LABELS = (
    ("product", "produktbezeichnung"),
    ("manufacturer", "hersteller"),
    ("manufacturer", "inverkehrbringer"),
    ("reason", "grund"),
    ("states", "betroffene"),
    ("batch", "chargennummer"),
)


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", (text or "").casefold()).split())


def _plain(fragment: str) -> str:
    """HTML zu Text mit Zeilen."""
    text = re.sub(r"<\s*br\s*/?>|</p>|</li>|</div>", "\n", fragment or "", flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())


def _fields(description: str) -> dict[str, str]:
    """Felder wie "<b>Grund der Meldung:</b> …" aus der Beschreibung lesen."""
    out: dict[str, str] = {}
    for found in re.finditer(r"<b>\s*([^<]+?)\s*</b>(.*?)(?=<b>|$)", description or "", flags=re.S | re.I):
        label = found.group(1).strip().rstrip(":").strip().casefold()
        key = next((k for k, start in _LABELS if label.startswith(start)), None)
        if key is None or key in out:
            continue
        value = _plain(found.group(2)).strip(" :")
        if key == "manufacturer":
            value = re.split(r"[,\n]", value, maxsplit=1)[0]  # Adresse weglassen
        value = " ".join(value.split()).strip(" ,;")
        if value:
            out[key] = value[:400]
    return out


def parse_feed(xml_text: str, today: datetime | None = None, state: str | None = None) -> list[dict[str, Any]]:
    """RSS des Portals lesen: Warnungen der letzten 30 Tage (optional nur für ein Bundesland)."""
    today = today or dt_util.now()
    root = ET.fromstring(xml_text)
    out = []
    for item in root.iter("item"):
        title = " ".join((item.findtext("title") or "").split())
        link = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or link or title).strip()
        description = item.findtext("description") or ""
        text = _plain(description)
        published = None
        try:
            published = parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError):
            published = None
        if published is not None and published.tzinfo is not None and published < today - timedelta(days=MAX_AGE_DAYS):
            continue
        fields = _fields(description)
        states = fields.get("states", "")
        if state and states and state.casefold() not in states.casefold() and "bundesweit" not in states.casefold() and "alle" not in states.casefold():
            continue
        if not title:
            continue
        out.append(
            {
                "id": hashlib.sha1(guid.encode()).hexdigest()[:12],
                "title": title,
                "link": link if link.startswith("https://") else SOURCE_URL,
                "date": published.date().isoformat() if published else None,
                "product": fields.get("product") or title,
                "manufacturer": fields.get("manufacturer"),
                "reason": fields.get("reason"),
                "states": states or None,
                "text": f"{title}\n{text}",
            }
        )
    return out


def _words(text: str) -> list[str]:
    return [w for w in _norm(text).split() if len(w) >= 4 and w not in _STOP and not w.isdigit()]


def _has(haystack: str, phrase: str) -> bool:
    phrase = _norm(phrase)
    return bool(phrase) and re.search(rf"(?<!\w){re.escape(phrase)}", haystack) is not None


def match(warning: dict[str, Any], item: dict[str, Any]) -> str | None:
    """Passt die Warnung zu diesem Eintrag? "barcode", "brand" oder "name" (wie), sonst None."""
    raw = warning["text"]
    haystack = _norm(raw)
    ean = re.sub(r"\D", "", str(item.get("ean") or ""))
    if len(ean) >= 8 and ean in re.findall(r"(?<!\d)\d{8,14}(?!\d)", raw):
        return "barcode"
    words = _words(item["content"])
    if not words:
        return None
    brand = " ".join(str(item.get("brand") or "").split(",")[0].split())
    if len(_norm(brand)) >= 3:
        if _has(haystack, brand) and any(_has(haystack, w) for w in words):
            return "brand"
        return None
    # ohne Marke: nur mehrteilige Inhalte, alle Wörter müssen vorkommen
    if len(words) >= 2 and all(_has(haystack, w) for w in words):
        return "name"
    return None


def stock_items(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Alles mit Inhalt: Dosen, Beutel, Packungen (Inhalt, Marke, Strichcode, Ort)."""
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    out = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get(CONF_CC)
        if not cc:
            continue
        entity_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        state = hass.states.get(entity_id) if entity_id else None
        if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE) or not state.state.strip():
            continue
        comp_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_compartment")
        comp = hass.states.get(comp_id) if comp_id else None
        device = devices.async_get_device(identifiers={(DOMAIN, cc)})
        area = None
        if device is not None and device.area_id:
            found = ar.async_get(hass).async_get_area(device.area_id)
            area = found.name if found else None
        out.append(
            {
                "cc": cc,
                "device_id": device.id if device else None,
                "kind": kind_of(entry),
                "content": state.state.strip(),
                "brand": state.attributes.get("brand"),
                "ean": state.attributes.get("ean"),
                "area": area,
                "compartment": comp.state.strip() if comp and comp.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE) else "",
            }
        )
    return out


class Recalls:
    """Zuletzt abgerufene Warnungen und Treffer im Vorrat (gelesen-Markierung liegt im Vorrat-Speicher)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.warnings: list[dict[str, Any]] = []
        self.fetched: str | None = None
        self.error: str | None = None
        self.notified: set[str] = set()
        self.found: list[dict[str, Any]] = []  # letzte Treffer (auch gelesene), für die Karten
        self._unsubs: list[Any] = []

    @callback
    def async_start(self) -> None:
        if self._unsubs:
            return
        self._unsubs.append(async_track_time_interval(self.hass, self._tick, INTERVAL))
        self._unsubs.append(async_call_later(self.hass, START_DELAY, self._tick))

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs = []

    async def _tick(self, _now: Any = None) -> None:
        await self.async_refresh()

    async def async_refresh(self) -> list[dict[str, Any]]:
        """Feed abrufen (wenn eingeschaltet), neu abgleichen und neue Treffer melden."""
        estimator = await async_get_estimator(self.hass)
        if not getattr(estimator, "recall_check", True):
            self.warnings = []
            return []
        try:
            session = async_get_clientsession(self.hass)
            async with session.get(FEED_URL, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as resp:
                resp.raise_for_status()
                body = await resp.content.read(MAX_BYTES)
            self.warnings = parse_feed(body.decode("utf-8", "replace"), state=getattr(estimator, "recall_state", None))
            self.fetched = dt_util.now().isoformat(timespec="seconds")
            self.error = None
        except (aiohttp.ClientError, TimeoutError, ET.ParseError, UnicodeError) as err:
            _LOGGER.debug("Rückrufwarnungen nicht abrufbar: %s", err)
            self.error = str(err) or type(err).__name__
            return []
        return await self.async_notify()

    def matches(self, read: list[str] | None = None) -> list[dict[str, Any]]:
        """Warnungen mit Treffern im Vorrat neu abgleichen (gelesene weggelassen, wenn `read` übergeben)."""
        items = stock_items(self.hass)
        out = []
        for warning in self.warnings:
            hits = []
            for item in items:
                via = match(warning, item)
                if via:
                    hits.append({**{k: item[k] for k in ("cc", "device_id", "kind", "content", "brand", "area", "compartment")}, "via": via})
            if hits:
                out.append({k: v for k, v in warning.items() if k != "text"} | {"items": hits})
        out.sort(key=lambda w: w.get("date") or "", reverse=True)
        if [w["id"] for w in out] != [w["id"] for w in self.found] or out != self.found:
            self.found = out
            async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)  # Karten zeigen den Hinweis
        return [w for w in out if read is None or w["id"] not in read]

    async def async_notify(self) -> list[dict[str, Any]]:
        from .stock import async_get_stock  # noqa: PLC0415 - vermeidet einen Import-Kreis

        stock = await async_get_stock(self.hass)
        found = self.matches(stock.recalls_read)
        new = [w for w in found if w["id"] not in self.notified and w["id"] not in stock.recalls_notified()]
        for warning in new:
            self.notified.add(warning["id"])
            stock.remember_recall_notified(warning["id"])
            products = sorted({i["content"] for i in warning["items"]})
            places = sorted({" · ".join(p for p in (i["area"], i["compartment"]) if p) for i in warning["items"]} - {""})
            de = (self.hass.config.language or "en").lower().startswith("de")
            message = (
                f"{warning['title']}" + (f" – {warning['reason']}" if warning.get("reason") else "")
                + (f"\nIm Vorrat: {', '.join(products)}" if de else f"\nIn stock: {', '.join(products)}")
                + (f" ({'; '.join(places)})" if places else "")
            )
            self.hass.bus.async_fire(
                EVENT_RECALL,
                {
                    "notification_title": "⚠️ Rückruf" if de else "⚠️ Recall",
                    "message": message,
                    "title": warning["title"],
                    "reason": warning.get("reason"),
                    "link": warning["link"],
                    "date": warning.get("date"),
                    "products": products,
                    "places": places,
                },
            )
        return new

    def for_cc(self, cc: str, read: list[str]) -> dict[str, Any] | None:
        """Ungelesene Warnung für diesen Eintrag (für die Karte)."""
        for warning in self.found:
            if warning["id"] in read:
                continue
            if any(i["cc"] == cc for i in warning["items"]):
                return {k: warning.get(k) for k in ("id", "title", "reason", "link", "date")}
        return None


async def async_get_recalls(hass: HomeAssistant) -> Recalls:
    async def create() -> Recalls:
        return Recalls(hass)

    return await async_singleton(hass, DATA_RECALLS, create)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/recalls"})
@websocket_api.async_response
async def ws_recalls(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from .stock import async_get_stock  # noqa: PLC0415

    recalls = await async_get_recalls(hass)
    stock = await async_get_stock(hass)
    connection.send_result(msg["id"], {"items": recalls.matches(stock.recalls_read), "fetched": recalls.fetched, "error": recalls.error})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/recall_read", vol.Required("recall_id"): str})
@websocket_api.async_response
async def ws_recall_read(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from .stock import async_get_stock  # noqa: PLC0415

    recalls = await async_get_recalls(hass)
    stock = await async_get_stock(hass)
    stock.mark_recall_read(msg["recall_id"])
    connection.send_result(msg["id"], {"items": recalls.matches(stock.recalls_read)})


@callback
def async_setup_recall_websocket(hass: HomeAssistant) -> None:
    if hass.data.setdefault(DOMAIN, {}).get("recall_ws"):
        return
    hass.data[DOMAIN]["recall_ws"] = True
    websocket_api.async_register_command(hass, ws_recalls)
    websocket_api.async_register_command(hass, ws_recall_read)
