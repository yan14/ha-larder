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

const { STRINGS, listAreas, collectDevices, daysUntil, toLocalInputValue, sourceLabel } = await import(
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
      switch: `switch.${d.id}_vacuum`,
    };
    for (const eid of Object.values(ids)) {
      entities[eid] = { entity_id: eid, device_id: d.id, platform: D, area_id: d.entityArea || null };
    }
    states[ids.text] = { entity_id: ids.text, state: d.content ?? "unknown", attributes: {} };
    states[ids.date] = { entity_id: ids.date, state: d.mhd ?? "unknown", attributes: { estimates: !!d.ai } };
    states[ids.switch] = { entity_id: ids.switch, state: d.vacuum ?? "on", attributes: {} };
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
  assert.deepEqual(Object.keys(out[0].entities).sort(), ["button", "date", "datetime", "image", "switch", "text"]);
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
  assert.deepEqual(events, ["/config/integrations/integration/zwilling_storage"]);
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
  hass.callWS = async (msg) => {
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
    { method: "POST", path: "config/config_entries/flow/f1", body: { name: "Suppe", area_id: "cellar" } },
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
  assert.deepEqual(hass.apiCalls[2].body, { qr_code: "kaputt!" });
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

test("?add=<ID> aus dem Scan-Webhook öffnet den Dialog mit vorbelegtem Code", () => {
  dom.window.history.pushState(null, "", "/zwilling-storage?add=NEU123");
  const el = mount(adminHass());
  assert.equal($(el, ".overlay").hidden, false);
  assert.equal($(el, 'input[name="mode"]:checked').value, "scan");
  assert.equal($(el, '[data-f="code"]').value, "NEU123");
  assert.equal($(el, '[data-w="code"]').hidden, false);
  assert.equal(dom.window.location.search, ""); // Parameter wird entfernt, kein erneutes Öffnen
  $(el, "button.cancel").click();
  el.hass = adminHass();
  assert.equal($(el, ".overlay").hidden, true);
});

test("?add=<ID> für Nutzer ohne Admin-Rechte zeigt einen Hinweis statt des Dialogs", () => {
  dom.window.history.pushState(null, "", "/zwilling-storage?add=NEU123");
  const hass = adminHass();
  hass.user = { is_admin: false };
  const el = mount(hass);
  assert.equal($(el, ".overlay").hidden, true);
  assert.equal($(el, "#notice").hidden, false);
  assert.match($(el, "#notice").textContent, /Nur Administratoren.*NEU123/);
});

test("listAreas sortiert Bereiche nach Name", () => {
  assert.deepEqual(listAreas({ language: "de", areas: AREAS }).map((a) => a.id), ["cellar", "kitchen"]);
  assert.deepEqual(listAreas({}), []);
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
  $(el, "button.empty").click();
  assert.equal($(el, ".tip").textContent, "");
  assert.deepEqual(hass.calls, [{ domain: "button", service: "press", data: { entity_id: "button.d1_leeren" } }]);
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
