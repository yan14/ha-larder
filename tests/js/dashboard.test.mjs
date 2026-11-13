// Tests für das Larder-Dashboard (seit 2.0, früher "Larder experimental"; läuft in jsdom, ohne Home Assistant).
process.env.TZ = "Europe/Berlin";

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "customElements", "Event", "CustomEvent"]) {
  globalThis[key] = dom.window[key];
}
dom.window.confirm = () => true;

const mod = await import("../../custom_components/larder/frontend/larder-dashboard.js");
const { TEXTS, CATEGORY_ICONS, describeDevices, sortContainers, isSoon } = mod;
const { collectDevices } = await import("../../custom_components/larder/frontend/larder-panel.js");

const D = "larder";
const AREAS = {
  kitchen: { area_id: "kitchen", name: "Küche" },
  cellar: { area_id: "cellar", name: "Keller" },
};

function iso(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** doses: { id, name, area, content, days, category } */
function makeHass(doses, { admin = true, language = "de", ai = true, recipes = [], name = "Yan" } = {}) {
  const entities = {};
  const devices = {};
  const states = {};
  for (const d of doses) {
    devices[d.id] = { id: d.id, name: d.name, area_id: d.area || null };
    const ids = {
      text: `text.${d.id}_inhalt`,
      date: `date.${d.id}_mhd`,
      datetime: `datetime.${d.id}_befuellt`,
      button: `button.${d.id}_leeren`,
      image: `image.${d.id}_qr`,
      switch: `switch.${d.id}_vacuum`,
      number: `number.${d.id}_portionen`,
      select: `select.${d.id}_einheit`,
    };
    for (const eid of Object.values(ids)) entities[eid] = { entity_id: eid, device_id: d.id, platform: D, area_id: null };
    states[ids.text] = {
      entity_id: ids.text,
      state: d.content ?? "",
      attributes: { category: d.content ? d.category ?? null : null },
    };
    states[ids.date] = { entity_id: ids.date, state: d.days === undefined || d.days === null ? "unknown" : iso(d.days), attributes: { estimates: false } };
    states[ids.datetime] = { entity_id: ids.datetime, state: "unknown", attributes: {} };
    states[ids.button] = { entity_id: ids.button, state: "unknown", attributes: {} };
    states[ids.image] = { entity_id: ids.image, state: "x", attributes: {} };
    states[ids.switch] = { entity_id: ids.switch, state: "on", attributes: {} };
    states[ids.number] = { entity_id: ids.number, state: "0", attributes: {} };
    states[ids.select] = { entity_id: ids.select, state: "portions", attributes: { options: ["portions"] } };
  }
  const hass = {
    entities,
    devices,
    areas: AREAS,
    states,
    language,
    user: { is_admin: admin, name },
    services: ai ? { ai_task: { generate_data: {} }, [D]: { suggest_recipes: {} } } : {},
    calls: [],
    wsCalls: [],
    recipes: [...recipes],
    suggestions: [],
    callService: (domain, service, data) => hass.calls.push({ domain, service, data }),
    hassUrl: (p) => p,
  };
  hass.callWS = async (msg) => {
    if (msg.type === "config/label_registry/list") return [];
    if (msg.type === `${D}/nfc_tags`) return { by_device: {} };
    hass.wsCalls.push(msg);
    if (msg.type === `${D}/recipes`) return { recipes: hass.recipes };
    if (msg.type === `${D}/recipe_save`) {
      const { type, recipe_id, ...rest } = msg;
      const recipe = { id: recipe_id || `r${hass.recipes.length + 1}`, source: "manual", created: "x", ingredients: [], steps: [], minutes: null, ...rest };
      return { recipe };
    }
    if (msg.type === `${D}/recipe_delete`) return { deleted: true };
    if (msg.type === `${D}/settings`) return { recipe_days: hass.recipeDays ?? 3 };
    if (msg.type === "call_service") return { response: { recipes: hass.suggestions, days: msg.service_data.all_containers ? null : (msg.service_data.days ?? hass.recipeDays ?? 3) } };
    return {};
  };
  return hass;
}

const DOSES = [
  { id: "d1", name: "Dose 1", area: "kitchen", content: "Lachs", days: 1, category: "fish" },
  { id: "d2", name: "Dose 2", area: "kitchen", content: "Gouda", days: 20, category: "dairy" },
  { id: "d3", name: "Dose 3", area: "cellar", content: "Chili", days: -1, category: "dish" },
  { id: "d4", name: "Dose 4", area: "cellar", content: "Reis", days: 3, category: "dry" },
  { id: "d5", name: "Dose 5", area: null },
];

const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
const names = (el) => $$(el, "main .tile .name, main .row .name").map((n) => n.textContent);

function mount(hass) {
  const el = document.createElement("larder-dashboard");
  document.body.appendChild(el);
  el.hass = hass;
  return el;
}

const go = async (el, view) => {
  $(el, `nav button[data-view="${view}"]`).click();
  await flush();
};

test.beforeEach(() => {
  document.body.innerHTML = "";
  dom.window.localStorage.clear();
});

test("Die eingebettete Karte ist eine eigene Variante, unabhängig von einem schon registrierten <larder-panel>", () => {
  const el = mount(makeHass(DOSES));
  assert.equal(el._classic.tagName.toLowerCase(), "larder-panel-embedded");
  assert.ok(el._classic.hasAttribute("embedded"));
  assert.ok(customElements.get("larder-panel-embedded"));
  assert.ok(customElements.get("larder-panel"));
});

test("Texte: Deutsch und Englisch haben dieselben Schlüssel", () => {
  const shape = (o) => JSON.stringify(Object.keys(o).sort());
  assert.equal(shape(TEXTS.de), shape(TEXTS.en));
  assert.equal(shape(TEXTS.de.views), shape(TEXTS.en.views));
  assert.equal(shape(TEXTS.de.categories), shape(TEXTS.en.categories));
  assert.deepEqual(Object.keys(TEXTS.de.categories).sort(), Object.keys(CATEGORY_ICONS).sort());
});

test("describeDevices: Inhalt, Resttage, Kategorie; leere Dosen gelten als 'empty'", () => {
  const hass = makeHass(DOSES);
  const rows = describeDevices(hass, collectDevices(hass));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([by.d1.content, by.d1.days, by.d1.category], ["Lachs", 1, "fish"]);
  assert.equal(by.d3.days, -1);
  assert.deepEqual([by.d5.content, by.d5.days, by.d5.category], ["", null, "empty"]);
  assert.deepEqual(rows.filter(isSoon).map((r) => r.id).sort(), ["d1", "d3", "d4"]);
});

test("sortContainers: Ablaufdatum, Name, Bereich, Kategorie", () => {
  const hass = makeHass(DOSES);
  const rows = describeDevices(hass, collectDevices(hass));
  const ids = (sort) => sortContainers(rows, sort, "de").map((r) => r.id);
  assert.deepEqual(ids("date"), ["d3", "d1", "d4", "d2", "d5"]);
  assert.deepEqual(ids("name"), ["d3", "d2", "d1", "d4", "d5"]); // Chili, Gouda, Lachs, Reis, leer zuletzt
  assert.deepEqual(ids("area"), ["d3", "d4", "d1", "d2", "d5"]); // Keller, Küche, ohne Bereich
  assert.deepEqual(ids("category"), ["d2", "d3", "d4", "d5", "d1"]); // dairy, dish, dry, empty, fish
});

test("Start: Begrüßung, nur bald ablaufende Dosen, Hilfe-Schaltflächen", async () => {
  const el = mount(makeHass(DOSES));
  assert.equal($(el, "h1").textContent, "Larder");
  assert.equal($(el, ".hello").textContent, "Hallo Yan");
  assert.match($(el, ".lead").textContent, /bald verbraucht/);
  assert.deepEqual(names(el), ["Chili", "Lachs", "Reis"]); // abgelaufen zuerst, dann nach Resttagen
  assert.deepEqual($$(el, "main .tile .badge").map((b) => b.textContent), ["abgelaufen", "1 T", "3 T"]);
  assert.ok($(el, '[data-role="recipes"]'));
  assert.equal($$(el, "nav button").length, 5);
  assert.deepEqual($$(el, "nav button").map((b) => b.textContent), ["🏠Start", "🫙Behälter", "📖Rezepte", "📍Bereiche", "🏷️Kategorien"]);
});

test("Start: nichts läuft ab, Benutzer ohne KI und ohne Namen", () => {
  const hass = makeHass([{ id: "d2", name: "Dose 2", content: "Gouda", days: 20, category: "dairy" }], { ai: false, name: "" });
  const el = mount(hass);
  assert.equal($(el, ".hello").textContent, "Hallo");
  assert.match($(el, ".lead").textContent, /läuft nichts ab/);
  assert.equal($(el, '[data-role="recipes"]'), null);
  assert.ok($(el, '[data-role="containers"]'));
});

test("Start: 'Behälter anzeigen' zeigt die Behälter, die bald ablaufen, mit Filter-Chip", async () => {
  const el = mount(makeHass(DOSES));
  $(el, '[data-role="containers"]').click();
  await flush();
  assert.equal($(el, "h1").textContent, "Behälter");
  assert.deepEqual(names(el), ["Chili", "Lachs", "Reis"]);
  const state = $(el, '[data-role="state"]');
  assert.equal(state.value, "soon");
  state.value = "all";
  state.dispatchEvent(new Event("change"));
  await flush();
  assert.equal(names(el).length, 5);
});

test("Behälter: Suche, Zustands-Filter und Anzahl wie im bisherigen Dashboard", async () => {
  document.body.innerHTML = "";
  const el = mount(makeHass(DOSES));
  await go(el, "containers");
  assert.equal($(el, "p.count").textContent, "5 Dosen");
  const search = $(el, '[data-role="search"]');
  search.value = "keller"; // Bereich
  search.dispatchEvent(new Event("input"));
  assert.deepEqual(names(el), ["Chili", "Reis"]);
  assert.equal($(el, "p.count").textContent, "2 von 5 Dosen");
  assert.equal($(el, '[data-role="search"]'), search); // dasselbe Feld, Fokus bleibt
  search.value = "gou";
  search.dispatchEvent(new Event("input"));
  assert.deepEqual(names(el), ["Gouda"]);
  search.value = "";
  search.dispatchEvent(new Event("input"));
  const state = () => $(el, '[data-role="state"]');
  for (const [value, expected] of [["expired", ["Chili"]], ["empty", ["Leer"]], ["filled", ["Chili", "Lachs", "Reis", "Gouda"]]]) {
    state().value = value;
    state().dispatchEvent(new Event("change"));
    await flush();
    assert.deepEqual(names(el), expected);
  }
});

test("Behälter: Kacheln mit Symbol, Name, Dose und Resttagen; leere Dose heißt 'Leer'", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "containers");
  assert.deepEqual(names(el), ["Chili", "Lachs", "Reis", "Gouda", "Leer"]);
  const lachs = $$(el, "main .tile").find((t) => t.dataset.id === "d1");
  assert.equal(lachs.querySelector(".ico").textContent, "🐟");
  assert.equal(lachs.querySelector(".sub").textContent, "Dose 1");
  assert.ok(lachs.querySelector(".badge").textContent === "1 T");
  const empty = $$(el, "main .tile").find((t) => t.dataset.id === "d5");
  assert.ok(empty.classList.contains("empty"));
  assert.equal(empty.querySelector(".badge"), null);
  assert.equal($$(el, "main .tile.empty").length, 1);
});

