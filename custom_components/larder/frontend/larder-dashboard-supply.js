/**
 * Larder dashboard (4.7): emergency supply check (⋮ → 🛟) and the order of the store sections (⋮ → 🏪).
 *
 * `installSupply` attaches the methods to the dashboard class (like larder-dashboard-items.js).
 */

export const SECTION_NAMES = {
  de: {
    produce: "🥦 Obst & Gemüse",
    bakery: "🥖 Brot & Backwaren",
    meat: "🥩 Fleisch, Wurst & Fisch",
    fridge: "🧀 Kühlregal",
    dry: "🍝 Nudeln, Reis & Konserven",
    breakfast: "☕ Frühstück, Kaffee & Süßes",
    drinks: "🥤 Getränke",
    frozen: "🧊 Tiefkühl",
    drugstore: "🧴 Drogerie & Haushalt",
    pharmacy: "💊 Apotheke",
    other: "🛒 Sonstiges",
  },
  en: {
    produce: "🥦 Fruit & vegetables",
    bakery: "🥖 Bakery",
    meat: "🥩 Meat, sausage & fish",
    fridge: "🧀 Chilled",
    dry: "🍝 Pasta, rice & cans",
    breakfast: "☕ Breakfast, coffee & sweets",
    drinks: "🥤 Drinks",
    frozen: "🧊 Frozen",
    drugstore: "🧴 Drugstore & household",
    pharmacy: "💊 Pharmacy",
    other: "🛒 Other",
  },
};

const TEXT = {
  de: {
    title: "Notvorrat",
    intro: (p, d) => `Für ${p} ${p === 1 ? "Person" : "Personen"} und ${d} Tage, nach dem Beispielvorrat des BBK (Bundesamt für Bevölkerungsschutz und Katastrophenhilfe). Personen und Tage stellst du in den Einstellungen ein.`,
    covered: (n, d) => (n >= d ? `✅ Der Vorrat reicht für ${d} Tage.` : n > 0 ? `Der Vorrat reicht für etwa ${n} von ${d} Tagen.` : `Der Vorrat reicht noch keinen Tag (Ziel: ${d} Tage).`),
    food: "Getränke und Lebensmittel",
    other: "Licht, Hygiene und Hausapotheke",
    groups: {
      drinks: "Getränke",
      grain: "Getreide, Brot, Kartoffeln, Nudeln, Reis",
      vegetables: "Gemüse und Hülsenfrüchte",
      fruit: "Obst und Nüsse",
      dairy: "Milch und Milchprodukte",
      protein: "Fisch, Fleisch, Eier",
      fats: "Fette und Öle",
    },
    items: {
      light: "Kerzen oder Taschenlampe",
      batteries: "Batterien",
      radio: "Radio (Batterie oder Kurbel)",
      toilet_paper: "Klopapier",
      soap: "Seife",
      first_aid: "Verbandskasten / Pflaster",
      pain: "Schmerzmittel",
      thermometer: "Fieberthermometer",
      disinfectant: "Desinfektionsmittel",
    },
    amount: (have, need, unit) => `${fmt(have).replace(".", ",")} von ${fmt(need).replace(".", ",")} ${unit}`,
    unknown: (n) => `+ ${n} ohne Mengenangabe`,
    shop: "🛒",
    shopLabel: "Auf die Einkaufsliste",
    shopped: (item) => `${item} steht auf der Einkaufsliste.`,
    noList: "Wähle zuerst eine Einkaufsliste in den Einstellungen.",
    off: "Der Notvorrat-Check ist in den Einstellungen ausgeschaltet.",
    hint: "Gezählt wird, was eine Mengenangabe hat (Packungsgröße wie „500 g“, Gramm oder Milliliter, Portionen mit 300 g). Mehr dazu auf bbk.bund.de.",
    menu: "🛟 Notvorrat",
    sectionsMenu: "🏪 Abteilungen",
    sectionsTitle: "Abteilungen im Laden",
    sectionsIntro: "In dieser Reihenfolge zeigt der Einkaufsmodus die Einkaufslisten – so, wie du durch deinen Laden gehst.",
    up: "Nach oben",
    down: "Nach unten",
    save: "Speichern",
    cancel: "Abbrechen",
  },
  en: {
    title: "Emergency supply",
    intro: (p, d) => `For ${p} ${p === 1 ? "person" : "persons"} and ${d} days, following the example supply of the German Federal Office of Civil Protection (BBK). Set persons and days in the settings.`,
    covered: (n, d) => (n >= d ? `✅ The supply lasts ${d} days.` : n > 0 ? `The supply lasts about ${n} of ${d} days.` : `The supply does not last a day yet (goal: ${d} days).`),
    food: "Drinks and food",
    other: "Light, hygiene and first aid",
    groups: {
      drinks: "Drinks",
      grain: "Grain, bread, potatoes, pasta, rice",
      vegetables: "Vegetables and pulses",
      fruit: "Fruit and nuts",
      dairy: "Milk and dairy",
      protein: "Fish, meat, eggs",
      fats: "Fats and oils",
    },
    items: {
      light: "Candles or a torch",
      batteries: "Batteries",
      radio: "Radio (battery or crank)",
      toilet_paper: "Toilet paper",
      soap: "Soap",
      first_aid: "First aid kit / plasters",
      pain: "Pain relief",
      thermometer: "Thermometer",
      disinfectant: "Disinfectant",
    },
    amount: (have, need, unit) => `${fmt(have)} of ${fmt(need)} ${unit}`,
    unknown: (n) => `+ ${n} without an amount`,
    shop: "🛒",
    shopLabel: "Onto the shopping list",
    shopped: (item) => `${item} is on the shopping list.`,
    noList: "Choose a shopping list in the settings first.",
    off: "The emergency supply check is switched off in the settings.",
    hint: "Only what has an amount counts (package size like “500 g”, grams or millilitres, portions as 300 g). More on bbk.bund.de.",
    menu: "🛟 Emergency supply",
    sectionsMenu: "🏪 Store sections",
    sectionsTitle: "Store sections",
    sectionsIntro: "The shopping mode shows the shopping lists in this order – the way you walk through your store.",
    up: "Move up",
    down: "Move down",
    save: "Save",
    cancel: "Cancel",
  },
};

