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

const { STRINGS, listAreas, collectDevices, daysUntil, toLocalInputValue, sourceLabel, arrangeDevices, addDays } = await import(
  "../../custom_components/larder/frontend/larder-panel.js"
);

const D = "larder";

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
      switch: `switch.${d.id}_vacuum`,
      number: `number.${d.id}_portionen`,
      select: `select.${d.id}_einheit`,
      shopping: `switch.${d.id}_einkaufsliste`,
      flexible: `switch.${d.id}_variabler_lagerort`,
      homeArea: `select.${d.id}_lagerort_nach_dem_leeren`,
    };
    for (const eid of Object.values(ids)) {
      entities[eid] = { entity_id: eid, device_id: d.id, platform: D, area_id: d.entityArea || null };
    }
    states[ids.flexible] = { entity_id: ids.flexible, state: d.flexible ?? "off", attributes: {} };
    states[ids.homeArea] = {
      entity_id: ids.homeArea,
      state: d.home ?? "none",
      attributes: { options: ["none", "Keller", "Küche"], area_id: null },
    };
    states[ids.text] = { entity_id: ids.text, state: d.content ?? "unknown", attributes: d.product || {} };
    states[ids.date] = { entity_id: ids.date, state: d.mhd ?? "unknown", attributes: { estimates: !!d.ai } };
    states[ids.switch] = { entity_id: ids.switch, state: d.vacuum ?? "on", attributes: {} };
    states[ids.shopping] = {
      entity_id: ids.shopping,
      state: d.shopping ?? "off",
      attributes: { list: d.shoppingList ?? null },
    };
    states[ids.number] = { entity_id: ids.number, state: String(d.portions ?? 0), attributes: {} };
    states[ids.select] = {
      entity_id: ids.select,
      state: d.unit ?? "portions",
      attributes: { options: ["portions", "pieces", "slices", "grams", "milliliters"] },
    };
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
  const el = document.createElement("larder-panel");
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
  dom.window.localStorage.clear();
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
  assert.deepEqual(Object.keys(out[0].entities).sort(), ["button", "date", "datetime", "flexible", "homeArea", "image", "number", "select", "shopping", "switch", "text"]);
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

