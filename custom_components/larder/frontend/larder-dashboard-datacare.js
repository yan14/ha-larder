/**
 * Larder dashboard (4.12): data care – gaps in the data (no price, no date, no place, no minimum stock).
 *
 * Once a month a short box on the start page (dismissable per device), any time via ⋮ → 🧹 Data care.
 * `installDataCare` attaches the methods to the dashboard class (like larder-dashboard-items.js).
 */


/** 6.0: texts in the user's language; French and Dutch fall back to English for anything missing. */
const LANG_CACHE = new WeakMap();
function pickLang(table, hass) {
  const lang = String((hass && hass.language) || "en").toLowerCase().slice(0, 2);
  if (lang === "en" || !table[lang]) return table.en;
  if (lang === "de") return table.de;
  let byLang = LANG_CACHE.get(table);
  if (!byLang) LANG_CACHE.set(table, (byLang = {}));
  return byLang[lang] || (byLang[lang] = { ...table.en, ...table[lang] });
}

const GROUPS = ["opened_no_date", "no_date", "no_price", "no_place", "no_min", "no_table", "history"];

const TEXT = {
  de: {
    introProducts: "Pro Produkt steht, was noch fehlt. Antippen und alles in einem Schritt nachtragen – Leeres bleibt einfach offen.",
    missing: { opened_no_date: "Datum seit dem Öffnen", no_date: "MHD", no_price: "Preis", no_place: "Bereich/Fach", no_min: "Mindestbestand", no_table: "Art für die Haltbarkeit" },
    missingLine: (list) => `fehlt: ${list}`,
    fillIntro: "Nur ausfüllen, was du weißt – Leeres bleibt offen.",
    fieldPrice: "Preis pro Packung (€)",
    fieldDate: "MHD",
    fieldOpened: "Geöffnet – haltbar bis",
    fieldArea: "Bereich",
    fieldCompartment: "Fach",
    fieldMin: "Mindestbestand (Packungen)",
    noArea: "Kein Bereich",
    save: "Speichern",
    saved: (name) => `${name}: gespeichert.`,
    nothing: "Nichts eingetragen.",
    openCard: "Karte öffnen",
    back: "Zurück",
    menu: "🧹 Datenpflege",
    title: "Datenpflege",
    boxTitle: "🧹 Datenpflege",
    intro: "Diese Angaben fehlen noch. Mit ihnen werden Statistik, „reicht noch …“, Einkaufsvorschläge und der Bestandswert genauer. Antippen öffnet die Karte.",
    summary: (n) => (n === 1 ? "1 Angabe fehlt" : `${n} Angaben fehlen`),
    show: "Ansehen",
    later: "Diesen Monat nicht mehr",
    none: "Alles vollständig – nichts zu tun.",
    close: "Schließen",
    groups: {
      opened_no_date: "Angebrochen, aber ohne Datum",
      no_date: "Packungen ohne MHD",
      no_price: "Ohne Preis",
      no_place: "Ohne Bereich oder Fach",
      no_min: "Oft verbraucht, aber ohne Mindestbestand",
      no_table: "Unbekannt in der Haltbarkeitstabelle – antippen und Art wählen",
      history: "Vorschläge aus eurem Verlauf (eure Haltbarkeit)",
    },
    tableTitle: "Art für die Haltbarkeit",
    tableIntro: (name) => `Wie soll Larder „${name}“ behandeln? Gilt nur für genau dieses Produkt.`,
    tableAuto: "Automatisch (nach dem Namen)",
    tableSave: "Speichern",
    tableSaved: (name) => `${name}: gespeichert.`,
    tableFailed: "Speichern fehlgeschlagen.",
    tableButton: "🧭 Art für die Haltbarkeit",
    tableSource: { own: "von dir gewählt", off: "laut Open Food Facts", name: "nach dem Namen" },
    historyShow: "Vorschläge ansehen",
    groupSuggestTitle: "📦 Gruppen-Vorschläge",
    groupSuggestHint: "Diese Produkte sehen zusammengehörig aus. Gruppieren fasst nichts zusammen – die Produkte bleiben getrennt, die Gruppe zeigt die Summe.",
    groupSuggestLine: (g, members) => `${g}: ${members.join(" · ")}`,
    groupSuggestAdd: (g) => `Zur Gruppe ${g}`,
    groupSuggestNo: "Nein",
    groupSuggestDone: (g) => `Gruppe ${g} angelegt.`,
    more: (n) => `… und ${n} weitere`,
  },
  en: {
    introProducts: "Each product shows what is still missing. Tap it and fill in everything in one step – anything left empty simply stays open.",
    missing: { opened_no_date: "date since opening", no_date: "best-before", no_price: "price", no_place: "area/compartment", no_min: "minimum stock", no_table: "kind for the shelf life" },
    missingLine: (list) => `missing: ${list}`,
    fillIntro: "Only fill in what you know – empty fields stay open.",
    fieldPrice: "Price per pack (€)",
    fieldDate: "Best before",
    fieldOpened: "Opened – keeps until",
    fieldArea: "Area",
    fieldCompartment: "Compartment",
    fieldMin: "Minimum stock (packs)",
    noArea: "No area",
    save: "Save",
    saved: (name) => `${name}: saved.`,
    nothing: "Nothing entered.",
    openCard: "Open the card",
    back: "Back",
    menu: "🧹 Data care",
    title: "Data care",
    boxTitle: "🧹 Data care",
    intro: "These details are still missing. With them, statistics, “lasts about …”, shopping suggestions and the stock value get more accurate. Tap to open the card.",
    summary: (n) => (n === 1 ? "1 detail missing" : `${n} details missing`),
    show: "Show",
    later: "Not again this month",
    none: "Everything complete – nothing to do.",
    close: "Close",
    groups: {
      opened_no_date: "Opened, but without a date",
      no_date: "Packs without a best-before date",
      no_price: "Without a price",
      no_place: "Without an area or compartment",
      no_min: "Used often, but without a minimum stock",
      no_table: "Unknown to the shelf-life table – tap to choose the kind",
      history: "Suggestions from your history (your shelf life)",
    },
    tableTitle: "Kind for the shelf life",
    tableIntro: (name) => `How should Larder treat “${name}”? Applies to exactly this product only.`,
    tableAuto: "Automatic (by the name)",
    tableSave: "Save",
    tableSaved: (name) => `${name}: saved.`,
    tableFailed: "Saving failed.",
    tableButton: "🧭 Kind for the shelf life",
    tableSource: { own: "chosen by you", off: "from Open Food Facts", name: "by the name" },
    historyShow: "Show suggestions",
    groupSuggestTitle: "📦 Group suggestions",
    groupSuggestHint: "These products look like they belong together. Grouping merges nothing – the products stay separate, the group shows the total.",
    groupSuggestLine: (g, members) => `${g}: ${members.join(" · ")}`,
    groupSuggestAdd: (g) => `Into group ${g}`,
    groupSuggestNo: "No",
    groupSuggestDone: (g) => `Group ${g} created.`,
    more: (n) => `… and ${n} more`,
  },
  fr: {
    introProducts: "Pour chaque produit, ce qui manque encore. Touchez-le et complétez tout en une fois – ce qui reste vide reste simplement ouvert.",
    missing: { opened_no_date: "date depuis l'ouverture", no_date: "date de péremption", no_price: "prix", no_place: "pièce/compartiment", no_min: "stock minimum", no_table: "type pour la conservation" },
    missingLine: (list) => `manque : ${list}`,
    fillIntro: "Remplis seulement ce que tu sais – le reste reste ouvert.",
    fieldPrice: "Prix par paquet (€)",
    fieldDate: "Date de péremption",
    fieldOpened: "Ouvert – se conserve jusqu'au",
    fieldArea: "Pièce",
    fieldCompartment: "Compartiment",
    fieldMin: "Stock minimum (paquets)",
    noArea: "Aucune pièce",
    save: "Enregistrer",
    saved: (name) => `${name} : enregistré.`,
    nothing: "Rien saisi.",
    openCard: "Ouvrir la fiche",
    back: "Retour",
    menu: "🧹 Entretien des données",
    title: "Entretien des données",
    boxTitle: "🧹 Entretien des données",
    intro: "Ces informations manquent encore. Avec elles, les statistiques, « tient encore environ … », les suggestions d'achat et la valeur du stock deviennent plus précises. Touchez pour ouvrir la fiche.",
    summary: (n) => (n === 1 ? "1 information manquante" : `${n} informations manquantes`),
    show: "Afficher",
    later: "Plus ce mois-ci",
    none: "Tout est complet – rien à faire.",
    close: "Fermer",
    groups: {
      opened_no_date: "Ouvert, mais sans date",
      no_date: "Paquets sans date de péremption",
      no_price: "Sans prix",
      no_place: "Sans pièce ni compartiment",
      no_min: "Souvent utilisé, mais sans stock minimum",
      no_table: "Inconnu du tableau de conservation – touchez pour choisir le type",
      history: "Suggestions de votre historique (votre conservation)",
    },
    tableTitle: "Type pour la conservation",
    tableIntro: (name) => `Comment Larder doit-il traiter « ${name} » ? Vaut uniquement pour ce produit précis.`,
    tableAuto: "Automatique (d'après le nom)",
    tableSave: "Enregistrer",
    tableSaved: (name) => `${name} : enregistré.`,
    tableFailed: "L'enregistrement a échoué.",
    tableButton: "🧭 Type pour la conservation",
    tableSource: { own: "choisi par vous", off: "selon Open Food Facts", name: "d'après le nom" },
    historyShow: "Voir les suggestions",
    groupSuggestTitle: "📦 Groupes suggérés",
    groupSuggestHint: "Ces produits semblent aller ensemble. Grouper ne fusionne rien – les produits restent séparés, le groupe montre le total.",
    groupSuggestAdd: (g) => `Dans le groupe ${g}`,
    groupSuggestNo: "Non",
    groupSuggestDone: (g) => `Groupe ${g} créé.`,
    more: (n) => `… et ${n} de plus`,
  },
  nl: {
    introProducts: "Per product staat wat nog ontbreekt. Tik erop en vul alles in één keer aan – wat leeg blijft, blijft gewoon open.",
    missing: { opened_no_date: "datum sinds openen", no_date: "houdbaarheid", no_price: "prijs", no_place: "ruimte/vak", no_min: "minimumvoorraad", no_table: "soort voor de houdbaarheid" },
    missingLine: (list) => `ontbreekt: ${list}`,
    fillIntro: "Vul alleen in wat je weet – lege velden blijven open.",
    fieldPrice: "Prijs per verpakking (€)",
    fieldDate: "Houdbaar tot",
    fieldOpened: "Geopend – houdbaar tot",
    fieldArea: "Ruimte",
    fieldCompartment: "Vak",
    fieldMin: "Minimumvoorraad (verpakkingen)",
    noArea: "Geen ruimte",
    save: "Opslaan",
    saved: (name) => `${name}: opgeslagen.`,
    nothing: "Niets ingevuld.",
    openCard: "Kaart openen",
    back: "Terug",
    menu: "🧹 Gegevensonderhoud",
    title: "Gegevensonderhoud",
    boxTitle: "🧹 Gegevensonderhoud",
    intro: "Deze gegevens ontbreken nog. Daarmee worden statistieken, „gaat nog ongeveer …”, boodschappenvoorstellen en de voorraadwaarde nauwkeuriger. Tik om de kaart te openen.",
    summary: (n) => (n === 1 ? "1 gegeven ontbreekt" : `${n} gegevens ontbreken`),
    show: "Tonen",
    later: "Deze maand niet meer",
    none: "Alles compleet – niets te doen.",
    close: "Sluiten",
    groups: {
      opened_no_date: "Geopend, maar zonder datum",
      no_date: "Verpakkingen zonder houdbaarheidsdatum",
      no_price: "Zonder prijs",
      no_place: "Zonder ruimte of vak",
      no_min: "Vaak gebruikt, maar zonder minimumvoorraad",
      no_table: "Onbekend in de houdbaarheidstabel – tik om de soort te kiezen",
      history: "Voorstellen uit jullie geschiedenis (jullie houdbaarheid)",
    },
    tableTitle: "Soort voor de houdbaarheid",
    tableIntro: (name) => `Hoe moet Larder „${name}” behandelen? Geldt alleen voor precies dit product.`,
    tableAuto: "Automatisch (op naam)",
    tableSave: "Opslaan",
    tableSaved: (name) => `${name}: opgeslagen.`,
    tableFailed: "Opslaan mislukt.",
    tableButton: "🧭 Soort voor de houdbaarheid",
    tableSource: { own: "door jou gekozen", off: "volgens Open Food Facts", name: "op naam" },
    historyShow: "Voorstellen bekijken",
    groupSuggestTitle: "📦 Voorgestelde groepen",
    groupSuggestHint: "Deze producten lijken bij elkaar te horen. Groeperen voegt niets samen – de producten blijven apart, de groep toont het totaal.",
    groupSuggestAdd: (g) => `In groep ${g}`,
    groupSuggestNo: "Nee",
    groupSuggestDone: (g) => `Groep ${g} aangemaakt.`,
    more: (n) => `… en nog ${n}`,
  },
};

