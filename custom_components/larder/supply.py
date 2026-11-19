"""Emergency supply check (4.7): the stock compared with the recommendation of the BBK.

The German Federal Office of Civil Protection (BBK) recommends food and drinks for 10 days per person (example
supply of about 2,200 kcal a day) plus a few household and first-aid items. Larder sums what is in stock per group
(packs with a package size such as "400 g" or "6 x 1,5 l", containers with grams or millilitres; portions count
as 300 g) and checks the other items by name. Entries without an amount are counted separately, so the result is a
lower bound. Missing things go onto the right shopping list with 🛒.
"""

from __future__ import annotations

import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from .const import CONF_CC, DOMAIN, KIND_HOUSEHOLD, KIND_MEDICINE, NON_FOOD_KINDS
from .entity import kind_of

# per person and 10 days (BBK example supply): group → (amount, unit)
FOOD_GROUPS: dict[str, tuple[float, str]] = {
    "drinks": (20.0, "l"),
    "grain": (3.5, "kg"),
    "vegetables": (4.0, "kg"),
    "fruit": (2.5, "kg"),
    "dairy": (2.6, "kg"),
    "protein": (1.5, "kg"),
    "fats": (0.357, "kg"),
}
PORTION_KG = 0.3

_FOOD_WORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("drinks", ("wasser", "sprudel", "saft", "schorle", "limo", "eistee", "getränk", "water", "juice", "lemonade", "drink")),
    ("fats", ("öl ", "olivenöl", "rapsöl", "sonnenblumenöl", "butter", "margarine", "schmalz", " oil", "ghee")),
    ("fruit", ("obst", "apfel", "äpfel", "birne", "pfirsich", "ananas", "banane", "mandarin", "orange", "kirsch", "beere",
               "aprikose", "pflaume", "nuss", "nüss", "mandel", "rosine", "dattel", "fruit", "apple", "pear", "peach",
               "pineapple", "banana", "cherr", "berr", "apricot", "nut", "almond", "raisin")),
    ("vegetables", ("gemüse", "bohne", "linse", "erbse", "kichererb", "mais", "tomate", "kohl", "karotte", "möhre", "gurke",
                    "paprika", "zwiebel", "spinat", "champignon", "pilz", "sauerkraut", "spargel", "rote bete",
                    "vegetable", "bean", "lentil", "peas", "chickpea", "corn", "tomato", "cabbage", "carrot", "onion",
                    "mushroom", "beetroot")),
    ("grain", ("nudel", "pasta", "spaghetti", "penne", "fusilli", "reis", "rice", "mehl", "flour", "hafer", "oat", "knäcke",
               "zwieback", "brot", "bread", "kartoffel", "potato", "couscous", "bulgur", "müsli", "muesli", "cornflakes",
               "grieß", "polenta", "cracker")),
    ("protein", ("fleisch", "wurst", "schinken", "salami", "thunfisch", "fisch", "lachs", "hering", "sardine", "eier",
                 "ei ", "meat", "sausage", "ham", "tuna", "fish", "salmon", "egg")),
    ("dairy", ("milch", "käse", "joghurt", "quark", "sahne", "milk", "cheese", "yogurt", "yoghurt", "cream")),
)
_BY_CATEGORY = {
    "produce": "vegetables", "bread": "grain", "dry": "grain", "dairy": "dairy",
    "raw_meat": "protein", "fish": "protein", "deli": "protein", "egg": "protein", "plant": "protein",
}

# other items of the checklist: key → (keywords, kind of the shopping list)
ITEMS: dict[str, tuple[tuple[str, ...], str | None]] = {
    "light": (("kerze", "taschenlampe", "stirnlampe", "laterne", "candle", "flashlight", "torch", "lantern"), KIND_HOUSEHOLD),
    "batteries": (("batterie", "akku", "powerbank", "batter"), KIND_HOUSEHOLD),
    "radio": (("radio",), KIND_HOUSEHOLD),
    "toilet_paper": (("klopapier", "toilettenpapier", "toilet paper"), KIND_HOUSEHOLD),
    "soap": (("seife", "soap", "duschgel", "shower gel"), KIND_HOUSEHOLD),
    "first_aid": (("verband", "pflaster", "erste hilfe", "erste-hilfe", "first aid", "bandage", "plaster"), KIND_MEDICINE),
    "pain": (("ibuprofen", "paracetamol", "aspirin", "schmerz", "pain"), KIND_MEDICINE),
    "thermometer": (("thermometer",), KIND_MEDICINE),
    "disinfectant": (("desinfekt", "disinfect"), KIND_MEDICINE),
}