test("Eingaben und Buttons rufen die richtigen Dienste auf", async () => {
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
  // erst die Frage, dann leeren; ohne WebSocket wird einfach der Button gedrückt
  assert.equal($(el, ".outcomerow").hidden, false);
  assert.equal(hass.calls.length, 4);
  $(el, "button.eaten").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal($(el, ".outcomerow").hidden, true);

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

test("Leere MHD-Eingabe leert das MHD über den Service (date.set_value kann das nicht)", () => {
  const hass = makeHass([{ id: "d1", name: "Dose 1", mhd: "2026-12-24" }], { areas: AREAS });
  const el = mount(hass);
  const mhd = $(el, '[data-f="bestBefore"]');
  mhd.value = "";
  mhd.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(hass.calls, [{ domain: D, service: "clear_best_before", data: { entity_id: "date.d1_mhd" } }]);
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
  assert.deepEqual(events, ["/config/integrations/integration/larder"]);
});

test("Englische Oberfläche", () => {
  const el = mount(
    makeHass([{ id: "d1", name: "Box 1", area: "kitchen", mhd: iso(2) }], { areas: AREAS, language: "en" }),
  );
  assert.equal($(el, '[data-l="filledAt"]').textContent, "Filled on");
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

test("Deutsche und englische Panel-Texte sind vollständig und gleichartig", () => {
  assert.deepEqual(Object.keys(STRINGS.de).sort(), Object.keys(STRINGS.en).sort());
  for (const key of Object.keys(STRINGS.de)) {
    assert.equal(typeof STRINGS.de[key], typeof STRINGS.en[key], key);
    if (typeof STRINGS.de[key] === "function") {
      for (const n of [0, 1, 2]) {
        assert.ok(String(STRINGS.de[key](n)).length > 0 && String(STRINGS.en[key](n)).length > 0, `${key}(${n})`);
      }
    } else if (typeof STRINGS.de[key] === "object") {
      assert.deepEqual(Object.keys(STRINGS.de[key]), Object.keys(STRINGS.en[key]), key);
    } else {
      assert.ok(STRINGS.de[key].length > 0 && STRINGS.en[key].length > 0, key);
    }
  }
  // Der Text darf nicht versehentlich in beiden Sprachen identisch deutsch sein
  assert.notEqual(STRINGS.de.emptyContainer, STRINGS.en.emptyContainer);
  assert.notEqual(STRINGS.de.noneText, STRINGS.en.noneText);
});

// ---------- Dose hinzufügen, Bereich ändern ----------

const flush = () => new Promise((r) => setTimeout(r, 0));

function adminHass(doses = [{ id: "d1", name: "Dose A", area: "kitchen" }], responses = []) {
  const hass = makeHass(doses, { areas: AREAS });
  hass.user = { is_admin: true };
  hass.apiCalls = [];
  hass.wsCalls = [];
  const queue = [...responses];
  hass.callApi = async (method, path, body) => {
    hass.apiCalls.push({ method, path, body });
    return queue.length ? queue.shift() : {};
  };
  hass.nfcLinks = {};
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/nfc_tags`) return { by_device: hass.nfcLinks }; // Hintergrundabruf, nicht mitzählen
    if (msg.type === "config/label_registry/list") return []; // Hintergrundabruf, nicht mitzählen
    if (msg.type === `${D}/settings`) return { vacuum_default: hass.vacuumDefault ?? true, shopping_list: !!hass.shoppingList }; // dito
    hass.wsCalls.push(msg);
    return {};
  };
  return hass;
}

const FLOW = [
  { type: "menu", flow_id: "f1" },
  { type: "form", flow_id: "f1", step_id: "create" },
];

test("Administrator sieht 'Dose hinzufügen' und die Bereichsauswahl, andere nicht", () => {
  const admin = mount(adminHass());
  assert.ok($(admin, "button.add").classList.contains("visible"));
  assert.ok($(admin, ".arearow").classList.contains("visible"));
  assert.ok($(admin, ".arealine").classList.contains("hidden"));
  assert.deepEqual(
    $$(admin, ".card select[data-f=area] option").map((o) => o.textContent),
    ["Kein Bereich", "Keller", "Küche"],
  );
  assert.equal($(admin, ".card select[data-f=area]").value, "kitchen");

  document.body.innerHTML = "";
  const hass = adminHass();
  hass.user = { is_admin: false };
  const user = mount(hass);
  assert.ok(!$(user, "button.add").classList.contains("visible"));
  assert.ok(!$(user, ".arearow").classList.contains("visible"));
  assert.match($(user, ".arealine").textContent, /Bereich: Küche/);
});

test("Bereich einer Dose ändern ruft die Geräte-Registry auf; 'Kein Bereich' entfernt ihn", async () => {
  const hass = adminHass();
  const el = mount(hass);
  const select = $(el, ".card select[data-f=area]");
  select.value = "cellar";
  select.dispatchEvent(new dom.window.Event("change"));
  select.value = "";
  select.dispatchEvent(new dom.window.Event("change"));
  await flush();
  assert.deepEqual(hass.wsCalls, [
    { type: "config/device_registry/update", device_id: "d1", area_id: "cellar" },
    { type: "config/device_registry/update", device_id: "d1", area_id: null },
  ]);
});

test("Bereich ändern: Fehler wird angezeigt", async () => {
  const hass = adminHass();
  hass.callWS = async () => {
    throw new Error("nope");
  };
  const el = mount(hass);
  const select = $(el, ".card select[data-f=area]");
  select.value = "cellar";
  select.dispatchEvent(new dom.window.Event("change"));
  await flush();
  assert.equal($(el, "#notice").hidden, false);
  assert.match($(el, "#notice").textContent, /Bereich konnte nicht geändert/);
});

test("Dose hinzufügen: neuer QR-Code über den Config Flow, mit Name und Bereich", async () => {
  const hass = adminHass(undefined, [...FLOW, { type: "create_entry", title: "Suppe" }]);
  const el = mount(hass);
  $(el, "button.add").click();
  assert.equal($(el, ".overlay").hidden, false);
  assert.equal($(el, '[data-w="code"]').hidden, true); // Code nur im Zwilling-Modus
  $(el, '[data-f="name"]').value = "Suppe";
  $(el, ".dialog select[data-f=area]").value = "cellar";
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.deepEqual(hass.apiCalls, [
    { method: "POST", path: "config/config_entries/flow", body: { handler: D, show_advanced_options: false } },
    { method: "POST", path: "config/config_entries/flow/f1", body: { next_step_id: "create" } },
    { method: "POST", path: "config/config_entries/flow/f1", body: { name: "Suppe", area_id: "cellar", vacuum: true, flexible: false } },
  ]);
  assert.equal($(el, ".overlay").hidden, true);
});

test("Dose hinzufügen: Zwilling-QR-Code einlesen, ungültiger Code zeigt Fehler und beendet den Flow", async () => {
  const hass = adminHass(undefined, [
    { type: "menu", flow_id: "f2" },
    { type: "form", flow_id: "f2", step_id: "scan" },
    { type: "form", flow_id: "f2", step_id: "scan", errors: { qr_code: "invalid_code" } },
  ]);
  const el = mount(hass);
  $(el, "button.add").click();
  const scan = $(el, 'input[name="mode"][value="scan"]');
  scan.checked = true;
  scan.dispatchEvent(new dom.window.Event("change"));
  assert.equal($(el, '[data-w="code"]').hidden, false);
  $(el, '[data-f="code"]').value = "kaputt!";
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal(hass.apiCalls[1].body.next_step_id, "scan");
  assert.deepEqual(hass.apiCalls[2].body, { qr_code: "kaputt!", vacuum: true, flexible: false });
  assert.equal(hass.apiCalls[3].method, "DELETE");
  assert.equal(hass.apiCalls[3].path, "config/config_entries/flow/f2");
  assert.equal($(el, ".dialog .error").textContent, "Im QR-Code wurde keine gültige ID (cc) gefunden.");
  assert.equal($(el, ".overlay").hidden, false); // Dialog bleibt offen
});

test("Dose hinzufügen: bereits vorhandene Dose und leerer Code im Zwilling-Modus", async () => {
  const hass = adminHass(undefined, [
    { type: "menu", flow_id: "f3" },
    { type: "form", flow_id: "f3", step_id: "scan" },
    { type: "abort", reason: "already_configured" },
  ]);
  const el = mount(hass);
  $(el, "button.add").click();
  const scan = $(el, 'input[name="mode"][value="scan"]');
  scan.checked = true;
  scan.dispatchEvent(new dom.window.Event("change"));

  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal(hass.apiCalls.length, 0); // ohne Code wird gar nichts gesendet
  assert.match($(el, ".dialog .error").textContent, /keine gültige ID/);

  $(el, '[data-f="code"]').value = "34OL";
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el, ".dialog .error").textContent, "Diese Dose wurde bereits hinzugefügt.");
  assert.ok(hass.apiCalls.every((c) => c.method !== "DELETE")); // abgebrochener Flow braucht kein DELETE
});

test("Netzwerkfehler beim Hinzufügen zeigt allgemeine Meldung", async () => {
  const hass = adminHass();
  hass.callApi = async () => {
    throw new Error("offline");
  };
  const el = mount(hass);
  $(el, "button.add").click();
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el, ".dialog .error").textContent, "Die Dose konnte nicht hinzugefügt werden.");
  assert.equal($(el, "button.submit").disabled, false);
});

test("?add=<ID> aus dem Scan-Webhook öffnet den Dialog mit vorbelegtem Code", async () => {
  dom.window.history.pushState(null, "", "/larder?add=NEU123");
  const el = mount(adminHass());
  await flush();
  await flush();
  assert.equal($(el, ".overlay").hidden, false);
  assert.equal($(el, 'input[name="mode"]:checked').value, "scan");
  assert.equal($(el, '[data-f="code"]').value, "NEU123");
  assert.equal($(el, '[data-w="code"]').hidden, false);
  assert.equal(dom.window.location.search, ""); // Parameter wird entfernt, kein erneutes Öffnen
  $(el, "button.cancel").click();
  el.hass = adminHass();
  assert.equal($(el, ".overlay").hidden, true);
});

test("?add=<ID> für Nutzer ohne Admin-Rechte zeigt einen Hinweis statt des Dialogs", async () => {
  dom.window.history.pushState(null, "", "/larder?add=NEU123");
  const hass = adminHass();
  hass.user = { is_admin: false };
  const el = mount(hass);
  await flush();
  await flush();
  assert.equal($(el, ".overlay").hidden, true);
  assert.equal($(el, "#notice").hidden, false);
  assert.match($(el, "#notice").textContent, /Nur Administratoren.*NEU123/);
});

test("listAreas sortiert Bereiche nach Name", () => {
  assert.deepEqual(listAreas({ language: "de", areas: AREAS }).map((a) => a.id), ["cellar", "kitchen"]);
  assert.deepEqual(listAreas({}), []);
});

test("listAreas: nur Bereiche mit der Beschriftung, ohne markierten Bereich alle, der aktuelle bleibt", () => {
  const areas = {
    kitchen: { area_id: "kitchen", name: "Küche", labels: ["larder"] },
    cellar: { area_id: "cellar", name: "Keller", labels: [] },
    pantry: { area_id: "pantry", name: "Vorrat", labels: ["larder", "x"] },
    garage: { area_id: "garage", name: "Garage" },
  };
  const hass = { language: "de", areas };
  const ids = (list) => list.map((a) => a.id);
  assert.deepEqual(ids(listAreas(hass, "larder")), ["kitchen", "pantry"]);
  assert.deepEqual(ids(listAreas(hass, "larder", "cellar")), ["cellar", "kitchen", "pantry"]); // aktueller Bereich bleibt wählbar
  assert.deepEqual(ids(listAreas(hass, null)), ["garage", "cellar", "kitchen", "pantry"]); // ohne Beschriftung: alle
  assert.deepEqual(ids(listAreas(hass, "unbekannt")), ["garage", "cellar", "kitchen", "pantry"]); // niemand hat sie: alle
});

function labelHass(labels, areas) {
  const hass = adminHass([{ id: "d1", name: "Dose A", area: "cellar", content: "Käse" }]);
  hass.areas = areas;
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "config/label_registry/list") {
      if (labels instanceof Error) throw labels;
      return labels;
    }
    return base(msg);
  };
  return hass;
}

const LABELED_AREAS = {
  kitchen: { area_id: "kitchen", name: "Küche", labels: ["lbl1"] },
  cellar: { area_id: "cellar", name: "Keller", labels: [] },
  garage: { area_id: "garage", name: "Garage", labels: [] },
};

test("Bereichsauswahl: mit Beschriftung 'Larder' nur markierte Bereiche (plus aktueller Bereich der Dose)", async () => {
  const el = mount(labelHass([{ label_id: "lbl1", name: "Larder" }], LABELED_AREAS));
  await flush();
  const cardOptions = [...$(el, '.card [data-f="area"]').options].map((o) => o.textContent);
  assert.deepEqual(cardOptions, ["Kein Bereich", "Keller", "Küche"]); // Keller: aktueller Bereich der Dose, Garage fehlt
  el.openAddDialog();
  await flush();
  assert.deepEqual([...$(el, "form.dialog select").options].map((o) => o.textContent), ["Kein Bereich", "Küche"]);
});

test("Bereichsauswahl: Beschriftung findet man über den Namen, egal wie geschrieben", async () => {
  const el = mount(labelHass([{ label_id: "abc", name: " LARDER " }], { ...LABELED_AREAS, kitchen: { area_id: "kitchen", name: "Küche", labels: ["abc"] } }));
  await flush();
  el.openAddDialog();
  await flush();
  assert.deepEqual([...$(el, "form.dialog select").options].map((o) => o.textContent), ["Kein Bereich", "Küche"]);
});

test("Bereichsauswahl: ohne Beschriftung, ohne markierte Bereiche oder bei Fehler erscheinen alle Bereiche", async () => {
  const all = ["Kein Bereich", "Garage", "Keller", "Küche"];
  for (const labels of [[], [{ label_id: "lbl1", name: "Larder" }], new Error("kein Zugriff")]) {
    document.body.innerHTML = "";
    const areas = Array.isArray(labels) && labels.length
      ? { ...LABELED_AREAS, kitchen: { area_id: "kitchen", name: "Küche", labels: [] } } // Beschriftung da, aber nirgends gesetzt
      : LABELED_AREAS;
    const el = mount(labelHass(labels, areas));
    await flush();
    el.openAddDialog();
    await flush();
    assert.deepEqual([...$(el, "form.dialog select").options].map((o) => o.textContent), all);
  }
});

// ---------- Vakuum und MHD-Schätzung ----------

test("Vakuum-Schalter zeigt den Zustand und schaltet die Entität", () => {
  const hass = adminHass([
    { id: "d1", name: "Dose A", area: "kitchen", vacuum: "on" },
    { id: "d2", name: "Dose B", area: "kitchen", vacuum: "off" },
  ]);
  const el = mount(hass);
  const [a, b] = $$(el, '[data-f="vacuum"]');
  assert.equal(a.checked, true);
  assert.equal(b.checked, false);
  assert.equal($$(el, '[data-l="vacuum"]')[0].textContent, "Vakuum");

  b.checked = true;
  b.dispatchEvent(new dom.window.Event("change"));
  a.checked = false;
  a.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(hass.calls, [
    { domain: "switch", service: "turn_on", data: { entity_id: "switch.d2_vacuum" } },
    { domain: "switch", service: "turn_off", data: { entity_id: "switch.d1_vacuum" } },
  ]);
});

test("Einkaufsliste: Schalter nur sichtbar, wenn eine Liste gewählt ist, und getrennt vom Vakuum-Schalter", () => {
  const hass = adminHass([
    { id: "d1", name: "Dose A", area: "kitchen", shopping: "on", shoppingList: "todo.einkaufen" },
    { id: "d2", name: "Dose B", area: "kitchen", shopping: "off", shoppingList: "todo.einkaufen" },
    { id: "d3", name: "Dose C", area: "kitchen", shoppingList: null },
  ]);
  const el = mount(hass);
  const [a, b, c] = $$(el, '[data-f="shopping"]');
  assert.equal($$(el, '[data-l="shopping"]')[0].textContent, "Beim Leeren auf die Einkaufsliste");
  const rows = $$(el, ".shoprow").map((r) => r.style.display !== "none");
  assert.deepEqual(rows, [true, true, false]);
  assert.equal(a.checked, true);
  assert.equal(b.checked, false);
  assert.equal(c.checked, false);

  b.checked = true;
  b.dispatchEvent(new dom.window.Event("change"));
  a.checked = false;
  a.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(hass.calls, [
    { domain: "switch", service: "turn_on", data: { entity_id: "switch.d2_einkaufsliste" } },
    { domain: "switch", service: "turn_off", data: { entity_id: "switch.d1_einkaufsliste" } },
  ]);
});

test("Einkaufsliste wird auch über translation_key erkannt, der Vakuum-Schalter bleibt unberührt", () => {
  const hass = adminHass([{ id: "d1", name: "Dose A", area: "kitchen", shoppingList: "todo.einkaufen" }]);
  hass.entities["switch.d1_einkaufsliste"].translation_key = "shopping";
  hass.entities["switch.d1_einkaufsliste"].entity_id = "switch.d1_liste_x";
  hass.states["switch.d1_liste_x"] = hass.states["switch.d1_einkaufsliste"];
  hass.entities["switch.d1_liste_x"] = hass.entities["switch.d1_einkaufsliste"];
  delete hass.entities["switch.d1_einkaufsliste"];
  const [dev] = collectDevices(hass);
  assert.equal(dev.entities.shopping, "switch.d1_liste_x");
  assert.equal(dev.entities.switch, "switch.d1_vacuum");
});

test("'MHD schätzen' erscheint nur bei aktivierter KI, vorhandenem Inhalt und leerem MHD", () => {
  const visible = (hass) => {
    document.body.innerHTML = "";
    const el = mount(hass);
    return $(el, ".estimate").style.display !== "none" && $(el, ".estimaterow").classList.contains("visible");
  };
  assert.equal(visible(adminHass([{ id: "d1", name: "A", content: "Suppe", ai: true }])), true);
  assert.equal(visible(adminHass([{ id: "d1", name: "A", content: "Suppe", ai: false }])), false); // KI aus
  assert.equal(visible(adminHass([{ id: "d1", name: "A", content: "Suppe", ai: true, mhd: "2030-01-01" }])), false); // MHD da
  assert.equal(visible(adminHass([{ id: "d1", name: "A", ai: true }])), false); // kein Inhalt
});

test("MHD schätzen ruft den Service auf und zeigt Schätzung samt Tipp", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Suppe", ai: true }]);
  const dateId = "date.d1_mhd";
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/nfc_tags`) return { by_device: {} };
    if (msg.type === "config/label_registry/list") return [];
    hass.wsCalls.push(msg);
    return {
      response: { [dateId]: { status: "estimated", days: 4, tip: "Gut verschließen", source: "table", basis: "Suppe · Kühlschrank", best_before: "2026-11-14", applied: true } },
    };
  };
  const el = mount(hass);
  $(el, "button.estimate").click();
  assert.equal($(el, "button.estimate").disabled, true); // währenddessen gesperrt
  await flush();
  assert.deepEqual(hass.wsCalls, [
    {
      type: "call_service",
      domain: D,
      service: "estimate_best_before",
      service_data: {},
      target: { entity_id: dateId },
      return_response: true,
    },
  ]);
  assert.equal($(el, ".tip").textContent, "Geschätzt: ca. 4 Tage haltbar (Tabelle). Gut verschließen");
  assert.equal($(el, "button.estimate").disabled, false);
  assert.equal($(el, ".estimaterow").classList.contains("visible"), true);

  // Eingabe im Inhaltsfeld löscht den Hinweis wieder
  $(el, '[data-f="content"]').dispatchEvent(new dom.window.Event("input"));
  assert.equal($(el, ".tip").textContent, "");
});

test("MHD schätzen: Fehler des Dienstes wird als Meldung angezeigt", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Suppe", ai: true }]);
  hass.callWS = async () => {
    throw { code: "home_assistant_error", message: "Weise der Dose zuerst einen Bereich zu." };
  };
  const el = mount(hass);
  $(el, "button.estimate").click();
  await flush();
  assert.equal($(el, ".tip").textContent, "Weise der Dose zuerst einen Bereich zu.");
  assert.ok($(el, ".tip").classList.contains("error"));
  assert.equal($(el, "button.estimate").disabled, false);
});

