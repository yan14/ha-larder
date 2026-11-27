"""Data care (4.12): gaps in the data that make statistics and forecasts less accurate.

Once a month the start page shows a short hint (dismissable per device), ⋮ → 🧹 Data care shows it any time:
packs without a price (and no remembered price), food packs without a best-before date, opened packs without a
date, entries without an area or compartment, and products that are used regularly but have no minimum stock.
Every entry opens its card, where the gap is filled in.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN, KIND_HOUSEHOLD, KIND_MEDICINE, KIND_PACK
from .stock import async_get_stock, pack_entries, product_key

MAX_LISTED = 20
MIN_TAKES = 2  # used at least this often (in the remembered takes) → a minimum stock is worth it


def data_gaps(hass: HomeAssistant, stock) -> dict[str, list[dict[str, Any]]]:
    """Gaps per kind: {"no_price": [...], "no_date": [...], "opened_no_date": [...], "no_place": [...], "no_min": [...]}."""
    gaps: dict[str, list[dict[str, Any]]] = {k: [] for k in ("no_price", "no_date", "opened_no_date", "no_place", "no_min", "no_table")}
    seen_price: set[str] = set()
    takes: dict[str, int] = {}
    for take in stock.takes:
        takes[take.get("key")] = takes.get(take.get("key"), 0) + int(take.get("n") or 1)
    seen_min: set[str] = set()
    for item in pack_entries(hass):
        key = product_key(item["content"])
        row = {"device_id": item["device_id"], "content": item["content"], "kind": item["kind"],
               "place": " · ".join(p for p in (item["area"], item["compartment"]) if p),
               "area_id": item["area_id"], "compartment": item["compartment"]}
        if not item["price"] and key not in stock.prices and key not in seen_price and item["kind"] != KIND_MEDICINE:
            seen_price.add(key)
            gaps["no_price"].append(row)
        if not item["best_before"]:
            if item["opened"]:
                gaps["opened_no_date"].append(row)
            elif item["kind"] == KIND_PACK:
                gaps["no_date"].append(row)
        if not item["area_id"] or not item["compartment"]:
            gaps["no_place"].append(row)
        if (
            item["kind"] in (KIND_PACK, KIND_HOUSEHOLD)
            and key not in seen_min
            and takes.get(key, 0) >= MIN_TAKES
            and not stock.minimum(item["content"])
        ):
            seen_min.add(key)
            gaps["no_min"].append(row)
    # 6.3 (#174): food the shelf-life table does not recognise – one tap picks the row
    from .table_rows import unknown_products  # noqa: PLC0415 - avoids an import cycle

    gaps["no_table"] = unknown_products(hass, stock)
    for rows in gaps.values():
        rows.sort(key=lambda r: r["content"].casefold())
    return gaps


def by_product(gaps: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """6.7 (#197): one line per product with everything that is missing (instead of up to three groups).

    `ids` holds the entries per gap, so one dialog fills in exactly those (e.g. the date of the packs without one).
    """
    products: dict[str, dict[str, Any]] = {}
    for gap, rows in gaps.items():
        for row in rows:
            key = product_key(row["content"])
            product = products.setdefault(
                key,
                {"content": row["content"], "kind": row.get("kind"), "device_id": row.get("device_id"),
                 "place": row.get("place", ""), "area_id": row.get("area_id"), "compartment": row.get("compartment", ""),
                 "missing": [], "ids": {}},
            )
            if gap not in product["missing"]:
                product["missing"].append(gap)
            if row.get("device_id"):
                product["ids"].setdefault(gap, [])
                if row["device_id"] not in product["ids"][gap]:
                    product["ids"][gap].append(row["device_id"])
            if not product["device_id"] and row.get("device_id"):
                product["device_id"] = row["device_id"]
    order = {gap: i for i, gap in enumerate(("opened_no_date", "no_date", "no_price", "no_place", "no_min", "no_table"))}
    for product in products.values():
        product["missing"].sort(key=lambda g: order.get(g, 99))
    return sorted(products.values(), key=lambda p: (-len(p["missing"]), p["content"].casefold()))


MAX_PRODUCTS = 40


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/data_gaps"})
@websocket_api.async_response
async def ws_data_gaps(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    gaps = data_gaps(hass, await async_get_stock(hass))
    counts = {k: len(v) for k, v in gaps.items()}
    if connection.user is not None and connection.user.is_admin:
        # 6.3 (#175): your own shelf life from the history (estimates suggestions) – found here, not only in Estimates
        from .learning import async_get_learning  # noqa: PLC0415

        counts["history"] = len(await (await async_get_learning(hass)).async_suggestions())
    products = by_product(gaps)
    counts["products"] = len(products)
    connection.send_result(
        msg["id"],
        {"counts": counts, "gaps": {k: v[:MAX_LISTED] for k, v in gaps.items()}, "products": products[:MAX_PRODUCTS]},
    )


def async_setup_datacare_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("datacare_ws"):
        return
    domain_data["datacare_ws"] = True
    websocket_api.async_register_command(hass, ws_data_gaps)