test("Behälter: Sortierung wird gemerkt, Gruppen nach Bereich und Kategorie", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "containers");
  const pick = async (value) => {
    const select = $(el, ".bar select");
    select.value = value;
    select.dispatchEvent(new dom.window.Event("change"));
    await flush();
  };
  assert.deepEqual([...$(el, ".bar select").options].map((o) => o.textContent), ["Ablaufdatum / MHD", "Bereich", "Alphabetisch", "Kategorie"]);
  await pick("area");
  assert.deepEqual($$(el, "main h2").map((h) => h.textContent), ["Keller", "Küche", "Ohne Bereich"]);
  await pick("category");
  assert.deepEqual($$(el, "main h2").map((h) => h.textContent), ["Milchprodukte", "Gerichte & Reste", "Trockenware", "Leer", "Fisch"]);
  await pick("name");
  assert.deepEqual(names(el), ["Chili", "Gouda", "Lachs", "Reis", "Leer"]);
  assert.equal(JSON.parse(dom.window.localStorage.getItem("larder.experimental")).sort, "name");

  // neue Sitzung: die Sortierung ist noch da
  document.body.innerHTML = "";
  const again = mount(makeHass(DOSES));
  await go(again, "containers");
  assert.equal($(again, ".bar select").value, "name");
});

test("Behälter: Umschalter zwischen Kacheln und Liste", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "containers");
  assert.equal($$(el, "main .tiles").length, 1);
  $(el, '[data-role="mode"]').click();
  await flush();
  assert.equal($$(el, "main .tiles").length, 0);
  assert.equal($$(el, "main .row").length, 5);
  assert.equal($$(el, "main .row .sub")[0].textContent, "Dose 3 · Keller");
  assert.equal(JSON.parse(dom.window.localStorage.getItem("larder.experimental")).mode, "list");
});

test("Behälter: gefüllte Dose öffnet die Detailansicht, leere den Befüllen-Dialog, Zurück schließt", async () => {
  const el = mount(makeHass(DOSES));
  const filled = [];
  el._classic.openFillDialog = (id) => filled.push(id);
  await go(el, "containers");

  $$(el, "main .tile").find((t) => t.dataset.id === "d5").click();
  assert.deepEqual(filled, ["d5"]);
  assert.equal(el._classic.hasAttribute("only"), false);

  $$(el, "main .tile").find((t) => t.dataset.id === "d1").click();
  assert.equal(el._classic.getAttribute("only"), "d1");
  assert.equal($(el, "header").hidden, true);
  assert.equal($(el, "nav").hidden, true);
  assert.equal($(el, "main").hidden, true);
  // die eingebettete Karte zeigt genau diese Dose
  assert.equal($(el._classic, "h1").textContent, "Dose 1");
  assert.equal($el_cards(el._classic).length, 1);

  $(el._classic, "#back").click();
  await flush();
  assert.equal(el._classic.hasAttribute("only"), false);
  assert.equal($(el, "header").hidden, false);
  assert.equal($(el, "nav").hidden, false);
  assert.equal($(el, "main").hidden, false);
});

function $el_cards(classic) {
  return [...classic.shadowRoot.querySelectorAll(".card")];
}

test("Nicht-Administrator: leere Dose öffnet die Detailansicht, Hinzufügen nur für Beutel und Packungen", async () => {
  const el = mount(makeHass(DOSES, { admin: false }));
  await go(el, "containers");
  $(el, '[data-role="add"]').click();
  assert.equal($(el, '[data-role="add-container"]'), null);
  assert.ok($(el, '[data-role="add-bag"]') && $(el, '[data-role="add-pack"]'));
  $(el, ".overlay").click();
  assert.equal($(el, '[data-role="menu-settings"]').hidden, true);
  $$(el, "main .tile").find((t) => t.dataset.id === "d5").click();
  assert.equal(el._classic.getAttribute("only"), "d5");
});

test("Hinzufügen öffnet den Dialog des normalen Dashboards", async () => {
  const el = mount(makeHass(DOSES));
  let opened = 0;
  el._classic.openAddDialog = () => opened++;
  await go(el, "containers");
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-container"]').click();
  assert.equal(opened, 1);
  assert.equal($(el, ".overlay").hidden, true);
  assert.equal($(el, "#settings").hidden, false);
});

test("Bereiche verwalten: anlegen mit Lagerart, leere Lagerorte, bearbeiten", async () => {
  const hass = makeHass(DOSES);
  hass.areas = {
    kitchen: { area_id: "kitchen", name: "Küche", labels: ["larder_fridge", "other"] },
    cellar: { area_id: "cellar", name: "Keller", labels: [] },
    garage: { area_id: "garage", name: "Garage", labels: [] },
    freezer: { area_id: "freezer", name: "Gefriertruhe", labels: ["larder_freezer"] },
  };
  const LABELS = [
    { label_id: "larder_fridge", name: "Larder: Fridge" },
    { label_id: "larder_freezer", name: "Larder: Freezer" },
    { label_id: "other", name: "Sonstiges" },
  ];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "config/label_registry/list") return LABELS;
    if (msg.type === "config/label_registry/create") {
      hass.wsCalls.push(msg);
      LABELS.push({ label_id: "larder_0c", name: msg.name });
      return { label_id: "larder_0c", name: msg.name };
    }
    if (msg.type.startsWith("config/area_registry/")) {
      hass.wsCalls.push(msg);
      return { area_id: msg.area_id || "new" };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await el._classic.loadAreaLabel();
  await go(el, "areas");
  // leerer Lagerort mit Larder-Label erscheint, Garage (ohne Label) nicht
  assert.deepEqual(names(el), ["Gefriertruhe", "Keller", "Küche", "Ohne Bereich"]);

  // anlegen: erstes Larder-Label ist vorgeschlagen, neues Label möglich
  $(el, '[data-role="area-add"]').click();
  await flush();
  const form = $(el, "form.dialog");
  assert.equal($(el, ".overlay").hidden, false);
  assert.equal(form.querySelector('[data-f="kind"]').value, "larder_fridge");
  form.querySelector('[data-f="name"]').value = "0-Grad-Fach";
  const kind = form.querySelector('[data-f="kind"]');
  kind.value = "__new";
  kind.dispatchEvent(new Event("change"));
  assert.equal(form.querySelector('[data-w="newkind"]').hidden, false);
  form.querySelector('[data-f="newkind"]').value = "0 °C";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.deepEqual(hass.wsCalls.filter((m) => m.type.startsWith("config/")).map((m) => [m.type, m.name, m.labels]), [
    ["config/label_registry/create", "Larder: 0 °C", undefined],
    ["config/area_registry/create", "0-Grad-Fach", ["larder_0c"]],
  ]);
  assert.equal($(el, ".overlay").hidden, true);

  // bearbeiten: alle Bereiche, Lagerart als Untertitel, fremde Labels bleiben
  $(el, '[data-role="area-edit"]').click();
  await flush();
  await flush();
  assert.deepEqual(names(el), ["Garage", "Gefriertruhe", "Keller", "Küche"]);
  const kueche = $$(el, "main [data-area]").find((n) => n.dataset.area === "kitchen");
  assert.match(kueche.textContent, /Fridge/);
  kueche.click();
  await flush();
  assert.equal(form.querySelector('[data-f="kind"]').value, "larder_fridge");
  assert.ok(form.querySelector('[data-role="area-open-ha"]'));
  form.querySelector('[data-f="name"]').value = "Kühlschrank";
  form.querySelector('[data-f="kind"]').value = "larder_freezer";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const update = hass.wsCalls.find((m) => m.type === "config/area_registry/update");
  assert.deepEqual(update, { type: "config/area_registry/update", area_id: "kitchen", name: "Kühlschrank", labels: ["other", "larder_freezer"] });

  // leerer Name wird abgelehnt
  $$(el, "main [data-area]").find((n) => n.dataset.area === "garage").click();
  await flush();
  form.querySelector('[data-f="name"]').value = " ";
  form.querySelector("button.submit").click();
  await flush();
  assert.equal(form.querySelector(".error").textContent, "Bitte einen Namen eingeben.");
  $(el, ".overlay").click();

  // Fertig beendet den Bearbeiten-Modus, Nicht-Admins sehen weder ＋ noch ✏️
  $(el, '[data-role="area-edit"]').click();
  await flush();
  assert.ok($(el, '[data-role="area-edit"]').textContent.includes("✏️"));
});

