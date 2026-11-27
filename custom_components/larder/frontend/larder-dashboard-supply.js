/**
 * Larder dashboard (4.7): emergency supply check (⋮ → 🛟) and the order of the store sections (⋮ → 🏪).
 *
 * `installSupply` attaches the methods to the dashboard class (like larder-dashboard-items.js).
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

export const SECTION_NAMES = {
  de: {
    produce: "🥦 Obst & Gemüse",
    bakery: "🥖 Brot & Backwaren",
    meat: "🥩 Fleisch, Wurst & Fisch",
    fridge: "🧀 Kühlregal",
    dry: "🫙 Öl, Soßen & Trockenware",
    pasta: "🍝 Nudeln & Reis",
    canned: "🥫 Konserven",
    baking: "🧁 Backen (Mehl, Zucker …)",
    spices: "🧂 Gewürze",
    international: "🌏 Internationale Küche",
    breakfast: "☕ Frühstück & Kaffee",
    sweets: "🍫 Süßes & Snacks",
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
    dry: "🫙 Oil, sauces & dry goods",
    pasta: "🍝 Pasta & rice",
    canned: "🥫 Canned food",
    baking: "🧁 Baking (flour, sugar …)",
    spices: "🧂 Spices",
    international: "🌏 International food",
    breakfast: "☕ Breakfast & coffee",
    sweets: "🍫 Sweets & snacks",
    drinks: "🥤 Drinks",
    frozen: "🧊 Frozen",
    drugstore: "🧴 Drugstore & household",
    pharmacy: "💊 Pharmacy",
    other: "🛒 Other",
  },
  fr: {
    produce: "🥦 Fruits et légumes",
    bakery: "🥖 Boulangerie",
    meat: "🥩 Viande, charcuterie et poisson",
    fridge: "🧀 Rayon frais",
    dry: "🫙 Huiles, sauces et épicerie",
    pasta: "🍝 Pâtes et riz",
    canned: "🥫 Conserves",
    baking: "🧁 Pâtisserie (farine, sucre …)",
    spices: "🧂 Épices",
    international: "🌏 Cuisine du monde",
    breakfast: "☕ Petit-déjeuner et café",
    sweets: "🍫 Sucreries et snacks",
    drinks: "🥤 Boissons",
    frozen: "🧊 Surgelés",
    drugstore: "🧴 Droguerie et entretien",
    pharmacy: "💊 Pharmacie",
    other: "🛒 Divers",
  },
  nl: {
    produce: "🥦 Groente en fruit",
    bakery: "🥖 Brood en banket",
    meat: "🥩 Vlees, vleeswaren en vis",
    fridge: "🧀 Koelvak",
    dry: "🫙 Olie, sauzen en droge waren",
    pasta: "🍝 Pasta en rijst",
    canned: "🥫 Conserven",
    baking: "🧁 Bakken (meel, suiker …)",
    spices: "🧂 Kruiden en specerijen",
    international: "🌏 Wereldkeuken",
    breakfast: "☕ Ontbijt en koffie",
    sweets: "🍫 Snoep en snacks",
    drinks: "🥤 Dranken",
    frozen: "🧊 Diepvries",
    drugstore: "🧴 Drogisterij en huishouden",
    pharmacy: "💊 Apotheek",
    other: "🛒 Overig",
  },
};

const TEXT = {
  de: {
    ownTitle: "Eigene Abteilungen",
    ownHint: "Für das, was dein Laden anders aufteilt – z. B. „Bio-Ecke“ oder „Getränkemarkt“. Auf der Karte eines Produkts wählst du die Abteilung.",
    ownPlaceholder: "Neue Abteilung …",
    ownAdd: "＋ Anlegen",
    ownRename: "Umbenennen",
    ownDelete: "Löschen",
    ownDeleted: (name) => `„${name}“ gelöscht – die Produkte bekommen wieder ihren Vorschlag.`,
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
    sectionsStoreTitle: (name) => `Abteilungen bei ${name}`,
    sectionsStoreIntro: (name) => `So gehst du durch ${name}. Gilt im Einkaufsmodus, wenn „Ich bin bei ${name}“ gewählt ist.`,
    sectionsGeneral: "Allgemeine Reihenfolge",
    up: "Nach oben",
    down: "Nach unten",
    save: "Speichern",
    cancel: "Abbrechen",
  },
  en: {
    ownTitle: "Own sections",
    ownHint: "For whatever your store divides differently – e.g. “organic corner” or “drinks market”. Choose the section on a product's card.",
    ownPlaceholder: "New section …",
    ownAdd: "＋ Add",
    ownRename: "Rename",
    ownDelete: "Delete",
    ownDeleted: (name) => `“${name}” deleted – its products get their suggestion again.`,
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
    sectionsStoreTitle: (name) => `Sections at ${name}`,
    sectionsStoreIntro: (name) => `The way you walk through ${name}. Applies in the shopping mode when “I am at ${name}” is chosen.`,
    sectionsGeneral: "General order",
    up: "Move up",
    down: "Move down",
    save: "Save",
    cancel: "Cancel",
  },
  fr: {
    ownTitle: "Rayons personnels",
    ownHint: "Pour ce que ton magasin range autrement – p. ex. « coin bio ». Choisis le rayon sur la fiche d'un produit.",
    ownPlaceholder: "Nouveau rayon …",
    ownAdd: "＋ Ajouter",
    ownRename: "Renommer",
    ownDelete: "Supprimer",
    ownDeleted: (name) => `« ${name} » supprimé – ses produits reprennent la suggestion.`,
    title: "Réserve d'urgence",
    intro: (p, d) => `Pour ${p} ${p === 1 ? "personne" : "personnes"} et ${d} jours, d'après la réserve type de l'Office fédéral allemand de protection civile (BBK). Personnes et jours se règlent dans les paramètres.`,
    covered: (n, d) => (n >= d ? `✅ La réserve tient ${d} jours.` : n > 0 ? `La réserve tient environ ${n} jours sur ${d}.` : `La réserve ne tient pas encore une journée (objectif : ${d} jours).`),
    food: "Boissons et aliments",
    other: "Éclairage, hygiène et premiers secours",
    groups: {
      drinks: "Boissons",
      grain: "Céréales, pain, pommes de terre, pâtes, riz",
      vegetables: "Légumes et légumineuses",
      fruit: "Fruits et fruits à coque",
      dairy: "Lait et produits laitiers",
      protein: "Poisson, viande, œufs",
      fats: "Matières grasses et huiles",
    },
    items: {
      light: "Bougies ou lampe de poche",
      batteries: "Piles",
      radio: "Radio (à piles ou à manivelle)",
      toilet_paper: "Papier toilette",
      soap: "Savon",
      first_aid: "Trousse de secours / pansements",
      pain: "Antidouleurs",
      thermometer: "Thermomètre",
      disinfectant: "Désinfectant",
    },
    amount: (have, need, unit) => `${fmt(have)} sur ${fmt(need)} ${unit}`,
    unknown: (n) => `+ ${n} sans quantité`,
    shop: "🛒",
    shopLabel: "Sur la liste de courses",
    shopped: (item) => `${item} est sur la liste de courses.`,
    noList: "Choisissez d'abord une liste de courses dans les paramètres.",
    off: "Le contrôle de la réserve d'urgence est désactivé dans les paramètres.",
    hint: "Seul ce qui a une quantité compte (taille du paquet comme « 500 g », grammes ou millilitres, portions comptées 300 g). Plus d'infos sur bbk.bund.de.",
    menu: "🛟 Réserve d'urgence",
    sectionsMenu: "🏪 Rayons du magasin",
    sectionsTitle: "Rayons du magasin",
    sectionsIntro: "Le mode courses affiche les listes dans cet ordre – comme vous parcourez votre magasin.",
    sectionsStoreTitle: (name) => `Rayons chez ${name}`,
    sectionsStoreIntro: (name) => `Votre parcours dans ${name}. S'applique en mode courses quand « Je suis chez ${name} » est choisi.`,
    sectionsGeneral: "Ordre général",
    up: "Monter",
    down: "Descendre",
    save: "Enregistrer",
    cancel: "Annuler",
  },
  nl: {
    ownTitle: "Eigen afdelingen",
    ownHint: "Voor wat jouw winkel anders indeelt – bv. „biohoek”. Kies de afdeling op de kaart van een product.",
    ownPlaceholder: "Nieuwe afdeling …",
    ownAdd: "＋ Toevoegen",
    ownRename: "Hernoemen",
    ownDelete: "Verwijderen",
    ownDeleted: (name) => `„${name}” verwijderd – de producten krijgen weer hun voorstel.`,
    title: "Noodvoorraad",
    intro: (p, d) => `Voor ${p} ${p === 1 ? "persoon" : "personen"} en ${d} dagen, volgens de voorbeeldvoorraad van het Duitse Bundesamt für Bevölkerungsschutz (BBK). Personen en dagen stel je in bij de instellingen.`,
    covered: (n, d) => (n >= d ? `✅ De voorraad is genoeg voor ${d} dagen.` : n > 0 ? `De voorraad is genoeg voor ongeveer ${n} van ${d} dagen.` : `De voorraad is nog geen dag genoeg (doel: ${d} dagen).`),
    food: "Dranken en voedsel",
    other: "Licht, hygiëne en EHBO",
    groups: {
      drinks: "Dranken",
      grain: "Graan, brood, aardappelen, pasta, rijst",
      vegetables: "Groente en peulvruchten",
      fruit: "Fruit en noten",
      dairy: "Melk en zuivel",
      protein: "Vis, vlees, eieren",
      fats: "Vetten en oliën",
    },
    items: {
      light: "Kaarsen of zaklamp",
      batteries: "Batterijen",
      radio: "Radio (batterij of slinger)",
      toilet_paper: "Toiletpapier",
      soap: "Zeep",
      first_aid: "EHBO-doos / pleisters",
      pain: "Pijnstillers",
      thermometer: "Thermometer",
      disinfectant: "Desinfectiemiddel",
    },
    amount: (have, need, unit) => `${fmt(have)} van ${fmt(need)} ${unit}`,
    unknown: (n) => `+ ${n} zonder hoeveelheid`,
    shop: "🛒",
    shopLabel: "Op de boodschappenlijst",
    shopped: (item) => `${item} staat op de boodschappenlijst.`,
    noList: "Kies eerst een boodschappenlijst in de instellingen.",
    off: "De controle van de noodvoorraad staat uit in de instellingen.",
    hint: "Alleen wat een hoeveelheid heeft telt mee (verpakkingsgrootte zoals „500 g”, gram of milliliter, porties als 300 g). Meer op bbk.bund.de.",
    menu: "🛟 Noodvoorraad",
    sectionsMenu: "🏪 Winkelafdelingen",
    sectionsTitle: "Winkelafdelingen",
    sectionsIntro: "De winkelmodus toont de boodschappenlijsten in deze volgorde – zoals je door je winkel loopt.",
    sectionsStoreTitle: (name) => `Afdelingen bij ${name}`,
    sectionsStoreIntro: (name) => `Zo loop je door ${name}. Geldt in de winkelmodus als „Ik ben bij ${name}” gekozen is.`,
    sectionsGeneral: "Algemene volgorde",
    up: "Omhoog",
    down: "Omlaag",
    save: "Opslaan",
    cancel: "Annuleren",
  },
};

function fmt(n) {
  return String(Math.round(n * 10) / 10);
}

export function supplyTexts(hass) {
  return pickLang(TEXT, hass);
}

// 6.9 (#238): own store sections (key → name), from larder/settings or larder/sections
let OWN_SECTIONS = {};
export function setOwnSections(own) {
  OWN_SECTIONS = own && typeof own === "object" ? { ...own } : {};
}
export function ownSections() {
  return OWN_SECTIONS;
}

export function sectionNames(hass) {
  const own = Object.fromEntries(Object.entries(OWN_SECTIONS).map(([k, v]) => [k, `🏷️ ${v}`]));
  return { ...pickLang(SECTION_NAMES, hass), ...own };
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
  proto.openSectionsDialog = async function openSectionsDialog(store = null, onSaved = null) {
    const hass = this._hass;
    const t = supplyTexts(hass);
    let names = sectionNames(hass);
    let order = Object.keys(names);
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/sections` });
      setOwnSections(res.own || {});
      names = sectionNames(hass);
      order = res.order || order;
    } catch {
      /* default order */
    }
    if (store && Array.isArray(store.order) && store.order.length) {
      // 5.9 (#140): the store's own order, the rest behind it
      order = [...store.order, ...order.filter((k) => !store.order.includes(k))];
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
          // 6.9 (#238): own sections can be renamed and deleted (general order only, administrators)
          if (!store && key in ownSections()) {
            const rename = button("", "✏️", () => {
              const input = el("input");
              input.type = "text";
              input.maxLength = 40;
              input.value = ownSections()[key];
              input.dataset.f = "section-rename";
              const ok = button("", "✓", () => manage({ key, name: input.value.trim() }));
              ok.dataset.role = "section-rename-save";
              row.replaceChildren(input, ok);
              input.focus();
            });
            rename.dataset.role = "section-rename";
            rename.setAttribute("aria-label", t.ownRename);
            const remove = button("", "✕", async () => {
              const name = ownSections()[key];
              if (await manage({ key, delete: true })) this.showNotice(t.ownDeleted(name));
            });
            remove.dataset.role = "section-delete";
            remove.setAttribute("aria-label", t.ownDelete);
            row.append(rename, remove);
          }
          return row;
        }),
      );
    };
    const manage = async (msg) => {
      if (msg.name === "") return false;
      try {
        const res = await hass.callWS({ type: `${DOMAIN}/section_own`, ...msg });
        setOwnSections(res.own || {});
        names = sectionNames(hass);
        // keep the order shown here, new ones where the server put them
        const known = res.order || order;
        order = [...order.filter((k) => known.includes(k)), ...known.filter((k) => !order.includes(k))];
        draw();
        return true;
      } catch (err) {
        this.showNotice((err && err.message) || String(err));
        return false;
      }
    };
    draw();
    let ownBox = null;
    if (!store) {
      const input = el("input");
      input.type = "text";
      input.maxLength = 40;
      input.placeholder = t.ownPlaceholder;
      input.dataset.f = "section-new";
      const add = button("", t.ownAdd, async () => {
        if (await manage({ name: input.value.trim() })) input.value = "";
      });
      add.dataset.role = "section-add";
      const line = el("div", "putcode");
      line.append(input, add);
      ownBox = el("div", "ownsections");
      ownBox.append(el("h3", "", t.ownTitle), el("p", "hint", t.ownHint), line);
    }
    const store_save = async (value) => {
      await hass.callWS({ type: `${DOMAIN}/store_save`, name: store.name, order: value });
    };
    const save = button("submit", t.save, async () => {
      try {
        if (store) await store_save(order);
        else await hass.callWS({ type: `${DOMAIN}/section_order`, order });
      } catch {
        return;
      }
      this._closeDialog();
      if (onSaved) onSaved();
    });
    save.dataset.role = "sections-save";
    const buttons = el("div", "buttons");
    buttons.append(button("cancel", t.cancel, () => this._closeDialog()));
    if (store && store.order) {
      const general = button("", t.sectionsGeneral, async () => {
        try {
          await store_save(null);
        } catch {
          return;
        }
        this._closeDialog();
        if (onSaved) onSaved();
      });
      general.dataset.role = "sections-general";
      buttons.append(general);
    }
    buttons.append(save);
    this._form.replaceChildren(
      el("h2", "", store ? t.sectionsStoreTitle(store.name) : t.sectionsTitle),
      el("p", "hint", store ? t.sectionsStoreIntro(store.name) : t.sectionsIntro),
      list,
      ...(ownBox ? [ownBox] : []),
      buttons,
    );
    this._submit = null;
    this._overlay.hidden = false;
  };
}