test("MHD schätzen: englische Texte", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Soup", ai: true }]);
  hass.language = "en";
  hass.callWS = async () => ({
    response: { "date.d1_mhd": { status: "estimated", days: 1, tip: "", applied: true } },
  });
  const el = mount(hass);
  assert.equal($(el, "button.estimate").textContent, "Estimate best before");
  $(el, "button.estimate").click();
  await flush();
  assert.equal($(el, ".tip").textContent, "Estimated: about 1 day shelf life");
});

test("'Behälter leeren' löscht den Schätz-Hinweis, der Vakuum-Schalter bleibt unberührt", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Suppe", ai: true }]);
  hass.callWS = async () => ({ response: { "date.d1_mhd": { status: "estimated", days: 3, tip: "x", applied: true } } });
  const el = mount(hass);
  $(el, "button.estimate").click();
  await flush();
  const ws = [];
  hass.callWS = async (msg) => {
    ws.push(msg);
    return {};
  };
  $(el, "button.empty").click();
  assert.equal($(el, ".tip").textContent, "");
  $(el, "button.thrown").click();
  await flush();
  assert.deepEqual(hass.calls, []);
  assert.deepEqual(ws, [{ type: "larder/empty", device_id: "d1", outcome: "thrown" }]);
});

test("Leeren von MHD und 'Eingelagert am' im Panel ruft die Löschen-Services auf", () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Suppe", mhd: "2030-01-01", filled: "2026-11-09T10:00:00+00:00" }]);
  const el = mount(hass);
  const mhd = $(el, '[data-f="bestBefore"]');
  mhd.value = "";
  mhd.dispatchEvent(new dom.window.Event("change"));
  const filled = $(el, '[data-f="filledAt"]');
  filled.value = "";
  filled.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(hass.calls, [
    { domain: D, service: "clear_best_before", data: { entity_id: "date.d1_mhd" } },
    { domain: D, service: "clear_filled_at", data: { entity_id: "datetime.d1_befuellt" } },
  ]);
});

// ---------- Quelle des Schätzwerts, Liste der gemerkten Schätzungen ----------

test("sourceLabel nennt Tabelle, KI und bei Korrekturen den Ursprung", () => {
  const t = STRINGS.de;
  assert.equal(sourceLabel(t, "table"), "Tabelle");
  assert.equal(sourceLabel(t, "ai"), "KI");
  assert.equal(sourceLabel(t, "learned", "table"), "Tabelle, von dir korrigiert");
  assert.equal(sourceLabel(t, "learned", "ai"), "KI, von dir korrigiert");
  assert.equal(sourceLabel(t, "learned", null), "von dir korrigiert");
  assert.equal(sourceLabel(STRINGS.en, "learned", "ai"), "AI, corrected by you");
});

const ENTRIES = [
  { key: "pizza|kühlschrank|vacuum", content: "Pizza", area: "Kühlschrank", vacuum: true, days: 3, tip: "Gut erhitzen", source: "learned", origin: "ai" },
  { key: "suppe|keller|normal", content: "Suppe", area: "Keller", vacuum: false, days: 4, tip: "", source: "table", origin: null },
];

