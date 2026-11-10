// Tests für das Dosen-Panel (läuft in jsdom, ohne Home Assistant).
process.env.TZ = "Europe/Berlin";

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const key of ["window", "document", "HTMLElement", "customElements", "Event", "CustomEvent"]) {
  globalThis[key] = dom.window[key];
}

const { collectDevices, daysUntil, toLocalInputValue } = await import(
  "../../custom_components/zwilling_storage/frontend/zwilling-storage-panel.js"
);

const D = "zwilling_storage";

/** Baut ein hass-Objekt mit den angegebenen Dosen. */
function makeHass(doses, { areas = {}, language = "de", stateOverrides = {} } = {}) {
  const entities = {};
  const devices = {};
  const states = {};
  for (const d of doses) {
    devices[d.id] = { id: d.id, name: d.name, name_by_user: d.nameByUser || null, area_id: d.area || null };
    const ids = {
      text: `text.${d.id}_inhalt`,
      date: `date.${d.id}_mhd`,
      datetime: `datetime.${d.id}_befuellt`,
      button: `button.${d.id}_leeren`,
      image: `image.${d.id}_qr`,
    };
    for (const eid of Object.values(ids)) {
      entities[eid] = { entity_id: eid, device_id: d.id, platform: D, area_id: d.entityArea || null };
    }
    states[ids.text] = { entity_id: ids.text, state: d.content ?? "unknown", attributes: {} };
    states[ids.date] = { entity_id: ids.date, state: d.mhd ?? "unknown", attributes: {} };
    states[ids.datetime] = { entity_id: ids.datetime, state: d.filled ?? "unknown", attributes: {} };
    states[ids.button] = { entity_id: ids.button, state: "unknown", attributes: {} };
    states[ids.image] = {
      entity_id: ids.image,
      state: "2026-11-10T06:00:00+00:00",
      attributes: { entity_picture: `/api/image_proxy/${ids.image}?token=abc` },
    };
  }
  // Fremde Entität, darf nie auftauchen
  entities["light.foreign"] = { entity_id: "light.foreign", device_id: "foreign", platform: "hue" };
  devices.foreign = { id: "foreign", name: "Lampe", area_id: "kitchen" };
  Object.assign(states, stateOverrides);
  const calls = [];
  return {
    entities,
    devices,
    areas,
    states,
    language,
    calls,
    callService: (domain, service, data) => calls.push({ domain, service, data }),
    hassUrl: (p) => `http://ha.local:8123${p}`,
  };
}

const AREAS = {
  kitchen: { area_id: "kitchen", name: "Küche" },
  cellar: { area_id: "cellar", name: "Keller" },
};