test("Bereiche verwalten: nur für Administratoren", async () => {
  const el = mount(makeHass(DOSES, { admin: false }));
  await go(el, "areas");
  assert.equal($(el, '[data-role="area-add"]'), null);
  assert.equal($(el, '[data-role="area-edit"]'), null);
});

test("Bereiche: Kacheln mit Anzahl, Antippen filtert die Behälter", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "areas");
  assert.equal($(el, "h1").textContent, "Bereiche");
  assert.deepEqual(names(el), ["Keller", "Küche", "Ohne Bereich"]);
  assert.deepEqual($$(el, "main .tile .sub").map((s) => s.textContent), ["2 Behälter", "2 Behälter", "1 Behälter"]);
  assert.deepEqual($$(el, "main .tile .badge").map((s) => s.textContent), ["2 bald", "1 bald"]);

  $$(el, "main .tile")[1].click(); // Küche
  await flush();
  assert.equal($(el, "h1").textContent, "Behälter");
  assert.equal($(el, ".chip span").textContent, "Bereich: Küche");
  assert.deepEqual(names(el), ["Lachs", "Gouda"]);
});

test("Bereiche: nach Anzahl sortieren, 'Ohne Bereich' filtert Dosen ohne Bereich", async () => {
  const el = mount(makeHass([...DOSES, { id: "d6", name: "Dose 6", area: "cellar", content: "Brot", days: 5, category: "bread" }]));
  await go(el, "areas");
  const sort = $(el, ".bar select");
  sort.value = "count";
  sort.dispatchEvent(new dom.window.Event("change"));
  await flush();
  assert.deepEqual(names(el)[0], "Keller");
  $$(el, "main .tile").find((t) => t.querySelector(".name").textContent === "Ohne Bereich").click();
  await flush();
  assert.equal($(el, ".chip span").textContent, "Bereich: Ohne Bereich");
  assert.deepEqual(names(el), ["Leer"]);
});

test("Kategorien: Kacheln je Kategorie inklusive 'Leer', Antippen filtert", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "categories");
  assert.equal($(el, "h1").textContent, "Kategorien");
  assert.deepEqual(names(el), ["Fisch", "Milchprodukte", "Gerichte & Reste", "Trockenware", "Leer"]);
  $$(el, "main .tile").find((t) => t.querySelector(".name").textContent === "Fisch").click();
  await flush();
  assert.equal($(el, ".chip span").textContent, "Kategorie: Fisch");
  assert.deepEqual(names(el), ["Lachs"]);
});

test("Kategorien: gemischte Dosen stehen unter 'Gemischt'", async () => {
  const el = mount(makeHass([...DOSES, { id: "d6", name: "Dose 6", area: "kitchen", content: "Gouda, Lachs", days: 2, category: "mixed" }]));
  await go(el, "categories");
  assert.deepEqual(names(el), ["Fisch", "Milchprodukte", "Gerichte & Reste", "Trockenware", "Gemischt", "Leer"]);
  const tile = $$(el, "main .tile").find((t) => t.querySelector(".name").textContent === "Gemischt");
  assert.equal(tile.querySelector(".ico").textContent, "🍱");
});

test("Navigation setzt Filter zurück", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "areas");
  $$(el, "main .tile")[0].click();
  await flush();
  assert.ok($(el, ".chip"));
  await go(el, "containers");
  assert.equal($(el, ".chip"), null);
  assert.equal(names(el).length, 5);
});

test("Englische Oberfläche", async () => {
  const el = mount(makeHass(DOSES, { language: "en" }));
  assert.equal($(el, ".hello").textContent, "Hello Yan");
  assert.deepEqual($$(el, "nav button").map((b) => b.textContent), ["🏠Start", "🫙Containers", "📖Recipes", "📍Areas", "🏷️Categories"]);
  await go(el, "containers");
  assert.equal($$(el, "main .tile .name").pop().textContent, "Empty");
});

test("Hamburger-Menü nur im schmalen Modus und löst das Home-Assistant-Menü aus", () => {
  const el = mount(makeHass(DOSES));
  let toggled = 0;
  el.addEventListener("hass-toggle-menu", () => toggled++);
  el.narrow = true;
  assert.ok(el.hasAttribute("narrow"));
  $(el, "#menu").click();
  assert.equal(toggled, 1);
  el.narrow = false;
  assert.ok(!el.hasAttribute("narrow"));
});

test("Rezepte: gespeicherte Rezepte laden, aufklappen, sortieren", async () => {
  const hass = makeHass(DOSES, {
    recipes: [
      { id: "r1", title: "Mac'n Cheese", minutes: 30, ingredients: ["Nudeln", "Käse"], steps: ["Kochen", "Überbacken"], source: "manual" },
      { id: "r2", title: "Lasagne", minutes: null, ingredients: [], steps: [], source: "ai" },
    ],
  });
  const el = mount(hass);
  await flush();
  await go(el, "recipes");
  assert.deepEqual($$(el, "main .recipe h3").map((h) => h.firstChild.textContent), ["Mac'n Cheese", "Lasagne"]);
  assert.equal($$(el, "main .recipe .tag")[0].textContent, "Von der KI");
  assert.equal($(el, ".recipe .body"), null);

  $$(el, "main .recipe h3")[0].click();
  await flush();
  assert.deepEqual($$(el, ".recipe .body li").map((l) => l.textContent), ["Nudeln", "Käse", "Kochen", "Überbacken"]);
  assert.ok($(el, '.recipe [data-role="edit"]'));

  const sort = $(el, ".bar select");
  sort.value = "name";
  sort.dispatchEvent(new dom.window.Event("change"));
  await flush();
  assert.deepEqual($$(el, "main .recipe h3").map((h) => h.firstChild.textContent), ["Lasagne", "Mac'n Cheese"]);
});

test("Rezepte: neues Rezept von Hand anlegen", async () => {
  const hass = makeHass(DOSES);
  const el = mount(hass);
  await flush();
  await go(el, "recipes");
  assert.match($(el, ".note").textContent, /Noch keine Rezepte/);
  $(el, '[data-role="add-recipe"]').click();
  assert.equal($(el, ".overlay").hidden, false);

  const form = $(el, "form.dialog");
  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  assert.match($(el, "form.dialog .error").textContent, /Namen/);
  assert.equal(hass.wsCalls.filter((m) => m.type === `${D}/recipe_save`).length, 0);

  $(el, '[data-f="title"]').value = " Pizza ";
  $(el, '[data-f="minutes"]').value = "25";
  $(el, '[data-f="ingredients"]').value = "Teig\n\n Tomaten \nKäse";
  $(el, '[data-f="steps"]').value = "Belegen\nBacken";
  form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  const save = hass.wsCalls.find((m) => m.type === `${D}/recipe_save`);
  assert.deepEqual(save, {
    type: `${D}/recipe_save`,
    title: "Pizza",
    ingredients: ["Teig", "Tomaten", "Käse"],
    steps: ["Belegen", "Backen"],
    minutes: 25,
  });
  assert.equal($(el, ".overlay").hidden, true);
  assert.deepEqual($$(el, "main .recipe h3").map((h) => h.firstChild.textContent), ["Pizza"]);
});

