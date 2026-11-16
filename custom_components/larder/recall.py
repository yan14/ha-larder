"""Recall warnings: the public feed of lebensmittelwarnung.de, matched against the stock.

* Fetched every 6 hours (and shortly after start), only warnings of the last 30 days, optionally one federal state.
* Food is matched against the food feed. With household items (4.1) the feed of all product types is fetched
  too; household items are matched only against its other warnings (cosmetics, consumer goods, …), so food
  gets no new false matches.
* Matched against containers, bags and packs: barcode in the text, or brand **and** a word of the content,
  or (without a brand) all words of a multi-word content. A match is a hint, not a certainty:
  the warning shows what matched and links to the original notice.
* Matches are shown on the start page (until "Read") and on the card; new matches fire `larder_recall`.
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

from .const import CONF_CC, DOMAIN, KIND_HOUSEHOLD, SIGNAL_STOCK_CHANGED
from .entity import kind_of
from .estimate import async_get_estimator
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

# official RSS feeds (all federal states): food, and all product types (food, cosmetics, consumer goods, …)
FEED_URL = (
    "https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/"
    "rssnewsfeed_Alle_DE.xml?nn=314268&type=lebensmittel"
)
FEED_ALL_URL = (
    "https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/"
    "rssnewsfeed_Alle_DE.xml?nn=314268"
)
SOURCE_URL = "https://www.lebensmittelwarnung.de"
EVENT_RECALL = f"{DOMAIN}_recall"
DATA_RECALLS = "recalls"
INTERVAL = timedelta(hours=6)
START_DELAY = 90  # seconds after start
MAX_AGE_DAYS = 30
TIMEOUT = 20
MAX_BYTES = 3_000_000

# words that occur in product names but say nothing about the product
_STOP = {
    "und", "mit", "ohne", "der", "die", "das", "für", "aus", "von", "vom", "zum", "zur", "the", "and", "with",
    "bio", "frisch", "packung", "glas", "dose", "beutel", "stück", "gramm", "sorte", "sorten", "marke", "classic",
}
# fields of the description ("<b>Label:</b> value"), recognised by the start of the label
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
    """HTML to text with lines."""
    text = re.sub(r"<\s*br\s*/?>|</p>|</li>|</div>", "\n", fragment or "", flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())


def _fields(description: str) -> dict[str, str]:
    """Read fields like "<b>Grund der Meldung:</b> …" from the description."""
    out: dict[str, str] = {}
    for found in re.finditer(r"<b>\s*([^<]+?)\s*</b>(.*?)(?=<b>|$)", description or "", flags=re.S | re.I):
        label = found.group(1).strip().rstrip(":").strip().casefold()
        key = next((k for k, start in _LABELS if label.startswith(start)), None)
        if key is None or key in out:
            continue
        value = _plain(found.group(2)).strip(" :")
        if key == "manufacturer":
            value = re.split(r"[,\n]", value, maxsplit=1)[0]  # leave out the address
        value = " ".join(value.split()).strip(" ,;")
        if value:
            out[key] = value[:400]
    return out


def parse_feed(xml_text: str, today: datetime | None = None, state: str | None = None) -> list[dict[str, Any]]:
    """Read the portal's RSS: warnings of the last 30 days (optionally only for one federal state)."""
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
    """Does the warning match this entry? "barcode", "brand" or "name" (how), else None."""
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
    # without a brand: only multi-word contents, all words must occur
    if len(words) >= 2 and all(_has(haystack, w) for w in words):
        return "name"
    return None


def stock_items(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Everything with content: containers, bags, packs (content, brand, barcode, place)."""
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
    """Warnings fetched last and matches in the stock (the read marker is kept in the stock store)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.warnings: list[dict[str, Any]] = []
        self.fetched: str | None = None
        self.error: str | None = None
        self.notified: set[str] = set()
        self.found: list[dict[str, Any]] = []  # last matches (also read ones), for the cards
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
        """Fetch the feed (if switched on), match again and report new matches."""
        estimator = await async_get_estimator(self.hass)
        if not getattr(estimator, "recall_check", True):
            self.warnings = []
            return []
        state = getattr(estimator, "recall_state", None)
        household = any(i["kind"] == KIND_HOUSEHOLD for i in stock_items(self.hass))
        try:
            food = parse_feed(await self._async_fetch(FEED_URL), state=state)
            for warning in food:
                warning["scope"] = "food"
            other: list[dict[str, Any]] = []
            if household:
                food_ids = {w["id"] for w in food}
                other = [w | {"scope": "other"} for w in parse_feed(await self._async_fetch(FEED_ALL_URL), state=state) if w["id"] not in food_ids]
            self.warnings = food + other
            self.fetched = dt_util.now().isoformat(timespec="seconds")
            self.error = None
        except (aiohttp.ClientError, TimeoutError, ET.ParseError, UnicodeError) as err:
            _LOGGER.debug("Rückrufwarnungen nicht abrufbar: %s", err)
            self.error = str(err) or type(err).__name__
            return []
        return await self.async_notify()

    async def _async_fetch(self, url: str) -> str:
        session = async_get_clientsession(self.hass)
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as resp:
            resp.raise_for_status()
            body = await resp.content.read(MAX_BYTES)
        return body.decode("utf-8", "replace")

    def matches(self, read: list[str] | None = None) -> list[dict[str, Any]]:
        """Match warnings against the stock again (read ones left out if `read` is given)."""
        items = stock_items(self.hass)
        out = []
        for warning in self.warnings:
            hits = []
            for item in items:
                # food only against food warnings, household items only against the other product types
                if (item["kind"] == KIND_HOUSEHOLD) != (warning.get("scope", "food") == "other"):
                    continue
                via = match(warning, item)
                if via:
                    hits.append({**{k: item[k] for k in ("cc", "device_id", "kind", "content", "brand", "area", "compartment")}, "via": via})
            if hits:
                out.append({k: v for k, v in warning.items() if k not in ("text", "scope")} | {"items": hits})
        out.sort(key=lambda w: w.get("date") or "", reverse=True)
        if [w["id"] for w in out] != [w["id"] for w in self.found] or out != self.found:
            self.found = out
            async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)  # cards show the hint
        return [w for w in out if read is None or w["id"] not in read]

    async def async_notify(self) -> list[dict[str, Any]]:
        from .stock import async_get_stock  # noqa: PLC0415 - avoids an import cycle

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
        """Unread warning for this entry (for the card)."""
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