function estimatesHass(entries = ENTRIES) {
  const hass = adminHass([{ id: "d1", name: "A", area: "kitchen" }]);
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/nfc_tags`) return { by_device: {} };
    if (msg.type === "config/label_registry/list") return [];
    hass.wsCalls.push(msg);
    if (msg.type === `${D}/estimates`) return { mode: "table", entries };
    return { entries: msg.type.endsWith("delete") ? entries.slice(1) : entries };
  };
  return hass;
}

test("Reiter 'Schätzungen' nur für Administratoren", () => {
  const user = adminHass();
  user.user = { is_admin: false };
  assert.equal($(mount(user), ".tabs").classList.contains("visible"), false);
  document.body.innerHTML = "";
  assert.equal($(mount(adminHass()), ".tabs").classList.contains("visible"), true);
});

test("Reiter 'Schätzungen' lädt und zeigt Einträge samt Quelle", async () => {
  const hass = estimatesHass();
  const el = mount(hass);
  $(el, '[data-view="estimates"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls, [{ type: `${D}/estimates` }]);
  assert.equal($(el, "#estimates").hidden, false);
  assert.equal($(el, "#content").hidden, true);
  const rows = $$(el, "#estimates .est:not(.new)");
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Pizza/);
  assert.match(rows[0].textContent, /KI, von dir korrigiert/);
  assert.match(rows[1].textContent, /ohne Vakuum/);
  assert.match(rows[1].textContent, /Quelle: Tabelle/);
  assert.equal(rows[0].querySelector('[data-f="days"]').value, "3");

  $(el, '[data-view="containers"]').click();
  assert.equal($(el, "#content").hidden, false);
});

test("Schätzungen: Speichern, Löschen (mit Rückfrage) und Hinzufügen rufen die Befehle auf", async () => {
  const hass = estimatesHass();
  const el = mount(hass);
  $(el, '[data-view="estimates"]').click();
  await flush();
  hass.wsCalls.length = 0;

  const row = () => $$(el, "#estimates .est:not(.new)")[0];
  row().querySelector('[data-f="days"]').value = "5";
  row().querySelector('[data-f="tip"]').value = "Neu";
  row().querySelector("button.save").click();
  await flush();
  assert.deepEqual(hass.wsCalls.pop(), {
    type: `${D}/estimate_set`,
    key: "pizza|kühlschrank|vacuum",
    days: 5,
    tip: "Neu",
  });

  dom.window.confirm = () => false;
  row().querySelector("button.del").click();
  await flush();
  assert.equal(hass.wsCalls.length, 0); // abgebrochen
  dom.window.confirm = () => true;
  row().querySelector("button.del").click();
  await flush();
  assert.deepEqual(hass.wsCalls.pop(), { type: `${D}/estimate_delete`, key: "pizza|kühlschrank|vacuum" });

  const add = $(el, "#estimates .est.new");
  add.querySelector("button.save").click(); // leer: nichts senden
  await flush();
  assert.equal(hass.wsCalls.length, 0);
  assert.equal($(el, "#notice").hidden, false);
  add.querySelector('[data-f="content"]').value = "Lasagne";
  add.querySelector('[data-f="area"]').value = "Küche";
  add.querySelector('[data-f="days"]').value = "3";
  add.querySelector('[data-f="vacuum"]').checked = false;
  add.querySelector("button.save").click();
  await flush();
  assert.deepEqual(hass.wsCalls.pop(), {
    type: `${D}/estimate_add`,
    content: "Lasagne",
    area: "Küche",
    vacuum: false,
    days: 3,
  });
});

test("Schätzungen: Fehler des Servers wird angezeigt", async () => {
  const hass = estimatesHass();
  const el = mount(hass);
  $(el, '[data-view="estimates"]').click();
  await flush();
  hass.callWS = async () => {
    throw { message: "Dieser gemerkte Eintrag existiert nicht (mehr)." };
  };
  $$(el, "#estimates .est:not(.new)")[0].querySelector("button.save").click();
  await flush();
  assert.match($(el, "#notice").textContent, /existiert nicht/);
});

// ---------- Suche, Filter, Sortierung, Schnellaktionen ----------

const FRIDGE_DOSES = [
  { id: "d1", name: "Dose A", area: "kitchen", content: "Pizza", mhd: iso(-1) },
  { id: "d2", name: "Dose B", area: "kitchen", content: "Suppe", mhd: iso(2) },
  { id: "d3", name: "Dose C", area: "cellar", content: "Nudeln", mhd: iso(30) },
  { id: "d4", name: "Dose D", area: "cellar" },
  { id: "d5", name: "Dose E", area: "cellar", content: "Reis" },
];
const names = (list) => list.map((d) => d.name);

test("addDays verschiebt ISO-Daten über Monats- und Jahresgrenzen", () => {
  assert.equal(addDays("2026-11-10", 1), "2026-11-11");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("", 1), null);
});

test("arrangeDevices: Filter, Suche und Sortierung", () => {
  const hass = makeHass(FRIDGE_DOSES, { areas: AREAS });
  const devices = collectDevices(hass);
  const run = (opts) => names(arrangeDevices(hass, devices, opts));
  assert.deepEqual(run({}), ["Dose C", "Dose D", "Dose E", "Dose A", "Dose B"]); // nach Bereich: Keller, Küche
  assert.deepEqual(run({ filter: "soon" }), ["Dose B"]);
  assert.deepEqual(run({ filter: "expired" }), ["Dose A"]);
  assert.deepEqual(run({ filter: "filled" }), ["Dose C", "Dose E", "Dose A", "Dose B"]);
  assert.deepEqual(run({ filter: "empty" }), ["Dose D"]);
  assert.deepEqual(run({ query: "pizza" }), ["Dose A"]);
  assert.deepEqual(run({ query: "KELLER" }), ["Dose C", "Dose D", "Dose E"]); // Suche im Bereichsnamen
  assert.deepEqual(run({ query: "dose b" }), ["Dose B"]);
  assert.deepEqual(run({ sort: "date" }), ["Dose A", "Dose B", "Dose C", "Dose D", "Dose E"]); // ohne MHD zuletzt
  assert.deepEqual(run({ sort: "name" }), ["Dose A", "Dose B", "Dose C", "Dose D", "Dose E"]);
  assert.deepEqual(run({ query: "xyz" }), []);
});

test("Toolbar: Suche und Filter blenden Karten aus, Sortierung nach MHD entfernt die Bereichsüberschriften", () => {
  const el = mount(adminHass(FRIDGE_DOSES));
  assert.equal($(el, ".toolbar").hidden, false);
  assert.equal(cardNames(el).length, 5);
  assert.deepEqual(areaHeadings(el), ["Keller", "Küche"]);

  const query = $(el, '[data-f="query"]');
  query.value = "suppe";
  query.dispatchEvent(new dom.window.Event("input"));
  assert.deepEqual(cardNames(el), ["Dose B"]);

  query.value = "";
  query.dispatchEvent(new dom.window.Event("input"));
  const sort = $(el, '[data-f="sort"]');
  sort.value = "date";
  sort.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(areaHeadings(el), []);
  assert.deepEqual(cardNames(el), ["Dose A", "Dose B", "Dose C", "Dose D", "Dose E"]);

  const filter = $(el, '[data-f="filter"]');
  filter.value = "expired";
  filter.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(cardNames(el), ["Dose A"]);
  query.value = "gibt es nicht";
  query.dispatchEvent(new dom.window.Event("input"));
  assert.match($(el, ".none").textContent, /Keine Dose passt/);
});

test("Toolbar-Einstellungen werden im Browser gemerkt", () => {
  const el = mount(adminHass(FRIDGE_DOSES));
  const filter = $(el, '[data-f="filter"]');
  filter.value = "soon";
  filter.dispatchEvent(new dom.window.Event("change"));
  document.body.innerHTML = "";
  const again = mount(adminHass(FRIDGE_DOSES));
  assert.equal($(again, '[data-f="filter"]').value, "soon");
  assert.deepEqual(cardNames(again), ["Dose B"]);
});

test("Toolbar ist ohne Dosen und im Reiter 'Schätzungen' ausgeblendet", async () => {
  assert.equal($(mount(adminHass([])), ".toolbar").hidden, true);
  document.body.innerHTML = "";
  const el = mount(estimatesHass());
  $(el, '[data-view="estimates"]').click();
  await flush();
  assert.equal($(el, ".toolbar").hidden, true);
});

test("Schnellaktionen: +1 Tag setzt das MHD, Geöffnet ruft den Service", () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Käse", mhd: "2026-12-31" }]);
  const el = mount(hass);
  const dateId = "date.d1_mhd";
  assert.equal($(el, ".quickrow").classList.contains("visible"), true);
  $(el, "button.plus1").click();
  $(el, "button.opened").click();
  assert.deepEqual(hass.calls, [
    { domain: "date", service: "set_value", data: { entity_id: dateId, date: "2027-01-01" } },
    { domain: D, service: "mark_opened", data: { entity_id: dateId } },
  ]);
});

test("Schnellaktionen: Aufgetaut ruft den Service mark_thawed", () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Chili", mhd: "2027-03-01" }]);
  const el = mount(hass);
  assert.equal($(el, "button.thawed").textContent, "Aufgetaut");
  $(el, "button.thawed").click();
  assert.deepEqual(hass.calls, [{ domain: D, service: "mark_thawed", data: { entity_id: "date.d1_mhd" } }]);
});

test("Menge: Eingabe und Einheit auf der Karte setzen die Entitäten, leer wird 0", () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Schinken", portions: 3, unit: "slices" }]);
  const el = mount(hass);
  const input = $(el, '.card [data-f="quantity"]');
  const unit = $(el, '.card [data-f="unit"]');
  assert.equal(input.value, "3");
  assert.equal(unit.value, "slices");
  assert.deepEqual([...unit.options].map((o) => o.textContent), ["Portionen", "Stück", "Scheiben", "Gramm", "Milliliter"]);
  assert.equal($(el, '[data-l="quantity"]').textContent, "Menge");
  input.value = "5";
  input.dispatchEvent(new dom.window.Event("change"));
  unit.value = "pieces";
  unit.dispatchEvent(new dom.window.Event("change"));
  input.value = "";
  input.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(hass.calls, [
    { domain: "number", service: "set_value", data: { entity_id: "number.d1_portionen", value: 5 } },
    { domain: "select", service: "select_option", data: { entity_id: "select.d1_einheit", option: "pieces" } },
    { domain: "number", service: "set_value", data: { entity_id: "number.d1_portionen", value: 0 } },
  ]);
  document.body.innerHTML = "";
  const none = mount(adminHass([{ id: "d1", name: "A", content: "Chili" }]));
  assert.equal($(none, '.card [data-f="quantity"]').value, "");
  assert.equal($(none, '.card [data-f="unit"]').value, "portions");
});

test("Portion entnehmen: −1 zieht ab, bei der letzten Frage nach Leeren", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Bolognese", portions: 2, unit: "portions" }]);
  const el = mount(hass);
  const take = $(el, ".card button.take");
  assert.equal(take.hidden, false);
  take.click();
  assert.deepEqual(hass.calls, [{ domain: "number", service: "set_value", data: { entity_id: "number.d1_portionen", value: 1 } }]);

  // letzte Portion: erst fragen
  hass.calls.length = 0;
  hass.states["number.d1_portionen"] = { ...hass.states["number.d1_portionen"], state: "1" };
  el.hass = { ...hass };
  $(el, ".card button.take").click();
  assert.deepEqual(hass.calls, []);
  assert.equal($(el, ".card .lastrow").hidden, false);
  assert.equal($(el, ".card .lasttext").textContent, "Letzte entnommen. Dose leeren?");
  $(el, ".card button.lastkeep").click();
  assert.deepEqual(hass.calls, [{ domain: "number", service: "set_value", data: { entity_id: "number.d1_portionen", value: 0 } }]);
  assert.equal($(el, ".card .lastrow").hidden, true);
  hass.calls.length = 0;
  $(el, ".card button.take").click();
  $(el, ".card button.lastempty").click();
  await flush();
  assert.deepEqual(hass.calls, []);
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === "larder/empty"), [{ type: "larder/empty", device_id: "d1", outcome: "eaten" }]);

  // Gramm oder ohne Menge: kein −1
  document.body.innerHTML = "";
  const grams = mount(adminHass([{ id: "d1", name: "A", content: "Reis", portions: 500, unit: "grams" }]));
  assert.equal($(grams, ".card button.take").hidden, true);
  document.body.innerHTML = "";
  const none = mount(adminHass([{ id: "d1", name: "A", content: "Reis" }]));
  assert.equal($(none, ".card button.take").hidden, true);
});

test("Verlauf: aufklappen lädt die letzten Einträge der Dose", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Suppe" }]);
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "larder/history") {
      assert.deepEqual(msg, { type: "larder/history", device_id: "d1", limit: 10 });
      return {
        records: [
          { content: "Bolognese", filled_at: "2026-10-01T10:00:00+00:00", emptied: "2026-10-20T10:00:00+00:00", outcome: "eaten" },
          { content: "Käse", filled_at: null, emptied: "2026-09-01T10:00:00+00:00", outcome: null, expired: true },
        ],
      };
    }
    return base(msg);
  };
  const el = mount(hass);
  const details = $(el, ".card details.history");
  assert.equal(details.querySelector("summary").textContent, "Verlauf");
  details.open = true;
  details.dispatchEvent(new dom.window.Event("toggle"));
  await flush();
  const items = [...details.querySelectorAll("li")].map((li) => li.textContent);
  assert.equal(items.length, 2);
  assert.match(items[0], /01\.10\.2026 – 20\.10\.2026 · Bolognese · gegessen/);
  assert.match(items[1], /01\.09\.2026 · Käse · abgelaufen/);
});

test("Strichcode im Befüllen-Dialog: Produktname aus Open Food Facts", async () => {
  const hass = adminHass([{ id: "d1", name: "A" }]);
  const sent = [];
  const original = () => true;
  const external = {
    config: { hasBarCodeScanner: 1 },
    _commandHandler: original,
    addCommandHandler(h) {
      this._commandHandler = h;
    },
    fireMessage: (m) => sent.push(m),
  };
  hass.auth = { external };
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/product`) {
      return msg.code === "4000417025005"
        ? { found: true, code: msg.code, name: "Zarte Haferflocken", product: { ean: msg.code, kcal_100g: 372 } }
        : { found: false, code: msg.code };
    }
    return base(msg);
  };
  const el = mount(hass);
  el.openFillDialog("d1");
  const form = el.shadowRoot.querySelector("form.fillform");
  const btn = form.querySelector("button.barcode");
  assert.equal(btn.hidden, false);
  btn.click();
  assert.equal(sent[0].type, "bar_code/scan");
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "4000417025005", format: "ean_13" } });
  await flush();
  await flush();
  assert.equal(sent[1].type, "bar_code/close");
  assert.equal(external._commandHandler, original);
  assert.equal(form.querySelector('[data-f="content"]').value, "Zarte Haferflocken");
  assert.match(form.querySelector(".barcodestatus").textContent, /Gefunden: Zarte Haferflocken.*Nährwerte übernommen.*Open Food Facts/);
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const set = hass.wsCalls.find((m) => m.type === `${D}/product_set`);
  assert.deepEqual(set, { type: `${D}/product_set`, device_id: "d1", product: { ean: "4000417025005", kcal_100g: 372 }, replace: true });
  el.openFillDialog("d1");
  btn.click();
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "12345678", format: "ean_8" } });
  await flush();
  await flush();
  assert.match(form.querySelector(".barcodestatus").textContent, /Kein Produkt zu EAN 12345678/);
  // ohne Scanner der App: kein Knopf
  document.body.innerHTML = "";
  const plain = mount(adminHass([{ id: "d1", name: "A" }]));
  plain.openFillDialog("d1");
  assert.equal(plain.shadowRoot.querySelector("form.fillform button.barcode").hidden, true);
});

