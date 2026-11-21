// Tests for the Larder dashboard (since 2.0, formerly "Larder experimental"; runs in jsdom, without Home Assistant).
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

test("the embedded card is a variant of its own, independent of an already registered <larder-panel>", () => {
  const el = mount(makeHass(DOSES));
  assert.equal(el._classic.tagName.toLowerCase(), "larder-panel-embedded");
  assert.ok(el._classic.hasAttribute("embedded"));
  assert.ok(customElements.get("larder-panel-embedded"));
  assert.ok(customElements.get("larder-panel"));
});

test("texts: German and English have the same keys", () => {
  const shape = (o) => JSON.stringify(Object.keys(o).sort());
  assert.equal(shape(TEXTS.de), shape(TEXTS.en));
  assert.equal(shape(TEXTS.de.views), shape(TEXTS.en.views));
  assert.equal(shape(TEXTS.de.categories), shape(TEXTS.en.categories));
  assert.deepEqual(Object.keys(TEXTS.de.categories).sort(), Object.keys(CATEGORY_ICONS).sort());
});

test("describeDevices: content, days left, category; empty containers count as 'empty'", () => {
  const hass = makeHass(DOSES);
  const rows = describeDevices(hass, collectDevices(hass));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([by.d1.content, by.d1.days, by.d1.category], ["Lachs", 1, "fish"]);
  assert.equal(by.d3.days, -1);
  assert.deepEqual([by.d5.content, by.d5.days, by.d5.category], ["", null, "empty"]);
  assert.deepEqual(rows.filter(isSoon).map((r) => r.id).sort(), ["d1", "d3", "d4"]);
});

test("sortContainers: expiry date, name, area, category", () => {
  const hass = makeHass(DOSES);
  const rows = describeDevices(hass, collectDevices(hass));
  const ids = (sort) => sortContainers(rows, sort, "de").map((r) => r.id);
  assert.deepEqual(ids("date"), ["d3", "d1", "d4", "d2", "d5"]);
  assert.deepEqual(ids("name"), ["d3", "d2", "d1", "d4", "d5"]); // Chili, Gouda, salmon, rice, empty last
  assert.deepEqual(ids("area"), ["d3", "d4", "d1", "d2", "d5"]); // cellar, kitchen, without area
  assert.deepEqual(ids("category"), ["d2", "d3", "d4", "d5", "d1"]); // dairy, dish, dry, empty, fish
});

test("Start: greeting, only containers expiring soon, help buttons", async () => {
  const el = mount(makeHass(DOSES));
  assert.equal($(el, "h1").textContent, "Larder");
  assert.equal($(el, ".hello").textContent, "Hallo Yan");
  assert.match($(el, ".lead").textContent, /bald verbraucht/);
  assert.deepEqual(names(el), ["Chili", "Lachs", "Reis"]); // expired first, then by days left
  assert.deepEqual($$(el, "main .tile .badge").map((b) => b.textContent), ["abgelaufen (1 T)", "1 T", "3 T"]);
  assert.ok($(el, '[data-role="recipes"]'));
  assert.equal($$(el, "nav button").length, 5);
  assert.deepEqual($$(el, "nav button").map((b) => b.textContent), ["🏠Start", "🥫Vorrat", "📖Rezepte", "📍Bereiche", "🏷️Kategorien"]);
});

test("Start: nothing expires, user without AI and without a name", () => {
  const hass = makeHass([{ id: "d2", name: "Dose 2", content: "Gouda", days: 20, category: "dairy" }], { ai: false, name: "" });
  const el = mount(hass);
  assert.equal($(el, ".hello").textContent, "Hallo");
  assert.match($(el, ".lead").textContent, /läuft nichts ab/);
  assert.equal($(el, '[data-role="recipes"]'), null);
  assert.ok($(el, '[data-role="containers"]'));
});

test("Start: 'Show containers' shows the containers expiring soon, with a filter chip", async () => {
  const el = mount(makeHass(DOSES));
  $(el, '[data-role="containers"]').click();
  await flush();
  assert.equal($(el, "h1").textContent, "Vorrat");
  assert.deepEqual(names(el), ["Chili", "Lachs", "Reis"]);
  const state = $(el, '[data-role="state"]');
  assert.equal(state.value, "soon");
  state.value = "all";
  state.dispatchEvent(new Event("change"));
  await flush();
  assert.equal(names(el).length, 5);
});

