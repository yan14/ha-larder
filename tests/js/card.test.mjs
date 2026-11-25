// Tests for the Lovelace card "Larder: expiring soon".
process.env.TZ = "Europe/Berlin";

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "customElements", "Event", "CustomEvent", "navigator"]) {
  try {
    globalThis[key] = dom.window[key];
  } catch {
    /* navigator is read-only in Node */
  }
}

const { expiringRows, LarderCard, LarderShoppingCard, LarderPlaceCard, placeRows } = await import("../../custom_components/larder/frontend/larder-card.js");

const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function makeHass(doses, language = "de") {
  const entities = {};
  const devices = {};
  const states = {};
  for (const d of doses) {
    devices[d.id] = { id: d.id, name: d.name, area_id: d.area || null };
    const text = `text.${d.id}_inhalt`;
    const date = `date.${d.id}_mhd`;
    entities[text] = { entity_id: text, device_id: d.id, platform: "larder" };
    entities[date] = { entity_id: date, device_id: d.id, platform: "larder" };
    states[text] = { entity_id: text, state: d.content ?? "unknown", attributes: { category: d.category, allergen_warning: d.allergens } };
    states[date] = { entity_id: date, state: d.mhd ?? "unknown", attributes: { soon_days: 3 } };
  }
  return { entities, devices, states, areas: { keller: { area_id: "keller", name: "Keller" } }, language };
}

const DOSES = [
  { id: "a", name: "Dose 1", area: "keller", content: "Gulasch", mhd: iso(2), category: "dish" },
  { id: "b", name: "Dose 2", content: "Fisch", mhd: iso(-1), category: "fish", allergens: ["Fisch"] },
  { id: "c", name: "Dose 3", content: "Reis", mhd: iso(30) },
  { id: "d", name: "Dose 4", content: "", mhd: iso(1) },
];

test("expiringRows: only filled containers within the limit, expired first", () => {
  const rows = expiringRows(makeHass(DOSES), {});
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
  assert.equal(rows[1].area, "Keller");
  assert.equal(rows[0].icon, "🐟");
});

test("expiringRows: days, show_expired and area", () => {
  const hass = makeHass(DOSES);
  assert.deepEqual(expiringRows(hass, { days: 40 }).map((r) => r.id), ["b", "a", "c"]);
  assert.deepEqual(expiringRows(hass, { show_expired: false }).map((r) => r.id), ["a"]);
  assert.deepEqual(expiringRows(hass, { area: "keller" }).map((r) => r.id), ["a"]);
});

test("card renders rows, limit and navigates on tap", () => {
  const card = new LarderCard();
  card.setConfig({ limit: 1, title: "Bald weg" });
  card.hass = makeHass(DOSES);
  const root = card.shadowRoot;
  assert.equal(root.querySelector("h2").textContent, "Bald weg");
  const rows = root.querySelectorAll(".row");
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Fisch/);
  assert.match(rows[0].textContent, /seit gestern abgelaufen/);
  assert.match(rows[0].textContent, /⚠ Fisch/);
  assert.match(root.querySelector(".more").textContent, /1 weitere/);
  let navigated = false;
  window.addEventListener("location-changed", () => (navigated = true), { once: true });
  rows[0].click();
  assert.ok(navigated);
  assert.equal(window.location.pathname + window.location.search, "/larder?open=b");
});

test("card: empty state in English and registration in customCards", () => {
  const card = new LarderCard();
  card.setConfig({});
  card.hass = makeHass([], "en");
  assert.match(card.shadowRoot.textContent, /Nothing expires soon/);
  assert.ok(window.customCards.some((c) => c.type === "larder-card"));
  assert.deepEqual(LarderCard.getStubConfig(), { show_expired: true, limit: 8 });
});

const { LarderStockCard } = await import("../../custom_components/larder/frontend/larder-card.js");

test("stock card: below minimum stock with 🛒, bought and opened", async () => {
  const calls = [];
  const hass = {
    language: "de",
    entities: {},
    states: {},
    callWS: async (msg) => {
      calls.push(msg);
      if (msg.type === "larder/stock") return { shopping_list: true, products: [
        { key: "ketchup", name: "Ketchup", count: 1, min: 3, low: true, opened: 1, places: [{ device_id: "p1", area: "Kühlschrank", compartment: "Tür", opened: "2026-11-10" }] },
        { key: "senf", name: "Senf", count: 2, min: 1, low: false, opened: 0, places: [] },
      ] };
      if (msg.type === "larder/bought") return { items: [{ id: "b1", summary: "Mehl (Aurora)" }] };
      return { added: true };
    },
  };
  const card = new LarderStockCard();
  card.setConfig({});
  card.hass = hass;
  await new Promise((r) => setTimeout(r, 10));
  const root = card.shadowRoot;
  assert.deepEqual([...root.querySelectorAll("h3")].map((h) => h.textContent), ["Unter Mindestbestand", "Eingekauft, noch nicht im Vorrat", "Angebrochen"]);
  assert.match(root.textContent, /Ketchup\s*1 von 3/);
  assert.match(root.textContent, /Mehl \(Aurora\)/);
  assert.match(root.textContent, /🔓 Ketchup\s*Kühlschrank · Tür/);
  assert.doesNotMatch(root.textContent, /Senf/);
  root.querySelector("[data-shop]").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.at(-1), { type: "larder/stock_shop", content: "Ketchup" });
  assert.match(card.shadowRoot.querySelector("[data-shop]").textContent, /auf der Liste/);
  card.shadowRoot.querySelectorAll("[data-go]")[2].click();
  assert.equal(window.location.pathname + window.location.search, "/larder?open=p1");
  assert.ok(window.customCards.some((c) => c.type === "larder-stock-card"));
});

