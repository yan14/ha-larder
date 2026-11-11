// Tests für "Larder experimental" (läuft in jsdom, ohne Home Assistant).
process.env.TZ = "Europe/Berlin";

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "customElements", "Event", "CustomEvent"]) {
  globalThis[key] = dom.window[key];
}
dom.window.confirm = () => true;

const mod = await import("../../custom_components/larder/frontend/larder-experimental.js");
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
    if (msg.type === "call_service") return { response: { recipes: hass.suggestions } };
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
  const el = document.createElement("larder-experimental");
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
  assert.equal($(el, "h1").textContent, "Larder experimental");
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
  assert.equal($(el, ".chip span").textContent, "Läuft bald ab");
  $(el, ".chip button").click();
  await flush();
  assert.equal(names(el).length, 5);
  assert.equal($(el, ".chip"), null);
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
  assert.deepEqual(call, { type: "call_service", domain: D, service: "suggest_recipes", service_data: { days: 3 }, return_response: true });
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