test("Rezepte: bearbeiten und löschen", async () => {
  const hass = makeHass(DOSES, { recipes: [{ id: "r1", title: "Lasagne", minutes: 45, ingredients: ["Nudeln"], steps: ["Backen"], source: "manual" }] });
  const el = mount(hass);
  await flush();
  await go(el, "recipes");
  $(el, "main .recipe h3").click();
  await flush();
  $(el, '.recipe [data-role="edit"]').click();
  assert.equal($(el, '[data-f="title"]').value, "Lasagne");
  assert.equal($(el, '[data-f="minutes"]').value, "45");
  $(el, '[data-f="title"]').value = "Lasagne al forno";
  $(el, "form.dialog").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  const save = hass.wsCalls.find((m) => m.type === `${D}/recipe_save`);
  assert.equal(save.recipe_id, "r1");
  assert.equal(save.title, "Lasagne al forno");
  assert.deepEqual($$(el, "main .recipe h3").map((h) => h.firstChild.textContent), ["Lasagne al forno"]);

  $(el, '.recipe [data-role="delete"]').click(); // bleibt aufgeklappt
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/recipe_delete`), { type: `${D}/recipe_delete`, recipe_id: "r1" });
  assert.equal($$(el, "main .recipe").length, 0);
});

test("Rezepte: Vorschläge aus Resten erzeugen und einzeln speichern", async () => {
  const hass = makeHass(DOSES);
  hass.suggestions = [
    { title: "Lachs-Pasta", minutes: 20, uses: ["Lachs (1 Portion)"], extra_ingredients: ["Sahne"], steps: ["Kochen"] },
    { title: "Chili-Wrap", uses: ["Chili"], steps: [] },
  ];
  const el = mount(hass);
  await flush();
  $(el, '[data-role="recipes"]').click(); // Start → Rezeptvorschläge
  await flush();
  await flush();
  assert.equal($(el, "h1").textContent, "Rezepte");
  const call = hass.wsCalls.find((m) => m.type === "call_service");
  assert.deepEqual(call, { type: "call_service", domain: D, service: "suggest_recipes", service_data: {}, return_response: true }); // ohne Angabe gilt die Einstellung
  assert.deepEqual($$(el, "main .recipe h3").map((h) => h.firstChild.textContent), ["Lachs-Pasta", "Chili-Wrap"]);
  assert.deepEqual($$(el, "main .recipe")[0].querySelectorAll("li").length, 3); // 2 Zutaten + 1 Schritt
  assert.deepEqual([...$$(el, "main .recipe")[0].querySelectorAll("ul li")].map((l) => l.textContent), ["Lachs (1 Portion)", "Sahne"]);

  $$(el, '[data-role="save-suggestion"]')[0].click();
  await flush();
  const save = hass.wsCalls.find((m) => m.type === `${D}/recipe_save`);
  assert.deepEqual(save, {
    type: `${D}/recipe_save`,
    title: "Lachs-Pasta",
    ingredients: ["Lachs (1 Portion)", "Sahne"],
    steps: ["Kochen"],
    minutes: 20,
    source: "ai",
  });
  assert.equal($$(el, '[data-role="save-suggestion"]')[0].disabled, true);
  assert.equal($$(el, '[data-role="save-suggestion"]')[0].textContent, "Gespeichert");
  assert.ok($$(el, "main h2").length >= 2);
});

test("Rezepte: Fehler und keine Treffer der KI, Benutzer ohne Rechte sehen keine Schaltflächen", async () => {
  const hass = makeHass(DOSES);
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/recipes`) return { recipes: [] };
    if (msg.type === "call_service") throw new Error("Kein Guthaben");
    return {};
  };
  const el = mount(hass);
  await flush();
  await go(el, "recipes");
  $(el, '[data-role="generate"]').click();
  await flush();
  assert.equal($(el, "main .error").textContent, "Kein Guthaben");

  document.body.innerHTML = "";
  const none = makeHass(DOSES);
  const el2 = mount(none);
  await flush();
  await go(el2, "recipes");
  $(el2, '[data-role="generate"]').click();
  await flush();
  assert.match($(el2, "main .note").textContent, /läuft nichts ab/);

  document.body.innerHTML = "";
  const user = makeHass(DOSES, { admin: false, recipes: [{ id: "r1", title: "Lasagne", ingredients: [], steps: [], source: "manual" }] });
  const el3 = mount(user);
  await flush();
  await go(el3, "recipes");
  assert.equal($(el3, '[data-role="generate"]'), null);
  assert.equal($(el3, '[data-role="add-recipe"]'), null);
  $(el3, "main .recipe h3").click();
  await flush();
  assert.equal($(el3, '.recipe [data-role="edit"]'), null);
  assert.equal($(el3, '.recipe [data-role="delete"]'), null);
});

test("Rezepte: Zeitraum aus den Einstellungen, änderbar und abschaltbar", async () => {
  assert.deepEqual(mod.recipeServiceData("default"), {});
  assert.deepEqual(mod.recipeServiceData("7"), { days: 7 });
  assert.deepEqual(mod.recipeServiceData("all"), { all_containers: true });
  assert.deepEqual(mod.recipeServiceData("quatsch"), {});

  document.body.innerHTML = "";
  window.localStorage.clear();
  const hass = makeHass(DOSES);
  hass.recipeDays = 5;
  const el = mount(hass);
  await flush();
  await go(el, "recipes");
  const period = () => $(el, '[data-role="period"]');
  assert.equal(period().value, "default");
  assert.equal(period().options[0].textContent, "Standard (5 Tage)");
  assert.equal(period().options[period().options.length - 1].textContent, "Alle Dosen (kein Zeitraum)");

  const calls = () => hass.wsCalls.filter((m) => m.type === "call_service").map((m) => m.service_data);
  $(el, '[data-role="generate"]').click();
  await flush();
  assert.match($(el, "main .note").textContent, /nächsten 5 Tagen/);

  period().value = "14";
  period().dispatchEvent(new Event("change"));
  $(el, '[data-role="generate"]').click();
  await flush();
  assert.match($(el, "main .note").textContent, /nächsten 14 Tagen/);

  period().value = "all";
  period().dispatchEvent(new Event("change"));
  $(el, '[data-role="generate"]').click();
  await flush();
  assert.equal($(el, "main .note").textContent, "Keine befüllte Dose gefunden.");
  assert.deepEqual(calls(), [{}, { days: 14 }, { all_containers: true }]);

  // Auswahl bleibt nach dem Neuladen erhalten
  document.body.innerHTML = "";
  const el2 = mount(makeHass(DOSES));
  await flush();
  await go(el2, "recipes");
  assert.equal($(el2, '[data-role="period"]').value, "all");
  window.localStorage.clear();
});

test("„Läuft bald ab“ folgt der Einstellung auch im neuen Dashboard", () => {
  assert.equal(isSoon({ content: "Suppe", days: 5, soon: 3 }), false);
  assert.equal(isSoon({ content: "Suppe", days: 5, soon: 7 }), true);
  assert.equal(isSoon({ content: "Suppe", days: 5 }), false); // ohne Angabe: 3 Tage
  assert.equal(isSoon({ content: "", days: 1, soon: 7 }), false);
});

test("Neuladen: Eigenschaften, die HA vor dem Laden des Moduls setzt, werden übernommen", async () => {
  document.body.innerHTML = "";
  // Element existiert schon, bevor die Klasse registriert ist (wie beim Neuladen in HA)
  const el = document.createElement("larder-exp-late");
  el.narrow = true;
  el.hass = makeHass(DOSES);
  document.body.appendChild(el);
  customElements.define("larder-exp-late", class extends customElements.get("larder-dashboard") {});
  await flush();
  assert.equal(el.hasAttribute("narrow"), true);
  assert.match($(el, "main").textContent, /Hallo Yan/);
  assert.ok($(el, 'nav button[data-view="containers"]'));
});

test("Rezept aus Foto: hochladen, Entwurf prüfen und als Foto-Rezept speichern", async () => {
  globalThis.File = dom.window.File;
  globalThis.FormData = dom.window.FormData;
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  const uploads = [];
  let answer = {
    ok: true,
    body: { recipe: { title: "Omas Apfelkuchen", minutes: 75, ingredients: ["500 g Äpfel"], steps: ["Backen."], source: "photo" } },
  };
  hass.fetchWithAuth = async (url, init) => {
    uploads.push({ url, files: init.body.getAll("file").map((f) => f.type) });
    return { ok: answer.ok, json: async () => answer.body };
  };
  const el = mount(hass);
  await flush();
  await go(el, "recipes");
  assert.ok($(el, '[data-role="photo"]'));

  const file = new File(["%PDF"], "rezept.pdf", { type: "application/pdf" });
  await el.readRecipePhotos([file]);
  await flush();
  assert.deepEqual(uploads, [{ url: "/api/larder/recipe_photo", files: ["application/pdf"] }]);
  assert.equal($(el, ".overlay").hidden, false);
  assert.equal($(el, "form.dialog h2").textContent, "Rezept aus Foto prüfen");
  assert.equal($(el, '[data-f="title"]').value, "Omas Apfelkuchen");
  assert.equal($(el, '[data-f="ingredients"]').value, "500 g Äpfel");
  $(el, "form.dialog").dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();
  const save = hass.wsCalls.find((m) => m.type === `${D}/recipe_save`);
  assert.equal(save.source, "photo");
  assert.equal(save.recipe_id, undefined);
  assert.equal(save.minutes, 75);

  // Fehler der KI erscheinen auf der Seite
  answer = { ok: false, body: { error: "recipe_photo_none", message: "Auf dem Foto wurde kein Rezept gefunden." } };
  await el.readRecipePhotos([file]);
  await flush();
  assert.equal($(el, "main .error").textContent, "Auf dem Foto wurde kein Rezept gefunden.");

  // zu viele Fotos
  await el.readRecipePhotos([file, file, file, file, file]);
  await flush();
  assert.equal($(el, "main .error").textContent, "Höchstens 4 Fotos auf einmal.");

  // ohne KI keine Schaltfläche
  document.body.innerHTML = "";
  const noAi = makeHass(DOSES, { ai: false });
  noAi.fetchWithAuth = hass.fetchWithAuth;
  const el2 = mount(noAi);
  await flush();
  await go(el2, "recipes");
  assert.equal($(el2, '[data-role="photo"]'), null);
});

test("Auswahl: Dosen antippen, leere gemeinsam befüllen, gefüllte für Rezeptideen", async () => {
  document.body.innerHTML = "";
  const hass = makeHass([...DOSES, { id: "d6", name: "Dose 6", area: "cellar" }]);
  hass.suggestions = [{ title: "Lachs-Risotto", uses: ["Lachs", "Reis"], steps: [] }];
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  $(el, '[data-role="select"]').click();
  await flush();
  assert.equal($(el, ".selbar .count").textContent, "Tippe Dosen an, um sie auszuwählen.");
  const tile = (id) => $(el, `main .tile[data-id="${id}"]`);
  for (const id of ["d1", "d4", "d5", "d6"]) tile(id).click();
  await flush();
  assert.equal($(el, ".selbar .count").textContent, "4 ausgewählt");
  assert.ok(tile("d1").classList.contains("selected"));
  assert.equal($(el, ".overlay").hidden, true); // Antippen öffnet im Auswahlmodus nichts

  // Befüllen: nur die leeren (d5, d6) im Dialog der klassischen Ansicht
  let opened = null;
  el._classic.openFillDialog = (ids) => (opened = ids);
  assert.equal($(el, '[data-role="fill-selected"]').textContent, "Befüllen (2)");
  $(el, '[data-role="fill-selected"]').click();
  assert.deepEqual([...opened].sort(), ["d5", "d6"]);

  // Rezeptideen aus den gefüllten (d1, d4)
  $(el, '[data-role="recipes-selected"]').click();
  await flush();
  await flush();
  assert.equal($(el, "h1").textContent, "Rezepte");
  const call = hass.wsCalls.find((m) => m.type === "call_service");
  assert.deepEqual([...call.service_data.containers].sort(), ["d1", "d4"]);
  assert.equal($$(el, "main h2")[0].textContent, "Vorschläge aus 2 gewählten Dosen");

  // nach dem Befüllen endet der Auswahlmodus
  await go(el, "containers");
  $(el, '[data-role="select"]').click();
  tile("d6").click();
  await flush();
  el._classic.dispatchEvent(new CustomEvent("larder-filled", { detail: { deviceIds: ["d6"] } }));
  await flush();
  assert.equal($(el, ".selbar"), null);
});

