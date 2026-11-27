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
    more: (n) => `… und ${n} weitere`,
  },
  en: {
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
    more: (n) => `… and ${n} more`,
  },
  fr: {
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
    more: (n) => `… et ${n} de plus`,
  },
  nl: {
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
    more: (n) => `… en nog ${n}`,
  },
};

export function dataCareTexts(hass) {
  return pickLang(TEXT, hass);
}

function month(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function installDataCare(Dashboard, { el, DOMAIN }) {
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

  /** All gaps, grouped; tapping an entry opens its card. */
  proto.openDataCare = async function openDataCare() {
    const hass = this._hass;
    const t = dataCareTexts(hass);
    if (!this._dataGaps) await this.loadDataGaps();
    const data = this._dataGaps || { counts: {}, gaps: {} };
    const parts = [el("h2", "", t.title)];
    if (!this._dataGapTotal()) parts.push(el("p", "hint", t.none));
    else parts.push(el("p", "hint", t.intro));
    for (const key of GROUPS) {
      const rows = (data.gaps && data.gaps[key]) || [];
      if (key === "history" && data.counts.history) {
        // 6.3 (#175): your own shelf life from the history – the suggestions of Estimates
        const group = el("div", "datagroup");
        group.dataset.group = key;
        const show = button("link", t.historyShow, () => {
          this._closeDialog();
          this.setView("estimates");
        });
        show.dataset.role = "datacare-history";
        group.append(el("h3", "", `${t.groups[key]} (${data.counts[key]})`), show);
        parts.push(group);
        continue;
      }
      if (!rows.length) continue;
      const group = el("div", "datagroup");
      group.dataset.group = key;
      group.append(el("h3", "", `${t.groups[key]} (${data.counts[key]})`));
      for (const r of rows) {
        const line = button("link", r.place ? `${r.content} · ${r.place}` : r.content, () => {
          // 6.1 (#170): a missing price is entered in the product view (for all its packs)
          if (key === "no_price" && r.kind && this.openProduct) {
            this.openProduct(r.content);
            return;
          }
          // 6.3 (#174): unknown to the table – choose the kind
          if (key === "no_table") {
            this.openTableRow(r.content, () => {
              this._dataGaps = null;
              this.openDataCare();
            });
            return;
          }
          this._closeDialog();
          this.openDetail(r.device_id);
        });
        line.dataset.id = r.device_id;
        group.append(line);
      }
      if (data.counts[key] > rows.length) group.append(el("p", "hint", t.more(data.counts[key] - rows.length)));
      parts.push(group);
    }
    const buttons = el("div", "buttons");
    buttons.append(button("cancel", t.close, () => this._closeDialog()));
    parts.push(buttons);
    this._form.replaceChildren(...parts);
    this._submit = null;
    this._overlay.hidden = false;
  };
}