// ---------- 5.3: shopping and compartment cards ----------

test("shopping card: open items per list and the button to the shopping mode", async () => {
  const hass = makeHass([]);
  hass.states["todo.einkauf"] = { entity_id: "todo.einkauf", state: "3", attributes: { friendly_name: "Einkauf" } };
  hass.states["todo.drogerie"] = { entity_id: "todo.drogerie", state: "0", attributes: {} };
  hass.callWS = async () => ({ lists: ["todo.einkauf", "todo.drogerie"] });
  const card = new LarderShoppingCard();
  card.setConfig({});
  card.hass = hass;
  await new Promise((r) => setTimeout(r, 0));
  const root = card.shadowRoot;
  assert.equal(root.querySelector('[data-role="shop-count"]').textContent, "3");
  assert.match(root.textContent, /Einkauf3 Einträge offen/);
  root.querySelector('[data-role="shop-go"]').click();
  assert.equal(window.location.pathname + window.location.search, "/larder?view=shopping");
  assert.ok(window.customCards.some((c) => c.type === "larder-shopping-card"));
});

test("compartment card: entries of an area and compartment, −1 for packs", async () => {
  const hass = makeHass([
    { id: "p", name: "Packung 1", area: "keller", content: "Senf", mhd: iso(5) },
    { id: "q", name: "Dose 1", area: "keller", content: "Chili", mhd: iso(-1), category: "dish" },
    { id: "r", name: "Dose 2", content: "Reis" },
  ]);
  for (const [id, comp, kind, count] of [["p", "Regal", "pack", "3"], ["q", "Truhe", "container", "1"]]) {
    hass.entities[`text.${id}_fach`] = { entity_id: `text.${id}_fach`, device_id: id, platform: "larder", translation_key: "compartment" };
    hass.states[`text.${id}_fach`] = { state: comp };
    hass.entities[`number.${id}_anzahl`] = { entity_id: `number.${id}_anzahl`, device_id: id, platform: "larder" };
    hass.states[`number.${id}_anzahl`] = { state: count };
    hass.states[`text.${id}_inhalt`].attributes.kind = kind;
  }
  assert.deepEqual(placeRows(hass, { area: "keller" }).map((r) => r.id), ["q", "p"]);
  assert.deepEqual(placeRows(hass, { area: "keller", compartment: "regal" }).map((r) => [r.id, r.count]), [["p", 3]]);
  const calls = [];
  hass.callWS = async (msg) => calls.push(msg);
  const card = new LarderPlaceCard();
  card.setConfig({ area: "keller", compartment: "Regal" });
  card.hass = hass;
  const root = card.shadowRoot;
  assert.equal(root.querySelector("h2").textContent, "Keller · Regal");
  assert.match(root.querySelector(".row").textContent, /Senf · 3/);
  root.querySelector("[data-take]").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [{ type: "larder/pack_take", device_id: "p", outcome: "eaten" }]);
  const empty = new LarderPlaceCard();
  empty.setConfig({});
  empty.hass = hass;
  assert.match(empty.shadowRoot.textContent, /Bereich/);
});

test("6.0: every card has a visual editor that reports its changes", async () => {
  const mod = await import("../../custom_components/larder/frontend/larder-card.js");
  for (const [cls, type] of [[mod.LarderCard, "larder-card"], [mod.LarderStockCard, "larder-stock-card"], [mod.LarderShoppingCard, "larder-shopping-card"], [mod.LarderPlaceCard, "larder-place-card"]]) {
    const editor = cls.getConfigElement();
    assert.equal(editor.tagName.toLowerCase(), "larder-card-editor");
    editor.setConfig({ type: `custom:${type}` });
    editor.hass = { language: "de", areas: { kitchen: { area_id: "kitchen", name: "Küche" } } };
    assert.ok(editor.querySelectorAll("[data-name]").length >= 1, type);
  }
  const editor = mod.LarderCard.getConfigElement();
  editor.setConfig({ type: "custom:larder-card", limit: 8 });
  editor.hass = { language: "de", areas: { kitchen: { area_id: "kitchen", name: "Küche" } } };
  let changed = null;
  editor.addEventListener("config-changed", (ev) => (changed = ev.detail.config));
  const area = editor.querySelector('[data-name="area"]');
  area.value = "kitchen";
  area.dispatchEvent(new Event("change"));
  assert.deepEqual(changed, { type: "custom:larder-card", limit: 8, area: "kitchen" });
  assert.match(editor.textContent, /Höchstens so viele Einträge/);
});