SHOP_NAMES = {
    "de": {
        "drinks": "Mineralwasser", "grain": "Nudeln", "vegetables": "Gemüsekonserven", "fruit": "Obstkonserven",
        "dairy": "H-Milch", "protein": "Thunfisch in Dosen", "fats": "Speiseöl", "light": "Kerzen",
        "batteries": "Batterien", "radio": "Kurbelradio", "toilet_paper": "Klopapier", "soap": "Seife",
        "first_aid": "Verbandskasten", "pain": "Schmerzmittel", "thermometer": "Fieberthermometer",
        "disinfectant": "Desinfektionsmittel",
    },
    "en": {
        "drinks": "Mineral water", "grain": "Pasta", "vegetables": "Canned vegetables", "fruit": "Canned fruit",
        "dairy": "UHT milk", "protein": "Canned tuna", "fats": "Cooking oil", "light": "Candles",
        "batteries": "Batteries", "radio": "Crank radio", "toilet_paper": "Toilet paper", "soap": "Soap",
        "first_aid": "First aid kit", "pain": "Pain relief", "thermometer": "Thermometer",
        "disinfectant": "Disinfectant",
    },
}

_AMOUNT = re.compile(r"(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b", re.IGNORECASE)


def parse_amount(text: str | None) -> tuple[float, str] | None:
    """"400 g" → (0.4, "kg"), "6 x 1,5 l" → (9.0, "l"); None without an amount."""
    match = _AMOUNT.search(text or "")
    if not match:
        return None
    times = int(match.group(1) or 1)
    value = float(match.group(2).replace(",", ".")) * times
    unit = match.group(3).lower()
    factor = {"kg": (1, "kg"), "g": (0.001, "kg"), "l": (1, "l"), "ml": (0.001, "l"), "cl": (0.01, "l")}[unit]
    return value * factor[0], factor[1]


def food_group(content: str | None) -> str | None:
    """Group of the BBK recommendation for a food (None = none of them, e.g. sweets, spices)."""
    text = f" {' '.join((content or '').casefold().split())} "
    if not text.strip():
        return None
    for group, words in _FOOD_WORDS:
        if any(w in text for w in words):
            return group
    from .shelf_life import category_for  # noqa: PLC0415 - large table, loaded on use

    return _BY_CATEGORY.get(category_for(content or "") or "")


def _state(hass: HomeAssistant, registry: er.EntityRegistry, platform: str, cc: str, key: str) -> str | None:
    entity_id = registry.async_get_entity_id(platform, DOMAIN, f"{cc}_{key}")
    state = hass.states.get(entity_id) if entity_id else None
    if state is None or state.state in ("unknown", "unavailable"):
        return None
    return state.state


def _number(value: str | None) -> float:
    try:
        return max(0.0, float(value or 0))
    except ValueError:
        return 0.0