test("Allergene im Haushalt: Hinweis auf der Karte", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Müsli", product: { allergen_warning: ["Gluten", "Schalenfrüchte"] } }]);
  const el = mount(hass);
  const warn = $(el, ".card .allergen-warning");
  assert.equal(warn.hidden, false);
  assert.equal(warn.textContent, "⚠ Enthält Gluten, Schalenfrüchte (Allergene im Haushalt)");
});

test("Nährwerte auf der Karte: anzeigen und einzeln ändern", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Haferflocken", product: { brand: "Kölln", kcal_100g: 372, nutri_score: "A", source: "openfoodfacts" } }]);
  const el = mount(hass);
  const nut = $(el, ".card details.nutrition");
  assert.equal(nut.hidden, false);
  assert.equal(nut.querySelector("summary").textContent, "Nährwerte · 372 kcal/100 g · Nutri-Score A");
  assert.equal($(el, ".card .allergen-warning").hidden, true);
  assert.equal(nut.querySelector('[data-p="brand"]').value, "Kölln");
  assert.equal(nut.querySelector('[data-p="nutri_score"]').value, "A");
  assert.equal(nut.querySelector(".source").hidden, false);
  const portion = nut.querySelector('[data-p="kcal_portion"]');
  portion.value = "150";
  portion.dispatchEvent(new dom.window.Event("change"));
  await flush();
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === `${D}/product_set`), [
    { type: `${D}/product_set`, device_id: "d1", product: { kcal_portion: "150" } },
  ]);
  // leere Dose: ausgeblendet
  document.body.innerHTML = "";
  const empty = mount(adminHass([{ id: "d1", name: "A" }]));
  assert.equal($(empty, ".card details.nutrition").hidden, true);
});

test("Inhalt per Foto im Befüllen-Dialog (KI)", async () => {
  const hass = adminHass([{ id: "d1", name: "A" }]);
  hass.services = { ai_task: { generate_data: {} } };
  const posted = [];
  hass.fetchWithAuth = async (url, opts) => {
    posted.push({ url, file: opts.body.get("file") });
    return { ok: true, json: async () => ({ content: "Chili con carne" }) };
  };
  const el = mount(hass);
  el.openFillDialog("d1");
  const form = el.shadowRoot.querySelector("form.fillform");
  assert.equal(form.querySelector("button.photo").hidden, false);
  const input = form.querySelector("input.photofile");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "a.jpg", { type: "image/jpeg" })] });
  input.dispatchEvent(new dom.window.Event("change"));
  await flush();
  await flush();
  assert.equal(posted[0].url, "/api/larder/content_photo");
  assert.equal(form.querySelector('[data-f="content"]').value, "Chili con carne");
  assert.match(form.querySelector(".barcodestatus").textContent, /Vorschlag: Chili con carne/);
  // ohne KI: kein Knopf
  document.body.innerHTML = "";
  const plain = mount(adminHass([{ id: "d1", name: "A" }]));
  plain.openFillDialog("d1");
  assert.equal(plain.shadowRoot.querySelector("form.fillform button.photo").hidden, true);
});

test("Schnellaktionen: ohne Inhalt versteckt, ohne MHD ist +1 Tag gesperrt", () => {
  const empty = mount(adminHass([{ id: "d1", name: "A" }]));
  assert.equal($(empty, ".quickrow").classList.contains("visible"), false);
  document.body.innerHTML = "";
  const noDate = mount(adminHass([{ id: "d1", name: "A", content: "Käse" }]));
  assert.equal($(noDate, ".quickrow").classList.contains("visible"), true);
  assert.equal($(noDate, "button.plus1").disabled, true);
  assert.equal($(noDate, "button.opened").disabled, false);
});

// ---------- NFC ----------