test("Larder: search, state filter and count as in the old dashboard", async () => {
  document.body.innerHTML = "";
  const el = mount(makeHass(DOSES));
  await go(el, "containers");
  assert.equal($(el, "p.count").textContent, "5 Einträge");
  const search = $(el, '[data-role="search"]');
  search.value = "keller"; // area
  search.dispatchEvent(new Event("input"));
  assert.deepEqual(names(el), ["Chili", "Reis"]);
  assert.equal($(el, "p.count").textContent, "2 von 5 Einträgen");
  assert.equal($(el, '[data-role="search"]'), search); // same field, focus stays
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

test("Larder: tiles with symbol, name, container and days left; an empty container is called 'Empty'", async () => {
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

test("Larder: sort order is remembered, groups by area and category", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "containers");
  const pick = async (value) => {
    const select = $(el, ".bar select");
    select.value = value;
    select.dispatchEvent(new dom.window.Event("change"));
    await flush();
  };
  assert.deepEqual([...$(el, ".bar select").options].map((o) => o.textContent), ["Ablaufdatum / MHD", "Bereich", "Bereich und Fach", "Alphabetisch", "Kategorie"]);
  await pick("area");
  assert.deepEqual($$(el, "main h2").map((h) => h.textContent), ["Keller", "Küche", "Ohne Bereich"]);
  await pick("category");
  assert.deepEqual($$(el, "main h2").map((h) => h.textContent), ["Milchprodukte", "Gerichte & Reste", "Trockenware", "Leer", "Fisch"]);
  await pick("name");
  assert.deepEqual(names(el), ["Chili", "Gouda", "Lachs", "Reis", "Leer"]);
  assert.equal(JSON.parse(dom.window.localStorage.getItem("larder.experimental")).sort, "name");

  // new session: the sort order is still there
  document.body.innerHTML = "";
  const again = mount(makeHass(DOSES));
  await go(again, "containers");
  assert.equal($(again, ".bar select").value, "name");
});

test("Larder: groups by area and compartment", async () => {
  const hass = makeHass(DOSES);
  for (const [id, comp] of [["d1", "Fach 2"], ["d2", "Fach 1"], ["d3", ""]]) {
    const eid = `text.${id}_fach`;
    hass.entities[eid] = { entity_id: eid, device_id: id, platform: D, translation_key: "compartment" };
    hass.states[eid] = { entity_id: eid, state: comp, attributes: {} };
  }
  const el = mount(hass);
  await go(el, "containers");
  const select = $(el, ".bar select");
  select.value = "place";
  select.dispatchEvent(new dom.window.Event("change"));
  await flush();
  assert.deepEqual($$(el, "main h2").map((h) => h.textContent), ["Keller", "Küche · Fach 1", "Küche · Fach 2", "Ohne Bereich"]);
});

test("Larder: switch between tiles and list", async () => {
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

test("Larder: a filled container opens the detail view, an empty one the fill dialog, Back closes", async () => {
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
  // the embedded card shows exactly this container
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

test("non-administrator: an empty container opens the detail view, adding only for bags and packs", async () => {
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

test("Add opens the dialog of the normal dashboard", async () => {
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

test("manage areas: create with storage type, empty storage places, edit", async () => {
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
  // empty storage place with Larder label appears, garage (without label) does not
  assert.deepEqual(names(el), ["Gefriertruhe", "Keller", "Küche", "Ohne Bereich"]);

  // create: first Larder label is suggested, new label possible
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

  // edit: all areas, storage type as subtitle, foreign labels stay
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

  // empty name is rejected
  $$(el, "main [data-area]").find((n) => n.dataset.area === "garage").click();
  await flush();
  form.querySelector('[data-f="name"]').value = " ";
  form.querySelector("button.submit").click();
  await flush();
  assert.equal(form.querySelector(".error").textContent, "Bitte einen Namen eingeben.");
  $(el, ".overlay").click();

  // Done ends edit mode, non-admins see neither ＋ nor ✏️
  $(el, '[data-role="area-edit"]').click();
  await flush();
  assert.ok($(el, '[data-role="area-edit"]').textContent.includes("✏️"));
});

test("manage areas: administrators only", async () => {
  const el = mount(makeHass(DOSES, { admin: false }));
  await go(el, "areas");
  assert.equal($(el, '[data-role="area-add"]'), null);
  assert.equal($(el, '[data-role="area-edit"]'), null);
});

test("areas: tiles with count, tapping filters the larder", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "areas");
  assert.equal($(el, "h1").textContent, "Bereiche");
  assert.deepEqual(names(el), ["Keller", "Küche", "Ohne Bereich"]);
  assert.deepEqual($$(el, "main .tile .sub").map((s) => s.textContent), ["2 Einträge", "2 Einträge", "1 Eintrag"]);
  assert.deepEqual($$(el, "main .tile .badge").map((s) => s.textContent), ["2 bald", "1 bald"]);

  $$(el, "main .tile")[1].click(); // kitchen
  await flush();
  assert.equal($(el, "h1").textContent, "Vorrat");
  assert.equal($(el, ".chip span").textContent, "Bereich: Küche");
  assert.deepEqual(names(el), ["Lachs", "Gouda"]);
});

test("areas: sort by count, 'Without area' filters containers without area", async () => {
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

test("categories: tiles per category including 'Empty', tapping filters", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "categories");
  assert.equal($(el, "h1").textContent, "Kategorien");
  assert.deepEqual(names(el), ["Fisch", "Milchprodukte", "Gerichte & Reste", "Trockenware", "Leer"]);
  $$(el, "main .tile").find((t) => t.querySelector(".name").textContent === "Fisch").click();
  await flush();
  assert.equal($(el, ".chip span").textContent, "Kategorie: Fisch");
  assert.deepEqual(names(el), ["Lachs"]);
});

test("categories: mixed containers are listed under 'Mixed'", async () => {
  const el = mount(makeHass([...DOSES, { id: "d6", name: "Dose 6", area: "kitchen", content: "Gouda, Lachs", days: 2, category: "mixed" }]));
  await go(el, "categories");
  assert.deepEqual(names(el), ["Fisch", "Milchprodukte", "Gerichte & Reste", "Trockenware", "Gemischt", "Leer"]);
  const tile = $$(el, "main .tile").find((t) => t.querySelector(".name").textContent === "Gemischt");
  assert.equal(tile.querySelector(".ico").textContent, "🍱");
});

test("navigation resets filters", async () => {
  const el = mount(makeHass(DOSES));
  await go(el, "areas");
  $$(el, "main .tile")[0].click();
  await flush();
  assert.ok($(el, ".chip"));
  await go(el, "containers");
  assert.equal($(el, ".chip"), null);
  assert.equal(names(el).length, 5);
});

test("English interface", async () => {
  const el = mount(makeHass(DOSES, { language: "en" }));
  assert.equal($(el, ".hello").textContent, "Hello Yan");
  assert.deepEqual($$(el, "nav button").map((b) => b.textContent), ["🏠Start", "🥫Larder", "📖Recipes", "📍Areas", "🏷️Categories"]);
  await go(el, "containers");
  assert.equal($$(el, "main .tile .name").pop().textContent, "Empty");
});

test("hamburger menu only in narrow mode and triggers the Home Assistant menu", () => {
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

test("recipes: create a new recipe by hand", async () => {
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

test("recipes: edit and delete", async () => {
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

  $(el, '.recipe [data-role="delete"]').click(); // stays expanded
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/recipe_delete`), { type: `${D}/recipe_delete`, recipe_id: "r1" });
  assert.equal($$(el, "main .recipe").length, 0);
});

test("recipes: generate suggestions from leftovers and save them one by one", async () => {
  const hass = makeHass(DOSES);
  hass.suggestions = [
    { title: "Lachs-Pasta", minutes: 20, uses: ["Lachs (1 Portion)"], extra_ingredients: ["Sahne"], steps: ["Kochen"] },
    { title: "Chili-Wrap", uses: ["Chili"], steps: [] },
  ];
  const el = mount(hass);
  await flush();
  $(el, '[data-role="recipes"]').click(); // start → recipe suggestions
  await flush();
  await flush();
  assert.equal($(el, "h1").textContent, "Rezepte");
  const call = hass.wsCalls.find((m) => m.type === "call_service");
  assert.deepEqual(call, { type: "call_service", domain: D, service: "suggest_recipes", service_data: {}, return_response: true }); // without a value the setting applies
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

test("recipes: AI errors and no matches, users without rights see no buttons", async () => {
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

test("recipes: period from the settings, changeable and can be switched off", async () => {
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

  // the choice survives a reload
  document.body.innerHTML = "";
  const el2 = mount(makeHass(DOSES));
  await flush();
  await go(el2, "recipes");
  assert.equal($(el2, '[data-role="period"]').value, "all");
  window.localStorage.clear();
});

test(`"Expiring soon" follows the setting in the new dashboard too`, () => {
  assert.equal(isSoon({ content: "Suppe", days: 5, soon: 3 }), false);
  assert.equal(isSoon({ content: "Suppe", days: 5, soon: 7 }), true);
  assert.equal(isSoon({ content: "Suppe", days: 5 }), false); // without a value: 3 days
  assert.equal(isSoon({ content: "", days: 1, soon: 7 }), false);
});

test("reload: properties HA sets before the module is loaded are taken over", async () => {
  document.body.innerHTML = "";
  // element exists before the class is registered (like on a reload in HA)
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

test("recipe from a photo: upload, check the draft and save as a photo recipe", async () => {
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

  // AI errors appear on the page
  answer = { ok: false, body: { error: "recipe_photo_none", message: "Auf dem Foto wurde kein Rezept gefunden." } };
  await el.readRecipePhotos([file]);
  await flush();
  assert.equal($(el, "main .error").textContent, "Auf dem Foto wurde kein Rezept gefunden.");

  // too many photos
  await el.readRecipePhotos([file, file, file, file, file]);
  await flush();
  assert.equal($(el, "main .error").textContent, "Höchstens 4 Fotos auf einmal.");

  // without AI no button
  document.body.innerHTML = "";
  const noAi = makeHass(DOSES, { ai: false });
  noAi.fetchWithAuth = hass.fetchWithAuth;
  const el2 = mount(noAi);
  await flush();
  await go(el2, "recipes");
  assert.equal($(el2, '[data-role="photo"]'), null);
});

test("selection: tap containers, fill empty ones together, filled ones for recipe ideas", async () => {
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
  assert.equal($(el, ".overlay").hidden, true); // tapping opens nothing in selection mode

  // fill: only the empty ones (d5, d6) in the dialog of the classic view
  let opened = null;
  el._classic.openFillDialog = (ids) => (opened = ids);
  assert.equal($(el, '[data-role="fill-selected"]').textContent, "Befüllen (2)");
  $(el, '[data-role="fill-selected"]').click();
  assert.deepEqual([...opened].sort(), ["d5", "d6"]);

  // recipe ideas from the filled ones (d1, d4)
  $(el, '[data-role="recipes-selected"]').click();
  await flush();
  await flush();
  assert.equal($(el, "h1").textContent, "Rezepte");
  const call = hass.wsCalls.find((m) => m.type === "call_service");
  assert.deepEqual([...call.service_data.containers].sort(), ["d1", "d4"]);
  assert.equal($$(el, "main h2")[0].textContent, "Vorschläge aus 2 gewählten Dosen");

  // selection mode ends after filling
  await go(el, "containers");
  $(el, '[data-role="select"]').click();
  tile("d6").click();
  await flush();
  el._classic.dispatchEvent(new CustomEvent("larder-filled", { detail: { deviceIds: ["d6"] } }));
  await flush();
  assert.equal($(el, ".selbar"), null);
});

test("single scan (📷): opens known containers, adds unknown Zwilling codes", async () => {
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

  // the start page has the button, so does the containers page
  assert.ok($(el, '.help [data-role="scan-one"]'));
  $(el, '.help [data-role="scan-one"]').click();
  assert.equal(sent[0].type, "bar_code/scan");
  assert.equal(sent[0].payload.title, "Dose scannen");
  assert.notEqual(external._commandHandler, original);

  // no Larder code: scanner stays open
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "Hallo", format: "qr_code" } });
  await flush();
  await flush();
  assert.equal(sent[sent.length - 1].type, "bar_code/notify");
  assert.notEqual(external._commandHandler, original);

  // known, filled container: detail view
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "cc=d2", format: "qr_code" } });
  await flush();
  await flush();
  assert.equal(sent[sent.length - 1].type, "bar_code/close");
  assert.equal(external._commandHandler, original);
  assert.equal(el._detail, "d2");
  assert.deepEqual(reported, ["D2"]);

  // empty container: fill dialog
  await go(el, "containers");
  $(el, '.bar [data-role="scan-one"]').click();
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: "cc=d5", format: "qr_code" } });
  await flush();
  await flush();
  assert.deepEqual(filled, ["d5"]);

  // unknown Zwilling code: add with the whole code
  $(el, '.bar [data-role="scan-one"]').click();
  external._commandHandler({ command: "bar_code/scan_result", payload: { rawValue: ZW, format: "qr_code" } });
  await flush();
  await flush();
  assert.deepEqual(added, [ZW]);

  // cancel gives the app's receiver back
  $(el, '.bar [data-role="scan-one"]').click();
  external._commandHandler({ command: "bar_code/aborted", payload: { reason: "canceled" } });
  assert.equal(external._commandHandler, original);
  assert.equal(el._single, null);
});

test("single scan: no button without the app's scanner", async () => {
  document.body.innerHTML = "";
  const el = mount(makeHass(DOSES));
  await flush();
  assert.equal($(el, '[data-role="scan-one"]'), null);
  await go(el, "containers");
  assert.equal($(el, '[data-role="scan-one"]'), null);
});

test("export and import: signed downloads and importing the estimates", async () => {
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

test("statistics: via the menu, change the period, empty history", async () => {
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
  // period "All": without days
  const period = $(el, "main .bar select");
  period.value = "all";
  period.dispatchEvent(new Event("change"));
  await flush();
  await flush();
  assert.deepEqual(asked[1], { type: `${D}/statistics` });
  // no history: hint, stock anyway
  empty = true;
  period.value = "30";
  $(el, "main .bar select").dispatchEvent(new Event("change"));
  await flush();
  await flush();
  assert.match($(el, "main").textContent, /Noch kein Verlauf/);
  assert.match($(el, "main").textContent, /Jetzt im Vorrat/);
});

test("weekly plan: schedule a recipe, start page shows the plan and thawing", async () => {
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
  assert.deepEqual(checked, ["d1"]); // salmon from the ingredients
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

test("compartment: in tile and list, searchable, sorted by area", async () => {
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

test("kcal on the tile and in the list (per portion before per 100 g)", async () => {
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

test("household allergens: warning on the tile and in the list", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  hass.states["text.d1_inhalt"].attributes = { category: "fish", allergen_warning: ["Fisch"] };
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  assert.equal($(el, 'main .tile[data-id="d1"] .allergen').textContent, "⚠ Fisch");
  assert.equal($(el, 'main .tile[data-id="d2"] .allergen'), null);
});

test("QR labels: dialog from menu and selection, signed link to the PDF", async () => {
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
  // menu: all containers
  $(el, "#settings").click();
  $(el, '[data-role="menu-labels"]').click();
  const form = $(el, "form.dialog");
  assert.equal($(el, ".overlay").hidden, false);
  assert.match(form.textContent, /Alle Dosen/);
  assert.equal(form.querySelector('[data-f="layout"]').value, "3x8");
  form.querySelector('[data-f="layout"]').value = "2x4";
  form.querySelector('[data-f="layout"]').dispatchEvent(new Event("change"));
  form.querySelector('[data-f="skip"]').value = "20"; // more than a 2×4 sheet holds: capped
  form.querySelector('[data-f="border"]').checked = true;
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[0].path, "/api/larder/labels.pdf?layout=2x4&skip=7&border=1");
  assert.equal(signed[0].expires, 300);
  const link = form.querySelector("a.pdf");
  assert.equal(link.getAttribute("href"), "/api/larder/labels.pdf?layout=2x4&skip=7&border=1&authSig=x");
  assert.equal(link.target, "_blank");
  // changing an option discards the link
  form.querySelector('[data-f="content"]').checked = true;
  form.querySelector('[data-f="content"]').dispatchEvent(new Event("change"));
  assert.equal(form.querySelector("a.pdf"), null);
  $(el, ".overlay").click();

  // selection: only the chosen containers, the format is remembered
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

  // content and best-before separately: content only (permanently in the container)
  $(el, '[data-role="labels-selected"]').click();
  assert.equal(form.querySelector('[data-f="bestBefore"]').checked, false);
  form.querySelector('[data-f="content"]').checked = true;
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[2].path, "/api/larder/labels.pdf?device=d1%2Cd3&layout=2x4&skip=0&content=1&bestbefore=0");
  // best-before only
  form.querySelector('[data-f="content"]').checked = false;
  form.querySelector('[data-f="bestBefore"]').checked = true;
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[3].path, "/api/larder/labels.pdf?device=d1%2Cd3&layout=2x4&skip=0&bestbefore=1");
});

test("stocktaking after the series scan: filled containers not scanned, select and empty", async () => {
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
  $(el, '[data-role="scan"]').click(); // NFC (no QR scanner)
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

test("links from the repair hints: ?problem filters the larder", async () => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?problem=noarea");
  const el = mount(makeHass([...DOSES, { id: "d6", name: "Dose 6", area: "kitchen", content: "Alt", days: -10, category: "dish" }]));
  await flush();
  assert.equal($(el, "h1").textContent, "Vorrat");
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

test("QR labels: what goes on the label, design and label printer", async () => {
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
  assert.equal(form.querySelector("button.submit").disabled, true); // nothing chosen
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
  // is remembered
  $(el, ".overlay").click();
  el.openLabelDialog();
  assert.equal(box("design").value, "handwritten");
  assert.equal(box("qr").checked, false);
  assert.equal(box("content").checked, true);
});

test("series scan: NFC events and the app's QR scanner select containers", async () => {
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
  assert.equal($(el, '[data-role="scan-qr"]'), null); // QR scanner is open
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

  // switch: NFC closes the QR scanner, the series scan keeps running
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

  // back to QR opens the scanner again; "Switch to NFC" in the scanner switches to NFC
  $(el, '[data-role="scan-mode-qr"]').click();
  await flush();
  assert.equal(sent[sent.length - 1].type, "bar_code/scan");
  assert.equal(sent[sent.length - 1].payload.alternative_option_label, "Zu NFC wechseln");
  external._commandHandler({ command: "bar_code/aborted", payload: { reason: "alternative_options" } });
  await flush();
  assert.equal($(el, '[data-role="scan-mode-nfc"]').classList.contains("on"), true);
  assert.equal(external._commandHandler, original);

  // swiping on the switch
  const seg = $(el, ".segment");
  const touch = (type, x) => {
    const ev = new Event(type);
    ev.touches = [{ clientX: x }];
    ev.changedTouches = [{ clientX: x }];
    seg.dispatchEvent(ev);
  };
  touch("touchstart", 200);
  touch("touchend", 100); // to the left: QR
  await flush();
  assert.equal($(el, '[data-role="scan-mode-qr"]').classList.contains("on"), true);
  assert.notEqual(external._commandHandler, original);

  $(el, '[data-role="scan"]').click(); // Scan beenden
  await flush();
  assert.equal(unsubscribed, true);
  assert.equal(external._commandHandler, original);
});

test("link from the notification: ?view=recipes opens the recipe page", async () => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?view=recipes");
  const el = mount(makeHass(DOSES));
  await flush();
  assert.equal($(el, "h1").textContent, "Rezepte");
  assert.equal(window.location.search, "");
  window.history.replaceState(null, "", "/");
});

test(`view "Cards": all details via the classic card, with filter and sorting`, async () => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  const hass = makeHass(DOSES);
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  const mode = () => $(el, '[data-role="mode"]');
  assert.equal(mode().getAttribute("aria-label"), "Liste");
  mode().click(); // → list
  await flush();
  assert.equal(mode().getAttribute("aria-label"), "Karten mit allen Details");
  mode().click(); // → cards
  await flush();
  assert.equal(el._classic.getAttribute("show"), "cards");
  assert.equal(el._classic.getAttribute("ids"), "d3,d1,d4,d2,d5"); // by best-before
  assert.ok(el.hasAttribute("classic-view"));
  assert.equal($$(el, "main .tile, main .row").length, 0);
  // the cards of the classic view are visible
  assert.equal(el._classic.shadowRoot.querySelectorAll(".card").length, 5);

  // selection shows tiles, then cards again
  $(el, '[data-role="select"]').click();
  await flush();
  assert.ok(!el._classic.hasAttribute("show"));
  assert.ok($$(el, "main .tile").length > 0);
  $(el, '[data-role="select-done"]').click();
  await flush();
  assert.equal(el._classic.getAttribute("show"), "cards");

  // other page: classic view only for dialogs again
  await go(el, "areas");
  assert.ok(!el._classic.hasAttribute("show") && !el.hasAttribute("classic-view"));
  window.localStorage.clear();
});

test("⋮ menu: remembered estimates (administrators only) and settings", async () => {
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
  // non-admins: ⋮ with statistics and labels, without export, estimates and settings
  assert.equal($(user, "#settings").hidden, false);
  assert.equal($(user, "#settings").textContent, "⋮");
  assert.equal($(user, '[data-role="menu-stats"]').hidden, false);
  assert.equal($(user, '[data-role="menu-labels"]').hidden, false);
  for (const role of ["menu-data", "menu-estimates", "menu-settings"]) assert.equal($(user, `[data-role="${role}"]`).hidden, true);
  user.setView("estimates");
  await flush();
  assert.equal($(user, "h1").textContent, "Larder"); // stays on the start page
});

test("links from scans: ?open opens the container (empty ones for filling), ?add the dialog with code", async () => {
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

test("NFC scan with the dashboard open opens the container; number of persons goes to the recipe ideas; hint for non-admins", async () => {
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
  cb({ data: { device_id: "d5" } }); // empty: fill dialog
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

test("own QR code (?cc=): open the container like with NFC, report the scan, unknown codes for adding", async () => {
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

// ---------- Block 9: bags and packs ----------

const { buildItems, itemTexts } = await import("../../custom_components/larder/frontend/larder-dashboard-items.js");

test("buildItems: one bag per count, empty rows are dropped, packs keep the amount", () => {
  const bags = buildItems("bag", [{ content: " Hack ", count: "3", quantity: "500", unit: "grams" }, { content: "" }, { content: "Reh", date: "2027-01-31" }], true);
  assert.equal(bags.length, 4);
  assert.deepEqual(bags[0], { content: "Hack", quantity: 500, unit: "grams", vacuum: true });
  assert.deepEqual(bags[3], { content: "Reh", best_before: "2027-01-31", vacuum: true });
  const packs = buildItems("pack", [{ content: "Tomaten", quantity: "3", unit: "pieces", count: "5", product: { brand: "Mutti" } }]);
  assert.deepEqual(packs, [{ content: "Tomaten", quantity: 3, unit: "pieces", product: { brand: "Mutti" } }]);
  const shape = (o) => JSON.stringify(Object.keys(o).sort());
  assert.equal(shape(itemTexts({ language: "de" })), shape(itemTexts({ language: "en" })));
});

test("create bags: dialog, create_items, then NFC stickers one after another or labels", async () => {
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

  // NFC series: the scanned sticker is linked with the current bag, then the next
  form.querySelector('[data-role="items-nfc"]').click();
  assert.match(form.querySelector("h2").textContent, /NFC-Sticker 1 von 3/);
  assert.match(form.querySelector(".nfcitem").textContent, /Beutel 1 · Hackfleisch/);
  assert.equal(form.querySelector('[data-role="nfc-write"]'), null); // browser cannot write stickers
  await el._classic._tagScanned("tag-a");
  await flush();
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === `${D}/nfc_link`).map((m) => [m.tag_id, m.device_id]), [["tag-a", "b1"]]);
  assert.match(form.querySelector("h2").textContent, /NFC-Sticker 2 von 3/);
  await el._classic._tagScanned("tag-a"); // already taken
  await flush();
  assert.match(form.querySelector('[data-role="nfc-status"]').textContent, /gehört schon/);
  form.querySelector('[data-role="nfc-skip"]').click();
  form.querySelector('[data-role="nfc-skip"]').click();
  assert.equal($(el, ".overlay").hidden, true);
  assert.match($(el, ".notice").textContent, /1 Sticker verknüpft/);
});

test("packs: create, filter, mark on the tile and transfer into an empty container", async () => {
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
  form.querySelector('[data-f="compartment"]').value = " Regal oben ";
  form.querySelector('[data-i="content"]').value = "Kichererbsen";
  form.querySelector('[data-i="quantity"]').value = "4";
  form.querySelector('[data-i="date"]').value = "2028-05-01";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const created = hass.wsCalls.find((m) => m.type === `${D}/create_items`);
  assert.deepEqual(created.items, [{ content: "Kichererbsen", quantity: 4, unit: "pieces", best_before: "2028-05-01" }]);
  assert.equal(created.compartment, "Regal oben");
  assert.equal($(el, ".overlay").hidden, true);
  assert.match($(el, ".notice").textContent, /1 Packung angelegt/);

  // transfer: the card reports the wish, the dashboard asks for the empty container
  el._classic.dispatchEvent(new dom.window.CustomEvent("larder-transfer", { detail: { deviceId: "p1" } }));
  assert.deepEqual([...form.querySelectorAll('[data-f="target"] option')].map((o) => o.value), ["d5"]);
  form.querySelector("button.submit").click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/transfer`), { type: `${D}/transfer`, device_id: "p1", target: "d5" });
  assert.match($(el, ".notice").textContent, /Umgefüllt in Dose 5\. Noch 2 im Vorrat/);
});

test("after filling: hint with label button; an old bag code reports as emptied", async () => {
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

// ---------- Block 11: stock ----------

test("stock: view from the menu, change minimum stock, a place opens the pack", async () => {
  const hass = makeHass(DOSES);
  let products = [
    { key: "ketchup", name: "Ketchup", count: 4, min: 5, low: true, brand: "Heinz", package: "500 ml", places: [
      { device_id: "d1", area: "Vorrat", compartment: "Keller", count: 3 }, { device_id: "d2", area: "Kühlschrank", compartment: "", count: 1 }] },
    { key: "senf", name: "Senf", count: 0, min: 1, low: true, places: [] },
  ];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/stock`) return { products, shopping_list: false };
    if (msg.type === `${D}/stock_min`) {
      hass.wsCalls.push(msg);
      products = products.map((p) => (p.name === msg.content ? { ...p, min: msg.min, low: p.count < msg.min } : p));
      return { products };
    }
    return base(msg);
  };
  const el = mount(hass);
  $(el, "#settings").click();
  $(el, '[data-role="menu-stock"]').click();
  await flush();
  await flush();
  assert.equal($(el, "h1").textContent, "Bestand");
  const items = $$(el, ".stockitem");
  assert.deepEqual(items.map((i) => i.querySelector(".name").textContent), ["Ketchup", "Senf"]);
  assert.equal(items[0].querySelector(".count").textContent, "4");
  assert.equal(items[0].querySelector(".badge").textContent, "zu wenig");
  assert.equal(items[1].querySelector(".badge").textContent, "keine mehr da");
  assert.deepEqual([...items[0].querySelectorAll("button.place")].map((b) => b.textContent), ["Vorrat · Keller: 3", "Kühlschrank: 1"]);
  assert.match($(el, "main").textContent, /fehlt noch eine Einkaufsliste/);
  const min = items[0].querySelector('[data-role="stock-min"]');
  min.value = "3";
  min.dispatchEvent(new dom.window.Event("change"));
  await flush();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/stock_min`), { type: `${D}/stock_min`, content: "Ketchup", min: 3 });
  assert.equal($$(el, ".stockitem")[0].querySelector(".badge"), null);
  $$(el, ".stockitem")[0].querySelector("button.place").click();
  assert.equal(el._classic.getAttribute("only"), "d1");
});

test("move/split a pack and receipt in the pack dialog", async () => {
  const hass = makeHass(DOSES);
  hass.states["text.d1_inhalt"].attributes.kind = "pack";
  hass.states["number.d1_portionen"].state = "5";
  hass.states["select.d1_einheit"].state = "pieces";
  hass.fetchWithAuth = async (url, init) => {
    hass.fetched = { url, file: init.body.get("file") };
    return { ok: true, json: async () => ({ items: [{ name: "Gehackte Tomaten", count: 3 }, { name: "Milch", count: 1 }] }) };
  };
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/pack_move`) {
      hass.wsCalls.push(msg);
      return { moved: msg.count, merged: false };
    }
    return base(msg);
  };
  const el = mount(hass);
  await go(el, "containers");
  el._classic.dispatchEvent(new dom.window.CustomEvent("larder-move", { detail: { deviceId: "d1" } }));
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector('[data-f="count"]').value, "5");
  assert.equal(form.querySelector('[data-f="area"]').value, "kitchen");
  form.querySelector('[data-f="count"]').value = "2";
  form.querySelector('[data-f="area"]').value = "cellar";
  form.querySelector('[data-f="compartment"]').value = "Regal";
  form.querySelector("button.submit").click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/pack_move`), { type: `${D}/pack_move`, device_id: "d1", count: 2, compartment: "Regal", area_id: "cellar" });
  assert.match($(el, ".notice").textContent, /2 nach Keller · Regal verschoben/);

  // receipt: suggestions end up in the rows
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-pack"]').click();
  const file = form.querySelector('[data-role="receipt-file"]');
  assert.ok(form.querySelector('[data-role="item-receipt"]'));
  Object.defineProperty(file, "files", { value: [new File(["x"], "bon.jpg", { type: "image/jpeg" })], configurable: true });
  file.dispatchEvent(new dom.window.Event("change"));
  await flush();
  await flush();
  assert.equal(hass.fetched.url, `/api/${D}/receipt_photo`);
  const rows = [...form.querySelectorAll(".itemrow")].map((r) => [r.querySelector('[data-i="content"]').value, r.querySelector('[data-i="quantity"]').value]);
  assert.deepEqual(rows, [["Gehackte Tomaten", "3"], ["Milch", "1"]]);
  assert.match(form.querySelector('[data-role="item-status"]').textContent, /2 Produkt/);
});

// ---------- Block 12: stock in everyday use ----------

test("barcode: shows all places, oldest best-before first, −1 at the chosen place; unknown → create as a pack", async () => {
  const hass = makeHass(DOSES);
  hass.states["number.d2_portionen"].state = "3";
  const answers = {
    "4000000000001": { code: "4000000000001", name: "Ketchup", product: null, entries: [
      { device_id: "d1", area: "Küche", compartment: "Tür", count: 1, best_before: "2026-12-01" },
      { device_id: "d2", area: "Keller", compartment: "Regal", count: 3, best_before: "2027-06-01" }],
      known: { content: "Ketchup", kind: "pack", product: { brand: "Heinz", ean: "4000000000001", price: 1.99 }, area_id: "cellar", compartment: "Regal" } },
    "6000000000003": { code: "6000000000003", name: "Senf", product: { brand: "Develey" }, entries: [] },
  };
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/stock_code`) return answers[msg.code];
    // formally an EAN is also a valid container ID for Larder (just unknown)
    if (msg.type === `${D}/resolve_code`) return { valid: true, cc: msg.code, device_id: null, name: null, retired: null };
    if (msg.type === `${D}/empty`) {
      hass.wsCalls.push(msg);
      return {};
    }
    return base(msg);
  };
  const el = mount(hass);
  await go(el, "containers");
  let added = 0;
  el._classic.openAddDialog = () => added++;
  // EAN via the normal 📷 scan: stock instead of "Add container"
  assert.equal(await el._resolveSingle("4000000000001"), true);
  assert.equal(added, 0);
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Ketchup");
  assert.match(form.querySelector("p.lead").textContent, /Ältestes zuerst: Küche · Tür/);
  const rows = [...form.querySelectorAll(".coderow")];
  assert.deepEqual(rows.map((r) => r.querySelector(".name").textContent), ["Küche · Tür: 1", "Keller · Regal: 3"]);
  assert.equal(rows[1].querySelector(".sub").textContent, "MHD 01.06.2027");
  assert.ok(rows[0].classList.contains("oldest"));
  // 4.2: per place used up, thrown away, open (not when already opened) and move
  assert.deepEqual([...rows[1].querySelectorAll(".codeactions button")].map((b) => b.textContent), ["Verbraucht", "Entsorgen", "Anbrechen", "Umbuchen"]);
  // the newer one in hand: used up there
  rows[1].querySelector('[data-role="code-take"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.at(-1), { type: `${D}/pack_take`, device_id: "d2", outcome: "eaten" });
  assert.match($(el, ".notice").textContent, /aus Keller · Regal verbraucht/);
  // thrown away
  await el.takeByCode("4000000000001");
  form.querySelector('[data-role="code-thrown"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.at(-1), { type: `${D}/pack_take`, device_id: "d1", outcome: "thrown" });
  assert.match($(el, ".notice").textContent, /entsorgt/);
  // move opens the move dialog, open the open dialog
  await el.takeByCode("4000000000001");
  form.querySelectorAll('[data-role="code-move"]')[1].click();
  assert.match(form.querySelector("h2").textContent, /verschieben|Verschieben/i);
  await el.takeByCode("4000000000001");
  form.querySelectorAll('[data-role="code-open"]')[1].click();
  assert.match(form.querySelector("h2").textContent, /anbrechen/i);
  // a new pack of the same product: prefilled with product data, price and the place where most of it is
  await el.takeByCode("4000000000001");
  form.querySelector('[data-role="code-new"]').click();
  assert.match(form.querySelector("h2").textContent, /Packungen anlegen/);
  assert.equal(form.querySelector('[data-i="content"]').value, "Ketchup");
  assert.equal(form.querySelector('[data-i="price"]').value, "1,99");
  assert.equal(form.querySelector('[data-f="area"]').value, "cellar");
  assert.equal(form.querySelector('[data-f="compartment"]').value, "Regal");
  // not in stock
  await el.takeByCode("6000000000003");
  assert.match(form.textContent, /Senf ist nicht im Vorrat/);
  form.querySelector('[data-role="code-add"]').click();
  assert.match(form.querySelector("h2").textContent, /Packungen anlegen/);
  assert.equal(form.querySelector('[data-i="content"]').value, "Senf");
});

test("bought: start page offers ticked-off entries, creating takes over place and data", async () => {
  const hass = makeHass(DOSES);
  let bought = [{ id: "b1", summary: "Senf (Develey)", content: "Senf", product: { brand: "Develey" }, area_id: "cellar", compartment: "Regal", count: 2 }];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/bought`) return { items: bought };
    if (msg.type === `${D}/bought_dismiss`) {
      hass.wsCalls.push(msg);
      bought = bought.filter((b) => b.id !== msg.item_id);
      return { items: bought };
    }
    if (msg.type === `${D}/create_items`) {
      hass.wsCalls.push(msg);
      return { items: [{ device_id: "p1", cc: "HA-1", name: "Packung 1" }] };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await flush();
  const box = $(el, ".stat.bought");
  assert.match(box.textContent, /Eingekauft/);
  assert.match(box.querySelector(".boughtrow .name").textContent, /Senf \(Develey\)/);
  box.querySelector('[data-role="bought-add"]').click();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector('[data-f="area"]').value, "cellar");
  assert.equal(form.querySelector('[data-f="compartment"]').value, "Regal");
  assert.equal(form.querySelector('[data-i="quantity"]').value, "2");
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const created = hass.wsCalls.find((m) => m.type === `${D}/create_items`);
  assert.deepEqual(created.items, [{ content: "Senf", quantity: 2, unit: "pieces", product: { brand: "Develey" } }]);
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/bought_dismiss`), { type: `${D}/bought_dismiss`, item_id: "b1" });
});

test("suggest a compartment: chips per area from existing and recently used compartments", async () => {
  const hass = makeHass(DOSES);
  for (const [id, comp] of [["d1", "Tür"], ["d2", "Tür"], ["d3", "Regal oben"], ["d4", "Regal unten"]]) {
    const eid = `text.${id}_fach`;
    hass.entities[eid] = { entity_id: eid, device_id: id, platform: D, translation_key: "compartment" };
    hass.states[eid] = { entity_id: eid, state: comp, attributes: {} };
  }
  dom.window.localStorage.setItem("larder.compartments", JSON.stringify({ cellar: ["Kiste"] }));
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/create_items`) {
      hass.wsCalls.push(msg);
      return { items: [{ device_id: "p1", cc: "HA-1", name: "Packung 1" }] };
    }
    return base(msg);
  };
  const el = mount(hass);
  await go(el, "containers");
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-pack"]').click();
  const form = $(el, "form.dialog");
  const chips = () => [...form.querySelectorAll('[data-role="compartment-chips"] .compchip')].map((c) => c.textContent);
  const area = form.querySelector('[data-f="area"]');
  area.value = "cellar";
  area.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(chips(), ["Regal oben", "Regal unten", "Kiste"]);
  area.value = "kitchen";
  area.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(chips(), ["Tür"]);
  area.value = "cellar";
  area.dispatchEvent(new dom.window.Event("change"));
  const input = form.querySelector('[data-f="compartment"]');
  input.value = "unten";
  input.dispatchEvent(new dom.window.Event("input"));
  assert.deepEqual(chips(), ["Regal unten"]);
  form.querySelector('[data-role="compartment-chips"] .compchip').click();
  assert.equal(input.value, "Regal unten");
  form.querySelector('[data-i="content"]').value = "Bohnen";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(hass.wsCalls.find((m) => m.type === `${D}/create_items`).compartment, "Regal unten");
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("larder.compartments")).cellar, ["Regal unten", "Kiste"]);
});

// ---------- Block 8: learning and reporting ----------

test("Again …?: start page suggests things often eaten; shopping list and hiding", async () => {
  const hass = makeHass(DOSES);
  let items = [{ key: "bolognese", content: "Bolognese", count: 4, last: "2026-11-01" }];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/cook_again`) return { items, shopping_list: true };
    if (msg.type === `${D}/cook_again_action`) {
      hass.wsCalls.push(msg);
      items = [];
      return { added: true, items };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await flush();
  const box = $(el, ".stat.again");
  assert.match(box.textContent, /Mal wieder/);
  assert.match(box.textContent, /Bolognese.*4× in den letzten 90 Tagen/);
  box.querySelector('[data-role="again-shop"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/cook_again_action`), { type: `${D}/cook_again_action`, content: "Bolognese", action: "shop" });
  assert.equal($(el, ".stat.again"), null);
  assert.match($(el, ".notice").textContent, /Bolognese steht auf der Einkaufsliste/);
});

test("statistics show the monthly report of the previous month", async () => {
  const hass = makeHass(DOSES);
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === "call_service" && msg.service === "get_monthly_report") {
      return { response: { label: "Oktober 2026", empty: false, summary: "📦 4 befüllt, 4 geleert\n✅ 2 gegessen, 🗑 2 weggeworfen" } };
    }
    if (msg.type === `${D}/statistics`) return null;
    return base(msg);
  };
  const el = mount(hass);
  $(el, "#settings").click();
  $(el, '[data-role="menu-stats"]').click();
  await flush();
  await flush();
  const box = $(el, ".stat.report");
  assert.equal(box.querySelector("h3").textContent, "📅 Oktober 2026");
  assert.deepEqual([...box.querySelectorAll("p.line")].map((p) => p.textContent), ["📦 4 befüllt, 4 geleert", "✅ 2 gegessen, 🗑 2 weggeworfen"]);
});