def _entries(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Everything with content: name, kind and amount (kg or l, None if unknown)."""
    registry = er.async_get(hass)
    out: list[dict[str, Any]] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get(CONF_CC)
        if not cc:
            continue
        content = (_state(hass, registry, "text", cc, "content") or "").strip()
        if not content:
            continue
        kind = kind_of(entry)
        quantity = _number(_state(hass, registry, "number", cc, "portions"))
        unit = _state(hass, registry, "select", cc, "unit")
        entity_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        attrs = hass.states.get(entity_id).attributes if entity_id and hass.states.get(entity_id) else {}
        amount: tuple[float, str] | None = None
        if unit == "grams" and quantity:
            amount = (quantity / 1000, "kg")
        elif unit == "milliliters" and quantity:
            amount = (quantity / 1000, "l")
        elif unit == "portions" and quantity and kind not in NON_FOOD_KINDS and not attrs.get("package"):
            amount = (quantity * PORTION_KG, "kg")
        elif package := parse_amount(attrs.get("package")):
            packs = quantity if unit in ("pieces", "portions") and quantity else 1
            if kind in (KIND_HOUSEHOLD, KIND_MEDICINE):
                packs = max(1, packs / max(1, int(attrs.get("pack_size") or 1)))
            amount = (package[0] * packs, package[1])
        out.append({"content": content, "kind": kind, "amount": amount})
    return out


def supply_report(hass: HomeAssistant, persons: int, days: int, language: str = "en") -> dict[str, Any]:
    """Groups with need, stock and share; checklist items present or missing."""
    factor = persons * days / 10
    sums = {g: 0.0 for g in FOOD_GROUPS}
    unknown = {g: 0 for g in FOOD_GROUPS}
    found: dict[str, list[str]] = {k: [] for k in ITEMS}
    for item in _entries(hass):
        text = f" {item['content'].casefold()} "
        if item["kind"] not in NON_FOOD_KINDS:
            group = food_group(item["content"])
            if group:
                amount = item["amount"]
                if amount is None:
                    unknown[group] += 1
                else:
                    # litres of food (milk, oil) count as kilograms and the other way round
                    sums[group] += amount[0]
        for key, (words, _kind) in ITEMS.items():
            if any(w in text for w in words) and item["content"] not in found[key]:
                found[key].append(item["content"])
    groups = []
    for key, (per, unit) in FOOD_GROUPS.items():
        need = round(per * factor, 2)
        have = round(sums[key], 2)
        groups.append({
            "key": key, "unit": unit, "need": need, "have": have, "unknown": unknown[key],
            "share": min(1.0, round(have / need, 2)) if need else 1.0,
        })
    # how long the drinks and the food last (the weakest group decides)
    food_share = min(g["share"] for g in groups if g["key"] != "drinks")
    drink_share = next(g["share"] for g in groups if g["key"] == "drinks")
    names = SHOP_NAMES["de" if language.lower().startswith("de") else "en"]
    return {
        "persons": persons,
        "days": days,
        "groups": groups,
        "items": [{"key": k, "present": bool(found[k]), "names": found[k][:3]} for k in ITEMS],
        "days_covered": int(days * min(food_share, drink_share)),
        "shop_names": names,
    }


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/supply"})
@websocket_api.async_response
async def ws_supply(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Emergency supply check for the household size of the settings."""
    from .estimate import async_get_estimator  # noqa: PLC0415

    estimator = await async_get_estimator(hass)
    report = supply_report(hass, int(estimator.supply_persons), int(estimator.supply_days), hass.config.language or "en")
    connection.send_result(msg["id"], {"enabled": bool(estimator.supply_check), **report})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/supply_shop", vol.Required("key"): vol.In([*FOOD_GROUPS, *ITEMS])})
@websocket_api.async_response
async def ws_supply_shop(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Put a missing group or item onto the right shopping list (food, household or pharmacy)."""
    from .shopping import async_add_to_shopping_list, default_list  # noqa: PLC0415

    key = msg["key"]
    kind = ITEMS[key][1] if key in ITEMS else None
    todo = default_list(hass, kind)
    if not todo:
        connection.send_error(msg["id"], "no_list", "No shopping list chosen")
        return
    name = SHOP_NAMES["de" if (hass.config.language or "en").lower().startswith("de") else "en"][key]
    added = await async_add_to_shopping_list(hass, todo, name)
    connection.send_result(msg["id"], {"added": added, "item": name, "list": todo})


def async_setup_supply_websocket(hass: HomeAssistant) -> None:
    if hass.data.setdefault(DOMAIN, {}).get("supply_ws"):
        return
    hass.data[DOMAIN]["supply_ws"] = True
    websocket_api.async_register_command(hass, ws_supply)
    websocket_api.async_register_command(hass, ws_supply_shop)