function iso(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mount(hass) {
  const el = document.createElement("zwilling-storage-panel");
  document.body.appendChild(el);
  el.hass = hass;
  return el;
}

const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
const cardNames = (el) => $$(el, ".card .name").map((n) => n.textContent);
const areaHeadings = (el) => $$(el, "h2.area").map((n) => n.textContent);

test.beforeEach(() => {
  document.body.innerHTML = "";
});

test("collectDevices: nur Zwilling-Geräte, sortiert nach Bereich, dann Name; ohne Bereich zuletzt", () => {
  const hass = makeHass(
    [
      { id: "d1", name: "Dose B", area: "kitchen" },
      { id: "d2", name: "Dose A", area: "kitchen" },
      { id: "d3", name: "Dose 10", area: "cellar" },
      { id: "d4", name: "Dose 2", area: "cellar" },
      { id: "d5", name: "Ohne Bereich" },
    ],
    { areas: AREAS },
  );
  const out = collectDevices(hass);
  assert.deepEqual(
    out.map((d) => [d.areaName, d.name]),
    [
      ["Keller", "Dose 2"],
      ["Keller", "Dose 10"], // natürliche Sortierung
      ["Küche", "Dose A"],
      ["Küche", "Dose B"],
      [null, "Ohne Bereich"],
    ],
  );
  assert.ok(out.every((d) => d.deviceId !== "foreign"));
  assert.deepEqual(Object.keys(out[0].entities).sort(), ["button", "date", "datetime", "image", "text"]);
});

test("collectDevices: Anzeigename des Nutzers und Bereich der Entität als Rückfall", () => {
  const hass = makeHass(
    [
      { id: "d1", name: "Dose X", nameByUser: "Suppendose", area: null, entityArea: "cellar" },
    ],
    { areas: AREAS },
  );
  const [dev] = collectDevices(hass);
  assert.equal(dev.name, "Suppendose");
  assert.equal(dev.areaName, "Keller");
});

test("daysUntil und toLocalInputValue", () => {
  const now = new Date(2026, 10, 10, 15, 0);
  assert.equal(daysUntil("2026-11-10", now), 0);
  assert.equal(daysUntil("2026-11-09", now), -1);
  assert.equal(daysUntil("2026-11-13", now), 3);
  assert.equal(daysUntil("unknown", now), null);
  // 10:00 UTC = 11:00 in Berlin (Winterzeit)
  assert.equal(toLocalInputValue("2026-11-09T10:00:00+00:00"), "2026-11-09T11:00");
  assert.equal(toLocalInputValue("kaputt"), "");
});

test("Panel zeigt Bereich, MHD, Inhalt, Eingelagert am und Leeren-Button je Dose", () => {
  const hass = makeHass(
    [
      {
        id: "d1",
        name: "Dose 34OL",
        area: "kitchen",
        content: "Gulasch",
        mhd: iso(10),
        filled: "2026-11-09T10:00:00+00:00",
      },
    ],
    { areas: AREAS },
  );
  const el = mount(hass);
  assert.deepEqual(areaHeadings(el), ["Küche"]);
  assert.deepEqual(cardNames(el), ["Dose 34OL"]);
  assert.match($(el, ".arealine").textContent, /Bereich: Küche/);
  assert.equal($(el, '[data-f="content"]').value, "Gulasch");
  assert.equal($(el, '[data-f="bestBefore"]').value, iso(10));
  assert.equal($(el, '[data-f="filledAt"]').value, "2026-11-09T11:00");
  assert.equal($(el, "button.empty").textContent, "Behälter leeren");
  assert.equal($(el, '[data-l="bestBefore"]').textContent, "MHD");
  assert.equal($(el, '[data-l="filledAt"]').textContent, "Eingelagert am");
  assert.equal($(el, ".count").textContent, "1 Dose");
  const qr = $(el, "img.qr");
  assert.equal(qr.src, "http://ha.local:8123/api/image_proxy/image.d1_qr?token=abc");
  assert.ok(qr.classList.contains("visible"));
});

test("MHD-Hinweise: abgelaufen, bald, unkritisch", () => {
  const hass = makeHass(
    [
      { id: "d1", name: "A", mhd: iso(-1) },
      { id: "d2", name: "B", mhd: iso(0) },
      { id: "d3", name: "C", mhd: iso(2) },
      { id: "d4", name: "D", mhd: iso(20) },
      { id: "d5", name: "E" },
    ],
    { areas: AREAS },
  );
  const el = mount(hass);
  const badges = $$(el, ".card").map((c) => {
    const b = c.querySelector(".badge");
    return [c.querySelector(".name").textContent, b.className.replace("badge", "").trim(), b.textContent];
  });
  assert.deepEqual(badges, [
    ["A", "expired", "abgelaufen"],
    ["B", "soon", "läuft heute ab"],
    ["C", "soon", "noch 2 Tage"],
    ["D", "", ""],
    ["E", "", ""],
  ]);
});

test("Neue Dose erscheint live, entfernte verschwindet, Bereichsänderung wird übernommen", () => {
  const el = mount(makeHass([{ id: "d1", name: "Dose 1", area: "kitchen" }], { areas: AREAS }));
  assert.deepEqual(cardNames(el), ["Dose 1"]);
  const firstCard = $(el, ".card");

  // Neue Dose im Keller: neue Registry-Objekte, wie sie das Frontend liefert
  el.hass = makeHass(
    [
      { id: "d1", name: "Dose 1", area: "kitchen" },
      { id: "d2", name: "Dose 2", area: "cellar" },
    ],
    { areas: AREAS },
  );
  assert.deepEqual(areaHeadings(el), ["Keller", "Küche"]);
  assert.deepEqual(cardNames(el), ["Dose 2", "Dose 1"]);
  assert.equal($(el, ".count").textContent, "2 Dosen");
  // vorhandene Karte wurde wiederverwendet (kein Neuaufbau, Fokus bleibt erhalten)
  assert.ok($$(el, ".card").includes(firstCard));

  // Dose 1 wird in den Keller verschoben
  el.hass = makeHass(
    [
      { id: "d1", name: "Dose 1", area: "cellar" },
      { id: "d2", name: "Dose 2", area: "cellar" },
    ],
    { areas: AREAS },
  );
  assert.deepEqual(areaHeadings(el), ["Keller"]);
  assert.deepEqual(cardNames(el), ["Dose 1", "Dose 2"]);

  // Dose 2 wird gelöscht
  el.hass = makeHass([{ id: "d1", name: "Dose 1", area: "cellar" }], { areas: AREAS });
  assert.deepEqual(cardNames(el), ["Dose 1"]);
});

test("Zustandsänderungen werden live übernommen, Eingabefeld im Fokus bleibt unberührt", () => {
  const hass1 = makeHass([{ id: "d1", name: "Dose 1", content: "Suppe" }], { areas: AREAS });
  const el = mount(hass1);
  const input = $(el, '[data-f="content"]');
  assert.equal(input.value, "Suppe");

  // gleiche Registries, nur neue Zustände (typischer hass-Update)
  const hass2 = { ...hass1, states: { ...hass1.states } };
  hass2.states["text.d1_inhalt"] = { entity_id: "text.d1_inhalt", state: "Gulasch", attributes: {} };
  el.hass = hass2;
  assert.equal(input.value, "Gulasch");

  // Nutzer tippt: Update darf das Feld nicht überschreiben
  input.focus();
  assert.equal(el.shadowRoot.activeElement, input);
  input.value = "Eintopf (wird getippt)";
  const hass3 = { ...hass2, states: { ...hass2.states } };
  hass3.states["text.d1_inhalt"] = { entity_id: "text.d1_inhalt", state: "Fremdwert", attributes: {} };
  el.hass = hass3;
  assert.equal(input.value, "Eintopf (wird getippt)");

  // nach dem Verlassen des Feldes zieht der Wert wieder nach
  input.blur();
  el.hass = { ...hass3, states: { ...hass3.states } };
  assert.equal(input.value, "Fremdwert");
});

test("Eingaben und Buttons rufen die richtigen Dienste auf", () => {
  const hass = makeHass([{ id: "d1", name: "Dose 1", content: "Suppe" }], { areas: AREAS });
  const el = mount(hass);

  const content = $(el, '[data-f="content"]');
  content.value = "Linseneintopf";
  content.dispatchEvent(new dom.window.Event("change"));

  const mhd = $(el, '[data-f="bestBefore"]');
  mhd.value = "2026-12-24";
  mhd.dispatchEvent(new dom.window.Event("change"));

  const filled = $(el, '[data-f="filledAt"]');
  filled.value = "2026-11-09T11:00"; // lokale Zeit Berlin
  filled.dispatchEvent(new dom.window.Event("change"));

  $(el, "button.now").click();
  $(el, "button.empty").click();

  assert.deepEqual(hass.calls[0], {
    domain: "text",
    service: "set_value",
    data: { entity_id: "text.d1_inhalt", value: "Linseneintopf" },
  });
  assert.deepEqual(hass.calls[1], {
    domain: "date",
    service: "set_value",
    data: { entity_id: "date.d1_mhd", date: "2026-12-24" },
  });
  assert.deepEqual(hass.calls[2], {
    domain: "datetime",
    service: "set_value",
    data: { entity_id: "datetime.d1_befuellt", datetime: "2026-11-09T10:00:00.000Z" },
  });
  assert.equal(hass.calls[3].service, "set_value");
  assert.equal(hass.calls[3].data.entity_id, "datetime.d1_befuellt");
  assert.ok(Math.abs(new Date(hass.calls[3].data.datetime) - Date.now()) < 5000);
  assert.deepEqual(hass.calls[4], {
    domain: "button",
    service: "press",
    data: { entity_id: "button.d1_leeren" },
  });
  assert.equal(hass.calls.length, 5);
});

test("Leere MHD-Eingabe löst keinen Dienst aus", () => {
  const hass = makeHass([{ id: "d1", name: "Dose 1", mhd: "2026-12-24" }], { areas: AREAS });
  const el = mount(hass);
  const mhd = $(el, '[data-f="bestBefore"]');
  mhd.value = "";
  mhd.dispatchEvent(new dom.window.Event("change"));
  assert.equal(hass.calls.length, 0);
});

test("Nicht verfügbare Entitäten deaktivieren die Bedienelemente", () => {
  const hass = makeHass([{ id: "d1", name: "Dose 1" }], {
    areas: AREAS,
    stateOverrides: {
      "text.d1_inhalt": { entity_id: "text.d1_inhalt", state: "unavailable", attributes: {} },
      "button.d1_leeren": { entity_id: "button.d1_leeren", state: "unavailable", attributes: {} },
    },
  });
  const el = mount(hass);
  assert.equal($(el, '[data-f="content"]').disabled, true);
  assert.equal($(el, "button.empty").disabled, true);
  assert.equal($(el, '[data-f="bestBefore"]').disabled, false);
});

test("Gerät öffnen und Seitenmenü", () => {
  const el = mount(makeHass([{ id: "abc123", name: "Dose 1" }], { areas: AREAS }));
  const events = [];
  window.addEventListener("location-changed", () => events.push(window.location.pathname));
  $(el, "a.open").click();
  assert.deepEqual(events, ["/config/devices/device/abc123"]);

  let toggled = 0;
  document.body.addEventListener("hass-toggle-menu", () => toggled++);
  el.narrow = true;
  assert.ok(el.hasAttribute("narrow"));
  $(el, "#menu").click();
  assert.equal(toggled, 1);
  el.narrow = false;
  assert.ok(!el.hasAttribute("narrow"));
});

test("Ohne Dosen: Hinweis mit Link zur Integration", () => {
  const el = mount(makeHass([], { areas: AREAS }));
  assert.equal($$(el, ".card").length, 0);
  assert.match($(el, ".none h2").textContent, /Noch keine Dosen/);
  assert.equal($(el, ".count").textContent, "0 Dosen");
  const events = [];
  window.addEventListener("location-changed", () => events.push(window.location.pathname));
  $(el, ".none a").click();
  assert.deepEqual(events, ["/config/integrations/integration/zwilling_storage"]);
});

test("Englische Oberfläche", () => {
  const el = mount(
    makeHass([{ id: "d1", name: "Box 1", area: "kitchen", mhd: iso(2) }], { areas: AREAS, language: "en" }),
  );
  assert.equal($(el, '[data-l="filledAt"]').textContent, "Stored on");
  assert.equal($(el, "button.empty").textContent, "Empty container");
  assert.match($(el, ".arealine").textContent, /Area: Küche/);
  assert.equal($(el, ".badge").textContent, "2 days left");
  assert.equal($(el, ".count").textContent, "1 container");
});

test("Dose ohne Bereich bekommt 'Kein Bereich'", () => {
  const el = mount(makeHass([{ id: "d1", name: "Dose 1" }], { areas: AREAS }));
  assert.deepEqual(areaHeadings(el), ["Kein Bereich"]);
  assert.match($(el, ".arealine").textContent, /Bereich: Kein Bereich/);
});