/** hass mit Ereignis-Abo: `emit(type, data)` simuliert ein Ereignis aus Home Assistant. */
function nfcHass(doses, { links = {} } = {}) {
  const hass = adminHass(doses);
  hass.nfcLinks = links;
  const handlers = [];
  hass.connection = {
    subscribeEvents: async (cb, type) => {
      handlers.push({ cb, type });
      return () => handlers.splice(handlers.findIndex((h) => h.cb === cb), 1);
    },
  };
  hass.emit = (type, data) => handlers.filter((h) => h.type === type).forEach((h) => h.cb({ event_type: type, data }));
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/nfc_link`) {
      hass.wsCalls.push(msg);
      hass.nfcLinks = { [msg.device_id || "neu"]: msg.tag_id };
      return { by_device: hass.nfcLinks };
    }
    if (msg.type === `${D}/nfc_unlink`) {
      hass.wsCalls.push(msg);
      hass.nfcLinks = {};
      return { by_device: {} };
    }
    return base(msg);
  };
  return hass;
}

test("Karte: NFC-Tag verknüpfen wartet auf den nächsten Scan und verknüpft ihn", async () => {
  const hass = nfcHass([{ id: "d1", name: "A", content: "Pizza" }]);
  const el = mount(hass);
  await flush();
  assert.equal($(el, ".nfcrow").classList.contains("visible"), true);
  assert.equal($(el, ".nfcstate").textContent, "Kein NFC-Tag");
  $(el, "button.nfcbtn").click();
  await flush();
  assert.equal($(el, ".nfcstate").textContent, "Halte das Handy jetzt an den NFC-Tag …");

  hass.emit("tag_scanned", { tag_id: "abc-123" });
  await flush();
  assert.deepEqual(hass.wsCalls.pop(), { type: `${D}/nfc_link`, tag_id: "abc-123", device_id: "d1" });
  assert.equal($(el, ".nfcstate").textContent, "NFC-Tag verknüpft");
  assert.equal($(el, "button.nfcbtn").textContent, "Lösen");

  // ohne Warten werden Scans ignoriert
  hass.emit("tag_scanned", { tag_id: "zzz" });
  await flush();
  assert.equal(hass.wsCalls.length, 0);

  $(el, "button.nfcbtn").click(); // Lösen
  await flush();
  assert.deepEqual(hass.wsCalls.pop(), { type: `${D}/nfc_unlink`, device_id: "d1" });
  assert.equal($(el, ".nfcstate").textContent, "Kein NFC-Tag");
});

test("Karte: Warten lässt sich abbrechen, ein bereits verknüpfter Tag wird abgelehnt", async () => {
  const hass = nfcHass(
    [{ id: "d1", name: "A" }, { id: "d2", name: "B" }],
    { links: { d2: "belegt" } },
  );
  const el = mount(hass);
  await flush();
  const row = (i) => $$(el, ".card")[i];
  row(0).querySelector("button.nfcbtn").click();
  await flush();
  hass.emit("tag_scanned", { tag_id: "belegt" });
  await flush();
  assert.equal(hass.wsCalls.length, 0);
  assert.match($(el, "#notice").textContent, /schon mit einer anderen Dose/);
  assert.equal(row(0).querySelector(".nfcstate").textContent, "Halte das Handy jetzt an den NFC-Tag …"); // wartet weiter

  row(0).querySelector("button.nfcbtn").click(); // Abbrechen
  await flush();
  assert.equal(row(0).querySelector(".nfcstate").textContent, "Kein NFC-Tag");
});

test("Nicht-Administratoren sehen keine NFC-Zeile", async () => {
  const hass = nfcHass([{ id: "d1", name: "A" }]);
  hass.user = { is_admin: false };
  const el = mount(hass);
  await flush();
  assert.equal($(el, ".nfcrow").classList.contains("visible"), false);
});

test("Dialog: 'NFC-Tag scannen' wartet auf den Tag, legt die Dose an und verknüpft den Tag", async () => {
  const hass = nfcHass([], {});
  hass.callApi = async (method, path, body) => {
    hass.apiCalls.push({ method, path, body });
    if (path.endsWith("flow") ) return { flow_id: "f1" };
    if (body && body.next_step_id) return { type: "form" };
    return { type: "create_entry", result: { entry_id: "e1" } };
  };
  const el = mount(hass);
  await flush();
  el.openAddDialog();
  const radio = $(el, 'input[name="mode"][value="nfc"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event("change"));
  assert.equal($(el, '.nfcstatus').hidden, false);
  assert.equal($(el, '.nfcstatus').textContent, "Halte das Handy jetzt an den NFC-Tag …");

  // ohne Tag kein Anlegen
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal(hass.apiCalls.length, 0);
  assert.equal($(el, ".dialog .error").textContent, "Halte das Handy jetzt an den NFC-Tag …");

  hass.emit("tag_scanned", { tag_id: "neu-tag" });
  await flush();
  assert.equal($(el, ".nfcstatus").textContent, "Tag erkannt.");
  $(el, '[data-f="name"]').value = "Dose 1";
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.deepEqual(hass.apiCalls.map((c) => c.body), [
    { handler: D, show_advanced_options: false },
    { next_step_id: "create" },
    { name: "Dose 1", vacuum: true, flexible: false },
  ]);
  assert.deepEqual(hass.wsCalls.pop(), { type: `${D}/nfc_link`, tag_id: "neu-tag", entry_id: "e1" });
  assert.equal($(el, ".overlay").hidden, true);
});

function writeHass(canWriteTag) {
  const hass = nfcHass([], {});
  hass.apiCalls = [];
  hass.callApi = async (method, path, body) => {
    hass.apiCalls.push({ method, path, body });
    if (path.endsWith("flow")) return { flow_id: "f1" };
    if (body && body.next_step_id) return { type: "form" };
    return { type: "create_entry", title: "Dose 1", result: { entry_id: "e1" } };
  };
  hass.messages = [];
  hass.auth = {
    external: { config: Promise.resolve({ canWriteTag }), fireMessage: (m) => hass.messages.push(m) },
  };
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "tag/create") {
      hass.wsCalls.push(msg);
      return {};
    }
    return base(msg);
  };
  return hass;
}

test("Dialog: 'Neuen NFC-Tag beschreiben' legt Dose, Tag und Verknüpfung an und startet das Beschreiben", async () => {
  const hass = writeHass(true);
  const el = mount(hass);
  await flush();
  el.openAddDialog();
  await flush();
  assert.equal($(el, '[data-w="nfcwrite"]').hidden, false);
  const radio = $(el, 'input[name="mode"][value="nfcwrite"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event("change"));
  assert.equal($(el, ".nfcstatus").hidden, false);
  assert.match($(el, ".nfcstatus").textContent, /öffnet die App das Beschreiben/);

  $(el, '[data-f="name"]').value = "Dose 1";
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.deepEqual(hass.apiCalls.map((c) => c.body), [
    { handler: D, show_advanced_options: false },
    { next_step_id: "create" },
    { name: "Dose 1", vacuum: true, flexible: false },
  ]);
  const link = hass.wsCalls.find((c) => c.type === `${D}/nfc_link`);
  const created = hass.wsCalls.find((c) => c.type === "tag/create");
  assert.equal(link.entry_id, "e1");
  assert.match(link.tag_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(created, { type: "tag/create", tag_id: link.tag_id, name: "Dose 1" });
  assert.deepEqual(hass.messages, [{ type: "tag/write", payload: { name: "Dose 1", tag: link.tag_id } }]);
  assert.equal($(el, ".overlay").hidden, true);
});

test("Dialog: 'Neuen NFC-Tag beschreiben' erscheint nur, wenn die App Tags beschreiben kann", async () => {
  for (const hass of [writeHass(false), adminHass([])]) {
    const el = mount(hass);
    await flush();
    el.openAddDialog();
    await flush();
    assert.equal($(el, '[data-w="nfcwrite"]').hidden, true);
  }
});

function recipeHass(response, { services = true, admin = true } = {}) {
  const hass = adminHass([{ id: "d1", name: "A", content: "Schinken", mhd: iso(1), portions: 5, unit: "slices" }]);
  hass.user = { is_admin: admin };
  if (services) hass.services = { ai_task: { generate_data: {} }, [D]: { suggest_recipes: {} } };
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "call_service" && msg.service === "suggest_recipes") {
      hass.wsCalls.push(msg);
      if (response instanceof Error) throw response;
      return { response };
    }
    return base(msg);
  };
  return hass;
}

test("Rezeptideen: Button nur für Administratoren und nur mit KI-Integration und Service", () => {
  assert.equal($(mount(recipeHass({})), "button.ideas").classList.contains("visible"), true);
  assert.equal($(mount(recipeHass({})), "button.ideas").textContent, "Rezeptideen");
  document.body.innerHTML = "";
  assert.equal($(mount(recipeHass({}, { services: false })), "button.ideas").classList.contains("visible"), false);
  document.body.innerHTML = "";
  assert.equal($(mount(recipeHass({}, { admin: false })), "button.ideas").classList.contains("visible"), false);
});

test("Rezeptideen: Dialog ruft den Service mit Tagen und Personen auf und zeigt die Rezepte", async () => {
  const hass = recipeHass({
    recipes: [
      { title: "Schinken-Omelett", minutes: 15, uses: ["Schinken"], extra_ingredients: ["Butter"], steps: ["Braten", "Servieren"] },
    ],
  });
  const el = mount(hass);
  $(el, "button.ideas").click();
  assert.equal($(el, ".overlay.recipes").hidden, false);
  $(el, 'form.recipeform [data-f="days"]').value = "5";
  $(el, 'form.recipeform [data-f="servings"]').value = "3";
  $(el, "form.recipeform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.deepEqual(hass.wsCalls.pop(), {
    type: "call_service",
    domain: D,
    service: "suggest_recipes",
    service_data: { days: 5, servings: 3 },
    return_response: true,
  });
  const text = $(el, ".recipelist").textContent;
  assert.match(text, /Schinken-Omelett/);
  assert.match(text, /15 Min\./);
  assert.match(text, /Verwendet: Schinken/);
  assert.match(text, /Zusätzlich: Butter/);
  assert.equal(el.shadowRoot.querySelectorAll(".recipe li").length, 2);
});

test("Rezeptideen: ohne ablaufende Dosen ein Hinweis, bei Fehler die Fehlermeldung", async () => {
  const none = recipeHass({ recipes: [] });
  const el = mount(none);
  $(el, "button.ideas").click();
  $(el, "form.recipeform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el, ".recipelist").textContent, "In den nächsten 3 Tagen läuft nichts ab.");
  assert.deepEqual(none.wsCalls.pop().service_data, { days: 3 }); // ohne Personen

  document.body.innerHTML = "";
  const failing = recipeHass(new Error("AI kaputt"));
  const el2 = mount(failing);
  $(el2, "button.ideas").click();
  $(el2, "form.recipeform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el2, ".recipeform .error").textContent, "AI kaputt");
  assert.equal($(el2, "button.submit.submit, form.recipeform button.submit").disabled, false);
});

test("Neue Dose: nach dem Anlegen öffnet sich der Befüll-Dialog, sobald ihr Gerät da ist", async () => {
  const existing = { id: "d1", name: "Alte Dose", content: "Käse" };
  const hass = adminHass([existing]);
  hass.callApi = async (method, path, body) => {
    hass.apiCalls.push({ method, path, body });
    if (path.endsWith("flow")) return { flow_id: "f1" };
    if (body && body.next_step_id) return { type: "form" };
    return { type: "create_entry", result: { entry_id: "e1" } };
  };
  const el = mount(hass);
  await flush();
  el.openAddDialog();
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el, ".overlay").hidden, true);
  assert.equal($(el, ".overlay.fill").hidden, true); // Gerät noch nicht da

  const next = adminHass([existing, { id: "d2", name: "Neue Dose" }]);
  el.hass = next;
  await flush();
  assert.equal($(el, ".overlay.fill").hidden, false);
  assert.match($(el, "form.fillform h2").textContent, /Neue Dose/);

  // nur einmal: nach dem Schließen öffnet ein weiteres hass-Update den Dialog nicht erneut
  $(el, "form.fillform button.cancel").click();
  el.hass = adminHass([existing, { id: "d2", name: "Neue Dose" }]);
  await flush();
  assert.equal($(el, ".overlay.fill").hidden, true);
});

test("Befüll-Dialog öffnet sich nicht von selbst, wenn keine Dose angelegt wurde", async () => {
  const el = mount(adminHass([{ id: "d1", name: "A" }]));
  await flush();
  el.hass = adminHass([{ id: "d1", name: "A" }, { id: "d2", name: "B" }]);
  await flush();
  assert.equal($(el, ".overlay.fill").hidden, true);
});

test("Dialog schließen beendet das Warten auf einen Tag", async () => {
  const hass = nfcHass([{ id: "d1", name: "A" }]);
  const el = mount(hass);
  await flush();
  el.openAddDialog();
  const radio = $(el, 'input[name="mode"][value="nfc"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event("change"));
  el.closeAddDialog();
  hass.emit("tag_scanned", { tag_id: "x" });
  await flush();
  assert.equal(hass.wsCalls.length, 0);
});

test("Gescannte Dose wird hervorgehoben, auch wenn ein Filter sie ausblendet", async () => {
  const hass = nfcHass([
    { id: "d1", name: "A", content: "Pizza" },
    { id: "d2", name: "B", content: "Suppe" },
  ]);
  const el = mount(hass);
  await flush();
  const query = $(el, '[data-f="query"]');
  query.value = "pizza";
  query.dispatchEvent(new dom.window.Event("input"));
  assert.deepEqual(cardNames(el), ["A"]);

  hass.emit("larder_dose_scanned", { device_id: "d2" });
  await flush();
  assert.deepEqual(cardNames(el), ["A", "B"]); // Filter zurückgesetzt
  const flashed = $$(el, ".card.flash");
  assert.equal(flashed.length, 1);
  assert.equal(flashed[0].querySelector(".name").textContent, "B");
});

test("?open=<Geräte-ID> hebt die Dose hervor (auch für Nicht-Administratoren)", async () => {
  dom.window.history.pushState(null, "", "/larder?open=d2");
  const hass = makeHass([{ id: "d1", name: "A" }, { id: "d2", name: "B" }], { areas: AREAS });
  hass.user = { is_admin: false };
  const el = mount(hass);
  await flush();
  assert.equal($$(el, ".card.flash").length, 1);
  assert.equal($(el, ".card.flash .name").textContent, "B");
  assert.equal(dom.window.location.search, ""); // Parameter ist entfernt
});

// ---------- Dose befüllen ----------

function fillHass(doses, contents = ["Pizza", "Suppe"]) {
  const hass = makeHass(doses, { areas: AREAS });
  hass.wsCalls = [];
  hass.callWS = async (msg) => {
    hass.wsCalls.push(msg);
    if (msg.type === `${D}/contents`) return { contents };
    return {};
  };
  return hass;
}

test("'Befüllen' erscheint nur bei leerer Dose und öffnet den Dialog mit Vorschlägen", async () => {
  const hass = fillHass([
    { id: "d1", name: "Leer", content: "unknown" },
    { id: "d2", name: "Voll", content: "Suppe", mhd: iso(5) },
  ]);
  const el = mount(hass);
  const buttons = $$(el, "button.fill");
  assert.deepEqual(buttons.map((b) => b.classList.contains("visible")), [true, false]);
  assert.equal(buttons[0].textContent, "Befüllen");

  buttons[0].click();
  await flush();
  const overlay = $(el, ".overlay.fill");
  assert.equal(overlay.hidden, false);
  assert.match($(el, "form.fillform h2").textContent, /Leer/);
  assert.deepEqual($$(el, "datalist option").map((o) => o.value), ["Pizza", "Suppe"]);
  assert.deepEqual(hass.wsCalls.filter((m) => m.type !== `${D}/nfc_tags`), [{ type: `${D}/contents` }]);
  assert.equal($(el, 'form.fillform [data-f="vacuum"]').checked, true);
  assert.ok($(el, 'form.fillform [data-f="filledAt"]').value.length > 0);

  $(el, "form.fillform button.cancel").click();
  assert.equal(overlay.hidden, true);
});

test("Dose befüllen: Pflichtfeld Inhalt, Speichern setzt Entitäten und schätzt das MHD", async () => {
  const hass = fillHass([{ id: "d1", name: "Dose 1", content: "unknown", ai: true }]);
  const el = mount(hass);
  el.openFillDialog("d1");
  await flush();
  const form = $(el, "form.fillform");

  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el, "form.fillform .error").textContent, STRINGS.de.fillNoContent);
  assert.equal(hass.calls.length, 0);

  $(el, 'form.fillform [data-f="content"]').value = "Pizza";
  $(el, 'form.fillform [data-f="vacuum"]').checked = false;
  $(el, 'form.fillform [data-f="quantity"]').value = "5";
  $(el, 'form.fillform [data-f="unit"]').value = "slices";
  $(el, 'form.fillform [data-f="filledAt"]').value = "2026-11-09T11:00";
  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();

  assert.deepEqual(hass.calls, [
    { domain: "text", service: "set_value", data: { entity_id: "text.d1_inhalt", value: "Pizza" } },
    { domain: "switch", service: "turn_off", data: { entity_id: "switch.d1_vacuum" } },
    { domain: "number", service: "set_value", data: { entity_id: "number.d1_portionen", value: 5 } },
    { domain: "select", service: "select_option", data: { entity_id: "select.d1_einheit", option: "slices" } },
    { domain: "datetime", service: "set_value", data: { entity_id: "datetime.d1_befuellt", datetime: "2026-11-09T10:00:00.000Z" } },
  ]);
  assert.equal($(el, ".overlay.fill").hidden, true);
  const est = hass.wsCalls.find((m) => m.type === "call_service");
  assert.equal(est.service, "estimate_best_before");
  assert.deepEqual(est.target, { entity_id: "date.d1_mhd" });
});

test("Dose befüllen: mit eingegebenem MHD oder abgewählter Schätzung wird nicht geschätzt", async () => {
  const hass = fillHass([{ id: "d1", name: "Dose 1", content: "unknown", ai: true }]);
  const el = mount(hass);
  el.openFillDialog("d1");
  await flush();
  $(el, 'form.fillform [data-f="content"]').value = "Reis";
  $(el, 'form.fillform [data-f="bestBefore"]').value = "2026-12-31";
  $(el, "form.fillform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.ok(hass.calls.some((c) => c.domain === "date" && c.data.date === "2026-12-31"));
  assert.ok(!hass.wsCalls.some((m) => m.type === "call_service"));
});

test("Dose befüllen: Schätzoption nur sichtbar, wenn Schätzung aktiv ist", async () => {
  const hass = fillHass([{ id: "d1", name: "Dose 1", content: "unknown", ai: false }]);
  const el = mount(hass);
  el.openFillDialog("d1");
  assert.equal($(el, 'form.fillform [data-w="estimate"]').hidden, true);
});

test("?open=<ID> öffnet bei leerer Dose den Befüll-Dialog, bei gefüllter nur Hervorhebung (auch ohne Admin)", async () => {
  const hass = fillHass([
    { id: "d1", name: "Leer", content: "unknown" },
    { id: "d2", name: "Voll", content: "Suppe" },
  ]);
  hass.user = { is_admin: false };
  dom.window.history.replaceState(null, "", "/larder?open=d2");
  let el = mount(hass);
  await flush();
  await flush();
  assert.equal($(el, ".overlay.fill").hidden, true);
  assert.ok($$(el, ".card")[1].classList.contains("flash"));

  document.body.innerHTML = "";
  dom.window.history.replaceState(null, "", "/larder?open=d1");
  el = mount(hass);
  await flush();
  await flush();
  assert.equal($(el, ".overlay.fill").hidden, false);
  assert.match($(el, "form.fillform h2").textContent, /Leer/);
  assert.equal(dom.window.location.search, "");
});

test("Dose befüllen: englische Texte", () => {
  const hass = fillHass([{ id: "d1", name: "Dose 1", content: "unknown" }]);
  hass.language = "en";
  const el = mount(hass);
  el.openFillDialog("d1");
  assert.match($(el, "form.fillform h2").textContent, /Fill container/);
  assert.equal($(el, "form.fillform button.submit").textContent, "Save");
});

test("Dose befüllen: Einkaufsliste-Checkbox nur mit gewählter Liste, Wert wird gespeichert", async () => {
  const hass = fillHass([
    { id: "d1", name: "Dose 1", content: "unknown", shoppingList: "todo.einkaufen" },
    { id: "d2", name: "Dose 2", content: "unknown" },
  ]);
  const el = mount(hass);
  el.openFillDialog("d2");
  await flush();
  assert.equal($(el, 'form.fillform [data-w="shopping"]').hidden, true);
  $(el, "form.fillform button.cancel").click();

  el.openFillDialog("d1");
  await flush();
  assert.equal($(el, 'form.fillform [data-w="shopping"]').hidden, false);
  assert.equal($(el, 'form.fillform [data-f="shopping"]').checked, false);
  $(el, 'form.fillform [data-f="content"]').value = "Reis";
  $(el, 'form.fillform [data-f="shopping"]').checked = true;
  $(el, "form.fillform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.ok(
    hass.calls.some(
      (c) => c.domain === "switch" && c.service === "turn_on" && c.data.entity_id === "switch.d1_einkaufsliste",
    ),
  );
});

test("„Läuft bald ab“ folgt der Einstellung (Attribut soon_days der MHD-Entität)", async () => {
  const { soonDaysOf } = await import("../../custom_components/larder/frontend/larder-panel.js");
  assert.equal(soonDaysOf(null), 3);
  assert.equal(soonDaysOf({ attributes: { soon_days: 0 } }), 0);
  assert.equal(soonDaysOf({ attributes: { soon_days: "x" } }), 3);

  const hass = makeHass(FRIDGE_DOSES, { areas: AREAS });
  const devices = collectDevices(hass);
  const run = () => names(arrangeDevices(hass, devices, { filter: "soon" }));
  assert.deepEqual(run(), ["Dose B"]);
  for (const dev of devices) {
    const st = hass.states[dev.entities.date];
    if (st) st.attributes = { ...(st.attributes || {}), soon_days: 30 };
  }
  assert.deepEqual(run(), ["Dose C", "Dose B"]);
  assert.equal(STRINGS.de.filterSoon(30), "Läuft bald ab (≤ 30 Tage)");
  assert.equal(STRINGS.en.filterSoon(1), "Expiring soon (≤ 1 day)");
});

test("Bereichsauswahl: auch Beschriftungen „Larder: …“ markieren einen Bereich, ein Label reicht", async () => {
  const { isLarderLabel } = await import("../../custom_components/larder/frontend/larder-panel.js");
  assert.equal(isLarderLabel({ name: "Larder: Freezer" }), true);
  assert.equal(isLarderLabel({ name: " larder:pantry" }), true);
  assert.equal(isLarderLabel({ name: "Larder" }), true);
  assert.equal(isLarderLabel({ name: "Larderobe" }), false);
  assert.equal(isLarderLabel({ name: "-18 °C" }), false);

  const areas = {
    kitchen: { area_id: "kitchen", name: "Küche", labels: ["lbl1"] },
    freezer: { area_id: "freezer", name: "Truhe", labels: ["frz"] },
    cellar: { area_id: "cellar", name: "Keller", labels: [] },
    garage: { area_id: "garage", name: "Garage", labels: ["temp"] },
  };
  const el = mount(
    labelHass(
      [
        { label_id: "lbl1", name: "Larder" },
        { label_id: "frz", name: "Larder: Freezer" },
        { label_id: "temp", name: "-18 °C" },
      ],
      areas,
    ),
  );
  await flush();
  el.openAddDialog();
  await flush();
  assert.deepEqual([...$(el, "form.dialog select").options].map((o) => o.textContent), ["Kein Bereich", "Küche", "Truhe"]);
});

test("Mehrere Dosen auf einmal befüllen: gleiche Angaben für alle, Schätzung für jede", async () => {
  const hass = fillHass([
    { id: "d1", name: "Dose 1", content: "unknown", ai: true },
    { id: "d2", name: "Dose 2", content: "unknown", ai: true },
  ]);
  const el = mount(hass);
  let filled = null;
  el.addEventListener("larder-filled", (ev) => (filled = ev.detail.deviceIds));
  assert.equal(el.openFillDialog(["d1", "d2", "gibt-es-nicht"]), true);
  await flush();
  assert.equal($(el, "form.fillform h2").textContent, "2 Dosen befüllen");
  $(el, 'form.fillform [data-f="content"]').value = "Bolognese";
  $(el, 'form.fillform [data-f="quantity"]').value = "2";
  $(el, "form.fillform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  await flush();
  const texts = hass.calls.filter((c) => c.domain === "text").map((c) => [c.data.entity_id, c.data.value]);
  assert.deepEqual(texts, [["text.d1_inhalt", "Bolognese"], ["text.d2_inhalt", "Bolognese"]]);
  const qty = hass.calls.filter((c) => c.domain === "number").map((c) => c.data.value);
  assert.deepEqual(qty, [2, 2]);
  const estimates = hass.wsCalls.filter((m) => m.type === "call_service").map((m) => m.target.entity_id);
  assert.deepEqual(estimates, ["date.d1_mhd", "date.d2_mhd"]);
  assert.deepEqual(filled, ["d1", "d2"]);
  assert.equal($(el, ".overlay.fill").hidden, true);
});


test("Variabler Lagerort: Schalter und „nach dem Leeren zurück in“ auf der Karte, Bereich im Befüll-Dialog", async () => {
  const hass = fillHass([
    { id: "d1", name: "Vakuumdose", content: "unknown", area: "kitchen", flexible: "on", home: "Keller" },
    { id: "d2", name: "Vorratsdose", content: "unknown", area: "cellar" },
  ]);
  hass.user = { is_admin: true };
  const el = mount(hass);
  await flush();
  const card = (name) => $$(el, ".card").find((c) => c.querySelector(".name").textContent === name);
  const flexCard = card("Vakuumdose");
  const fixedCard = card("Vorratsdose");
  assert.equal(flexCard.querySelector('[data-f="flexible"]').checked, true);
  assert.notEqual(flexCard.querySelector(".homerow").style.display, "none");
  assert.deepEqual([...flexCard.querySelectorAll('[data-f="homeArea"] option')].map((o) => o.textContent), ["bleibt, wo sie ist", "Keller", "Küche"]);
  assert.equal(flexCard.querySelector('[data-f="homeArea"]').value, "Keller");
  assert.equal(fixedCard.querySelector(".homerow").style.display, "none");

  const home = flexCard.querySelector('[data-f="homeArea"]');
  home.value = "Küche";
  home.dispatchEvent(new dom.window.Event("change"));
  fixedCard.querySelector('[data-f="flexible"]').click();
  assert.deepEqual(hass.calls.slice(-2).map((c) => [c.domain, c.service, c.data.entity_id]), [
    ["select", "select_option", "select.d1_lagerort_nach_dem_leeren"],
    ["switch", "turn_on", "switch.d2_variabler_lagerort"],
  ]);

  // Befüll-Dialog: Bereich nur bei variablem Lagerort, Speichern stellt die Dose um
  el.openFillDialog("d2");
  assert.equal($(el, 'form.fillform [data-w="area"]').hidden, true);
  el.closeFillDialog();
  el.openFillDialog("d1");
  const area = $(el, 'form.fillform [data-f="area"]');
  assert.equal($(el, 'form.fillform [data-w="area"]').hidden, false);
  assert.equal(area.value, "kitchen");
  area.value = "cellar";
  $(el, 'form.fillform [data-f="content"]').value = "Lachs";
  $(el, "form.fillform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.ok(hass.wsCalls.some((m) => m.type === "config/device_registry/update" && m.device_id === "d1" && m.area_id === "cellar"));

  // ohne Administratorrechte kein Bereichsfeld
  hass.user = { is_admin: false };
  el.hass = { ...hass };
  el.openFillDialog("d1");
  assert.equal($(el, 'form.fillform [data-w="area"]').hidden, true);
});

test("Karte einer Packung: Umfüllen-Knopf, kein NFC, kein Befüll-Datum", async () => {
  const hass = adminHass([{ id: "d1", name: "Packung 1", content: "Tomaten", product: { kind: "pack" } }, { id: "d2", name: "Dose", content: "Reis" }]);
  // Packungen haben weder "Befüllt am" noch Schalter
  for (const id of ["datetime.d1_befuellt", "switch.d1_vacuum", "switch.d1_einkaufsliste", "switch.d1_variabler_lagerort"]) {
    delete hass.entities[id];
    delete hass.states[id];
  }
  const el = mount(hass);
  const [dose, pack] = $$(el, ".card");
  assert.equal(pack.querySelector("button.transfer").hidden, false);
  assert.equal(pack.querySelector(".filledrow").style.display, "none");
  assert.equal(pack.querySelector(".vacrow").style.display, "none");
  assert.equal(pack.querySelector(".nfcrow").classList.contains("visible"), false);
  assert.equal(dose.querySelector("button.transfer").hidden, true);
  assert.equal(dose.querySelector(".filledrow").style.display, "");
  let asked = null;
  el.addEventListener("larder-transfer", (ev) => (asked = ev.detail.deviceId));
  pack.querySelector("button.transfer").click();
  assert.equal(asked, "d1");
});

test("Karte einer Packung: Mindestbestand und Verschieben", async () => {
  const hass = adminHass([{ id: "d1", name: "Packung 1", content: "Ketchup", product: { kind: "pack", min_stock: 4 } }]);
  const el = mount(hass);
  const card = $(el, ".card");
  assert.equal(card.querySelector(".minrow").hidden, false);
  const min = card.querySelector('[data-f="minStock"]');
  assert.equal(min.value, "4");
  min.value = "6";
  min.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/stock_min`), { type: `${D}/stock_min`, content: "Ketchup", min: 6 });
  let moved = null;
  el.addEventListener("larder-move", (ev) => (moved = ev.detail.deviceId));
  card.querySelector("button.move").click();
  assert.equal(moved, "d1");
});