function fmt(n) {
  return String(Math.round(n * 10) / 10);
}

export function supplyTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

export function sectionNames(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? SECTION_NAMES.de : SECTION_NAMES.en;
}

export function installSupply(Dashboard, { el, DOMAIN }) {
  const proto = Dashboard.prototype;
  const button = (cls, text, onClick) => {
    const b = el("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };

  proto.supplyTitle = function supplyTitle() {
    return supplyTexts(this._hass).title;
  };

  proto.loadSupply = async function loadSupply() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._supply = await hass.callWS({ type: `${DOMAIN}/supply` });
    } catch {
      this._supply = { error: true };
    }
    this._sig = "";
    this._update();
  };

  proto._supplyShop = async function _supplyShop(key, btn) {
    const t = supplyTexts(this._hass);
    btn.disabled = true;
    try {
      const res = await this._hass.callWS({ type: `${DOMAIN}/supply_shop`, key });
      this.showNotice(t.shopped(res.item));
    } catch {
      this.showNotice(t.noList);
      btn.disabled = false;
    }
  };

  proto._renderSupply = function _renderSupply() {
    const t = supplyTexts(this._hass);
    const data = this._supply;
    const frag = document.createDocumentFragment();
    if (!data || data.error) {
      this._main.replaceChildren(frag);
      return;
    }
    if (data.enabled === false) frag.append(el("p", "note", t.off));
    frag.append(el("p", "lead", t.intro(data.persons, data.days)));
    const covered = el("p", "lead", t.covered(data.days_covered, data.days));
    covered.dataset.role = "supply-covered";
    frag.append(covered);
    const food = el("section", "stat supply");
    food.dataset.role = "supply-food";
    food.append(el("h3", "", t.food));
    for (const g of data.groups || []) {
      const row = el("div", "boughtrow");
      row.dataset.key = g.key;
      const text = el("span", "name");
      const sub = t.amount(g.have, g.need, g.unit) + (g.unknown ? ` ${t.unknown(g.unknown)}` : "");
      text.append(el("span", "", `${g.share >= 1 ? "✅" : "⬜"} ${t.groups[g.key] || g.key}`), el("span", "sub", sub));
      const bar = el("span", "supplybar");
      const fill = el("span", "");
      fill.style.width = `${Math.round(Math.min(1, g.share) * 100)}%`;
      bar.append(fill);
      text.append(bar);
      row.append(text);
      if (g.share < 1) {
        const shop = button("", t.shop, () => this._supplyShop(g.key, shop));
        shop.dataset.role = "supply-shop";
        shop.setAttribute("aria-label", t.shopLabel);
        shop.title = t.shopLabel;
        row.append(shop);
      }
      food.append(row);
    }
    frag.append(food);
    const other = el("section", "stat supply");
    other.dataset.role = "supply-items";
    other.append(el("h3", "", t.other));
    for (const item of data.items || []) {
      const row = el("div", "boughtrow");
      row.dataset.key = item.key;
      const text = el("span", "name");
      text.append(el("span", "", `${item.present ? "✅" : "⬜"} ${t.items[item.key] || item.key}`));
      if (item.names && item.names.length) text.append(el("span", "sub", item.names.join(", ")));
      row.append(text);
      if (!item.present) {
        const shop = button("", t.shop, () => this._supplyShop(item.key, shop));
        shop.dataset.role = "supply-shop";
        shop.setAttribute("aria-label", t.shopLabel);
        shop.title = t.shopLabel;
        row.append(shop);
      }
      other.append(row);
    }
    frag.append(other);
    frag.append(el("p", "note", t.hint));
    this._main.replaceChildren(frag);
  };

  /** Order of the store sections (administrators): ↑/↓, then save. */
  proto.openSectionsDialog = async function openSectionsDialog() {
    const hass = this._hass;
    const t = supplyTexts(hass);
    const names = sectionNames(hass);
    let order = Object.keys(names);
    try {
      order = (await hass.callWS({ type: `${DOMAIN}/sections` })).order || order;
    } catch {
      /* default order */
    }
    const list = el("div", "sectionlist");
    const draw = () => {
      list.replaceChildren(
        ...order.map((key, i) => {
          const row = el("div", "boughtrow");
          row.dataset.key = key;
          const up = button("", "↑", () => {
            [order[i - 1], order[i]] = [order[i], order[i - 1]];
            draw();
          });
          up.disabled = i === 0;
          up.setAttribute("aria-label", t.up);
          up.dataset.role = "section-up";
          const down = button("", "↓", () => {
            [order[i + 1], order[i]] = [order[i], order[i + 1]];
            draw();
          });
          down.disabled = i === order.length - 1;
          down.setAttribute("aria-label", t.down);
          down.dataset.role = "section-down";
          row.append(el("span", "name", `${i + 1}. ${names[key] || key}`), up, down);
          return row;
        }),
      );
    };
    draw();
    const save = button("submit", t.save, async () => {
      try {
        await hass.callWS({ type: `${DOMAIN}/section_order`, order });
      } catch {
        return;
      }
      this._closeDialog();
    });
    save.dataset.role = "sections-save";
    const buttons = el("div", "buttons");
    buttons.append(button("cancel", t.cancel, () => this._closeDialog()), save);
    this._form.replaceChildren(el("h2", "", t.sectionsTitle), el("p", "hint", t.sectionsIntro), list, buttons);
    this._submit = null;
    this._overlay.hidden = false;
  };
}
