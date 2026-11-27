// Tests for the container panel (runs in jsdom, without Home Assistant).
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

const { STRINGS, listAreas, collectDevices, daysUntil, toLocalInputValue, sourceLabel, arrangeDevices, addDays, hassChanged } = await import(
  "../../custom_components/larder/frontend/larder-panel.js"
);

const D = "larder";

/** Builds a hass object with the given containers. */
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
  // foreign entity, must never show up
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

test("collectDevices: only Zwilling devices, sorted by area, then name; without area last", () => {
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
      ["Keller", "Dose 10"], // natural sort order
      ["Küche", "Dose A"],
      ["Küche", "Dose B"],
      [null, "Ohne Bereich"],
    ],
  );
  assert.ok(out.every((d) => d.deviceId !== "foreign"));
  assert.deepEqual(Object.keys(out[0].entities).sort(), ["button", "date", "datetime", "flexible", "homeArea", "image", "number", "select", "shopping", "switch", "text"]);
});

test("collectDevices: the user's display name and the entity's area as fallback", () => {
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

test("daysUntil and toLocalInputValue", () => {
  const now = new Date(2026, 10, 10, 15, 0);
  assert.equal(daysUntil("2026-11-10", now), 0);
  assert.equal(daysUntil("2026-11-09", now), -1);
  assert.equal(daysUntil("2026-11-13", now), 3);
  assert.equal(daysUntil("unknown", now), null);
  // 10:00 UTC = 11:00 in Berlin (Winterzeit)
  assert.equal(toLocalInputValue("2026-11-09T10:00:00+00:00"), "2026-11-09T11:00");
  assert.equal(toLocalInputValue("kaputt"), "");
});

test("panel shows area, best-before, content, stored on and empty button per container", () => {
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
    ["A", "expired", "seit gestern abgelaufen"],
    ["B", "soon", "läuft heute ab"],
    ["C", "soon", "noch 2 Tage"],
    ["D", "", ""],
    ["E", "", ""],
  ]);
});

test("a new container appears live, a removed one disappears, an area change is taken over", () => {
  const el = mount(makeHass([{ id: "d1", name: "Dose 1", area: "kitchen" }], { areas: AREAS }));
  assert.deepEqual(cardNames(el), ["Dose 1"]);
  const firstCard = $(el, ".card");

  // new container in the cellar: new registry objects, as the frontend delivers them
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
  // the existing card was reused (no rebuild, focus stays)
  assert.ok($$(el, ".card").includes(firstCard));

  // container 1 is moved to the cellar
  el.hass = makeHass(
    [
      { id: "d1", name: "Dose 1", area: "cellar" },
      { id: "d2", name: "Dose 2", area: "cellar" },
    ],
    { areas: AREAS },
  );
  assert.deepEqual(areaHeadings(el), ["Keller"]);
  assert.deepEqual(cardNames(el), ["Dose 1", "Dose 2"]);

  // container 2 is deleted
  el.hass = makeHass([{ id: "d1", name: "Dose 1", area: "cellar" }], { areas: AREAS });
  assert.deepEqual(cardNames(el), ["Dose 1"]);
});

test("state changes are taken over live, an input field with focus stays untouched", () => {
  const hass1 = makeHass([{ id: "d1", name: "Dose 1", content: "Suppe" }], { areas: AREAS });
  const el = mount(hass1);
  const input = $(el, '[data-f="content"]');
  assert.equal(input.value, "Suppe");

  // same registries, only new states (typical hass update)
  const hass2 = { ...hass1, states: { ...hass1.states } };
  hass2.states["text.d1_inhalt"] = { entity_id: "text.d1_inhalt", state: "Gulasch", attributes: {} };
  el.hass = hass2;
  assert.equal(input.value, "Gulasch");

  // user is typing: the update must not overwrite the field
  input.focus();
  assert.equal(el.shadowRoot.activeElement, input);
  input.value = "Eintopf (wird getippt)";
  const hass3 = { ...hass2, states: { ...hass2.states } };
  hass3.states["text.d1_inhalt"] = { entity_id: "text.d1_inhalt", state: "Fremdwert", attributes: {} };
  el.hass = hass3;
  assert.equal(input.value, "Eintopf (wird getippt)");

  // after leaving the field the value follows again
  input.blur();
  el.hass = { ...hass3, states: { ...hass3.states } };
  assert.equal(input.value, "Fremdwert");
});

