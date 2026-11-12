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

test("Nicht-Administrator: leere Dose öffnet die Detailansicht, kein Hinzufügen-Button", async () => {
  const el = mount(makeHass(DOSES, { admin: false }));
  await go(el, "containers");
  assert.equal($(el, '[data-role="add"]'), null);
  assert.equal($(el, "#settings").hidden, true);
  $$(el, "main .tile").find((t) => t.dataset.id === "d5").click();
  assert.equal(el._classic.getAttribute("only"), "d5");
});

test("Hinzufügen öffnet den Dialog des normalen Dashboards", async () => {
  const el = mount(makeHass(DOSES));
  let opened = 0;
  el._classic.openAddDialog = () => opened++;
  await go(el, "containers");
  $(el, '[data-role="add"]').click();
  assert.equal(opened, 1);
  assert.equal($(el, "#settings").hidden, false);
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

test("⚙-Menü: gemerkte Schätzungen (nur Administratoren) und Einstellungen", async () => {
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
  assert.equal($(user, "#settings").hidden, true);
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