export function dataCareTexts(hass) {
  return pickLang(TEXT, hass);
}

/** "1,99" or "1.99 €" → 1.99 (null when empty or not a number). */
function parsePrice(text) {
  const value = Number(String(text || "").replace(/[^0-9,.]/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

function month(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function installDataCare(Dashboard, { el, DOMAIN, listAreas }) {
  const proto = Dashboard.prototype;
  const button = (cls, text, onClick) => {
    const b = el("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };

  proto.loadDataGaps = async function loadDataGaps() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._dataGaps = await hass.callWS({ type: `${DOMAIN}/data_gaps` });
    } catch {
      this._dataGaps = null;
    }
    this._sig = "";
    this._update();
  };

  proto._dataGapTotal = function _dataGapTotal() {
    const counts = (this._dataGaps && this._dataGaps.counts) || {};
    return GROUPS.reduce((sum, key) => sum + (counts[key] || 0), 0);
  };

  /** Start page: once a month, while something is missing. */
  proto._dataCareBox = function _dataCareBox() {
    const total = this._dataGapTotal();
    if (!total || this._opts.dataCareSeen === month()) return null;
    const t = dataCareTexts(this._hass);
    const box = el("section", "stat datacare");
    box.dataset.role = "datacare";
    box.append(el("h3", "", t.boxTitle));
    const row = el("div", "boughtrow");
    const text = el("span", "name");
    const counts = this._dataGaps.counts;
    text.append(
      el("span", "", t.summary(total)),
      el("span", "sub", GROUPS.filter((k) => counts[k]).map((k) => `${t.groups[k]}: ${counts[k]}`).join(" · ")),
    );
    const show = button("primary", t.show, () => this.openDataCare());
    show.dataset.role = "datacare-show";
    const later = button("", "✕", () => {
      this._opts.dataCareSeen = month();
      this._saveOptions();
      this._sig = "";
      this._update();
    });
    later.dataset.role = "datacare-later";
    later.setAttribute("aria-label", t.later);
    later.title = t.later;
    row.append(text, show, later);
    box.append(row);
    return box;
  };

  /** 6.3 (#174): choose the row of the shelf-life table for exactly this product. */
  proto.openTableRow = async function openTableRow(content, onDone = null) {
    const hass = this._hass;
    const t = dataCareTexts(hass);
    let data = { rows: [], current: null, source: null };
    try {
      data = await hass.callWS({ type: `${DOMAIN}/table_rows`, content, language: hass.language || undefined });
    } catch {
      /* the list stays empty */
    }
    const select = el("select");
    select.dataset.f = "table-row";
    const auto = el("option", "", t.tableAuto);
    auto.value = "";
    select.append(auto);
    for (const r of data.rows || []) {
      const o = el("option", "", r.name);
      o.value = r.id;
      select.append(o);
    }
    select.value = data.source === "own" || data.source === "off" ? data.current || "" : "";
    const status = el("p", "hint");
    const note = data.current && data.source ? `${(data.rows.find((r) => r.id === data.current) || {}).name || ""} (${t.tableSource[data.source] || ""})` : "";
    const save = button("submit", t.tableSave, async () => {
      save.disabled = true;
      try {
        await hass.callWS({ type: `${DOMAIN}/table_row_set`, content, entry: select.value || null });
        if (this.showNotice) this.showNotice(t.tableSaved(content));
        if (onDone) onDone();
        else this._closeDialog();
      } catch {
        status.textContent = t.tableFailed;
        save.disabled = false;
      }
    });
    save.dataset.role = "table-row-save";
    const buttons = el("div", "buttons");
    buttons.append(button("cancel", t.close, () => this._closeDialog()), save);
    this._form.replaceChildren(el("h2", "", t.tableTitle), el("p", "hint", t.tableIntro(content)), ...(note ? [el("p", "sub", note)] : []), select, status, buttons);
    this._submit = null;
    this._overlay.hidden = false;
  };

  /** The button in the product view (6.3, #174). */
  proto._tableRowButton = function _tableRowButton(content, onChanged = null) {
    const t = dataCareTexts(this._hass);
    const b = button("link", t.tableButton, () => this.openTableRow(content, onChanged));
    b.dataset.role = "table-row";
    return b;
  };

  /** 6.7 (#197): one line per product with everything that is missing; tapping it opens one dialog. */
  proto.openDataCare = async function openDataCare() {
    const hass = this._hass;
    const t = dataCareTexts(hass);
    if (!this._dataGaps) await this.loadDataGaps();
    const data = this._dataGaps || { counts: {}, gaps: {}, products: [] };
    const products = data.products || [];
    const parts = [el("h2", "", t.title)];
    if (!this._dataGapTotal()) parts.push(el("p", "hint", t.none));
    else parts.push(el("p", "hint", t.introProducts));
    const list = el("div", "datagroup");
    list.dataset.group = "products";
    for (const p of products) {
      const line = el("button", "row dataproduct");
      line.type = "button";
      line.dataset.id = p.device_id || "";
      line.dataset.role = "datacare-product";
      const text = el("span", "text");
      text.append(
        el("span", "name", p.place ? `${p.content} · ${p.place}` : p.content),
        el("span", "sub", t.missingLine(p.missing.map((g) => t.missing[g] || g).join(" · "))),
      );
      line.append(text);
      line.addEventListener("click", () => this.openGapFill(p));
      list.append(line);
    }
    if (products.length) parts.push(list);
    if ((data.counts.products || 0) > products.length) parts.push(el("p", "hint", t.more(data.counts.products - products.length)));
    const suggestions = data.group_suggestions || [];
    if (suggestions.length) {
      // 6.12 (#269): groups suggested for products that look alike – nothing happens without a tap
      const group = el("div", "datagroup");
      group.dataset.group = "group-suggestions";
      group.append(el("h3", "", t.groupSuggestTitle), el("p", "hint", t.groupSuggestHint));
      for (const sg of suggestions) {
        const row = el("div", "boughtrow groupsuggest");
        row.dataset.key = sg.key;
        const send = async (accept) => {
          try {
            const res = await hass.callWS({ type: `${DOMAIN}/group_suggestion`, key: sg.key, accept, group: sg.group, members: sg.members });
            this._dataGaps = { ...this._dataGaps, group_suggestions: res.suggestions };
            if (accept && this.showNotice) this.showNotice(t.groupSuggestDone(sg.group));
            this.openDataCare();
          } catch {
            /* stays as it is */
          }
        };
        const yes = button("primary", t.groupSuggestAdd(sg.group), () => send(true));
        yes.dataset.role = "group-suggest-yes";
        const no = button("", t.groupSuggestNo, () => send(false));
        no.dataset.role = "group-suggest-no";
        row.append(el("span", "name", t.groupSuggestLine(sg.group, sg.members)), yes, no);
        group.append(row);
      }
      parts.push(group);
    }
    if (data.counts.history) {
      // 6.3 (#175): your own shelf life from the history – the suggestions of Estimates
      const group = el("div", "datagroup");
      group.dataset.group = "history";
      const show = button("link", t.historyShow, () => {
        this._closeDialog();
        this.setView("estimates");
      });
      show.dataset.role = "datacare-history";
      group.append(el("h3", "", `${t.groups.history} (${data.counts.history})`), show);
      parts.push(group);
    }
    const buttons = el("div", "buttons");
    buttons.append(button("cancel", t.close, () => this._closeDialog()));
    parts.push(buttons);
    this._form.replaceChildren(...parts);
    this._submit = null;
    this._overlay.hidden = false;
  };

  /** 6.7 (#197): everything missing for one product in one dialog. */
  proto.openGapFill = function openGapFill(p) {
    const hass = this._hass;
    const t = dataCareTexts(hass);
    const has = (gap) => p.missing.includes(gap);
    const ids = (gap) => (p.ids && p.ids[gap]) || (p.device_id ? [p.device_id] : []);
    const field = (label, control) => {
      const wrap = el("label", "", label);
      wrap.append(control);
      return wrap;
    };
    const input = (type, f) => {
      const i = el("input");
      i.type = type;
      i.dataset.f = f;
      return i;
    };
    const parts = [el("h2", "", p.content), el("p", "hint", t.fillIntro)];
    let price = null;
    let date = null;
    let area = null;
    let compartment = null;
    let minimum = null;
    if (has("no_price")) {
      price = input("text", "gap-price");
      price.inputMode = "decimal";
      parts.push(field(t.fieldPrice, price));
    }
    if (has("no_date") || has("opened_no_date")) {
      date = input("date", "gap-date");
      parts.push(field(has("opened_no_date") ? t.fieldOpened : t.fieldDate, date));
    }
    if (has("no_place")) {
      area = el("select");
      area.dataset.f = "gap-area";
      for (const a of [{ id: "", name: t.noArea }, ...(listAreas ? listAreas(hass, this._classic && this._classic.larderLabel) : [])]) {
        const o = el("option", "", a.name);
        o.value = a.id;
        area.append(o);
      }
      area.value = p.area_id || "";
      compartment = input("text", "gap-compartment");
      compartment.maxLength = 60;
      compartment.value = p.compartment || "";
      parts.push(field(t.fieldArea, area), field(t.fieldCompartment, compartment));
    }
    if (has("no_min")) {
      minimum = input("number", "gap-min");
      minimum.min = "0";
      minimum.max = "99";
      minimum.inputMode = "numeric";
      parts.push(field(t.fieldMin, minimum));
    }
    if (has("no_table")) {
      parts.push(this._tableRowButton(p.content, () => {
        this._dataGaps = null;
        this.openDataCare();
      }));
    }
    const status = el("p", "hint");
    status.setAttribute("role", "status");
    const back = button("cancel", t.back, () => this.openDataCare());
    const card = button("link", t.openCard, () => {
      this._closeDialog();
      this.openDetail(p.device_id);
    });
    card.dataset.role = "gap-card";
    const save = button("submit", t.save, async () => {
      const calls = [];
      const value = price ? parsePrice(price.value) : null;
      if (value) calls.push({ type: `${DOMAIN}/price_set`, content: p.content, price: value });
      const rows = new Map();
      const row = (id) => rows.get(id) || rows.set(id, { device_id: id, added: 999 }).get(id);
      if (date && date.value) for (const id of [...ids("no_date"), ...ids("opened_no_date")]) row(id).best_before = date.value;
      if (area && (area.value !== (p.area_id || "") || compartment.value.trim() !== (p.compartment || ""))) {
        for (const id of ids("no_place")) Object.assign(row(id), { area_id: area.value || null, compartment: compartment.value.trim() });
      }
      if (rows.size) calls.push({ type: `${DOMAIN}/put_away_save`, rows: [...rows.values()] });
      if (minimum && minimum.value !== "" && Number(minimum.value) > 0) calls.push({ type: `${DOMAIN}/stock_min`, content: p.content, min: Number(minimum.value) });
      if (!calls.length) {
        status.textContent = t.nothing;
        return;
      }
      save.disabled = true;
      try {
        for (const msg of calls) await hass.callWS(msg);
        if (this.showNotice) this.showNotice(t.saved(p.content));
        this._dataGaps = null;
        await this.openDataCare();
      } catch (err) {
        status.textContent = (err && err.message) || t.tableFailed;
        save.disabled = false;
      }
    });
    save.dataset.role = "gap-save";
    const buttons = el("div", "buttons");
    buttons.append(back, save);
    if (p.device_id) parts.push(card);
    parts.push(status, buttons);
    this._form.replaceChildren(...parts);
    this._submit = null;
    this._overlay.hidden = false;
    const first = this._form.querySelector("input, select");
    if (first) first.focus();
  };
}