test("Einzel-Scan (📷): öffnet bekannte Dosen, fügt unbekannte Zwilling-Codes hinzu", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  const sent = [];
  const reported = [];
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
  const ZW = "zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=NEU1";
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/resolve_code`) {
      if (msg.code === "cc=d2") return { valid: true, cc: "D2", device_id: "d2", name: "Dose 2" };
      if (msg.code === "cc=d5") return { valid: true, cc: "D5", device_id: "d5", name: "Dose 5" };
      if (msg.code === ZW) return { valid: true, cc: "NEU1", device_id: null };
      return { valid: false };
    }
    if (msg.type === `${D}/report_scan`) {
      reported.push(msg.cc);
      return {};
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  const added = [];
  const filled = [];
  el._classic.openAddDialog = (code) => added.push(code);
  el._classic.openFillDialog = (id) => filled.push(id);

  // Startseite hat den Knopf, ebenso die Behälter-Seite
  assert.ok($(el, '.help [data-role="scan-one"]'));
  $(el, '.help [data-role="scan-one"]').click();
  assert.equal(sent[0].type, "bar_code/scan");
  assert.equal(sent[0].payload.title, "Dose scannen");
  assert.notEqual(external._commandHandler, original);

  // kein Larder-Code: Scanner bleibt offen
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "Hallo", format: "qr_code" } });
  await flush();
  await flush();
  assert.equal(sent[sent.length - 1].type, "bar_code/notify");
  assert.notEqual(external._commandHandler, original);

  // bekannte, gefüllte Dose: Detailansicht
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "cc=d2", format: "qr_code" } });
  await flush();
  await flush();
  assert.equal(sent[sent.length - 1].type, "bar_code/close");
  assert.equal(external._commandHandler, original);
  assert.equal(el._detail, "d2");
  assert.deepEqual(reported, ["D2"]);

  // leere Dose: Befüllen-Dialog
  await go(el, "containers");
  $(el, '.bar [data-role="scan-one"]').click();
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "cc=d5", format: "qr_code" } });
  await flush();
  await flush();
  assert.deepEqual(filled, ["d5"]);

  // unbekannter Zwilling-Code: Hinzufügen mit dem ganzen Code
  $(el, '.bar [data-role="scan-one"]').click();
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: ZW, format: "qr_code" } });
  await flush();
  await flush();
  assert.deepEqual(added, [ZW]);

  // Abbrechen gibt den Empfänger der App zurück
  $(el, '.bar [data-role="scan-one"]').click();
  external._commandHandler({ command: "bar_code/aborted", payload: { reason: "canceled" } });
  assert.equal(external._commandHandler, original);
  assert.equal(el._single, null);
});

test("Einzel-Scan: ohne Scanner der App kein Knopf", async () => {
  document.body.innerHTML = "";
  const el = mount(makeHass(DOSES));
  await flush();
  assert.equal($(el, '[data-role="scan-one"]'), null);
  await go(el, "containers");
  assert.equal($(el, '[data-role="scan-one"]'), null);
});

test("Export und Import: signierte Downloads und Einlesen der Schätzungen", async () => {
  const hass = makeHass(DOSES);
  const base = hass.callWS;
  const imports = [];
  hass.callWS = async (msg) => {
    if (msg.type === "auth/sign_path") return { path: `${msg.path}?authSig=x` };
    if (msg.type === `${D}/estimates_import`) {
      imports.push(msg);
      if (!msg.data.entries) throw new Error("invalid");
      return { added: 2, updated: 1, kept: 1, skipped: 0, entries: [] };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  $(el, "#settings").click();
  $(el, '[data-role="menu-data"]').click();
  await flush();
  await flush();
  const form = $(el, "form.dialog");
  assert.equal($(el, '[data-role="export-inventory"]').getAttribute("href"), "/api/larder/export/containers.csv?authSig=x");
  assert.equal($(el, '[data-role="export-estimates"]').getAttribute("href"), "/api/larder/export/estimates.json?authSig=x");

  const file = form.querySelector('[data-f="file"]');
  const pickFile = (text) => {
    Object.defineProperty(file, "files", { configurable: true, value: [{ text: async () => text }] });
    file.dispatchEvent(new Event("change"));
  };
  form.querySelector('[data-f="replace"]').checked = true;
  pickFile(JSON.stringify({ domain: "larder", entries: [{ content: "Lachs", area: "Küche", days: 2 }] }));
  await flush();
  await flush();
  assert.equal(imports[0].replace, true);
  assert.equal($(el, '[data-role="import-status"]').textContent, "Eingelesen: 2 neu, 1 aktualisiert, 1 eigene behalten.");
  pickFile("kein json");
  await flush();
  await flush();
  assert.equal(form.querySelector(".error").textContent, "Das ist keine Datei mit Larder-Schätzungen.");
});

test("Statistik: über das Menü, Zeitraum wechseln, leerer Verlauf", async () => {
  const hass = makeHass(DOSES);
  const base = hass.callWS;
  const asked = [];
  const STATS = {
    emptied: 3, eaten: 2, thrown: 1, unknown: 0, waste_percent: 33, avg_days_stored: 4.5,
    top_thrown: [{ content: "Käse", count: 1 }], top_eaten: [{ content: "Lachs", count: 2 }], thrown_by_area: [{ area: "Küche", count: 1 }],
    months: [{ month: "2026-10", eaten: 1, thrown: 1 }, { month: "2026-11", eaten: 1, thrown: 0 }],
    containers: { total: 5, filled: 4, empty: 1, expired: 1, soon: 1, undated: 0 },
  };
  let empty = false;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/statistics`) {
      asked.push(msg);
      return empty ? { ...STATS, emptied: 0, eaten: 0, thrown: 0, top_thrown: [], top_eaten: [], thrown_by_area: [] } : STATS;
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  $(el, "#settings").click();
  $(el, '[data-role="menu-stats"]').click();
  await flush();
  await flush();
  assert.equal($(el, "h1").textContent, "Statistik");
  assert.deepEqual(asked[0], { type: `${D}/statistics`, days: 90 });
  const text = $(el, "main").textContent;
  assert.match(text, /33 % weggeworfen/);
  assert.match(text, /Ø 4,5 Tage gelagert/);
  assert.equal($(el, '[data-role="top-thrown"] li .name').textContent, "Käse");
  assert.equal($$(el, ".months .month").length, 2);
  // Zeitraum "Alles": ohne days
  const period = $(el, "main .bar select");
  period.value = "all";
  period.dispatchEvent(new Event("change"));
  await flush();
  await flush();
  assert.deepEqual(asked[1], { type: `${D}/statistics` });
  // kein Verlauf: Hinweis, Bestand trotzdem
  empty = true;
  period.value = "30";
  $(el, "main .bar select").dispatchEvent(new Event("change"));
  await flush();
  await flush();
  assert.match($(el, "main").textContent, /Noch kein Verlauf/);
  assert.match($(el, "main").textContent, /Jetzt im Vorrat/);
});