// ---------- Block 14: stock care ----------

test("open a pack: dialog with place, pack_open, then the opened pack", async () => {
  const hass = makeHass(DOSES);
  hass.states["text.d4_inhalt"].attributes.kind = "pack";
  hass.states["number.d4_portionen"].state = "3";
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/pack_open`) {
      hass.wsCalls.push(msg);
      return { device_id: "d2", best_before: "2026-12-24", split: true };
    }
    return base(msg);
  };
  const el = mount(hass);
  await go(el, "containers");
  el._classic.dispatchEvent(new dom.window.CustomEvent("larder-open-pack", { detail: { deviceId: "d4" } }));
  const form = $(el, "form.dialog");
  assert.match(form.textContent, /Eine von 3 Packungen/);
  assert.equal(form.querySelector('[data-f="area"]').value, "cellar");
  form.querySelector('[data-f="area"]').value = "kitchen";
  form.querySelector('[data-f="compartment"]').value = "Tür";
  form.querySelector("button.submit").click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/pack_open`), { type: `${D}/pack_open`, device_id: "d4", area_id: "kitchen", compartment: "Tür" });
  assert.match($(el, ".notice").textContent, /Angebrochen, MHD jetzt 24\.12\.2026/);
  assert.equal(el._classic.getAttribute("only"), "d2");
});

