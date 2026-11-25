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

const GROUPS = ["opened_no_date", "no_date", "no_price", "no_place", "no_min"];

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
    },
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
    },
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
    },
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
    },
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
      if (!rows.length) continue;
      const group = el("div", "datagroup");
      group.dataset.group = key;
      group.append(el("h3", "", `${t.groups[key]} (${data.counts[key]})`));
      for (const r of rows) {
        const line = button("link", r.place ? `${r.content} · ${r.place}` : r.content, () => {
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