test("Wochenplan: Rezept einplanen, Startseite zeigt Plan und Auftauen", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES, { recipes: [{ id: "r1", title: "Lachs-Pasta", ingredients: ["Lachs", "Nudeln"], steps: [], source: "manual", created: "1" }] });
  const base = hass.callWS;
  const sent = [];
  const iso = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  let plans = { plans: [], thaw: [] };
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/plan_list`) return plans;
    if ([`${D}/plan_add`, `${D}/plan_delete`, `${D}/thawed`, `${D}/plan_cooked`, `${D}/plan_shopping`].includes(msg.type)) {
      sent.push(msg);
      return {};
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await go(el, "recipes");
  await flush();
  $(el, '.recipe[data-id="r1"] h3').click();
  await flush();
  $(el, '.recipe[data-id="r1"] [data-role="plan"]').click();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector('[data-f="title"]').value, "Lachs-Pasta");
  assert.equal(form.querySelector('[data-f="date"]').value, iso(1));
  const checked = [...form.querySelectorAll('[data-role="plan-containers"] input')].filter((b) => b.checked).map((b) => b.value);
  assert.deepEqual(checked, ["d1"]); // Lachs aus den Zutaten
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.deepEqual(sent[0], { type: `${D}/plan_add`, date: iso(1), title: "Lachs-Pasta", device_ids: ["d1"], ingredients: ["Lachs", "Nudeln"], recipe_id: "r1" });

  plans = {
    plans: [{ id: "p1", date: iso(1), title: "Lachs-Pasta", missing: ["Nudeln"], containers: [{ device_id: "d1", name: "Dose 1", content: "Lachs", frozen: true, thawed: false }] }],
    thaw: [{ cc: "D1", device_id: "d1", name: "Dose 1", content: "Lachs", plan: "Lachs-Pasta", date: iso(1), days_until: 1 }],
  };
  await go(el, "start");
  await flush();
  await flush();
  assert.match($(el, ".stat.thaw").textContent, /Lachs \(Dose 1\) für Lachs-Pasta/);
  assert.match($(el, ".stat.planned").textContent, /Morgen.*Lachs-Pasta.*Lachs 🧊/);
  $(el, '[data-role="thawed"]').click();
  await flush();
  assert.deepEqual(sent[1], { type: `${D}/thawed`, device_ids: ["d1"] });
  await go(el, "recipes");
  await flush();
  await flush();
  $(el, '[data-role="plan-shopping"]').click();
  await flush();
  assert.deepEqual(sent[2], { type: `${D}/plan_shopping`, plan_id: "p1" });
  $(el, '[data-role="plan-cooked"]').click();
  await flush();
  assert.deepEqual(sent[3], { type: `${D}/plan_cooked`, plan_id: "p1" });
  await flush();
  $(el, '[data-role="plan-delete"]').click();
  await flush();
  assert.deepEqual(sent[4], { type: `${D}/plan_delete`, plan_id: "p1" });
});

test("Fach: in Kachel und Liste, durchsuchbar, nach Bereich sortiert", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  for (const [id, value] of [["d1", "Schublade 2"], ["d2", "Schublade 1"]]) {
    const eid = `text.${id}_fach`;
    hass.entities[eid] = { entity_id: eid, device_id: id, platform: D, translation_key: "compartment" };
    hass.states[eid] = { entity_id: eid, state: value, attributes: {} };
  }
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  const tile = $(el, 'main .tile[data-id="d1"]');
  assert.equal(tile.querySelector(".sub").textContent, "Dose 1 · Schublade 2");
  const search = $(el, '[data-role="search"]');
  search.value = "schublade 1";
  search.dispatchEvent(new Event("input"));
  await flush();
  assert.deepEqual(names(el), ["Gouda"]);
  search.value = "";
  search.dispatchEvent(new Event("input"));
  el._opts.sort = "area";
  el._opts.mode = "list";
  el._sig = "";
  el._update();
  await flush();
  const subs = $$(el, "main .row .sub").map((n) => n.textContent);
  assert.ok(subs.indexOf("Dose 2 · Küche · Schublade 1") < subs.indexOf("Dose 1 · Küche · Schublade 2"));
});

test("kcal auf Kachel und in der Liste (pro Portion vor pro 100 g)", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  hass.states["text.d1_inhalt"].attributes = { category: "fish", kcal_100g: 208, kcal_portion: 260 };
  hass.states["text.d2_inhalt"].attributes = { category: "dairy", kcal_100g: 356.5 };
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  assert.equal($(el, 'main .tile[data-id="d1"] .kcal').textContent, "260 kcal/Portion");
  assert.equal($(el, 'main .tile[data-id="d2"] .kcal').textContent, "356,5 kcal/100 g");
  assert.equal($(el, 'main .tile[data-id="d3"] .kcal'), null);
});

test("Allergene im Haushalt: Warnung auf Kachel und in der Liste", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  hass.states["text.d1_inhalt"].attributes = { category: "fish", allergen_warning: ["Fisch"] };
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  assert.equal($(el, 'main .tile[data-id="d1"] .allergen').textContent, "⚠ Fisch");
  assert.equal($(el, 'main .tile[data-id="d2"] .allergen'), null);
});

test("QR-Etiketten: Dialog aus Menü und Auswahl, signierter Link zum PDF", async () => {
  const hass = makeHass(DOSES);
  const signed = [];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "auth/sign_path") {
      signed.push(msg);
      return { path: `${msg.path}&authSig=x` };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  // Menü: alle Dosen
  $(el, "#settings").click();
  $(el, '[data-role="menu-labels"]').click();
  const form = $(el, "form.dialog");
  assert.equal($(el, ".overlay").hidden, false);
  assert.match(form.textContent, /Alle Dosen/);
  assert.equal(form.querySelector('[data-f="layout"]').value, "3x8");
  form.querySelector('[data-f="layout"]').value = "2x4";
  form.querySelector('[data-f="layout"]').dispatchEvent(new Event("change"));
  form.querySelector('[data-f="skip"]').value = "20"; // mehr als ein 2×4-Bogen hat: wird begrenzt
  form.querySelector('[data-f="border"]').checked = true;
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[0].path, "/api/larder/labels.pdf?layout=2x4&skip=7&border=1");
  assert.equal(signed[0].expires, 300);
  const link = form.querySelector("a.pdf");
  assert.equal(link.getAttribute("href"), "/api/larder/labels.pdf?layout=2x4&skip=7&border=1&authSig=x");
  assert.equal(link.target, "_blank");
  // Option ändern verwirft den Link
  form.querySelector('[data-f="content"]').checked = true;
  form.querySelector('[data-f="content"]').dispatchEvent(new Event("change"));
  assert.equal(form.querySelector("a.pdf"), null);
  $(el, ".overlay").click();

  // Auswahl: nur die gewählten Dosen, das Format wird gemerkt
  await go(el, "containers");
  $(el, '[data-role="select"]').click();
  await flush();
  $(el, 'main .tile[data-id="d1"]').click();
  $(el, 'main .tile[data-id="d3"]').click();
  await flush();
  $(el, '[data-role="labels-selected"]').click();
  assert.match(form.textContent, /2 ausgewählte Dosen/);
  assert.equal(form.querySelector('[data-f="layout"]').value, "2x4");
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[1].path, "/api/larder/labels.pdf?device=d1%2Cd3&layout=2x4&skip=0");

  // Inhalt und MHD getrennt: nur Inhalt (dauerhaft in der Dose)
  $(el, '[data-role="labels-selected"]').click();
  assert.equal(form.querySelector('[data-f="bestBefore"]').checked, false);
  form.querySelector('[data-f="content"]').checked = true;
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[2].path, "/api/larder/labels.pdf?device=d1%2Cd3&layout=2x4&skip=0&content=1&bestbefore=0");
  // nur MHD
  form.querySelector('[data-f="content"]').checked = false;
  form.querySelector('[data-f="bestBefore"]').checked = true;
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[3].path, "/api/larder/labels.pdf?device=d1%2Cd3&layout=2x4&skip=0&bestbefore=1");
});

test("Inventur nach dem Serien-Scan: nicht gescannte gefüllte Dosen, auswählen und leeren", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  let eventCb = null;
  hass.connection = { subscribeMessage: async (cb) => ((eventCb = cb), () => {}) };
  const base = hass.callWS;
  const emptied = [];
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/empty`) {
      emptied.push(msg);
      return {};
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  $(el, '[data-role="select"]').click();
  await flush();
  $(el, '[data-role="scan"]').click(); // NFC (kein QR-Scanner)
  await flush();
  await flush();
  eventCb({ device_id: "d1" });
  eventCb({ device_id: "d2" });
  await flush();
  $(el, '[data-role="scan"]').click(); // beenden
  await flush();
  const panel = $(el, ".inventory");
  assert.ok(panel);
  assert.match(panel.textContent, /Inventur: 2 gescannt/);
  assert.match(panel.textContent, /2 gefüllte Dosen wurden nicht gescannt/);
  assert.deepEqual([...panel.querySelectorAll("li")].map((li) => li.textContent), ["Chili (Dose 3)", "Reis (Dose 4)"]);
  $(el, '[data-role="inventory-select"]').click();
  await flush();
  assert.equal($(el, ".selbar .count").textContent, "2 ausgewählt");
  $(el, '[data-role="empty-selected"]').click();
  assert.equal($(el, "form.dialog h2").textContent, "2 Dosen leeren");
  $(el, '[data-role="empty-thrown"]').click();
  await flush();
  await flush();
  assert.deepEqual(emptied, [
    { type: `${D}/empty`, device_id: "d3", outcome: "thrown" },
    { type: `${D}/empty`, device_id: "d4", outcome: "thrown" },
  ]);
  assert.equal($(el, ".overlay").hidden, true);
  assert.match($(el, ".inventory").textContent, /Alle gefüllten Dosen wurden gescannt/);
  $(el, '[data-role="inventory-close"]').click();
  await flush();
  assert.equal($(el, ".inventory"), null);
});

test("Links aus den Reparaturhinweisen: ?problem filtert die Behälter", async () => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?problem=noarea");
  const el = mount(makeHass([...DOSES, { id: "d6", name: "Dose 6", area: "kitchen", content: "Alt", days: -10, category: "dish" }]));
  await flush();
  assert.equal($(el, "h1").textContent, "Behälter");
  assert.deepEqual(names(el), ["Leer"]);
  assert.equal($(el, ".chip span").textContent, "Ohne Bereich");
  el.setView("containers", { problem: "longexpired" });
  await flush();
  assert.deepEqual(names(el), ["Alt"]);
  $(el, ".chip button").click();
  await flush();
  assert.equal(names(el).length, 6);
  window.history.replaceState(null, "", "/");
});

test("QR-Etiketten: was aufs Etikett kommt, Design und Etikettendrucker", async () => {
  const hass = makeHass(DOSES);
  const signed = [];
  const base = hass.callWS;
  hass.callWS = async (msg) => (msg.type === "auth/sign_path" ? (signed.push(msg), { path: msg.path }) : base(msg));
  const el = mount(hass);
  await flush();
  el.openLabelDialog();
  const form = $(el, "form.dialog");
  const box = (f) => form.querySelector(`[data-f="${f}"]`);
  const change = (f) => box(f).dispatchEvent(new Event("change"));
  assert.equal(box("qr").checked, true);
  assert.equal(box("name").checked, true);
  assert.equal(box("content").checked, false);
  box("qr").checked = false;
  change("qr");
  box("name").checked = false;
  change("name");
  assert.equal(form.querySelector("button.submit").disabled, true); // nichts gewählt
  box("content").checked = true;
  change("content");
  assert.equal(form.querySelector("button.submit").disabled, false);
  box("design").value = "handwritten";
  change("design");
  box("layout").value = "62x29";
  change("layout");
  assert.equal(box("skip").closest("label").hidden, true);
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[0].path, "/api/larder/labels.pdf?layout=62x29&skip=0&content=1&bestbefore=0&qr=0&name=0&design=handwritten");
  // wird gemerkt
  $(el, ".overlay").click();
  el.openLabelDialog();
  assert.equal(box("design").value, "handwritten");
  assert.equal(box("qr").checked, false);
  assert.equal(box("content").checked, true);
});