test("stocktaking: choose a place, tick off, correct the count, remove, scan, summary", async () => {
  const hass = makeHass([
    ...DOSES,
    { id: "p1", name: "Packung 1", area: "cellar", content: "Tomaten", days: 200, category: "produce" },
  ]);
  hass.states["text.p1_inhalt"].attributes.kind = "pack";
  hass.states["number.p1_portionen"].state = "4";
  hass.states["select.p1_einheit"].state = "pieces";
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/empty`) {
      hass.wsCalls.push(msg);
      return {};
    }
    if (msg.type === `${D}/resolve_code`) return { valid: true, cc: msg.code, device_id: msg.code === "QR-D4" ? "d4" : msg.code === "QR-D1" ? "d1" : null };
    return base(msg);
  };
  hass.user.is_admin = false; // stocktaking without administrator rights too
  const el = mount(hass);
  $(el, "#settings").click();
  $(el, '[data-role="menu-stocktake"]').click();
  await flush();
  assert.equal($(el, "h1").textContent, "Inventur");
  $(el, '[data-f="take-area"]').value = "cellar";
  $(el, '[data-role="take-start"]').click();
  await flush();
  const rowsText = () => $$(el, ".takerow .name").map((n) => n.textContent);
  assert.deepEqual(rowsText().sort(), ["Chili", "Reis", "Tomaten"]);
  assert.match($(el, "main p.count").textContent, /0 von 3 geprüft/);
  // container without administrator rights: no "Elsewhere"; a pack has it
  const row = (id) => $(el, `.takerow[data-id="${id}"]`);
  assert.equal(row("d3").querySelector('[data-role="take-elsewhere"]'), null);
  assert.ok(row("p1").querySelector('[data-role="take-elsewhere"]'));
  // Anzahl korrigieren
  const count = row("p1").querySelector('[data-role="take-count"]');
  assert.equal(count.value, "4");
  count.value = "3";
  count.dispatchEvent(new dom.window.Event("change"));
  await flush();
  assert.deepEqual(hass.calls.at(-1), { domain: "number", service: "set_value", data: { entity_id: "number.p1_portionen", value: 3 } });
  assert.ok(row("p1").classList.contains("changed"));
  // tick off by scanning (container 4 = rice); container 1 does not belong here
  await el.stocktakeScan("QR-D4");
  assert.ok(row("d4").classList.contains("ok"));
  await el.stocktakeScan("QR-D1");
  assert.match($(el, ".notice").textContent, /Lachs gehört nicht in dieses Fach/);
  // austragen
  row("d3").querySelector('[data-role="take-gone"]').click();
  row("d3").querySelector('[data-role="take-thrown"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/empty`), { type: `${D}/empty`, device_id: "d3", outcome: "thrown" });
  assert.ok(row("d3").classList.contains("gone"));
  assert.match($(el, "main p.count").textContent, /3 von 3 geprüft/);
  $(el, '[data-role="take-finish"]').click();
  assert.match($(el, "form.dialog").textContent, /2 bestätigt \(1 korrigiert\), 1 ausgetragen, 0 verschoben, 0 nicht geprüft/);
});

// ---------- Block 15: consumption and costs ----------

const { spanText, money } = await import("../../custom_components/larder/frontend/larder-dashboard-items.js");

test("stock: lasts, suggested minimum stock, price and value; price in the pack dialog", async () => {
  assert.equal(spanText(5, true), "5 Tage");
  assert.equal(spanText(42, true), "6 Wochen");
  assert.equal(spanText(180, true, true), "6 Monaten");
  assert.equal(spanText(30, false), "4 weeks");
  assert.equal(money(1.5, true), "1,50");
  const hass = makeHass(DOSES);
  let products = [
    { key: "ketchup", name: "Ketchup", count: 3, min: 1, low: false, places: [], usage: { per_week: 0.5, lasts_days: 42, takes: 4, days: 180 }, suggested_min: 2, price: { price: 1.99, source: "receipt" }, value: 5.97 },
    { key: "senf", name: "Senf", count: 2, min: 0, low: false, places: [], usage: null, suggested_min: null, price: { price: 2.29, source: "openprices" }, value: 4.58 },
  ];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/stock`) return { products, shopping_list: true, value: 10.55, valued: 2, lead_days: 7 };
    if (msg.type === `${D}/stock_min`) {
      hass.wsCalls.push(msg);
      products = products.map((p) => (p.name === msg.content ? { ...p, min: msg.min } : p));
      return { products };
    }
    if (msg.type === `${D}/create_items`) {
      hass.wsCalls.push(msg);
      return { items: [{ device_id: "p1", cc: "HA-1", name: "Packung 1" }] };
    }
    return base(msg);
  };
  hass.fetchWithAuth = async () => ({ ok: true, json: async () => ({ items: [{ name: "Ketchup", count: 2, price: 1.99 }] }) });
  const el = mount(hass);
  el.setView("stock");
  await flush();
  await flush();
  assert.match($(el, '[data-role="stock-value"]').textContent, /Vorrat im Wert von ca\. 10,55 € \(2 Produkte mit Preis\)/);
  const [ketchup, senf] = $$(el, ".stockitem");
  assert.equal(ketchup.querySelector('[data-role="stock-usage"]').textContent, "reicht noch ca. 6 Wochen · aus 4 Entnahmen in 6 Monaten");
  assert.match(ketchup.querySelector(".price").textContent, /1,99 € je Packung · Wert ca\. 5,97 €/);
  assert.match(senf.querySelector(".price").textContent, /ca\. 2,29 € je Packung \(Open Prices\)/);
  assert.equal(senf.querySelector('[data-role="stock-usage"]'), null);
  ketchup.querySelector('[data-role="stock-suggest"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/stock_min`), { type: `${D}/stock_min`, content: "Ketchup", min: 2 });

  // the receipt fills the price, which ends up in the product data
  $(el, "#settings").click();
  el.openItemsDialog("pack");
  const form = $(el, "form.dialog");
  const file = form.querySelector('[data-role="receipt-file"]');
  Object.defineProperty(file, "files", { value: [new File(["x"], "bon.jpg", { type: "image/jpeg" })], configurable: true });
  file.dispatchEvent(new dom.window.Event("change"));
  await flush();
  await flush();
  assert.equal(form.querySelector('[data-i="price"]').value, "1,99");
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const created = hass.wsCalls.find((m) => m.type === `${D}/create_items`);
  assert.deepEqual(created.items[0].product, { price: 1.99, price_source: "receipt" });
});

// ---------- Block 16: running low and recalls ----------

test("start page: running low with shopping list and hiding", async () => {
  const hass = makeHass(DOSES);
  let items = [{ key: "milch", name: "Milch", count: 2, min: 1, lasts_days: 4 }];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/running_low`) return { items, shopping_list: true };
    if (msg.type === `${D}/running_low_action`) {
      hass.wsCalls.push(msg);
      items = [];
      return { added: msg.action === "shop", items };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await flush();
  const box = $(el, ".stat.low");
  assert.match(box.textContent, /Bald leer/);
  assert.match(box.textContent, /Milch.*noch 2, reicht ca\. 4 Tage/);
  box.querySelector('[data-role="low-shop"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/running_low_action`), { type: `${D}/running_low_action`, content: "Milch", action: "shop" });
  assert.equal($(el, ".stat.low"), null);
  assert.match($(el, ".notice").textContent, /Milch steht auf der Einkaufsliste/);
});