test("inputs and buttons call the right services", async () => {
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
  // 6.7 (#199): "Eaten" / "Thrown away" right at the bottom of a filled card; without WebSocket the button is pressed
  assert.equal($(el, ".outcomerow").hidden, false);
  assert.equal($(el, "button.empty").hidden, true);
  assert.equal(hass.calls.length, 4);
  $(el, "button.eaten").click();
  await new Promise((r) => setTimeout(r, 0));

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

test("an empty best-before input clears the date via the service (date.set_value cannot)", () => {
  const hass = makeHass([{ id: "d1", name: "Dose 1", mhd: "2026-12-24" }], { areas: AREAS });
  const el = mount(hass);
  const mhd = $(el, '[data-f="bestBefore"]');
  mhd.value = "";
  mhd.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(hass.calls, [{ domain: D, service: "clear_best_before", data: { entity_id: "date.d1_mhd" } }]);
});

test("unavailable entities disable the controls", () => {
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

test("open device and side menu", () => {
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

test("without containers: hint with a link to the integration", () => {
  const el = mount(makeHass([], { areas: AREAS }));
  assert.equal($$(el, ".card").length, 0);
  assert.match($(el, ".none h2").textContent, /Noch keine Dosen/);
  assert.equal($(el, ".count").textContent, "0 Dosen");
  const events = [];
  window.addEventListener("location-changed", () => events.push(window.location.pathname));
  $(el, ".none a").click();
  assert.deepEqual(events, ["/config/integrations/integration/larder"]);
});

test("English interface", () => {
  const el = mount(
    makeHass([{ id: "d1", name: "Box 1", area: "kitchen", mhd: iso(2) }], { areas: AREAS, language: "en" }),
  );
  assert.equal($(el, '[data-l="filledAt"]').textContent, "Filled on");
  assert.equal($(el, "button.empty").textContent, "Empty container");
  assert.match($(el, ".arealine").textContent, /Area: Küche/);
  assert.equal($(el, ".badge").textContent, "2 days left");
  assert.equal($(el, ".count").textContent, "1 container");
});

test("a container without area gets 'No area'", () => {
  const el = mount(makeHass([{ id: "d1", name: "Dose 1" }], { areas: AREAS }));
  assert.deepEqual(areaHeadings(el), ["Kein Bereich"]);
  assert.match($(el, ".arealine").textContent, /Bereich: Kein Bereich/);
});

test("German and English panel texts are complete and alike", () => {
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
  // the text must not accidentally be identical German in both languages
  assert.notEqual(STRINGS.de.emptyContainer, STRINGS.en.emptyContainer);
  assert.notEqual(STRINGS.de.noneText, STRINGS.en.noneText);
});

// ---------- Add container, change area ----------

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
    if (msg.type === `${D}/nfc_tags`) return { by_device: hass.nfcLinks }; // background fetch, do not count
    if (msg.type === "config/label_registry/list") return []; // background fetch, do not count
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

test("administrator sees 'Add container' and the area choice, others do not", () => {
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

test("changing the area of a container calls the device registry; 'No area' removes it", async () => {
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

test("change area: an error is shown", async () => {
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

test("add container: new QR code via the config flow, with name and area", async () => {
  const hass = adminHass(undefined, [...FLOW, { type: "create_entry", title: "Suppe" }]);
  const el = mount(hass);
  $(el, "button.add").click();
  assert.equal($(el, ".overlay").hidden, false);
  assert.equal($(el, '[data-w="code"]').hidden, true); // code only in Zwilling mode
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

test("add container: read a Zwilling QR code, an invalid code shows an error and ends the flow", async () => {
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
  assert.equal($(el, ".overlay").hidden, false); // dialog stays open
});

test("add container: already existing container and empty code in Zwilling mode", async () => {
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
  assert.equal(hass.apiCalls.length, 0); // without a code nothing is sent at all
  assert.match($(el, ".dialog .error").textContent, /keine gültige ID/);

  $(el, '[data-f="code"]').value = "34OL";
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el, ".dialog .error").textContent, "Diese Dose wurde bereits hinzugefügt.");
  assert.ok(hass.apiCalls.every((c) => c.method !== "DELETE")); // an aborted flow needs no DELETE
});

test("a network error while adding shows a general message", async () => {
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

test("?add=<ID> from the scan webhook opens the dialog with the code prefilled", async () => {
  dom.window.history.pushState(null, "", "/larder?add=NEU123");
  const el = mount(adminHass());
  await flush();
  await flush();
  assert.equal($(el, ".overlay").hidden, false);
  assert.equal($(el, 'input[name="mode"]:checked').value, "scan");
  assert.equal($(el, '[data-f="code"]').value, "NEU123");
  assert.equal($(el, '[data-w="code"]').hidden, false);
  assert.equal(dom.window.location.search, ""); // parameter is removed, no reopening
  $(el, "button.cancel").click();
  el.hass = adminHass();
  assert.equal($(el, ".overlay").hidden, true);
});

test("?add=<ID> for users without admin rights shows a hint instead of the dialog", async () => {
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

test("listAreas: only areas with the label, without a marked area all, the current one stays", () => {
  const areas = {
    kitchen: { area_id: "kitchen", name: "Küche", labels: ["larder"] },
    cellar: { area_id: "cellar", name: "Keller", labels: [] },
    pantry: { area_id: "pantry", name: "Vorrat", labels: ["larder", "x"] },
    garage: { area_id: "garage", name: "Garage" },
  };
  const hass = { language: "de", areas };
  const ids = (list) => list.map((a) => a.id);
  assert.deepEqual(ids(listAreas(hass, "larder")), ["kitchen", "pantry"]);
  assert.deepEqual(ids(listAreas(hass, "larder", "cellar")), ["cellar", "kitchen", "pantry"]); // the current area stays selectable
  assert.deepEqual(ids(listAreas(hass, null)), ["garage", "cellar", "kitchen", "pantry"]); // without a label: all
  assert.deepEqual(ids(listAreas(hass, "unbekannt")), ["garage", "cellar", "kitchen", "pantry"]); // nobody has it: all
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

test("area choice: with label 'Larder' only marked areas (plus the container's current area)", async () => {
  const el = mount(labelHass([{ label_id: "lbl1", name: "Larder" }], LABELED_AREAS));
  await flush();
  const cardOptions = [...$(el, '.card [data-f="area"]').options].map((o) => o.textContent);
  assert.deepEqual(cardOptions, ["Kein Bereich", "Keller", "Küche"]); // cellar: current area of the container, garage missing
  el.openAddDialog();
  await flush();
  assert.deepEqual([...$(el, "form.dialog select").options].map((o) => o.textContent), ["Kein Bereich", "Küche"]);
});

test("area choice: the label is found by its name, however it is written", async () => {
  const el = mount(labelHass([{ label_id: "abc", name: " LARDER " }], { ...LABELED_AREAS, kitchen: { area_id: "kitchen", name: "Küche", labels: ["abc"] } }));
  await flush();
  el.openAddDialog();
  await flush();
  assert.deepEqual([...$(el, "form.dialog select").options].map((o) => o.textContent), ["Kein Bereich", "Küche"]);
});

test("area choice: without label, without marked areas or on error all areas appear", async () => {
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

// ---------- Vacuum and best-before estimate ----------

test("vacuum switch shows the state and switches the entity", () => {
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

test("shopping list: switch only visible when a list is chosen, and separate from the vacuum switch", () => {
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

test("shopping list is also recognised via translation_key, the vacuum switch stays untouched", () => {
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

test("'Estimate best-before' only appears with AI enabled, content present and empty best-before", () => {
  const visible = (hass) => {
    document.body.innerHTML = "";
    const el = mount(hass);
    return $(el, ".estimate").style.display !== "none" && $(el, ".estimaterow").classList.contains("visible");
  };
  assert.equal(visible(adminHass([{ id: "d1", name: "A", content: "Suppe", ai: true }])), true);
  assert.equal(visible(adminHass([{ id: "d1", name: "A", content: "Suppe", ai: false }])), false); // AI off
  assert.equal(visible(adminHass([{ id: "d1", name: "A", content: "Suppe", ai: true, mhd: "2030-01-01" }])), false); // MHD da
  assert.equal(visible(adminHass([{ id: "d1", name: "A", ai: true }])), false); // no content
});

test("estimate best-before calls the service and shows the estimate with the tip", async () => {
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
  assert.equal($(el, "button.estimate").disabled, true); // locked meanwhile
  await flush();
  assert.deepEqual(hass.wsCalls, [
    {
      type: "call_service",
      domain: D,
      service: "estimate_best_before",
      service_data: { language: "de" }, // 6.2 (#172): the user's language
      target: { entity_id: dateId },
      return_response: true,
    },
  ]);
  assert.equal($(el, ".tip").textContent, "Geschätzt: ca. 4 Tage haltbar (Tabelle). Gut verschließen");
  assert.equal($(el, "button.estimate").disabled, false);
  assert.equal($(el, ".estimaterow").classList.contains("visible"), true);

  // typing in the content field clears the hint again
  $(el, '[data-f="content"]').dispatchEvent(new dom.window.Event("input"));
  assert.equal($(el, ".tip").textContent, "");
});

test("estimate best-before: a service error is shown as a message", async () => {
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

test("estimate best-before: English texts", async () => {
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

test("'Empty container' clears the estimate hint, the vacuum switch stays untouched", async () => {
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
  $(el, "button.thrown").click();
  await flush();
  assert.deepEqual(hass.calls, []);
  assert.deepEqual(ws, [{ type: "larder/empty", device_id: "d1", outcome: "thrown" }]);
});

test("clearing best-before and 'stored on' in the panel calls the clear services", () => {
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

// ---------- Source of the estimate, list of remembered estimates ----------

test("sourceLabel names table, AI and the origin for corrections", () => {
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

function estimatesHass(entries = ENTRIES, suggestions = []) {
  const hass = adminHass([{ id: "d1", name: "A", area: "kitchen" }]);
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/nfc_tags`) return { by_device: {} };
    if (msg.type === `${D}/estimate_suggestions`) return { suggestions };
    if (msg.type === `${D}/estimate_suggestion`) {
      hass.wsCalls.push(msg);
      return { suggestions: [], entries: entries.map((e) => (e.key === msg.key ? { ...e, days: 2 } : e)) };
    }
    if (msg.type === "config/label_registry/list") return [];
    hass.wsCalls.push(msg);
    if (msg.type === `${D}/estimates`) return { mode: "table", entries };
    return { entries: msg.type.endsWith("delete") ? entries.slice(1) : entries };
  };
  return hass;
}

test("tab 'Estimates' for administrators only", () => {
  const user = adminHass();
  user.user = { is_admin: false };
  assert.equal($(mount(user), ".tabs").classList.contains("visible"), false);
  document.body.innerHTML = "";
  assert.equal($(mount(adminHass()), ".tabs").classList.contains("visible"), true);
});

test("tab 'Estimates' loads and shows entries with source", async () => {
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

test("estimates: save, delete (with confirmation) and add call the commands", async () => {
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
  add.querySelector("button.save").click(); // empty: send nothing
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

test("estimates: a server error is shown", async () => {
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

test("addDays shifts ISO dates across month and year boundaries", () => {
  assert.equal(addDays("2026-11-10", 1), "2026-11-11");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("", 1), null);
});

test("arrangeDevices: filter, search and sorting", () => {
  const hass = makeHass(FRIDGE_DOSES, { areas: AREAS });
  const devices = collectDevices(hass);
  const run = (opts) => names(arrangeDevices(hass, devices, opts));
  assert.deepEqual(run({}), ["Dose C", "Dose D", "Dose E", "Dose A", "Dose B"]); // by area: cellar, kitchen
  assert.deepEqual(run({ filter: "soon" }), ["Dose B"]);
  assert.deepEqual(run({ filter: "expired" }), ["Dose A"]);
  assert.deepEqual(run({ filter: "filled" }), ["Dose C", "Dose E", "Dose A", "Dose B"]);
  assert.deepEqual(run({ filter: "empty" }), ["Dose D"]);
  assert.deepEqual(run({ query: "pizza" }), ["Dose A"]);
  assert.deepEqual(run({ query: "KELLER" }), ["Dose C", "Dose D", "Dose E"]); // search in the area name
  assert.deepEqual(run({ query: "dose b" }), ["Dose B"]);
  assert.deepEqual(run({ sort: "date" }), ["Dose A", "Dose B", "Dose C", "Dose D", "Dose E"]); // without best-before last
  assert.deepEqual(run({ sort: "name" }), ["Dose A", "Dose B", "Dose C", "Dose D", "Dose E"]);
  assert.deepEqual(run({ query: "xyz" }), []);
});

test("toolbar: search and filter hide cards, sorting by best-before removes the area headings", () => {
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
  assert.match($(el, ".none").textContent, /Nichts passt/);
});

test("toolbar settings are remembered in the browser", () => {
  const el = mount(adminHass(FRIDGE_DOSES));
  const filter = $(el, '[data-f="filter"]');
  filter.value = "soon";
  filter.dispatchEvent(new dom.window.Event("change"));
  document.body.innerHTML = "";
  const again = mount(adminHass(FRIDGE_DOSES));
  assert.equal($(again, '[data-f="filter"]').value, "soon");
  assert.deepEqual(cardNames(again), ["Dose B"]);
});

test("toolbar is hidden without containers and in the 'Estimates' tab", async () => {
  assert.equal($(mount(adminHass([])), ".toolbar").hidden, true);
  document.body.innerHTML = "";
  const el = mount(estimatesHass());
  $(el, '[data-view="estimates"]').click();
  await flush();
  assert.equal($(el, ".toolbar").hidden, true);
});

test("quick actions: +1 day sets the best-before date, Opened calls the service", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Ketchup", mhd: "2026-12-31" }]);
  const el = mount(hass);
  const dateId = "date.d1_mhd";
  assert.equal($(el, ".quickrow").classList.contains("visible"), true);
  $(el, "button.plus1").click();
  assert.deepEqual(hass.calls, [{ domain: "date", service: "set_value", data: { entity_id: dateId, date: "2027-01-01" } }]);
  // 5.5: Opened asks for the response and shows where the value comes from
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "call_service") {
      hass.wsCalls.push(msg);
      return { response: { [dateId]: { days: 180, source: "table", tip: "Nach dem Öffnen: 6 Monate (Kühlschrank, Quelle: USDA FoodKeeper)." } } };
    }
    return base(msg);
  };
  $(el, "button.opened").click();
  await flush();
  const call = hass.wsCalls.find((m) => m.type === "call_service");
  assert.equal(call.service, "mark_opened");
  assert.deepEqual(call.target, { entity_id: dateId });
  assert.match($(el, ".card .tip").textContent, /6 Monate.*FoodKeeper/);
  // without a known value: says that the setting was used
  hass.callWS = async (msg) => (msg.type === "call_service" ? { response: { [dateId]: { days: 14, source: "setting" } } } : base(msg));
  $(el, "button.opened").click();
  await flush();
  assert.match($(el, ".card .tip").textContent, /14 Tage laut Einstellung/);
});

test("quick actions: Thawed calls the service mark_thawed", () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Chili", mhd: "2027-03-01" }]);
  const el = mount(hass);
  assert.equal($(el, "button.thawed").textContent, "Aufgetaut");
  $(el, "button.thawed").click();
  assert.deepEqual(hass.calls, [{ domain: D, service: "mark_thawed", data: { entity_id: "date.d1_mhd" } }]);
});

test("amount: input and unit on the card set the entities, empty becomes 0", () => {
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

test("take a portion: −1 subtracts, asks about emptying at the last one", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Bolognese", portions: 2, unit: "portions" }]);
  const el = mount(hass);
  const take = $(el, ".card button.take");
  assert.equal(take.hidden, false);
  take.click();
  assert.deepEqual(hass.calls, [{ domain: "number", service: "set_value", data: { entity_id: "number.d1_portionen", value: 1 } }]);

  // last portion: ask first
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

  // grams or without amount: no −1
  document.body.innerHTML = "";
  const grams = mount(adminHass([{ id: "d1", name: "A", content: "Reis", portions: 500, unit: "grams" }]));
  assert.equal($(grams, ".card button.take").hidden, true);
  document.body.innerHTML = "";
  const none = mount(adminHass([{ id: "d1", name: "A", content: "Reis" }]));
  assert.equal($(none, ".card button.take").hidden, true);
});

test("5.0: slim card – big actions on top, the rest under More; −1 of a pack asks used up or thrown away", async () => {
  const hass = adminHass([{ id: "d1", name: "Packung 1", content: "Tomaten", portions: 3, unit: "pieces", product: { kind: "pack" } }]);
  const el = mount(hass);
  const card = $(el, ".card");
  // 6.7 (#199): emptying moved to the bottom, "Open device" under More
  assert.deepEqual([...card.querySelectorAll(".bigactions > button")].map((b) => b.className), ["take", "openpack", "move"]);
  assert.equal(card.querySelector(".outcomerow").hidden, false);
  assert.ok(card.querySelector("details.more > a.open"));
  assert.ok(card.querySelector("details.more .minrow"));
  assert.ok(card.querySelector("details.more details.nutrition"));
  assert.equal(card.querySelector("details.more > summary").textContent, "Mehr");
  card.querySelector("button.take").click();
  assert.deepEqual(hass.calls, []);
  assert.equal(card.querySelector(".takerow").hidden, false);
  card.querySelector("button.tthrown").click();
  await flush();
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === "larder/pack_take"), [{ type: "larder/pack_take", device_id: "d1", outcome: "thrown" }]);
  assert.equal(card.querySelector(".takerow").hidden, true);
});

test("history: expanding loads the container's latest entries", async () => {
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

test("barcode in the fill dialog: product name from Open Food Facts", async () => {
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
  // without the app's scanner: no button
  document.body.innerHTML = "";
  const plain = mount(adminHass([{ id: "d1", name: "A" }]));
  plain.openFillDialog("d1");
  assert.equal(plain.shadowRoot.querySelector("form.fillform button.barcode").hidden, true);
});

test("household allergens: hint on the card", async () => {
  const hass = adminHass([{ id: "d1", name: "A", content: "Müsli", product: { allergen_warning: ["Gluten", "Schalenfrüchte"] } }]);
  const el = mount(hass);
  const warn = $(el, ".card .allergen-warning");
  assert.equal(warn.hidden, false);
  assert.equal(warn.textContent, "⚠ Enthält Gluten, Schalenfrüchte (Allergene im Haushalt)");
});

test("nutrition on the card: show and change one by one", async () => {
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
  // empty container: hidden
  document.body.innerHTML = "";
  const empty = mount(adminHass([{ id: "d1", name: "A" }]));
  assert.equal($(empty, ".card details.nutrition").hidden, true);
});

test("content from a photo in the fill dialog (AI)", async () => {
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
  // without AI: no button
  document.body.innerHTML = "";
  const plain = mount(adminHass([{ id: "d1", name: "A" }]));
  plain.openFillDialog("d1");
  assert.equal(plain.shadowRoot.querySelector("form.fillform button.photo").hidden, true);
});

test("quick actions: hidden without content, +1 day locked without best-before", () => {
  const empty = mount(adminHass([{ id: "d1", name: "A" }]));
  assert.equal($(empty, ".quickrow").classList.contains("visible"), false);
  document.body.innerHTML = "";
  const noDate = mount(adminHass([{ id: "d1", name: "A", content: "Käse" }]));
  assert.equal($(noDate, ".quickrow").classList.contains("visible"), true);
  assert.equal($(noDate, "button.plus1").disabled, true);
  assert.equal($(noDate, "button.opened").disabled, false);
});

// ---------- NFC ----------

/** hass with event subscription: `emit(type, data)` simulates an event from Home Assistant. */
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

test("card: link NFC tag waits for the next scan and links it", async () => {
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

  // scans are ignored without waiting
  hass.emit("tag_scanned", { tag_id: "zzz" });
  await flush();
  assert.equal(hass.wsCalls.length, 0);

  $(el, "button.nfcbtn").click(); // unlink
  await flush();
  assert.deepEqual(hass.wsCalls.pop(), { type: `${D}/nfc_unlink`, device_id: "d1" });
  assert.equal($(el, ".nfcstate").textContent, "Kein NFC-Tag");
});

test("card: waiting can be cancelled, an already linked tag is rejected", async () => {
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
  assert.equal(row(0).querySelector(".nfcstate").textContent, "Halte das Handy jetzt an den NFC-Tag …"); // keeps waiting

  row(0).querySelector("button.nfcbtn").click(); // Abbrechen
  await flush();
  assert.equal(row(0).querySelector(".nfcstate").textContent, "Kein NFC-Tag");
});

test("non-administrators see no NFC row", async () => {
  const hass = nfcHass([{ id: "d1", name: "A" }]);
  hass.user = { is_admin: false };
  const el = mount(hass);
  await flush();
  assert.equal($(el, ".nfcrow").classList.contains("visible"), false);
});

test("dialog: 'Scan NFC tag' waits for the tag, creates the container and links the tag", async () => {
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

  // no creating without a tag
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

test("dialog: 'Write new NFC tag' creates container, tag and link and starts writing", async () => {
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

test("dialog: 'Write new NFC tag' only appears when the app can write tags", async () => {
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

test("recipe ideas: button only for administrators and only with AI integration and service", () => {
  assert.equal($(mount(recipeHass({})), "button.ideas").classList.contains("visible"), true);
  assert.equal($(mount(recipeHass({})), "button.ideas").textContent, "Rezeptideen");
  document.body.innerHTML = "";
  assert.equal($(mount(recipeHass({}, { services: false })), "button.ideas").classList.contains("visible"), false);
  document.body.innerHTML = "";
  assert.equal($(mount(recipeHass({}, { admin: false })), "button.ideas").classList.contains("visible"), false);
});

test("recipe ideas: dialog calls the service with days and persons and shows the recipes", async () => {
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

test("recipe ideas: a hint without expiring containers, the error message on error", async () => {
  const none = recipeHass({ recipes: [] });
  const el = mount(none);
  $(el, "button.ideas").click();
  $(el, "form.recipeform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el, ".recipelist").textContent, "In den nächsten 3 Tagen läuft nichts ab.");
  assert.deepEqual(none.wsCalls.pop().service_data, { days: 3 }); // without persons

  document.body.innerHTML = "";
  const failing = recipeHass(new Error("AI kaputt"));
  const el2 = mount(failing);
  $(el2, "button.ideas").click();
  $(el2, "form.recipeform").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.equal($(el2, ".recipeform .error").textContent, "AI kaputt");
  assert.equal($(el2, "button.submit.submit, form.recipeform button.submit").disabled, false);
});

test("new container: after creating, the fill dialog opens as soon as its device is there", async () => {
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
  assert.equal($(el, ".overlay.fill").hidden, true); // device not there yet

  const next = adminHass([existing, { id: "d2", name: "Neue Dose" }]);
  el.hass = next;
  await flush();
  assert.equal($(el, ".overlay.fill").hidden, false);
  assert.match($(el, "form.fillform h2").textContent, /Neue Dose/);

  // only once: after closing, another hass update does not open the dialog again
  $(el, "form.fillform button.cancel").click();
  el.hass = adminHass([existing, { id: "d2", name: "Neue Dose" }]);
  await flush();
  assert.equal($(el, ".overlay.fill").hidden, true);
});

test("the fill dialog does not open by itself when no container was created", async () => {
  const el = mount(adminHass([{ id: "d1", name: "A" }]));
  await flush();
  el.hass = adminHass([{ id: "d1", name: "A" }, { id: "d2", name: "B" }]);
  await flush();
  assert.equal($(el, ".overlay.fill").hidden, true);
});

test("closing the dialog ends waiting for a tag", async () => {
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

test("a scanned container is highlighted, even if a filter hides it", async () => {
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
  assert.deepEqual(cardNames(el), ["A", "B"]); // filter reset
  const flashed = $$(el, ".card.flash");
  assert.equal(flashed.length, 1);
  assert.equal(flashed[0].querySelector(".name").textContent, "B");
});

test("?open=<device ID> highlights the container (for non-administrators too)", async () => {
  dom.window.history.pushState(null, "", "/larder?open=d2");
  const hass = makeHass([{ id: "d1", name: "A" }, { id: "d2", name: "B" }], { areas: AREAS });
  hass.user = { is_admin: false };
  const el = mount(hass);
  await flush();
  assert.equal($$(el, ".card.flash").length, 1);
  assert.equal($(el, ".card.flash .name").textContent, "B");
  assert.equal(dom.window.location.search, ""); // parameter is removed
});

// ---------- Fill container ----------

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

test("'Fill' only appears for an empty container and opens the dialog with suggestions", async () => {
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

test("fill container: content is required, saving sets entities and estimates the best-before date", async () => {
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
  // 6.8 (#220): the day only; a past day counts as noon
  $(el, 'form.fillform [data-f="filledAt"]').value = "2026-11-09";
  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();

  assert.deepEqual(hass.calls, [
    { domain: "text", service: "set_value", data: { entity_id: "text.d1_inhalt", value: "Pizza" } },
    { domain: "switch", service: "turn_off", data: { entity_id: "switch.d1_vacuum" } },
    { domain: "number", service: "set_value", data: { entity_id: "number.d1_portionen", value: 5 } },
    { domain: "select", service: "select_option", data: { entity_id: "select.d1_einheit", option: "slices" } },
    { domain: "datetime", service: "set_value", data: { entity_id: "datetime.d1_befuellt", datetime: "2026-11-09T11:00:00.000Z" } },
  ]);
  assert.equal($(el, ".overlay.fill").hidden, true);
  const est = hass.wsCalls.find((m) => m.type === "call_service");
  assert.equal(est.service, "estimate_best_before");
  assert.deepEqual(est.target, { entity_id: "date.d1_mhd" });
});

test("fill container: no estimate with an entered best-before date or a deselected estimate", async () => {
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

test("fill container: estimate option only visible when estimating is active", async () => {
  const hass = fillHass([{ id: "d1", name: "Dose 1", content: "unknown", ai: false }]);
  const el = mount(hass);
  el.openFillDialog("d1");
  assert.equal($(el, 'form.fillform [data-w="estimate"]').hidden, true);
});

test("?open=<ID> opens the fill dialog for an empty container, only highlights a filled one (also without admin)", async () => {
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

test("fill container: English texts", () => {
  const hass = fillHass([{ id: "d1", name: "Dose 1", content: "unknown" }]);
  hass.language = "en";
  const el = mount(hass);
  el.openFillDialog("d1");
  assert.match($(el, "form.fillform h2").textContent, /Fill container/);
  assert.equal($(el, "form.fillform button.submit").textContent, "Save");
});

test("fill container: shopping list checkbox only with a chosen list, the value is saved", async () => {
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

test(`"Expiring soon" follows the setting (attribute soon_days of the best-before entity)`, async () => {
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

test(`area choice: labels "Larder: …" also mark an area, one label is enough`, async () => {
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

test("fill several containers at once: same details for all, an estimate for each", async () => {
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


test(`variable storage place: switch and "back to after emptying" on the card, area in the fill dialog`, async () => {
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

  // fill dialog: area only with a variable storage place, saving moves the container
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

  // no area field without administrator rights
  hass.user = { is_admin: false };
  el.hass = { ...hass };
  el.openFillDialog("d1");
  assert.equal($(el, 'form.fillform [data-w="area"]').hidden, true);
});

test("card of a pack: transfer button, no NFC, no fill date", async () => {
  const hass = adminHass([{ id: "d1", name: "Packung 1", content: "Tomaten", product: { kind: "pack" } }, { id: "d2", name: "Dose", content: "Reis" }]);
  // packs have neither "Filled on" nor switches
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

test("card of a pack: minimum stock and moving", async () => {
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

test("pack: hint at an older pack in another place", async () => {
  const hass = adminHass([
    { id: "d1", name: "Packung 1", area: "kitchen", content: "Ketchup", mhd: "2027-06-01", product: { kind: "pack" } },
    { id: "d2", name: "Packung 2", content: "ketchup", mhd: "2026-12-01", product: { kind: "pack" } },
  ]);
  const el = mount(hass);
  const cards = $$(el, ".card");
  const newer = cards.find((c) => c.querySelector(".name").textContent === "Packung 1");
  const older = cards.find((c) => c.querySelector(".name").textContent === "Packung 2");
  assert.equal(newer.querySelector(".olderhint").hidden, false);
  assert.match(newer.querySelector(".olderhint").textContent, /Ältere Packung in .*01\.12\.2026/);
  assert.equal(older.querySelector(".olderhint").hidden, true);
});

test("card: compartment suggestions from the same area, tapping saves", async () => {
  const hass = adminHass([
    { id: "d1", name: "A", area: "kitchen", content: "Reis" },
    { id: "d2", name: "B", area: "kitchen", content: "Nudeln" },
    { id: "d3", name: "C", area: "cellar", content: "Mehl" },
  ]);
  const compId = (id) => `text.${id}_fach`;
  for (const [id, comp] of [["d1", ""], ["d2", "Schublade 2"], ["d3", "Regal"]]) {
    hass.entities[compId(id)] = { entity_id: compId(id), device_id: id, platform: D, translation_key: "compartment" };
    hass.states[compId(id)] = { entity_id: compId(id), state: comp, attributes: {} };
  }
  const el = mount(hass);
  el.hass = { ...hass };
  const card = $$(el, ".card").find((c) => c.querySelector(".name").textContent === "A");
  const chips = [...card.querySelectorAll(".compchip")];
  assert.deepEqual(chips.map((c) => c.textContent), ["Schublade 2"]);
  chips[0].click();
  assert.deepEqual(hass.calls.at(-1), { domain: "text", service: "set_value", data: { entity_id: compId("d1"), value: "Schublade 2" } });
});

test("estimates: accept or ignore suggestions from the history", async () => {
  const hass = estimatesHass(ENTRIES, [
    { key: ENTRIES[0].key, content: "Pizza", area: "Kühlschrank", vacuum: true, days: 3, suggested: 2, direction: "shorter", count: 2 },
  ]);
  const el = mount(hass);
  $(el, '[data-view="estimates"]').click();
  await flush();
  await flush();
  const box = $(el, "#estimates .est.suggest");
  assert.match(box.textContent, /Pizza: 3 → 2 Tage/);
  assert.match(box.textContent, /2× vor dem MHD weggeworfen/);
  box.querySelector('[data-role="suggestion-accept"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.at(-1), { type: `${D}/estimate_suggestion`, key: ENTRIES[0].key, action: "accept" });
  assert.equal($(el, "#estimates .est.suggest"), null);
  assert.equal($$(el, "#estimates .est:not(.new)")[0].querySelector('[data-f="days"]').value, "2");
});

test("card of a pack: open and mark 'opened'", async () => {
  const hass = adminHass([
    { id: "d1", name: "Packung 1", content: "Ketchup", product: { kind: "pack" } },
    { id: "d2", name: "Packung 2", content: "Senf", product: { kind: "pack", opened: "2026-11-10" } },
  ]);
  const el = mount(hass);
  const card = (name) => $$(el, ".card").find((c) => c.querySelector(".name").textContent === name);
  assert.equal(card("Packung 1").querySelector("button.openpack").hidden, false);
  assert.equal(card("Packung 1").querySelector(".openedline").hidden, true);
  assert.equal(card("Packung 2").querySelector("button.openpack").hidden, true);
  assert.equal(card("Packung 2").querySelector(".openedline").textContent, "🔓 Angebrochen am 10.11.2026");
  let asked = null;
  el.addEventListener("larder-open-pack", (ev) => (asked = ev.detail.deviceId));
  card("Packung 1").querySelector("button.openpack").click();
  assert.equal(asked, "d1");
});

test("card of a pack: lasts (all places) and remembered price as placeholder", async () => {
  const hass = adminHass([
    { id: "d1", name: "Packung 1", content: "Ketchup", portions: 2, product: { kind: "pack", consumption_per_week: 0.5, consumption_basis: { takes: 4, days: 180 }, price_remembered: 1.99 } },
    { id: "d2", name: "Packung 2", content: "ketchup", portions: 1, product: { kind: "pack", price: 2.49 } },
  ]);
  for (const id of ["d1", "d2"]) hass.states[`select.${id}_einheit`].state = "pieces";
  const el = mount(hass);
  const card = $$(el, ".card").find((c) => c.querySelector(".name").textContent === "Packung 1");
  const line = card.querySelector(".usageline");
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, "📉 Reicht noch ca. 6 Wochen (aus 4 Entnahmen in 6 Monaten)");
  assert.equal(card.querySelector('[data-p="price"]').placeholder, "1.99");
  // price line: remembered price; value across both packs (2 × 1.99 + 1 × 2.49)
  assert.equal(card.querySelector(".priceline").textContent, "💶 1,99 € je Packung · alle zusammen ca. 6,47 €");
});

test("card of a pack: price estimate from Open Prices, no row without a price", async () => {
  const hass = adminHass([
    { id: "d1", name: "Packung 1", content: "Tomaten", portions: 1, product: { kind: "pack", price_remembered: 1.49, price_remembered_source: "openprices" } },
    { id: "d2", name: "Packung 2", content: "Senf", portions: 1, product: { kind: "pack" } },
  ]);
  for (const id of ["d1", "d2"]) hass.states[`select.${id}_einheit`].state = "pieces";
  const el = mount(hass);
  const card = (n) => $$(el, ".card").find((c) => c.querySelector(".name").textContent === n);
  assert.equal(card("Packung 1").querySelector(".priceline").textContent, "💶 ca. 1,49 € je Packung (Open Prices)");
  assert.equal(card("Packung 2").querySelector(".priceline").hidden, true);
});

test("card: recall with link, no row without a recall", async () => {
  const hass = adminHass([
    { id: "d1", name: "Packung 1", content: "Ketchup", portions: 1, product: { kind: "pack", recall: { id: "x", title: "Heinz Ketchup", reason: "Glassplitter", link: "https://www.lebensmittelwarnung.de/meldung/1" } } },
    { id: "d2", name: "Packung 2", content: "Senf", portions: 1, product: { kind: "pack" } },
  ]);
  const el = mount(hass);
  const card = (n) => $$(el, ".card").find((c) => c.querySelector(".name").textContent === n);
  const line = card("Packung 1").querySelector(".recallline");
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /Rückrufwarnung: Heinz Ketchup – Glassplitter/);
  assert.equal(line.querySelector("a").href, "https://www.lebensmittelwarnung.de/meldung/1");
  assert.equal(card("Packung 2").querySelector(".recallline").hidden, true);
});

// ---------- Block 10: sizes and batch cooking ----------

test("card: size fixed or variable, not for packs", async () => {
  const hass = fillHass([
    { id: "d1", name: "Dose 1", content: "unknown" },
    { id: "d2", name: "Deckel", content: "Suppe", mhd: iso(5) },
    { id: "p1", name: "Packung 1", content: "Senf", product: { kind: "pack" } },
  ]);
  hass.states["text.d1_inhalt"].attributes = { kind: "container", size_fixed: "1 l", size: "1 l" };
  hass.states["text.d2_inhalt"].attributes = { kind: "container", size_variable: true, size: "2 l", size_last: "2 l" };
  const el = mount(hass);
  await flush();
  const card = (n) => $$(el, ".card").find((c) => c.querySelector(".name").textContent === n);
  assert.equal(card("Packung 1").querySelector(".sizerow").hidden, true);
  const fixed = card("Dose 1");
  assert.equal(fixed.querySelector(".sizerow").hidden, false);
  assert.equal(fixed.querySelector('[data-f="size"]').value, "1 l");
  assert.equal(fixed.querySelector('[data-f="sizeVariable"]').checked, false);
  const variable = card("Deckel");
  assert.equal(variable.querySelector('[data-f="sizeVariable"]').checked, true);
  assert.equal(variable.querySelector('[data-f="size"]').value, "2 l");
  // change the fixed size
  const size = fixed.querySelector('[data-f="size"]');
  size.value = "1,5 l";
  size.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(hass.wsCalls.at(-1), { type: `${D}/size_set`, device_id: "d1", size: "1,5 l", variable: false });
  // variable container: size of the current filling
  const vsize = variable.querySelector('[data-f="size"]');
  vsize.value = "1 l";
  vsize.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(hass.wsCalls.at(-1), { type: `${D}/size_fill`, device_id: "d2", size: "1 l" });
  // switch to variable: the fixed size stays remembered
  fixed.querySelector('[data-f="sizeVariable"]').click();
  assert.deepEqual(hass.wsCalls.at(-1), { type: `${D}/size_set`, device_id: "d1", size: "1 l", variable: true });
});

test("fill with presets (batch cooking): amount per container and size of the variable containers", async () => {
  const hass = fillHass([
    { id: "d1", name: "Dose 1", content: "unknown" },
    { id: "d2", name: "Deckel", content: "unknown" },
  ]);
  hass.states["text.d1_inhalt"].attributes = { kind: "container", size_fixed: "1 l" };
  hass.states["text.d2_inhalt"].attributes = { kind: "container", size_variable: true, size_last: "2 l" };
  const el = mount(hass);
  await flush();
  el.openFillDialog(["d1", "d2"], { content: "Chili", quantities: { d1: 1000, d2: 500 }, unit: "milliliters", sizes: { d2: "0,5 l" } });
  await flush();
  const form = $(el, "form.fillform");
  assert.equal(form.querySelector('[data-f="content"]').value, "Chili");
  assert.equal(form.querySelector('[data-w="boxsize"]').hidden, false);
  assert.equal(form.querySelector('[data-f="boxSize"]').value, "0,5 l");
  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  await flush();
  await flush();
  assert.deepEqual(hass.calls.filter((c) => c.domain === "number").map((c) => [c.data.entity_id, c.data.value]), [["number.d1_portionen", 1000], ["number.d2_portionen", 500]]);
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === `${D}/size_fill`), [{ type: `${D}/size_fill`, device_id: "d2", size: "0,5 l" }]);
});

test("Card of a household item / medicine: optional date, pieces and packs, period after opening, convert (4.4)", async () => {
  const hass = adminHass([
    { id: "d1", name: "Artikel 1", content: "Klopapier", product: { kind: "household", pack_size: 8, piece: "Rollen" } },
    { id: "d2", name: "Packung 1", content: "Senf", product: { kind: "pack" } },
    { id: "d3", name: "Medikament 1", content: "Ibuprofen", product: { kind: "medicine" } },
  ]);
  hass.states["number.d1_portionen"].state = "12";
  hass.states["select.d1_einheit"].state = "pieces";
  hass.states["number.d3_portionen"].state = "1";
  hass.states["select.d3_einheit"].state = "pieces";
  const el = mount(hass);
  const cards = $$(el, ".card");
  const card = (name) => cards.find((c) => c.querySelector(".name").textContent === name);
  const [item, pack, med] = [card("Artikel 1"), card("Packung 1"), card("Medikament 1")];
  // household items may have a date now (e.g. sunscreen), medicines have an expiry date; no estimate
  assert.equal(item.querySelector(".bbrow").style.display, "");
  assert.equal(item.querySelector('[data-l="bestBefore"]').textContent, "Ablaufdatum (optional)");
  assert.equal(med.querySelector('[data-l="bestBefore"]').textContent, "Verfallsdatum");
  assert.equal(pack.querySelector('[data-l="bestBefore"]').textContent, "MHD");
  assert.equal(med.querySelector(".estimaterow").style.display, "none");
  assert.equal(item.querySelector(".packline").hidden, false);
  assert.match(item.querySelector(".packline").textContent, /12 Rollen \(1[.,]5 Packungen\)/);
  assert.equal(pack.querySelector(".packline").hidden, true);
  assert.equal(item.querySelector("button.transfer").hidden, true);
  // opening: also household items and medicines (period after opening)
  assert.equal(item.querySelector("button.openpack").hidden, false);
  assert.equal(med.querySelector("button.openpack").hidden, false);
  assert.equal(item.querySelector('[data-hh="only"]').hidden, false);
  assert.equal(item.querySelector('[data-hh="pao"]').hidden, false);
  assert.equal(med.querySelector('[data-hh="pao"]').hidden, false);
  assert.equal(med.querySelector('[data-hh="only"]').hidden, true);
  assert.equal(item.querySelector('[data-hh="no"]').hidden, true);
  assert.equal(pack.querySelector('[data-hh="only"]').hidden, true);
  assert.equal(pack.querySelector('[data-hh="pao"]').hidden, true);
  // convert: a choice of the other kinds
  const convert = item.querySelector("select.convert");
  assert.equal(convert.hidden, false);
  assert.deepEqual([...convert.options].map((o) => o.value), ["", "pack", "medicine"]);
  convert.value = "medicine";
  convert.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/convert_kind`), { type: `${D}/convert_kind`, device_id: "d1", kind: "medicine" });
  assert.equal(convert.value, "");
  assert.deepEqual([...pack.querySelector("select.convert").options].map((o) => o.value), ["", "household", "medicine"]);
});

test("Card: own shopping list per product (4.1), only with content and to-do lists", async () => {
  const hass = adminHass([
    { id: "d1", name: "Packung 1", content: "Leberkäse", product: { kind: "pack", shopping_list: "todo.metzger" } },
    { id: "d2", name: "Dose 2" },
  ]);
  hass.states["todo.einkaufen"] = { entity_id: "todo.einkaufen", state: "0", attributes: { friendly_name: "Einkaufsliste" } };
  hass.states["todo.metzger"] = { entity_id: "todo.metzger", state: "0", attributes: { friendly_name: "Metzger" } };
  const el = mount(hass);
  const cards = $$(el, ".card");
  const card = cards.find((c) => c.querySelector(".name").textContent === "Packung 1");
  const empty = cards.find((c) => c.querySelector(".name").textContent === "Dose 2");
  assert.equal(empty.querySelector(".listrow").hidden, true);
  const row = card.querySelector(".listrow");
  assert.equal(row.hidden, false);
  const select = row.querySelector("select");
  assert.deepEqual([...select.options].map((o) => o.textContent), ["Standardliste", "Einkaufsliste", "Metzger"]);
  assert.equal(select.value, "todo.metzger");
  select.value = "";
  select.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/product_list`), { type: `${D}/product_list`, content: "Leberkäse" });
  select.value = "todo.einkaufen";
  select.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(hass.wsCalls.filter((m) => m.type === `${D}/product_list`)[1].list, "todo.einkaufen");
});

test("Card of a household item: replacement interval, due date and 'Replaced' (4.6)", async () => {
  const hass = adminHass([
    { id: "d1", name: "Artikel 1", content: "Wasserfilter", product: { kind: "household" } },
    { id: "d2", name: "Packung 1", content: "Senf", product: { kind: "pack" } },
  ]);
  hass.states["text.d1_inhalt"].attributes.replace = { weeks: 4, last: "2026-11-01", due: "2026-11-29", days: 12 };
  const el = mount(hass);
  const cards = $$(el, ".card");
  const card = (name) => cards.find((c) => c.querySelector(".name").textContent === name);
  const [item, pack] = [card("Artikel 1"), card("Packung 1")];
  assert.equal(pack.querySelector(".replrow").hidden, true);
  const row = item.querySelector(".replrow");
  assert.equal(row.hidden, false);
  assert.equal(row.querySelector("label").textContent, "Wechseln alle (Wochen)");
  assert.equal(row.querySelector("input").value, "4");
  assert.match(row.querySelector(".replinfo").textContent, /^fällig am /);
  assert.equal(row.querySelector("button.replaced").textContent, "🔁 Gewechselt");
  row.querySelector("button.replaced").click();
  const input = row.querySelector("input");
  input.value = "6";
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/replaced`), { type: `${D}/replaced`, content: "Wasserfilter", device_id: "d1" });
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/replace_interval`), { type: `${D}/replace_interval`, content: "Wasserfilter", weeks: 6 });
});

test("Card: store section with suggestion, own choice and back to automatic (4.7)", async () => {
  const hass = adminHass([
    { id: "d1", name: "Packung 1", content: "Senf", product: { kind: "pack" } },
    { id: "d2", name: "Dose 2", content: "" },
  ]);
  hass.states["todo.einkaufen"] = { entity_id: "todo.einkaufen", state: "0", attributes: { friendly_name: "Einkaufen" } };
  hass.states["text.d1_inhalt"].attributes.section = "dry";
  const el = mount(hass);
  const card = $$(el, ".card").find((c) => c.querySelector(".name").textContent === "Packung 1");
  const row = card.querySelector(".sectionrow");
  assert.equal(row.hidden, false);
  assert.equal(row.querySelector("label").textContent, "Abteilung");
  const select = row.querySelector("select");
  assert.equal(select.options[0].textContent, "Automatisch (🫙 Öl, Soßen & Trockenware)");
  assert.equal(select.value, "");
  assert.equal(select.options.length, 18); // 6.9 (#237): 17 sections + automatic
  select.value = "fridge";
  select.dispatchEvent(new Event("change"));
  select.value = "";
  select.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === `${D}/product_section`), [
    { type: `${D}/product_section`, content: "Senf", section: "fridge" },
    { type: `${D}/product_section`, content: "Senf" },
  ]);
  // empty container: no row
  const empty = $$(el, ".card").find((c) => c.querySelector(".name").textContent === "Dose 2");
  assert.equal(empty.querySelector(".sectionrow").hidden, true);
});

test("5.1: 📷 reads the best-before date; 'History of …' asks the dashboard (embedded only)", async () => {
  const hass = adminHass([{ id: "d1", name: "Dose A", content: "Schinken", mhd: iso(3) }]);
  hass.services = { ai_task: { generate_data: {} } };
  hass.fetchWithAuth = async () => ({ ok: true, json: async () => ({ date: "2027-03-12" }) });
  const el = mount(hass);
  const card = $(el, ".card");
  assert.equal(card.querySelector("button.datephoto").hidden, false);
  const file = card.querySelector("input.datefile");
  Object.defineProperty(file, "files", { value: [new File(["x"], "mhd.jpg", { type: "image/jpeg" })], configurable: true });
  file.dispatchEvent(new window.Event("change"));
  await flush();
  await flush();
  assert.deepEqual(hass.calls.at(-1), { domain: "date", service: "set_value", data: { entity_id: "date.d1_mhd", date: "2027-03-12" } });
  // not embedded in the dashboard: no product history link
  assert.equal(card.querySelector("button.producthistory").hidden, true);
  document.body.innerHTML = "";
  const embedded = document.createElement("larder-panel");
  embedded.setAttribute("embedded", "");
  document.body.appendChild(embedded);
  embedded.hass = hass;
  const btn = $(embedded, ".card button.producthistory");
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, "📦 Schinken: Bestand & Verlauf");
  let asked = null;
  embedded.addEventListener("larder-product-history", (ev) => (asked = ev.detail.content));
  btn.click();
  assert.equal(asked, "Schinken");
});

test("5.3: 🏷 next to the compartment asks the dashboard for the compartment view (embedded only)", () => {
  const hass = adminHass([{ id: "d1", name: "Dose A", area: "kitchen", content: "Chili" }]);
  hass.entities["text.d1_fach"] = { entity_id: "text.d1_fach", device_id: "d1", platform: "larder", translation_key: "compartment" };
  hass.states["text.d1_fach"] = { entity_id: "text.d1_fach", state: "Fach 2", attributes: {} };
  const embedded = document.createElement("larder-panel");
  embedded.setAttribute("embedded", "");
  document.body.appendChild(embedded);
  embedded.hass = hass;
  const card = $(embedded, ".card");
  const btn = card.querySelector("button.placetag");
  assert.equal(btn.hidden, false);
  let asked = null;
  embedded.addEventListener("larder-open-place", (ev) => (asked = ev.detail));
  btn.click();
  assert.deepEqual(asked, { areaId: "kitchen", compartment: "Fach 2" });
});

test("5.3.1: card of a container – write a new sticker (blank stickers cannot be read)", async () => {
  const hass = adminHass([{ id: "d1", name: "Dose A", content: "Chili" }]);
  const messages = [];
  hass.auth = { external: { config: Promise.resolve({ canWriteTag: true }), fireMessage: (m) => messages.push(m) } };
  const el = mount(hass);
  await flush();
  await flush();
  el.hass = { ...hass };
  const btn = $(el, ".card button.nfcwrite");
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, "✍ Neuen Sticker beschreiben");
  btn.click();
  await flush();
  await flush();
  const link = hass.wsCalls.find((m) => m.type === "larder/nfc_link");
  assert.equal(link.device_id, "d1");
  // not embedded in the dashboard: the app is asked right away
  assert.deepEqual(messages.at(-1), { type: "tag/write", payload: { name: "Chili", tag: link.tag_id } });
});

test("5.4: redraw only when something Larder shows changed", () => {
  const hass1 = makeHass([{ id: "d1", name: "Dose 1", content: "Suppe" }], { areas: AREAS });
  hass1.states["light.kitchen"] = { entity_id: "light.kitchen", state: "off", attributes: {} };
  hass1.states["todo.shop"] = { entity_id: "todo.shop", state: "0", attributes: {} };
  const memo = {};
  assert.equal(hassChanged(null, hass1, memo), true);
  hassChanged({ ...hass1, entities: {} }, hass1, memo); // remembers the minute
  // a foreign entity changes: nothing to do
  const hass2 = { ...hass1, states: { ...hass1.states, "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: {} } } };
  assert.equal(hassChanged(hass1, hass2, memo), false);
  // own entity, to-do list, registry, language: redraw
  const own = { ...hass2, states: { ...hass2.states, "text.d1_inhalt": { entity_id: "text.d1_inhalt", state: "Gulasch", attributes: {} } } };
  assert.equal(hassChanged(hass2, own, memo), true);
  const todo = { ...hass2, states: { ...hass2.states, "todo.shop": { entity_id: "todo.shop", state: "1", attributes: {} } } };
  assert.equal(hassChanged(hass2, todo, memo), true);
  assert.equal(hassChanged(hass2, { ...hass2, areas: {} }, memo), true);
  assert.equal(hassChanged(hass2, { ...hass2, language: "en" }, memo), true);
  // after a minute without a redraw it redraws anyway
  memo.at = Date.now() - 61000;
  assert.equal(hassChanged(hass1, hass2, memo), true);
});

test("5.4: the panel skips foreign state changes", () => {
  const hass1 = makeHass([{ id: "d1", name: "Dose 1", content: "Suppe" }], { areas: AREAS });
  const el = mount(hass1);
  let updates = 0;
  const real = el._update.bind(el);
  el._update = () => {
    updates += 1;
    real();
  };
  el.hass = { ...hass1, states: { ...hass1.states, "light.x": { entity_id: "light.x", state: "on", attributes: {} } } };
  assert.equal(updates, 0);
  el.hass = { ...hass1, states: { ...hass1.states, "text.d1_inhalt": { entity_id: "text.d1_inhalt", state: "Gulasch", attributes: {} } } };
  assert.equal(updates, 1);
});

test("6.8 (#217–#221): fill dialog – vacuum question once, date only, hints, barcode button", async () => {
  const hass = adminHass([{ id: "d1", name: "Dose 1", content: "" }]);
  const calls = [];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "larder/settings") return { vacuum_asked: false, vacuum_default: true };
    if (msg.type === "larder/vacuum_answer") {
      calls.push(msg);
      return { vacuum_default: msg.has_sealer, changed: 0 };
    }
    return base ? base(msg) : {};
  };
  hass.auth = { external: { config: { hasBarCodeScanner: true } } };
  const el = mount(hass);
  el.openFillDialog("d1");
  await flush();
  const form = $(el, "form.fillform");
  assert.equal(form.querySelector('[data-w="vacask"]').hidden, false);
  assert.equal(form.querySelector('[data-f="filledAt"]').type, "date");
  assert.match(form.querySelector('[data-f="filledAt"]').value, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(form.querySelector('[data-f="quantity"]').placeholder, "z. B. 2 – optional");
  form.querySelector("button.vacno").click();
  await flush();
  assert.deepEqual(calls, [{ type: "larder/vacuum_answer", has_sealer: false }]);
  assert.equal(form.querySelector('[data-f="vacuum"]').checked, false);
  assert.equal(form.querySelector('[data-w="vacask"]').hidden, true);
});