test("Serien-Scan: NFC-Ereignisse und QR-Scanner der App wählen Dosen aus", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  let eventCb = null;
  let unsubscribed = false;
  hass.connection = {
    subscribeMessage: async (cb, msg) => {
      assert.deepEqual(msg, { type: "larder/scan_session" });
      eventCb = cb;
      return () => (unsubscribed = true);
    },
  };
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
    if (msg.type === `${D}/resolve_code`) {
      if (msg.code === "cc=d2") return { valid: true, cc: "d2", device_id: "d2", name: "Dose 2" };
      if (msg.code === "cc=NEU") return { valid: true, cc: "NEU", device_id: null };
      return { valid: false };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  $(el, '[data-role="select"]').click();
  await flush();
  $(el, '[data-role="scan"]').click();
  await flush();
  await flush();
  assert.match($(el, "main .note").textContent, /Serien-Scan läuft/);
  assert.equal($(el, '[data-role="scan-qr"]'), null); // QR-Scanner ist offen
  assert.equal(sent[0].type, "bar_code/scan");
  assert.notEqual(external._commandHandler, original);

  eventCb({ device_id: "d1", name: "Dose 1" }); // NFC
  assert.ok(external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "cc=d2", format: "qr_code" } }));
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "cc=NEU", format: "qr_code" } });
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "Hallo", format: "qr_code" } });
  await flush();
  await flush();
  assert.equal($(el, ".selbar .count").textContent, "2 ausgewählt");
  assert.deepEqual(
    sent.filter((m) => m.type === "bar_code/notify").map((m) => m.payload.message),
    ["✓ Dose 2 (2 ausgewählt)", "Diese Dose ist noch nicht angelegt.", "Kein Larder-Code."],
  );

  $(el, '[data-role="scan"]').click(); // beenden
  await flush();
  assert.equal(unsubscribed, true);
  assert.equal(external._commandHandler, original);
  assert.equal(sent[sent.length - 1].type, "bar_code/close");

  // Umschalter: NFC schließt den QR-Scanner, der Serien-Scan läuft weiter
  unsubscribed = false;
  $(el, '[data-role="scan"]').click();
  await flush();
  await flush();
  assert.equal($(el, '[data-role="scan-mode-qr"]').classList.contains("on"), true);
  $(el, '[data-role="scan-mode-nfc"]').click();
  await flush();
  assert.equal(sent[sent.length - 1].type, "bar_code/close");
  assert.equal(external._commandHandler, original);
  assert.equal(unsubscribed, false);
  assert.equal($(el, '[data-role="scan-mode-nfc"]').classList.contains("on"), true);
  assert.match($(el, ".scanpanel").textContent, /In Home Assistant öffnen/);
  eventCb({ device_id: "d3" });
  await flush();
  assert.ok($(el, 'main .tile[data-id="d3"]').classList.contains("selected"));

  // zurück zu QR öffnet den Scanner wieder; "Zu NFC wechseln" im Scanner schaltet auf NFC
  $(el, '[data-role="scan-mode-qr"]').click();
  await flush();
  assert.equal(sent[sent.length - 1].type, "bar_code/scan");
  assert.equal(sent[sent.length - 1].payload.alternative_option_label, "Zu NFC wechseln");
  external._commandHandler({ command: "bar_code/aborted", payload: { reason: "alternative_options" } });
  await flush();
  assert.equal($(el, '[data-role="scan-mode-nfc"]').classList.contains("on"), true);
  assert.equal(external._commandHandler, original);

  // Wischen auf dem Umschalter
  const seg = $(el, ".segment");
  const touch = (type, x) => {
    const ev = new Event(type);
    ev.touches = [{ clientX: x }];
    ev.changedTouches = [{ clientX: x }];
    seg.dispatchEvent(ev);
  };
  touch("touchstart", 200);
  touch("touchend", 100); // nach links: QR
  await flush();
  assert.equal($(el, '[data-role="scan-mode-qr"]').classList.contains("on"), true);
  assert.notEqual(external._commandHandler, original);

  $(el, '[data-role="scan"]').click(); // Scan beenden
  await flush();
  assert.equal(unsubscribed, true);
  assert.equal(external._commandHandler, original);
});

test("Link aus der Benachrichtigung: ?view=recipes öffnet die Rezeptseite", async () => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?view=recipes");
  const el = mount(makeHass(DOSES));
  await flush();
  assert.equal($(el, "h1").textContent, "Rezepte");
  assert.equal(window.location.search, "");
  window.history.replaceState(null, "", "/");
});

test("Ansicht „Karten“: alle Details über die klassische Karte, mit Filter und Sortierung", async () => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  const hass = makeHass(DOSES);
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  const mode = () => $(el, '[data-role="mode"]');
  assert.equal(mode().getAttribute("aria-label"), "Liste");
  mode().click(); // → Liste
  await flush();
  assert.equal(mode().getAttribute("aria-label"), "Karten mit allen Details");
  mode().click(); // → Karten
  await flush();
  assert.equal(el._classic.getAttribute("show"), "cards");
  assert.equal(el._classic.getAttribute("ids"), "d3,d1,d4,d2,d5"); // nach MHD
  assert.ok(el.hasAttribute("classic-view"));
  assert.equal($$(el, "main .tile, main .row").length, 0);
  // die Karten der klassischen Ansicht sind sichtbar
  assert.equal(el._classic.shadowRoot.querySelectorAll(".card").length, 5);

  // Auswahl zeigt Kacheln, danach wieder Karten
  $(el, '[data-role="select"]').click();
  await flush();
  assert.ok(!el._classic.hasAttribute("show"));
  assert.ok($$(el, "main .tile").length > 0);
  $(el, '[data-role="select-done"]').click();
  await flush();
  assert.equal(el._classic.getAttribute("show"), "cards");

  // andere Seite: klassische Ansicht wieder nur für Dialoge
  await go(el, "areas");
  assert.ok(!el._classic.hasAttribute("show") && !el.hasAttribute("classic-view"));
  window.localStorage.clear();
});

test("⋮-Menü: gemerkte Schätzungen (nur Administratoren) und Einstellungen", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  const base = hass.callWS;
  hass.callWS = async (msg) => (msg.type === `${D}/estimates` ? { mode: "table", entries: [] } : base(msg));
  const el = mount(hass);
  await flush();
  assert.equal($(el, ".menu").hidden, true);
  $(el, "#settings").click();
  assert.equal($(el, ".menu").hidden, false);
  assert.equal($(el, '[data-role="menu-estimates"]').textContent, "📋 Gemerkte Schätzungen");
  $(el, '[data-role="menu-estimates"]').click();
  await flush();
  await flush();
  assert.equal($(el, ".menu").hidden, true);
  assert.equal($(el, "h1").textContent, "Schätzungen");
  assert.equal(el._classic.getAttribute("show"), "estimates");
  assert.equal(el._classic.shadowRoot.querySelector("#estimates").hidden, false);
  await go(el, "start");
  assert.ok(!el._classic.hasAttribute("show"));
  assert.equal(el._classic.shadowRoot.querySelector("#estimates").hidden, true);

  document.body.innerHTML = "";
  const user = mount(makeHass(DOSES, { admin: false }));
  await flush();
  // Nicht-Admins: ⋮ mit Statistik und Etiketten, ohne Export, Schätzungen und Einstellungen
  assert.equal($(user, "#settings").hidden, false);
  assert.equal($(user, "#settings").textContent, "⋮");
  assert.equal($(user, '[data-role="menu-stats"]').hidden, false);
  assert.equal($(user, '[data-role="menu-labels"]').hidden, false);
  for (const role of ["menu-data", "menu-estimates", "menu-settings"]) assert.equal($(user, `[data-role="${role}"]`).hidden, true);
  user.setView("estimates");
  await flush();
  assert.equal($(user, "h1").textContent, "Larder"); // bleibt auf der Startseite
});

test("Links aus Scans: ?open öffnet die Dose (leere zum Befüllen), ?add den Dialog mit Code", async () => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?open=d2");
  let el = mount(makeHass(DOSES));
  await flush();
  assert.equal(el._detail, "d2");
  assert.equal(el._classic.getAttribute("only"), "d2");
  assert.equal(window.location.search, "");

  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?open=d5");
  el = mount(makeHass(DOSES));
  await flush();
  assert.equal(el._classic.shadowRoot.querySelector(".overlay.fill").hidden, false);

  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?add=NEU7");
  el = mount(makeHass(DOSES));
  await flush();
  assert.equal(el._classic.shadowRoot.querySelector(".overlay").hidden, false);
  assert.equal(el._classic.shadowRoot.querySelector('[data-f="code"]').value, "NEU7");
  window.history.replaceState(null, "", "/");
});

test("NFC-Scan bei offenem Dashboard öffnet die Dose; Personenzahl geht an die Rezeptideen; Hinweis für Nicht-Admins", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  const handlers = [];
  hass.connection = { subscribeEvents: async (f, type) => (type === "larder_dose_scanned" && handlers.push(f), () => {}) };
  const cb = (ev) => handlers.forEach((f) => f(ev));
  const el = mount(hass);
  await flush();
  cb({ data: { device_id: "d2" } });
  await flush();
  assert.equal(el._detail, "d2");
  el._closeDetail();
  cb({ data: { device_id: "d5" } }); // leer: Befüll-Dialog
  await flush();
  assert.equal(el._classic.shadowRoot.querySelector(".overlay.fill").hidden, false);

  await go(el, "recipes");
  const servings = $(el, '[data-role="servings"]');
  servings.value = "4";
  servings.dispatchEvent(new Event("change"));
  $(el, '[data-role="generate"]').click();
  await flush();
  const call = hass.wsCalls.filter((m) => m.type === "call_service").pop();
  assert.equal(call.service_data.servings, 4);
  window.localStorage.clear();

  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?add=NEU9");
  const user = mount(makeHass(DOSES, { admin: false }));
  await flush();
  assert.equal($(user, ".notice").hidden, false);
  assert.match($(user, ".notice").textContent, /NEU9/);
  window.history.replaceState(null, "", "/");
});