test("start page: recall at the top, with place, match, link and read", async () => {
  const hass = makeHass(DOSES);
  let items = [{
    id: "abc123", title: "Heinz Tomato Ketchup 500 ml", reason: "Glassplitter nicht ausgeschlossen", date: "2026-11-12",
    link: "https://www.lebensmittelwarnung.de/meldung/1",
    items: [{ cc: "P1", device_id: "d1", content: "Ketchup", brand: "Heinz", area: "Küche", compartment: "Tür", via: "brand" }],
  }];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/recalls`) return { items };
    if (msg.type === `${D}/recall_read`) {
      hass.wsCalls.push(msg);
      items = [];
      return { items };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await flush();
  const box = $(el, ".stat.recall");
  assert.ok(box);
  // right below the greeting, before everything else
  assert.equal(box.previousElementSibling.className, "hello");
  assert.match(box.textContent, /Rückrufwarnung/);
  assert.match(box.textContent, /Glassplitter/);
  assert.match(box.textContent, /Im Vorrat: Ketchup – Küche · Tür/);
  assert.match(box.textContent, /Übereinstimmung: Marke und Name.*12\.11\.2026/);
  assert.equal(box.querySelector('[data-role="recall-open"]').href, "https://www.lebensmittelwarnung.de/meldung/1");
  box.querySelector('[data-role="recall-read"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/recall_read`), { type: `${D}/recall_read`, recall_id: "abc123" });
  assert.equal($(el, ".stat.recall"), null);
});

// ---------- Block 13: compartment tags and labels ----------

test("QR label of a compartment is recognised", () => {
  assert.deepEqual(mod.placeFromCode("homeassistant://navigate/larder?place=cellar&compartment=Regal+oben"), { areaId: "cellar", compartment: "Regal oben" });
  assert.deepEqual(mod.placeFromCode("homeassistant://navigate/larder?place=-&compartment="), { areaId: "", compartment: "" });
  assert.equal(mod.placeFromCode("homeassistant://navigate/larder?cc=HA-1"), null);
  assert.equal(mod.placeFromCode("4000000000017"), null);
});

test("compartment via link (NFC notification): list oldest first, −1, link a tag, stocktaking", async () => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/larder?place=cellar&compartment=");
  const hass = makeHass([...DOSES, { id: "p1", name: "Packung 1", area: "cellar", content: "Tomaten", days: 200, category: "produce" }]);
  hass.states["text.p1_inhalt"].attributes.kind = "pack";
  hass.states["number.p1_portionen"].state = "3";
  hass.states["select.p1_einheit"].state = "pieces";
  let links = [];
  let capture = null;
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/place_tags`) return { links };
    if (msg.type === `${D}/place_link`) {
      hass.wsCalls.push(msg);
      links = [{ tag_id: msg.tag_id, area_id: msg.area_id, compartment: msg.compartment }];
      return { links };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await flush();
  el._classic.startCapture = (cb) => {
    capture = cb;
  };
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Keller");
  assert.deepEqual([...form.querySelectorAll(".placelist .name")].map((n) => n.textContent.replace(/^\S+ /, "")), ["Chili", "Reis", "Tomaten · 3"]);
  // pack: −1
  form.querySelector('.coderow[data-id="p1"] [data-role="place-take"]').click();
  await flush();
  assert.ok(hass.wsCalls.some((m) => m.type === `${D}/pack_take` && m.device_id === "p1" && m.outcome === "eaten"));
  // container: open instead of −1
  assert.ok(form.querySelector('.coderow[data-id="d3"] [data-role="place-open"]'));
  // link a tag: scan an existing tag
  form.querySelector('[data-role="place-tag"]').click();
  assert.match(form.querySelector('[data-role="place-status"]').textContent, /NFC-Tag/);
  await capture("tag-xyz");
  await flush();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/place_link`), { type: `${D}/place_link`, tag_id: "tag-xyz", area_id: "cellar", compartment: "" });
  assert.ok($(el, "form.dialog").textContent.includes("NFC-Tag verknüpft"));
  // stocktaking for exactly this compartment
  $(el, '[data-role="place-stocktake"]').click();
  await flush();
  assert.equal($(el, "h1").textContent, "Inventur");
  assert.deepEqual($$(el, ".takerow .name").map((n) => n.textContent).sort(), ["Chili", "Reis", "Tomaten"]);
  assert.ok($(el, '[data-role="take-place"]'));
  window.history.replaceState(null, "", "/");
});

test("compartment label and look options in the PDF link", async () => {
  document.body.innerHTML = "";
  dom.window.localStorage.clear();
  const hass = makeHass(DOSES);
  const signed = [];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/place_tags`) return { links: [] };
    if (msg.type === "auth/sign_path") {
      signed.push(msg.path);
      return { path: msg.path };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await el.openPlace("kitchen", "Tür");
  $(el, '[data-role="place-label"]').click();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Fach-Etikett");
  assert.match(form.textContent, /Küche · Tür/);
  assert.equal(form.querySelector('[data-role="label-parts"]').hidden, true);
  form.querySelector('[data-f="logo"]').checked = true;
  form.querySelector('[data-f="color"]').value = "green";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[0], "/api/larder/labels.pdf?place=kitchen%7CT%C3%BCr&layout=3x8&skip=0&color=green&logo=1");
  // inverted: hint, colour locked, no color parameter
  const inv = form.querySelector('[data-f="inverted"]');
  inv.checked = true;
  inv.dispatchEvent(new Event("change"));
  assert.equal(form.querySelector('[data-role="inverted-hint"]').hidden, false);
  assert.equal(form.querySelector('[data-f="color"]').disabled, true);
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(signed[1], "/api/larder/labels.pdf?place=kitchen%7CT%C3%BCr&layout=3x8&skip=0&inverted=1&logo=1");
  dom.window.localStorage.clear();
});

test("compartment: writing a sticker links the tag right away", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  const messages = [];
  hass.auth = { external: { config: { canWriteTag: true }, fireMessage: (m) => messages.push(m) } };
  let links = [];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/place_tags`) return { links };
    if (msg.type === `${D}/place_link`) {
      hass.wsCalls.push(msg);
      links = [{ tag_id: msg.tag_id, area_id: msg.area_id, compartment: msg.compartment }];
      return { links };
    }
    if (msg.type === "tag/create") {
      hass.wsCalls.push(msg);
      return {};
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await el.openPlace("cellar", "Regal oben");
  // beide Wege sofort sichtbar
  assert.ok($(el, '[data-role="place-tag"]'));
  $(el, '[data-role="place-write"]').click();
  await flush();
  await flush();
  await flush();
  const link = hass.wsCalls.find((m) => m.type === `${D}/place_link`);
  assert.equal(link.area_id, "cellar");
  assert.equal(link.compartment, "Regal oben");
  assert.equal(hass.wsCalls.find((m) => m.type === "tag/create").tag_id, link.tag_id);
  assert.deepEqual(messages[0], { type: "tag/write", payload: { name: "Keller · Regal oben", tag: link.tag_id } });
  const form = $(el, "form.dialog");
  assert.match(form.textContent, /NFC-Tag verknüpft/);
  assert.match(form.querySelector('[data-role="place-status"]').textContent, /Verknüpft\. Halte das Handy/);
  assert.equal(form.querySelector('[data-role="place-write"]'), null);
});

// ---------- Block 10: batch cooking and planning ----------

const cook = await import("../../custom_components/larder/frontend/larder-dashboard-cook.js");

test("split and suggest matching containers", () => {
  assert.equal(cook.litres("500 ml"), 0.5);
  assert.equal(cook.litres("1,5 l"), 1.5);
  assert.equal(cook.litres("groß"), null);
  assert.deepEqual(cook.splitAmount(3000, "milliliters", ["1 l", "1 l", "1,5 l"]), [1000, 1000, 1000]);
  assert.deepEqual(cook.splitAmount(1500, "milliliters", ["1 l"]), [1000]); // the rest does not fit
  assert.deepEqual(cook.splitAmount(7, "portions", [null, null, null]), [3, 2, 2]);
  assert.deepEqual(cook.splitAmount(0, "portions", [null]), [0]);
  const options = [{ size: "0,5 l" }, { size: "1 l" }, { size: "2 l" }, { size: "1 l" }];
  assert.deepEqual(cook.suggestContainers(3000, options).map((o) => o.size), ["2 l", "1 l"]);
  assert.deepEqual(cook.suggestContainers(2400, options).map((o) => o.size), ["2 l", "0,5 l"]);
});

test("larder: free containers per size; the container sizes dialog saves loose containers", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  let sizes = { overview: [{ size: "0,5 l", total: 1, filled: 1, free: 0 }, { size: "1 l", total: 4, filled: 1, free: 3 }], loose: { "1 l": 2 }, known: ["1 l"] };
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/sizes`) return sizes;
    if (msg.type === `${D}/loose_set`) {
      hass.wsCalls.push(msg);
      sizes = { ...sizes, loose: msg.loose };
      return sizes;
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  await flush();
  assert.equal($(el, '[data-role="free-sizes"]').textContent, "Frei: 3 × 1 l");
  $(el, '[data-role="free-sizes"]').click();
  await flush();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Behältergrößen");
  assert.equal(form.querySelector('[data-f="loose-size"]').value, "1 l");
  form.querySelector('[data-role="loose-add"]').click();
  const rows = form.querySelectorAll(".looserow");
  rows[1].querySelector('[data-f="loose-size"]').value = "2 l";
  rows[1].querySelector('[data-f="loose-count"]').value = "3";
  form.querySelector('[data-role="loose-save"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.at(-1), { type: `${D}/loose_set`, loose: { "1 l": 2, "2 l": 3 } });
});

test("batch cooking: dish, amount, suggest containers, on to filling with amount per container", async () => {
  document.body.innerHTML = "";
  const hass = makeHass([...DOSES, { id: "d6", name: "Dose 6", area: "kitchen" }, { id: "d7", name: "Dose 7", area: "kitchen" }]);
  hass.states["text.d5_inhalt"].attributes = { kind: "container", size_fixed: "1 l" };
  hass.states["text.d6_inhalt"].attributes = { kind: "container", size_fixed: "2 l" };
  hass.states["text.d7_inhalt"].attributes = { kind: "container", size_fixed: "0,5 l" };
  const base = hass.callWS;
  hass.callWS = async (msg) => (msg.type === `${D}/sizes` ? { overview: [], loose: {}, known: [] } : base(msg));
  const el = mount(hass);
  await flush();
  let opened = null;
  el._classic.openFillDialog = (ids, preset) => {
    opened = { ids, preset };
    return true;
  };
  $(el, "#settings").click();
  $(el, '[data-role="menu-batch"]').click();
  await flush();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Vorkochen");
  assert.equal(form.querySelectorAll(".batchrow").length, 3);
  form.querySelector('[data-f="batch-dish"]').value = "Chili";
  form.querySelector('[data-f="batch-total"]').value = "2500";
  form.querySelector('[data-f="batch-unit"]').value = "milliliters";
  form.querySelector('[data-f="batch-unit"]').dispatchEvent(new Event("change"));
  form.querySelector('[data-role="batch-suggest"]').click();
  assert.match(form.querySelector('[data-role="batch-preview"]').textContent, /2 Dosen: 2000 ml, 500 ml/);
  form.querySelector('[data-role="batch-next"]').click();
  assert.deepEqual(opened.ids, ["d6", "d7"]);
  assert.deepEqual(opened.preset, { content: "Chili", quantities: { d6: 2000, d7: 500 }, unit: "milliliters", sizes: {} });
});

test("suggest a weekly plan: show days, remove, apply", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  const base = hass.callWS;
  const added = [];
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/plan_suggest`) {
      return {
        source: "book_ai",
        error: null,
        days: [
          { date: "2026-11-15", title: "Bolognese", source: "book", recipe_id: "r1", ingredients: ["Nudeln"], uses: [{ device_id: "d3", content: "Chili" }] },
          { date: "2026-11-16", title: "Omelett", source: "ai", ingredients: ["Butter"], uses: [{ device_id: "d4", content: "Reis" }] },
          { date: "2026-11-17", title: "Suppe", source: "ai", ingredients: [], uses: [{ device_id: "d1", content: "Lachs" }] },
        ],
        others: [],
      };
    }
    if (msg.type === `${D}/plan_add`) {
      added.push(msg);
      return { plan: {} };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await go(el, "recipes");
  $(el, '[data-role="week-suggest"]').click();
  await flush();
  await flush();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelectorAll(".weekday").length, 3);
  assert.match(form.textContent, /Bolognese.*📖 Rezeptbuch.*Verbraucht: Chili/);
  form.querySelectorAll('[data-role="week-remove"]')[2].click();
  assert.equal(form.querySelectorAll(".weekday").length, 2);
  form.querySelector('[data-role="week-accept"]').click();
  await flush();
  await flush();
  assert.deepEqual(added, [
    { type: `${D}/plan_add`, date: "2026-11-15", title: "Bolognese", device_ids: ["d3"], recipe_id: "r1", ingredients: ["Nudeln"] },
    { type: `${D}/plan_add`, date: "2026-11-16", title: "Omelett", device_ids: ["d4"], ingredients: ["Butter"] },
  ]);
  assert.match($(el, ".notice").textContent, /2 Gerichte im Wochenplan/);
});

// ---------- Block 20: Bugfixes ----------

