// Tests für die Lovelace-Karte "Larder: läuft bald ab".
process.env.TZ = "Europe/Berlin";

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "customElements", "Event", "CustomEvent", "navigator"]) {
  try {
    globalThis[key] = dom.window[key];
  } catch {
    /* navigator ist in Node schreibgeschützt */
  }
}

const { expiringRows, LarderCard } = await import("../../custom_components/larder/frontend/larder-card.js");

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

test("expiringRows: nur befüllte Dosen innerhalb der Grenze, abgelaufene zuerst", () => {
  const rows = expiringRows(makeHass(DOSES), {});
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
  assert.equal(rows[1].area, "Keller");
  assert.equal(rows[0].icon, "🐟");
});

test("expiringRows: days, show_expired und area", () => {
  const hass = makeHass(DOSES);
  assert.deepEqual(expiringRows(hass, { days: 40 }).map((r) => r.id), ["b", "a", "c"]);
  assert.deepEqual(expiringRows(hass, { show_expired: false }).map((r) => r.id), ["a"]);
  assert.deepEqual(expiringRows(hass, { area: "keller" }).map((r) => r.id), ["a"]);
});

test("Karte rendert Zeilen, Limit und navigiert beim Antippen", () => {
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

test("Karte: leerer Zustand auf Englisch und Registrierung in customCards", () => {
  const card = new LarderCard();
  card.setConfig({});
  card.hass = makeHass([], "en");
  assert.match(card.shadowRoot.textContent, /Nothing expires soon/);
  assert.ok(window.customCards.some((c) => c.type === "larder-card"));
  assert.deepEqual(LarderCard.getStubConfig(), { show_expired: true, limit: 8 });
});