test("Eigener QR-Code (?cc=): Dose öffnen wie bei NFC, Scan melden, unbekannte Codes zum Hinzufügen", async () => {
  const run = async (cc, { admin = true } = {}) => {
    document.body.innerHTML = "";
    const hass = makeHass(DOSES, { admin });
    const base = hass.callWS;
    hass.callWS = async (msg) => {
      if (msg.type === `${D}/resolve_code`) return { valid: true, cc: msg.code, device_id: { AAA: "d2", EEE: "d5" }[msg.code] || null };
      if (msg.type === `${D}/report_scan`) return hass.wsCalls.push(msg) && { device_id: "x" };
      return base(msg);
    };
    window.history.replaceState(null, "", `/larder?cc=${cc}`);
    const el = mount(hass);
    await flush();
    await flush();
    return { el, hass };
  };
  let { el, hass } = await run("AAA");
  assert.equal(el._detail, "d2");
  assert.ok(hass.wsCalls.some((m) => m.type === `${D}/report_scan` && m.cc === "AAA"));
  ({ el } = await run("EEE"));
  assert.equal(el._classic.shadowRoot.querySelector(".overlay.fill").hidden, false);
  ({ el, hass } = await run("NEU"));
  assert.equal(el._classic.shadowRoot.querySelector('[data-f="code"]').value, "NEU");
  assert.ok(!hass.wsCalls.some((m) => m.type === `${D}/report_scan`));
  ({ el } = await run("NEU", { admin: false }));
  assert.match($(el, ".notice").textContent, /NEU/);
  window.history.replaceState(null, "", "/");
});

// ---------- Block 9: Beutel und Packungen ----------

const { buildItems, itemTexts } = await import("../../custom_components/larder/frontend/larder-dashboard-items.js");

test("buildItems: ein Beutel je Anzahl, leere Zeilen fallen weg, Packungen behalten die Menge", () => {
  const bags = buildItems("bag", [{ content: " Hack ", count: "3", quantity: "500", unit: "grams" }, { content: "" }, { content: "Reh", date: "2027-01-31" }], true);
  assert.equal(bags.length, 4);
  assert.deepEqual(bags[0], { content: "Hack", quantity: 500, unit: "grams", vacuum: true });
  assert.deepEqual(bags[3], { content: "Reh", best_before: "2027-01-31", vacuum: true });
  const packs = buildItems("pack", [{ content: "Tomaten", quantity: "3", unit: "pieces", count: "5", product: { brand: "Mutti" } }]);
  assert.deepEqual(packs, [{ content: "Tomaten", quantity: 3, unit: "pieces", product: { brand: "Mutti" } }]);
  const shape = (o) => JSON.stringify(Object.keys(o).sort());
  assert.equal(shape(itemTexts({ language: "de" })), shape(itemTexts({ language: "en" })));
});

test("Beutel anlegen: Dialog, create_items, danach NFC-Sticker der Reihe nach oder Etiketten", async () => {
  const hass = makeHass(DOSES);
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/create_items`) {
      hass.wsCalls.push(msg);
      return { items: msg.items.map((_, i) => ({ device_id: `b${i + 1}`, cc: `HA-${i}`, name: `Beutel ${i + 1}` })) };
    }
    if (msg.type === `${D}/nfc_link`) {
      hass.wsCalls.push(msg);
      return { by_device: { [msg.device_id]: msg.tag_id } };
    }
    return base(msg);
  };
  const el = mount(hass);
  await go(el, "containers");
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-bag"]').click();
  const form = $(el, "form.dialog");
  assert.match(form.querySelector("h2").textContent, /Beutel anlegen/);
  form.querySelector('[data-f="area"]').value = "cellar";
  form.querySelector("button.submit").click();
  await flush();
  assert.match(form.querySelector(".error").textContent, /mindestens einen Inhalt/);
  form.querySelector('[data-i="content"]').value = "Hackfleisch";
  form.querySelector('[data-i="count"]').value = "2";
  form.querySelector('[data-role="item-more"]').click();
  const rows = form.querySelectorAll(".itemrow");
  assert.equal(rows.length, 2);
  rows[1].querySelector('[data-i="content"]').value = "Rehgulasch";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const created = hass.wsCalls.find((m) => m.type === `${D}/create_items`);
  assert.equal(created.kind, "bag");
  assert.equal(created.area_id, "cellar");
  assert.deepEqual(created.items.map((i) => i.content), ["Hackfleisch", "Hackfleisch", "Rehgulasch"]);
  assert.match(form.querySelector("h2").textContent, /3 Beutel angelegt/);
  assert.equal(form.querySelectorAll("ul.created li").length, 3);
  assert.equal(JSON.parse(dom.window.localStorage.getItem("larder.experimental")).itemArea.bag, "cellar");

  // NFC-Serie: gescannter Sticker wird mit dem aktuellen Beutel verknüpft, dann der nächste
  form.querySelector('[data-role="items-nfc"]').click();
  assert.match(form.querySelector("h2").textContent, /NFC-Sticker 1 von 3/);
  assert.match(form.querySelector(".nfcitem").textContent, /Beutel 1 · Hackfleisch/);
  assert.equal(form.querySelector('[data-role="nfc-write"]'), null); // Browser kann keine Sticker beschreiben
  await el._classic._tagScanned("tag-a");
  await flush();
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === `${D}/nfc_link`).map((m) => [m.tag_id, m.device_id]), [["tag-a", "b1"]]);
  assert.match(form.querySelector("h2").textContent, /NFC-Sticker 2 von 3/);
  await el._classic._tagScanned("tag-a"); // schon vergeben
  await flush();
  assert.match(form.querySelector('[data-role="nfc-status"]').textContent, /gehört schon/);
  form.querySelector('[data-role="nfc-skip"]').click();
  form.querySelector('[data-role="nfc-skip"]').click();
  assert.equal($(el, ".overlay").hidden, true);
  assert.match($(el, ".notice").textContent, /1 Sticker verknüpft/);
});

test("Packungen: anlegen, Filter, Kennzeichen auf der Kachel und Umfüllen in eine leere Dose", async () => {
  const hass = makeHass([...DOSES, { id: "p1", name: "Packung 1", area: "cellar", content: "Tomaten", days: 200, category: "produce" }]);
  hass.states["text.p1_inhalt"].attributes.kind = "pack";
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/create_items`) {
      hass.wsCalls.push(msg);
      return { items: [{ device_id: "p9", cc: "HA-9", name: "Packung 9" }] };
    }
    if (msg.type === `${D}/transfer`) {
      hass.wsCalls.push(msg);
      return { left: 2, best_before: null };
    }
    return base(msg);
  };
  const el = mount(hass);
  await go(el, "containers");
  assert.equal($(el, 'main .tile[data-id="p1"] .kindmark').textContent, "📦");
  assert.equal($(el, 'main .tile[data-id="d1"] .kindmark'), null);
  const state = $(el, '[data-role="state"]');
  state.value = "packs";
  state.dispatchEvent(new Event("change"));
  await flush();
  assert.deepEqual(names(el), ["Tomaten"]);

  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-pack"]').click();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector('[data-i="count"]'), null);
  assert.equal(form.querySelector('[data-i="quantity"]').value, "1");
  form.querySelector('[data-i="content"]').value = "Kichererbsen";
  form.querySelector('[data-i="quantity"]').value = "4";
  form.querySelector('[data-i="date"]').value = "2028-05-01";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const created = hass.wsCalls.find((m) => m.type === `${D}/create_items`);
  assert.deepEqual(created.items, [{ content: "Kichererbsen", quantity: 4, unit: "pieces", best_before: "2028-05-01" }]);
  assert.equal($(el, ".overlay").hidden, true);
  assert.match($(el, ".notice").textContent, /1 Packung angelegt/);

  // Umfüllen: die Karte meldet den Wunsch, das Dashboard fragt nach der leeren Dose
  el._classic.dispatchEvent(new dom.window.CustomEvent("larder-transfer", { detail: { deviceId: "p1" } }));
  assert.deepEqual([...form.querySelectorAll('[data-f="target"] option')].map((o) => o.value), ["d5"]);
  form.querySelector("button.submit").click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/transfer`), { type: `${D}/transfer`, device_id: "p1", target: "d5" });
  assert.match($(el, ".notice").textContent, /Umgefüllt in Dose 5\. Noch 2 im Vorrat/);
});

test("Nach dem Befüllen: Hinweis mit Etikett-Knopf; alter Beutel-Code meldet sich als geleert", async () => {
  const hass = makeHass(DOSES);
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/resolve_code`) return { valid: true, cc: "HA-OLD", device_id: null, retired: "Beutel 3 (Reh) wurde am 12.11.2026 geleert." };
    return base(msg);
  };
  const el = mount(hass);
  await go(el, "containers");
  let labels = null;
  el.openLabelDialog = (ids) => (labels = ids);
  el._classic.dispatchEvent(new dom.window.CustomEvent("larder-filled", { detail: { deviceIds: ["d5"] } }));
  assert.match($(el, ".notice").textContent, /Befüllt/);
  $(el, '[data-role="notice-action"]').click();
  assert.deepEqual(labels, ["d5"]);
  assert.equal($(el, ".notice").hidden, true);

  let added = 0;
  el._classic.openAddDialog = () => added++;
  await el._openScanned("HA-OLD");
  assert.equal(added, 0);
  assert.match($(el, ".notice").textContent, /wurde am 12\.11\.2026 geleert/);
});