test("barcode: a renamed pack keeps the EAN; not in stock → link with a product", async () => {
  document.body.innerHTML = "";
  const hass = makeHass(DOSES);
  let linked = false;
  const created = [];
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/stock_code`) {
      return linked
        ? { code: msg.code, name: "Curryketchup", product: null, entries: [{ device_id: "d1", area: "Küche", compartment: "", count: 1, best_before: null }] }
        : { code: msg.code, name: "Hela Curry Gewürz Ketchup", product: { ean: msg.code, brand: "Hela" }, entries: [] };
    }
    if (msg.type === `${D}/stock`) return { products: [{ key: "curryketchup", name: "Curryketchup", brand: "Hela", count: 2 }, { key: "x", name: "Leer", count: 0 }] };
    if (msg.type === `${D}/stock_code_link`) {
      hass.wsCalls.push(msg);
      linked = true;
      return { linked: 1 };
    }
    if (msg.type === `${D}/create_items`) {
      created.push(msg);
      return { items: [] };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  // create as a pack and rename: product data (EAN) stays
  await el.takeByCode("4000000000017");
  const form = $(el, "form.dialog");
  form.querySelector('[data-role="code-add"]').click();
  const content = form.querySelector('[data-i="content"]');
  content.value = "Curryketchup";
  content.dispatchEvent(new Event("input"));
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();
  await flush();
  assert.equal(created[0].items[0].content, "Curryketchup");
  assert.equal(created[0].items[0].product.ean, "4000000000017");
  // not in stock → link
  await el.takeByCode("4000000000017");
  form.querySelector('[data-role="code-link"]').click();
  await flush();
  await flush();
  assert.equal(form.querySelector("h2").textContent, "Strichcode zuordnen");
  assert.deepEqual([...form.querySelectorAll('[data-f="code-product"] option')].map((o) => o.value), ["Curryketchup"]);
  form.querySelector('[data-role="code-link-save"]').click();
  await flush();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/stock_code_link`), { type: `${D}/stock_code_link`, code: "4000000000017", content: "Curryketchup" });
  assert.equal(form.querySelector("h2").textContent, "Curryketchup");
  assert.match($(el, ".notice").textContent, /Strichcode mit Curryketchup verknüpft/);
});

// ----- 4.0: household items, area scopes -----

test("buildItems: household items count pieces (packs × pieces per pack), optional date (4.4)", () => {
  const items = buildItems("household", [
    { content: "Klopapier", quantity: "2", packSize: "8", piece: " Rollen ", date: "2030-01-01", price: "3,99", product: { ean: "4" } },
    { content: "Spülmittel", quantity: "", packSize: "" },
  ]);
  assert.deepEqual(items, [
    { content: "Klopapier", quantity: 16, unit: "pieces", best_before: "2030-01-01", product: { ean: "4", pack_size: 8, piece: "Rollen", price: 3.99, price_source: "own" } },
    { content: "Spülmittel", quantity: 1, unit: "pieces" },
  ]);
});

function householdHass() {
  const hass = makeHass([
    ...DOSES,
    { id: "h1", name: "Artikel 1", area: "cellar", content: "Klopapier", days: null, category: "hh_paper" },
  ]);
  hass.states["text.h1_inhalt"].attributes.kind = "household";
  hass.areas = {
    ...AREAS,
    bath: { area_id: "bath", name: "Bad", labels: ["l_hh", "l"] },
    fridge: { area_id: "fridge", name: "Kühlschrank", labels: ["l_food", "l"] },
  };
  hass.areas.kitchen = { ...AREAS.kitchen, labels: ["l"] };
  hass.areas.cellar = { ...AREAS.cellar, labels: ["l"] };
  const base = hass.callWS;
  hass.scopes = { bath: "household", fridge: "food", kitchen: "both", cellar: "both" };
  hass.plan = {};
  hass.callWS = async (msg) => {
    if (msg.type === "config/label_registry/list") {
      return [{ label_id: "l", name: "Larder" }, { label_id: "l_hh", name: "Larder: Haushalt" }, { label_id: "l_food", name: "Larder: Lebensmittel" }];
    }
    if (msg.type === `${D}/area_scopes`) return { scopes: hass.scopes, plan: hass.plan };
    if (msg.type === `${D}/area_scope_set`) {
      hass.wsCalls.push(msg);
      hass.scopes = { ...hass.scopes, [msg.area_id]: msg.scope };
      return {};
    }
    if (msg.type === `${D}/area_scopes_auto`) {
      hass.wsCalls.push(msg);
      hass.plan = {};
      return {};
    }
    if (msg.type === `${D}/create_items`) {
      hass.wsCalls.push(msg);
      return { items: msg.items.map((_, i) => ({ device_id: `n${i}`, cc: `HA-${i}`, name: `Artikel ${i + 2}` })) };
    }
    if (msg.type === "config/area_registry/update") {
      hass.wsCalls.push(msg);
      return {};
    }
    return base(msg);
  };
  return hass;
}

test("Switch Lebensmittel | Haushalt: filters storage, areas and categories and is remembered", async () => {
  const hass = householdHass();
  const el = mount(hass);
  el._classic.larderLabel = ["l", "l_hh", "l_food"];
  await flush();
  await flush();
  await go(el, "containers");
  assert.equal($(el, "h1").textContent, "Vorrat");
  assert.deepEqual($$(el, ".scope button").map((b) => [b.textContent, b.classList.contains("on")]), [["🍎 Lebensmittel", true], ["🧻 Haushalt", false], ["💊 Apotheke", false]]);
  assert.ok(!names(el).includes("Klopapier"));
  $(el, '.scope [data-scope="household"]').click();
  await flush();
  assert.deepEqual(names(el), ["Klopapier"]);
  assert.equal($(el, 'main .tile[data-id="h1"] .ico').textContent, "🧻");
  assert.equal($(el, 'main .tile[data-id="h1"] .kindmark'), null);
  await go(el, "areas");
  assert.deepEqual($$(el, "main .tile .name").map((n) => n.textContent).sort(), ["Bad", "Keller", "Küche"]);
  await go(el, "categories");
  assert.deepEqual($$(el, "main .tile .name").map((n) => n.textContent), ["Papier & Hygiene"]);
  assert.equal($(el, "main .tile .sub").textContent, "1 Artikel");
  // remembered on this device
  const again = mount(hass);
  await flush();
  await go(again, "areas");
  assert.equal($(again, '.scope [data-scope="household"]').classList.contains("on"), true);
  $(again, '.scope [data-scope="food"]').click();
  await flush();
  assert.ok(!$$(again, "main .tile .name").map((n) => n.textContent).includes("Bad"));
});

test("Haushaltsartikel anlegen: own dialog, only household areas, pieces and packs", async () => {
  const hass = householdHass();
  const el = mount(hass);
  el._classic.larderLabel = ["l", "l_hh", "l_food"];
  await flush();
  await flush();
  await go(el, "containers");
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-household"]').click();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Haushaltsartikel anlegen");
  assert.equal(form.querySelector(".datelabel").firstChild.textContent, "Ablaufdatum (optional)"); // 4.4
  assert.equal(form.querySelector('[data-i="unit"]'), null);
  assert.equal(form.querySelector('[data-role="item-receipt"]'), null);
  const areas = [...form.querySelector('[data-f="area"]').options].map((o) => o.textContent);
  assert.ok(areas.includes("Bad") && !areas.includes("Kühlschrank"));
  form.querySelector('[data-i="content"]').value = "Küchenrolle";
  form.querySelector('[data-i="quantity"]').value = "2";
  form.querySelector('[data-i="packSize"]').value = "4";
  form.querySelector('[data-i="piece"]').value = "Rollen";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const created = hass.wsCalls.find((m) => m.type === `${D}/create_items`);
  assert.equal(created.kind, "household");
  assert.deepEqual(created.items, [{ content: "Küchenrolle", quantity: 8, unit: "pieces", product: { pack_size: 4, piece: "Rollen" } }]);
  // afterwards the storage shows the household side
  assert.equal($(el, '.scope [data-scope="household"]').classList.contains("on"), true);
  // the pack dialog offers the food areas
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-pack"]').click();
  const foodAreas = [...$(el, "form.dialog").querySelector('[data-f="area"]').options].map((o) => o.textContent);
  assert.ok(foodAreas.includes("Kühlschrank") && !foodAreas.includes("Bad"));
});

test("Start: sections Lebensmittel and Haushalt; bought household item opens the household dialog", async () => {
  const hass = householdHass();
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/bought`) {
      return { items: [
        { id: "b1", summary: "Senf", content: "Senf", count: 1 },
        { id: "b2", summary: "Klopapier (2 Packungen)", content: "Klopapier", count: 2, kind: "household", product: { pack_size: 8, piece: "Rollen" } },
      ] };
    }
    if (msg.type === `${D}/running_low`) {
      return { shopping_list: true, items: [{ key: "spuelmittel", name: "Spülmittel", count: 1, min: 1, lasts_days: 3, kind: "household" }] };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await flush();
  const heads = $$(el, "main h2.section").map((h) => h.textContent);
  assert.deepEqual(heads, ["🍎 Lebensmittel", "🧻 Haushalt"]);
  const household = $(el, '[data-role="household-section"]');
  const before = [...$(el, "main").children];
  const idx = before.indexOf(household);
  const boxes = $$(el, "main .stat.bought, main .stat.low");
  // food: bought mustard above the household heading; household: low dish soap and bought toilet paper below
  assert.ok(before.indexOf($$(el, "main .stat.bought")[0]) < idx);
  assert.ok(before.indexOf($(el, "main .stat.low")) > idx);
  assert.equal(boxes.length, 3);
  assert.equal($$(el, "main .stat.bought")[1].querySelector(".name").textContent, "Klopapier (2 Packungen)");
  $$(el, "main .stat.bought")[1].querySelector('[data-role="bought-add"]').click();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Haushaltsartikel anlegen");
  assert.deepEqual(
    ["quantity", "packSize", "piece"].map((n) => form.querySelector(`[data-i="${n}"]`).value),
    ["2", "8", "Rollen"],
  );
  // without household items the start page has no sections
  const plain = mount(makeHass(DOSES));
  await flush();
  assert.equal($$(plain, "main h2.section").length, 0);
});

test("stock: household products show pieces and packs, minimum in pieces", async () => {
  const hass = householdHass();
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/stock`) {
      return { shopping_list: true, products: [
        { key: "senf", name: "Senf", count: 2, min: 0, low: false, places: [], kind: "pack", value: 3 },
        { key: "klopapier", name: "Klopapier", count: 12, min: 8, low: false, places: [], kind: "household", pack_size: 8, piece: "Rollen", packs: 1.5, value: 6 },
      ] };
    }
    return base(msg);
  };
  const el = mount(hass);
  $(el, "#settings").click();
  $(el, '[data-role="menu-stock"]').click();
  await flush();
  await flush();
  assert.deepEqual($$(el, ".stockitem .name").map((n) => n.textContent), ["Senf"]);
  $(el, '.scope [data-scope="household"]').click();
  await flush();
  assert.deepEqual($$(el, ".stockitem .name").map((n) => n.textContent), ["Klopapier"]);
  assert.equal($(el, ".stockitem .count").textContent, "12 Rollen");
  assert.equal($(el, ".stockitem .sub").textContent, "1,5 Packungen");
  assert.equal($(el, ".stockitem .stockmin").textContent, "Mindestens");
  assert.match($(el, '[data-role="stock-value"]').textContent, /6,00/);
  await go(el, "containers");
  assert.equal($(el, "main .count").textContent, "1 Artikel");
  assert.equal($(el, '[data-role="state"]').options.length, 3); // all, soon, expired (4.4: household items may have a date)
});

test("Bereiche bearbeiten: use (scope) per area and automatic assignment", async () => {
  const hass = householdHass();
  hass.plan = { bath: "household" };
  hass.scopes = { ...hass.scopes, bath: "both" };
  const el = mount(hass);
  el._classic.larderLabel = ["l", "l_hh", "l_food"];
  await flush();
  await go(el, "areas");
  $(el, '[data-role="area-edit"]').click();
  await flush();
  await flush();
  const auto = $(el, '[data-role="scope-auto"]');
  assert.equal(auto.textContent, "Nutzung automatisch zuordnen (1 Bereich)");
  assert.match($(el, 'main [data-area="fridge"] .sub').textContent, /nur Lebensmittel/);
  $(el, 'main [data-area="kitchen"]').click();
  await flush();
  const form = $(el, "form.dialog");
  // scope labels are not offered as a storage kind
  assert.deepEqual([...form.querySelector('[data-f="kind"]').options].map((o) => o.textContent).slice(0, 2), ["kein Larder-Label", "Larder"]);
  const scope = form.querySelector('[data-f="scope"]');
  assert.equal(scope.value, "both");
  scope.value = "food";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  await flush();
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === `${D}/area_scope_set`).map((m) => [m.area_id, m.scope]), [["kitchen", "food"]]);
  $(el, '[data-role="scope-auto"]').click();
  await flush();
  await flush();
  await flush();
  assert.equal(hass.wsCalls.filter((m) => m.type === `${D}/area_scopes_auto`).length, 1);
  assert.equal($(el, '[data-role="scope-auto"]'), null);
});

test("Fixed height: the dashboard fills exactly the space below its top edge (iOS safe area, 4.0.1)", async () => {
  const el = mount(makeHass(DOSES));
  el.getBoundingClientRect = () => ({ top: 47, left: 0, right: 390, bottom: 0, width: 390, height: 0 });
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(el.style.height, `${window.innerHeight - 47}px`);
  assert.equal(el.style.minHeight, "0px");
  // a scrolled Home Assistant container (negative top) keeps the last good value
  el.getBoundingClientRect = () => ({ top: -200, left: 0, right: 390, bottom: 0, width: 390, height: 0 });
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(el.style.height, `${window.innerHeight - 47}px`);
  el.remove();
});

test("Add dialog: shopping list for the new products (4.1), only with several to-do lists", async () => {
  const hass = householdHass();
  hass.states["todo.einkaufen"] = { entity_id: "todo.einkaufen", state: "0", attributes: { friendly_name: "Einkaufsliste" } };
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-pack"]').click();
  assert.equal($(el, 'form.dialog [data-f="shopping_list"]'), null); // one list: nothing to choose
  hass.states["todo.drogerie"] = { entity_id: "todo.drogerie", state: "0", attributes: { friendly_name: "Drogerie" } };
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-household"]').click();
  const form = $(el, "form.dialog");
  const select = form.querySelector('[data-f="shopping_list"]');
  assert.deepEqual([...select.options].map((o) => o.textContent), ["Standardliste", "Drogerie", "Einkaufsliste"]);
  select.value = "todo.drogerie";
  form.querySelector('[data-i="content"]').value = "Zahnpasta";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  assert.equal(hass.wsCalls.find((m) => m.type === `${D}/create_items`).shopping_list, "todo.drogerie");
});

test("Statistics: household side with spending per month and per product (4.1)", async () => {
  const hass = householdHass();
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/statistics`) return { months: [], containers: { filled: 0, empty: 0, soon: 0, expired: 0 }, eaten: 0, thrown: 0, emptied: 0, top_thrown: [], top_eaten: [], thrown_by_area: [] };
    if (msg.type === `${D}/household_statistics`) {
      hass.wsCalls.push(msg);
      return {
        months: [{ month: "2026-10", pieces: 6, cost: 3, priced: true }, { month: "2026-11", pieces: 12, cost: 5, priced: false }],
        products: [
          { key: "klopapier", name: "Klopapier", piece: "Rollen", pieces: 16, pieces_per_month: 8, cost: 8, cost_per_month: 4, complete: true },
          { key: "batterien", name: "Batterien AA", piece: null, pieces: 2, pieces_per_month: 2, cost: null, cost_per_month: null, complete: false },
        ],
        cost_per_month: 4,
        complete: false,
      };
    }
    return base(msg);
  };
  const el = mount(hass);
  el.setView("stats");
  await flush();
  assert.equal($(el, '[data-role="hh-total"]'), null);
  $(el, '.scope [data-scope="household"]').click();
  await flush();
  await flush();
  assert.equal(hass.wsCalls.filter((m) => m.type === `${D}/household_statistics`).length, 1);
  assert.equal($(el, '[data-role="hh-total"] .num').textContent, "4,00 €");
  assert.deepEqual(
    $$(el, '[data-role="hh-products"] li').map((li) => li.textContent),
    ["Klopapier8 Rollen · 4,00 €", "Batterien AA2 Stück"],
  );
  assert.equal($$(el, "main .month").length, 2);
  assert.match($(el, "main p.note:last-of-type").textContent, /Nicht für alle Produkte/);
});

test("Put away (4.3): scan one product after another, unknown ones are added at the end", async () => {
  const hass = makeHass(DOSES);
  const answers = {
    "4000000000001": { status: "added", content: "Ketchup", kind: "pack", device_id: "p1", area: "Keller", compartment: "Regal", count: 1, added: 1, new_entry: true },
    "4000000000002": { status: "added", content: "Klopapier", kind: "household", device_id: "h1", area: "Bad", compartment: "", count: 13, added: 8, new_entry: false },
    "5000000000002": { status: "unknown", code: "5000000000002", name: "Senf", product: { brand: "Develey" }, product_type: "food" },
    "6000000000003": { status: "unknown", code: "6000000000003", name: "Zahnpasta", product: null, product_type: "beauty" },
  };
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/put_away`) {
      hass.wsCalls.push(msg);
      return answers[msg.code];
    }
    return base(msg);
  };
  // the app's barcode scanner stays open: every result is put away and confirmed in the scanner
  const sent = [];
  let handler = null;
  hass.auth = { external: { config: { hasBarCodeScanner: true }, _commandHandler: () => true, addCommandHandler(h) { handler = h; }, fireMessage: (m) => sent.push(m) } };
  const el = mount(hass);
  await flush();
  $(el, '[data-role="putaway"]').click(); // start page
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Einräumen");
  assert.equal(sent.at(-1).type, "bar_code/scan");
  for (const code of ["4000000000001", "4000000000001", "4000000000002", "5000000000002", "6000000000003", "5000000000002"]) {
    handler({ command: "bar_code/scan_result", payload: { rawValue: code } });
    await flush();
    await flush();
  }
  assert.equal(hass.wsCalls.filter((m) => m.type === `${D}/put_away`).length, 6);
  assert.deepEqual(sent.filter((m) => m.type === "bar_code/notify").map((m) => m.payload.message).slice(0, 2), ["Ketchup → Keller · Regal", "Ketchup → Keller · Regal"]);
  assert.deepEqual([...form.querySelectorAll(".putrow:not(.unknown) .name")].map((n) => n.textContent), ["Klopapier +1", "Ketchup +2"]);
  assert.ok(form.querySelector('.putrow[data-id="p1"] [data-role="putaway-date"]')); // new food entry without a date
  assert.equal(form.querySelector('.putrow[data-id="h1"] [data-role="putaway-date"]'), null);
  assert.deepEqual([...form.querySelectorAll(".putrow.unknown")].map((n) => n.textContent), ["Senf", "Zahnpasta"]);
  // typing a code works too (browser without a camera)
  form.querySelector('[data-f="putaway-code"]').value = "4000000000002";
  form.querySelector('[data-role="putaway-add"]').click();
  await flush();
  await flush();
  assert.match(form.querySelector('.putrow[data-id="h1"] .name').textContent, /\+2/);
  // the unknown food product: one dialog for packs, prefilled with name, brand and barcode
  handler({ command: "bar_code/aborted" });
  form.querySelector('[data-role="putaway-new"]').click();
  assert.match(form.querySelector("h2").textContent, /Packungen anlegen/);
  assert.equal(form.querySelector('[data-i="content"]').value, "Senf");
});

test("Pharmacy (4.4): third tab, own section on the start page with the longer warning, add medicines", async () => {
  const hass = householdHass();
  // medicine expiring in 40 days: "soon" with the 60 days of the setting; one in 200 days is not
  for (const [id, name, content, days] of [["m1", "Medikament 1", "Ibuprofen 400", 40], ["m2", "Medikament 2", "Nasenspray", 200]]) {
    const extra = makeHass([{ id, name, area: "bath", content, days, category: "md_pain" }]);
    Object.assign(hass.entities, extra.entities);
    Object.assign(hass.devices, extra.devices);
    Object.assign(hass.states, extra.states);
    hass.states[`text.${id}_inhalt`].attributes.kind = "medicine";
    hass.states[`date.${id}_mhd`].attributes.soon_days = 60;
  }
  hass.areas.cabinet = { area_id: "cabinet", name: "Arzneischrank", labels: ["l"] };
  hass.scopes = { ...hass.scopes, cabinet: "pharmacy" };
  const el = mount(hass);
  el._classic.larderLabel = ["l", "l_hh", "l_food"];
  await flush();
  await flush();
  const heads = $$(el, "main h2.section").map((h) => h.textContent);
  assert.deepEqual(heads, ["🍎 Lebensmittel", "🧻 Haushalt", "💊 Apotheke"]);
  assert.deepEqual([...$(el, '[data-role="pharmacy-soon"]').querySelectorAll(".name")].map((n) => n.textContent), ["Ibuprofen 400"]);
  // the food list does not show medicines
  assert.ok(!$$(el, "main .tiles:not([data-role]) .name").map((n) => n.textContent).includes("Ibuprofen 400"));
  await go(el, "containers");
  $(el, '.scope [data-scope="pharmacy"]').click();
  await flush();
  assert.deepEqual(names(el).sort(), ["Ibuprofen 400", "Nasenspray"]);
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-medicine"]').click();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "Medikamente anlegen");
  assert.equal(form.querySelector(".datelabel").firstChild.textContent, "Verfallsdatum");
  const areas = [...form.querySelector('[data-f="area"]').options].map((o) => o.textContent);
  assert.ok(areas.includes("Arzneischrank") && !areas.includes("Bad") && !areas.includes("Kühlschrank"));
  form.querySelector('[data-i="content"]').value = "Paracetamol";
  form.querySelector('[data-i="date"]').value = "2028-03-01";
  form.querySelector("button.submit").click();
  await flush();
  await flush();
  const created = hass.wsCalls.find((m) => m.type === `${D}/create_items`);
  assert.equal(created.kind, "medicine");
  assert.deepEqual(created.items, [{ content: "Paracetamol", quantity: 1, unit: "pieces", best_before: "2028-03-01" }]);
});

test("Start (household): 'Replace soon' box with 'Replaced' (4.6)", async () => {
  const hass = householdHass();
  const base = hass.callWS;
  let due = [{ key: "wasserfilter", name: "Wasserfilter", weeks: 4, last: "2026-10-20", due: "2026-11-17", days: 0 }];
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/replace_due`) return { items: due };
    if (msg.type === `${D}/replaced`) {
      hass.wsCalls.push(msg);
      due = [];
      return { taken: true, interval: null, due };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  await flush();
  const box = $(el, '[data-role="replace-due"]');
  assert.ok(box);
  assert.equal(box.querySelector("h3").textContent, "🔁 Bald wechseln");
  assert.equal(box.querySelector(".sub").textContent, "heute fällig");
  const household = $(el, '[data-role="household-section"]');
  const children = [...$(el, "main").children];
  assert.ok(children.indexOf(box) > children.indexOf(household));
  box.querySelector('[data-role="replace-done"]').click();
  await flush();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/replaced`), { type: `${D}/replaced`, content: "Wasserfilter" });
  assert.equal($(el, '[data-role="replace-due"]'), null);
});

test("Start without anything in Larder: 'Get started' with three steps (4.7)", async () => {
  const hass = makeHass([]);
  const base = hass.callWS;
  hass.callWS = async (msg) => (msg.type === `${D}/settings` ? { recipe_days: 3, shopping_list: true } : base(msg));
  const el = mount(hass);
  await flush();
  await flush();
  const box = $(el, '[data-role="get-started"]');
  assert.ok(box);
  assert.equal(box.querySelector("h3").textContent, "🚀 Los geht's");
  const steps = [...box.querySelectorAll("[data-step]")];
  assert.equal(steps.length, 3);
  // the shopping list is chosen already: ticked
  assert.equal(steps[1].classList.contains("done"), true);
  assert.match(steps[1].textContent, /^✅ Einkaufsliste wählen/);
  assert.equal(steps[0].classList.contains("done"), false);
  // no empty boxes below
  assert.equal($$(el, "main .stat").length, 1);
  box.querySelector('[data-role="start-3"]').click();
  assert.ok($(el, '[data-role="add-pack"]'));
  // step 1 opens the areas in edit mode
  $(el, '[data-role="start-1"]').click();
  await flush();
  assert.equal($(el, "h1").textContent, "Bereiche");
  // with something in Larder the box is gone
  const full = mount(makeHass(DOSES));
  await flush();
  assert.equal($(full, '[data-role="get-started"]'), null);
});

test("⋮ → 🛟 Emergency supply: groups, checklist and 🛒; 🏪 store sections for administrators (4.7)", async () => {
  const hass = makeHass(DOSES);
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type === `${D}/supply`) {
      return {
        enabled: true, persons: 2, days: 10, days_covered: 4,
        groups: [
          { key: "drinks", unit: "l", need: 40, have: 18, unknown: 0, share: 0.45 },
          { key: "grain", unit: "kg", need: 7, have: 7.5, unknown: 1, share: 1 },
        ],
        items: [{ key: "light", present: true, names: ["Kerzen"] }, { key: "radio", present: false, names: [] }],
      };
    }
    if (msg.type === `${D}/supply_shop`) {
      hass.wsCalls.push(msg);
      return { added: true, item: "Mineralwasser", list: "todo.einkaufen" };
    }
    if (msg.type === `${D}/sections`) return { order: ["produce", "bakery", "meat", "fridge", "dry", "breakfast", "drinks", "frozen", "drugstore", "pharmacy", "other"] };
    if (msg.type === `${D}/section_order`) {
      hass.wsCalls.push(msg);
      return { order: msg.order };
    }
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  const item = $(el, '[data-role="menu-supply"]');
  assert.equal(item.textContent, "🛟 Notvorrat");
  item.click();
  await flush();
  await flush();
  assert.equal($(el, "h1").textContent, "Notvorrat");
  assert.equal($(el, '[data-role="supply-covered"]').textContent, "Der Vorrat reicht für etwa 4 von 10 Tagen.");
  const rows = $$(el, '[data-role="supply-food"] [data-key]');
  assert.match(rows[0].textContent, /⬜ Getränke18 von 40 l/);
  assert.match(rows[1].textContent, /✅ Getreide.*7,5 von 7 kg \+ 1 ohne Mengenangabe/);
  assert.equal(rows[1].querySelector('[data-role="supply-shop"]'), null);
  rows[0].querySelector('[data-role="supply-shop"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/supply_shop`), { type: `${D}/supply_shop`, key: "drinks" });
  const items = $$(el, '[data-role="supply-items"] [data-key]');
  assert.match(items[0].textContent, /✅ Kerzen oder TaschenlampeKerzen/);
  assert.ok(items[1].querySelector('[data-role="supply-shop"]'));
  // store sections: move drinks up once, save
  $(el, '[data-role="menu-sections"]').click();
  await flush();
  const drinks = () => $(el, 'form.dialog [data-key="drinks"]');
  drinks().querySelector('[data-role="section-up"]').click();
  $(el, '[data-role="sections-save"]').click();
  await flush();
  const saved = hass.wsCalls.find((m) => m.type === `${D}/section_order`);
  assert.deepEqual(saved.order.slice(4, 7), ["dry", "drinks", "breakfast"]);
  // not for others
  const other = mount(makeHass(DOSES, { admin: false }));
  await flush();
  assert.equal($(other, '[data-role="menu-sections"]').hidden, true);
});

test("Vouchers (4.8): own scope only when there is one, start section, detail with partial redeem, add with code", async () => {
  const hass = makeHass([...DOSES, { id: "v1", name: "Gutschein 1", area: "kitchen", content: "Thalia", days: 20, category: "voucher" }]);
  hass.states["text.v1_inhalt"].attributes = { category: "voucher", kind: "voucher", value: 25, value_initial: 30 };
  hass.states["date.v1_mhd"].attributes = { estimates: false, soon_days: 60 };
  const base = hass.callWS;
  hass.callWS = async (msg) => {
    if (msg.type.startsWith(`${D}/voucher`) || msg.type === `${D}/create_items`) hass.wsCalls.push(msg);
    if (msg.type === `${D}/voucher_stats`) return { count: 1, open_value: 25, lost_value: 12.5, redeemed_value: 0 };
    if (msg.type === `${D}/voucher_code`) return { code: "ABC-123" };
    if (msg.type === `${D}/voucher_redeem`) return { removed: false, value: 15 };
    if (msg.type === `${D}/create_items`) return { items: [{ device_id: "v2", cc: "X", name: "Gutschein 2" }] };
    if (msg.type === `${D}/voucher_update`) return { value: 50 };
    return base(msg);
  };
  const el = mount(hass);
  await flush();
  // start page: section of its own
  const heads = $$(el, "main h2.section").map((h) => h.textContent);
  assert.ok(heads.includes("🎟️ Gutscheine"));
  // larder page: switch with vouchers, tile with value
  await go(el, "containers");
  $(el, '.scope [data-scope="voucher"]').click();
  await flush();
  await flush();
  assert.match($(el, '[data-role="voucher-stats"]').textContent, /1 Gutschein · 25 € offen/);
  assert.match($(el, '[data-role="voucher-stats"]').textContent, /Verfallen \(12 Monate\): 12,50 €$/);
  const tile = $(el, 'main .tile[data-id="v1"]');
  assert.match(tile.textContent, /Thalia.*25 €/);
  tile.click();
  const form = $(el, "form.dialog");
  assert.equal(form.querySelector("h2").textContent, "🎟️ Thalia");
  assert.match(form.textContent, /25 € von 30 € übrig/);
  form.querySelector('[data-role="voucher-show-code"]').click();
  await flush();
  assert.equal(form.querySelector('[data-role="voucher-code"]').textContent, "ABC-123");
  form.querySelector('[data-role="voucher-redeem-part"]').click();
  form.querySelector('[data-f="voucher-amount"]').value = "10";
  form.querySelector('[data-role="voucher-redeem-part-ok"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/voucher_redeem`), { type: `${D}/voucher_redeem`, device_id: "v1", amount: 10 });
  // add: name, value, date, code
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-voucher"]').click();
  await flush();
  const add = $(el, "form.dialog");
  add.querySelector('[data-f="voucher-name"]').value = "IKEA";
  add.querySelector('[data-f="voucher-value"]').value = "50";
  add.querySelector('[data-f="voucher-until"]').value = "2027-06-30";
  add.querySelector('[data-f="voucher-code"]').value = "9999";
  add.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await flush();
  await flush();
  const created = hass.wsCalls.find((m) => m.type === `${D}/create_items`);
  assert.equal(created.kind, "voucher");
  assert.deepEqual(created.items, [{ content: "IKEA", quantity: 1, unit: "pieces", best_before: "2027-06-30", product: { value: 50, value_initial: 50 } }]);
  assert.deepEqual(hass.wsCalls.filter((m) => m.type === `${D}/voucher_update`).pop(), { type: `${D}/voucher_update`, device_id: "v2", code: "9999" });
  // without vouchers no switch button (and the remembered choice goes back to food)
  $(el, '.scope [data-scope="food"]').click();
  const plain = mount(makeHass(DOSES));
  await flush();
  await go(plain, "containers");
  assert.equal($(plain, '.scope [data-scope="voucher"]'), null);
});

test("Voucher from a photo (4.9): the AI fills shop, value, date and code; vouchers never as classic cards", async () => {
  const hass = makeHass([...DOSES, { id: "v1", name: "Gutschein 1", area: "kitchen", content: "Thalia", days: 20, category: "voucher" }]);
  hass.states["text.v1_inhalt"].attributes = { category: "voucher", kind: "voucher", value: 25 };
  const uploads = [];
  hass.fetchWithAuth = async (url, init) => {
    uploads.push(url);
    return { ok: true, json: async () => ({ shop: "IKEA", value: 50.5, valid_until: "2027-06-30", code: "4711" }) };
  };
  const el = mount(hass);
  await flush();
  await go(el, "containers");
  $(el, '[data-role="add"]').click();
  $(el, '[data-role="add-voucher"]').click();
  await flush();
  const form = $(el, "form.dialog");
  const file = form.querySelector('[data-role="voucher-photo-file"]');
  Object.defineProperty(file, "files", { value: [new File(["x"], "g.jpg", { type: "image/jpeg" })], configurable: true });
  Object.defineProperty(file, "value", { value: "", writable: true, configurable: true });
  file.dispatchEvent(new Event("change"));
  await flush();
  await flush();
  assert.deepEqual(uploads, ["/api/larder/voucher_photo"]);
  assert.equal(form.querySelector('[data-f="voucher-name"]').value, "IKEA");
  assert.equal(form.querySelector('[data-f="voucher-value"]').value, "50,5");
  assert.equal(form.querySelector('[data-f="voucher-until"]').value, "2027-06-30");
  assert.equal(form.querySelector('[data-f="voucher-code"]').value, "4711");
  assert.equal(form.querySelector('[data-role="voucher-photo-status"]').textContent, "Übernommen – bitte prüfen.");
  $(el, "form.dialog button.cancel").click();
  // cards view: vouchers stay rows of their own
  $(el, '.scope [data-scope="voucher"]').click();
  el._opts.mode = "cards";
  el._sig = "";
  el._update();
  assert.ok($(el, 'main [data-id="v1"]'));
  assert.equal(el._classicShow === "cards" && el._classicIds !== null, false);
  $(el, '.scope [data-scope="food"]').click();
});

test("Shopping mode (4.10): by store section, tick off into stock, unknown at the end; recurring purchases", async () => {
  const hass = makeHass(DOSES);
  let recurring = [];
  hass.callWS = (base => async (msg) => {
    if (msg.type.startsWith(`${D}/shopping`) || msg.type.startsWith(`${D}/recurring`)) hass.wsCalls.push(msg);
    if (msg.type === `${D}/shopping_mode`) return { order: ["produce", "dry"], items: [
      { list: "todo.einkaufen", list_name: "Einkaufen", uid: "u1", summary: "Bananen", section: "produce", known: false },
      { list: "todo.einkaufen", list_name: "Einkaufen", uid: "u2", summary: "Senf (Develey)", section: "dry", known: true },
    ] };
    if (msg.type === `${D}/shopping_check`) return msg.uid === "u2" ? { status: "added", area: "Vorrat", compartment: "Schrank", added: 2 } : { status: "unknown", name: "Bananen" };
    if (msg.type === `${D}/recurring`) return { items: recurring };
    if (msg.type === `${D}/recurring_set`) {
      recurring = [{ key: "wasserkiste", name: msg.name, weekdays: msg.weekdays }];
      return { items: recurring };
    }
    return base(msg);
  })(hass.callWS);
  const el = mount(hass);
  await flush();
  $(el, '[data-role="start-shopping"]').click();
  await flush();
  await flush();
  assert.equal($(el, "h1").textContent, "Einkaufen");
  const sections = $$(el, "main section.shop").map((s) => s.querySelector("h3").textContent);
  assert.deepEqual(sections, ["🥦 Obst & Gemüse", "🍝 Nudeln, Reis & Konserven"]);
  $(el, '[data-uid="u2"] [data-role="shop-check"]').click();
  await flush();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/shopping_check`), { type: `${D}/shopping_check`, list: "todo.einkaufen", uid: "u2", summary: "Senf (Develey)" });
  assert.match($(el, '[data-uid="u2"]').textContent, /→ Vorrat · Schrank \(\+2\)/);
  assert.equal($(el, '[data-uid="u2"]').classList.contains("done"), true);
  $(el, '[data-uid="u1"] [data-role="shop-check"]').click();
  await flush();
  await flush();
  const add = $(el, '[data-role="shop-add-unknown"]');
  assert.equal(add.textContent, "＋ 1 neuen Artikel anlegen");
  add.click();
  assert.equal($(el, "form.dialog").querySelector('[data-i="content"]').value, "Bananen");
  $(el, "form.dialog button.cancel").click();
  // recurring: Friday
  $(el, '[data-role="shop-recurring"]').click();
  await flush();
  const form = $(el, "form.dialog");
  form.querySelector('[data-f="recurring-name"]').value = "Wasserkiste";
  form.querySelector('[data-day="4"]').click();
  form.querySelector('[data-role="recurring-add"]').click();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/recurring_set`), { type: `${D}/recurring_set`, name: "Wasserkiste", weekdays: [4] });
  assert.match(form.querySelector('[data-key="wasserkiste"]').textContent, /WasserkisteFr/);
});

test("How long something has been expired (4.10.2): days, months, years", async () => {
  const { TEXTS } = await import("../../custom_components/larder/frontend/larder-dashboard-strings.js");
  assert.deepEqual([3, 59, 90, 800].map((n) => TEXTS.de.expiredSince(n)), ["3 T", "59 T", "3 Mon.", "2 J."]);
  assert.deepEqual([3, 90, 800].map((n) => TEXTS.en.expiredSince(n)), ["3 d", "3 mo", "2 y"]);
  assert.deepEqual([12, 59, 60, 400, 1556].map((n) => TEXTS.de.daysShort(n)), ["12 T", "59 T", "2 Mon.", "13 Mon.", "4 J."]);
  const panelStrings = await import("../../custom_components/larder/frontend/larder-panel-strings.js");
  const de = panelStrings.STRINGS.de;
  assert.deepEqual([1, 5, 90].map((n) => de.expiredSince(n)), ["seit gestern abgelaufen", "seit 5 Tagen abgelaufen", "seit 3 Monaten abgelaufen"]);
});

test("Shopping mode (4.11): scan ticks off, price and date, scanned extras, receipt button", async () => {
  const hass = makeHass(DOSES);
  hass.fetchWithAuth = async () => ({ ok: true, json: async () => ({ items: [] }) });
  hass.callWS = (base => async (msg) => {
    if (msg.type.startsWith(`${D}/shopping`)) hass.wsCalls.push(msg);
    if (msg.type === `${D}/shopping_mode`) return { order: ["dry"], items: [{ list: "todo.einkaufen", list_name: "Einkaufen", uid: "u2", summary: "Senf (Develey)", section: "dry", known: true }] };
    if (msg.type === `${D}/shopping_scan`) {
      if (msg.code === "1") return { status: "added", matched: true, uid: "u2", summary: "Senf (Develey)", content: "Senf", area: "Vorrat", compartment: "Schrank", device_id: "p1", added: 1 };
      if (msg.code === "2") return { status: "added", matched: false, content: "Ketchup", area: "Küche", compartment: "", device_id: "p2", added: 1 };
      return { status: "unknown", name: "Hafermilch", code: "7394376616501", product: { brand: "Oatly" } };
    }
    if (msg.type === `${D}/shopping_details`) return { device_id: "p9" };
    return base(msg);
  })(hass.callWS);
  const el = mount(hass);
  await flush();
  // receipt on the start page
  assert.equal($(el, '[data-role="start-receipt"]').textContent, "🧾 Kassenbon");
  await go(el, "start");
  el.setView("shopping");
  await flush();
  await flush();
  assert.ok($(el, '[data-role="shop-receipt"]'));
  assert.equal(await el._shopScan("1"), "Senf → Vorrat · Schrank");
  assert.equal($(el, '[data-uid="u2"]').classList.contains("done"), true);
  assert.equal(await el._shopScan("2"), "Ketchup → Küche");
  assert.match($(el, '[data-role="shop-extra"]').textContent, /Ketchup/);
  assert.equal(await el._shopScan("7394376616501"), "Hafermilch: neu, wird am Ende angelegt");
  // price and date for the mustard
  $(el, '[data-uid="u2"] [data-role="shop-details"]').click();
  $(el, '[data-f="shop-price"]').value = "1,99";
  $(el, '[data-f="shop-date"]').value = "2027-06-30";
  $(el, '[data-role="shop-details-save"]').click();
  await flush();
  await flush();
  assert.deepEqual(hass.wsCalls.find((m) => m.type === `${D}/shopping_details`), { type: `${D}/shopping_details`, device_id: "p1", added: 1, price: 1.99, best_before: "2027-06-30" });
  assert.match($(el, '[data-uid="u2"]').textContent, /1,99 € · MHD 30\.06\.2027/);
  // unknown: the pack dialog with name and barcode
  $(el, '[data-role="shop-add-unknown"]').click();
  const row = $(el, "form.dialog").querySelector('[data-i="content"]');
  assert.equal(row.value, "Hafermilch");
});
