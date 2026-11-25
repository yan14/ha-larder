/**
 * Larder dashboard (4.10): shopping mode – the shopping lists by store section; ticking an item off puts it into
 * stock at its usual place – and recurring purchases (a crate of water every Friday).
 *
 * `installShopping` attaches the methods to the dashboard class (like larder-dashboard-items.js).
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

const TEXT = {
  de: {
    title: "Einkaufen",
    menu: "🛒 Einkaufsmodus",
    startButton: "🛒 Einkaufen",
    intro: "Nach Abteilungen sortiert. Abhaken hakt den Eintrag auf der Liste ab und legt ihn gleich in den Vorrat, an seinen üblichen Ort.",
    empty: "Nichts auf den Einkaufslisten.",
    noList: "Wähle zuerst eine Einkaufsliste in den Einstellungen.",
    check: "Abhaken",
    added: (r) => `→ ${[r.area, r.compartment].filter(Boolean).join(" · ") || "Vorrat"}${r.added > 1 ? ` (+${r.added})` : ""}`,
    unknown: "neu – wird am Ende angelegt",
    loading: "Einkaufslisten werden geladen …",
    loadFailed: (msg) => `Die Einkaufslisten konnten nicht geladen werden${msg ? `: ${msg}` : "."}`,
    listFailed: (name, msg) => `${name}: nicht lesbar (${msg})`,
    listOpen: (name, n) => `${name}: ${n} offen`,
    listMissing: (id) => `Die eingestellte Einkaufsliste ${id} gibt es in Home Assistant gerade nicht. Bitte in den Einstellungen der Integration neu wählen.`,
    failed: "Abhaken fehlgeschlagen.",
    addUnknown: (n) => (n === 1 ? "＋ 1 neuen Artikel anlegen" : `＋ ${n} neue Artikel anlegen`),
    reload: "🔄 Aktualisieren",
    storeWhere: "📍 Wo bist du?",
    storeAll: "Überall",
    storeNew: "Laden, z. B. Rewe",
    storeOrder: (name) => `🏪 Abteilungen bei ${name}`,
    elsewhere: (n, store) => `Woanders gekauft (${n}) – bisher nicht bei ${store}`,
    boughtAt: (stores) => `bisher bei ${stores}`,
    scan: "📷 Scannen",
    receipt: "🧾 Kassenbon",
    details: "€ / MHD",
    detailsLabel: "Preis und MHD eintragen",
    price: "Preis (€)",
    bestBefore: "MHD",
    save: "Speichern",
    detailsDone: (price, date) => [price ? `${price.toFixed(2).replace(".", ",")} €` : null, date ? `MHD ${date.split("-").reverse().join(".")}` : null].filter(Boolean).join(" · "),
    extraTitle: "Gescannt, nicht auf der Liste",
    scanAdded: (name, place) => `${name} → ${place}`,
    scanUnknown: (name) => `${name || "Unbekannt"}: neu, wird am Ende angelegt`,
    scanFailed: "Scannen fehlgeschlagen.",
    recurring: "🔁 Wiederkehrend",
    recurringTitle: "Wiederkehrende Einkäufe",
    recurringIntro: "Kommt automatisch auf die Liste – an den gewählten Tagen oder alle paar Tage, morgens um 8 Uhr; nie doppelt, solange es noch offen ist.",
    recurringNone: "Noch nichts eingetragen.",
    name: "Was",
    namePlaceholder: "z. B. Wasserkiste",
    days: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
    every: "oder alle … Tage",
    list: "Liste",
    listDefault: "Standardliste",
    add: "Hinzufügen",
    remove: "Entfernen",
    close: "Schließen",
    needName: "Bitte einen Namen eingeben.",
    needWhen: "Bitte Wochentage oder „alle … Tage“ wählen.",
    when: (e, days) => (e.weekdays && e.weekdays.length ? e.weekdays.map((d) => days[d]).join(", ") : `alle ${e.every_days} Tage`),
  },
  en: {
    title: "Shopping",
    menu: "🛒 Shopping mode",
    startButton: "🛒 Go shopping",
    intro: "Sorted by store section. Ticking an item off completes it on the list and puts it into stock right away, at its usual place.",
    empty: "Nothing on the shopping lists.",
    noList: "Choose a shopping list in the settings first.",
    check: "Tick off",
    added: (r) => `→ ${[r.area, r.compartment].filter(Boolean).join(" · ") || "stock"}${r.added > 1 ? ` (+${r.added})` : ""}`,
    unknown: "new – added at the end",
    loading: "Loading the shopping lists …",
    loadFailed: (msg) => `The shopping lists could not be loaded${msg ? `: ${msg}` : "."}`,
    listFailed: (name, msg) => `${name}: cannot be read (${msg})`,
    listOpen: (name, n) => `${name}: ${n} open`,
    listMissing: (id) => `The shopping list ${id} chosen in the settings does not exist in Home Assistant right now. Please choose it again in the integration's settings.`,
    failed: "Ticking off failed.",
    addUnknown: (n) => (n === 1 ? "＋ Add 1 new item" : `＋ Add ${n} new items`),
    reload: "🔄 Refresh",
    storeWhere: "📍 Where are you?",
    storeAll: "Everywhere",
    storeNew: "Store, e.g. Rewe",
    storeOrder: (name) => `🏪 Sections at ${name}`,
    elsewhere: (n, store) => `Bought elsewhere (${n}) – not at ${store} so far`,
    boughtAt: (stores) => `so far at ${stores}`,
    scan: "📷 Scan",
    receipt: "🧾 Receipt",
    details: "€ / date",
    detailsLabel: "Enter price and best-before date",
    price: "Price (€)",
    bestBefore: "Best before",
    save: "Save",
    detailsDone: (price, date) => [price ? `€${price.toFixed(2)}` : null, date ? `best before ${date}` : null].filter(Boolean).join(" · "),
    extraTitle: "Scanned, not on the list",
    scanAdded: (name, place) => `${name} → ${place}`,
    scanUnknown: (name) => `${name || "Unknown"}: new, added at the end`,
    scanFailed: "Scanning failed.",
    recurring: "🔁 Recurring",
    recurringTitle: "Recurring purchases",
    recurringIntro: "Goes onto the list automatically – on the chosen days or every few days, in the morning at 8; never twice while it is still open.",
    recurringNone: "Nothing yet.",
    name: "What",
    namePlaceholder: "e.g. crate of water",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    every: "or every … days",
    list: "List",
    listDefault: "Default list",
    add: "Add",
    remove: "Remove",
    close: "Close",
    needName: "Please enter a name.",
    needWhen: "Please choose weekdays or “every … days”.",
    when: (e, days) => (e.weekdays && e.weekdays.length ? e.weekdays.map((d) => days[d]).join(", ") : `every ${e.every_days} days`),
  },
  fr: {
    title: "Courses",
    menu: "🛒 Mode courses",
    startButton: "🛒 Faire les courses",
    intro: "Trié par rayon. Cocher un article le termine sur la liste et le met aussitôt en stock, à sa place habituelle.",
    empty: "Rien sur les listes de courses.",
    noList: "Choisissez d'abord une liste de courses dans les paramètres.",
    check: "Cocher",
    added: (r) => `→ ${[r.area, r.compartment].filter(Boolean).join(" · ") || "stock"}${r.added > 1 ? ` (+${r.added})` : ""}`,
    unknown: "nouveau – ajouté à la fin",
    loading: "Chargement des listes de courses …",
    loadFailed: (msg) => `Les listes de courses n'ont pas pu être chargées${msg ? ` : ${msg}` : "."}`,
    listFailed: (name, msg) => `${name} : illisible (${msg})`,
    listOpen: (name, n) => `${name} : ${n} ouverts`,
    listMissing: (id) => `La liste de courses ${id} choisie dans les paramètres n'existe pas dans Home Assistant pour le moment. Choisissez-la à nouveau dans les paramètres de l'intégration.`,
    failed: "Le cochage a échoué.",
    addUnknown: (n) => (n === 1 ? "＋ Ajouter 1 nouvel article" : `＋ Ajouter ${n} nouveaux articles`),
    reload: "🔄 Actualiser",
    storeWhere: "📍 Où êtes-vous ?",
    storeAll: "Partout",
    storeNew: "Magasin, par ex. Carrefour",
    storeOrder: (name) => `🏪 Rayons chez ${name}`,
    elsewhere: (n, store) => `Acheté ailleurs (${n}) – jamais chez ${store} jusqu'ici`,
    boughtAt: (stores) => `jusqu'ici chez ${stores}`,
    scan: "📷 Scanner",
    receipt: "🧾 Ticket",
    details: "€ / date",
    detailsLabel: "Saisir prix et date de péremption",
    price: "Prix (€)",
    bestBefore: "À consommer avant",
    save: "Enregistrer",
    detailsDone: (price, date) => [price ? `${price.toFixed(2).replace(".", ",")} €` : null, date ? `à consommer avant le ${date}` : null].filter(Boolean).join(" · "),
    extraTitle: "Scanné, pas sur la liste",
    scanAdded: (name, place) => `${name} → ${place}`,
    scanUnknown: (name) => `${name || "Inconnu"} : nouveau, ajouté à la fin`,
    scanFailed: "Le scan a échoué.",
    recurring: "🔁 Récurrent",
    recurringTitle: "Achats récurrents",
    recurringIntro: "Arrive automatiquement sur la liste – les jours choisis ou tous les quelques jours, le matin à 8 h ; jamais deux fois tant qu'il est encore ouvert.",
    recurringNone: "Rien pour l'instant.",
    name: "Quoi",
    namePlaceholder: "par ex. pack d'eau",
    days: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
    every: "ou tous les … jours",
    list: "Liste",
    listDefault: "Liste par défaut",
    add: "Ajouter",
    remove: "Retirer",
    close: "Fermer",
    needName: "Veuillez saisir un nom.",
    needWhen: "Choisissez des jours de la semaine ou « tous les … jours ».",
    when: (e, days) => (e.weekdays && e.weekdays.length ? e.weekdays.map((d) => days[d]).join(", ") : `tous les ${e.every_days} jours`),
  },
  nl: {
    title: "Boodschappen",
    menu: "🛒 Winkelmodus",
    startButton: "🛒 Boodschappen doen",
    intro: "Gesorteerd op winkelafdeling. Afvinken rondt het artikel af op de lijst en zet het meteen in de voorraad, op de gebruikelijke plek.",
    empty: "Niets op de boodschappenlijsten.",
    noList: "Kies eerst een boodschappenlijst in de instellingen.",
    check: "Afvinken",
    added: (r) => `→ ${[r.area, r.compartment].filter(Boolean).join(" · ") || "voorraad"}${r.added > 1 ? ` (+${r.added})` : ""}`,
    unknown: "nieuw – achteraan toegevoegd",
    loading: "Boodschappenlijsten worden geladen …",
    loadFailed: (msg) => `De boodschappenlijsten konden niet worden geladen${msg ? `: ${msg}` : "."}`,
    listFailed: (name, msg) => `${name}: niet leesbaar (${msg})`,
    listOpen: (name, n) => `${name}: ${n} open`,
    listMissing: (id) => `De in de instellingen gekozen boodschappenlijst ${id} bestaat nu niet in Home Assistant. Kies hem opnieuw in de instellingen van de integratie.`,
    failed: "Afvinken mislukt.",
    addUnknown: (n) => (n === 1 ? "＋ 1 nieuw artikel toevoegen" : `＋ ${n} nieuwe artikelen toevoegen`),
    reload: "🔄 Vernieuwen",
    storeWhere: "📍 Waar ben je?",
    storeAll: "Overal",
    storeNew: "Winkel, bijv. Albert Heijn",
    storeOrder: (name) => `🏪 Afdelingen bij ${name}`,
    elsewhere: (n, store) => `Elders gekocht (${n}) – tot nu toe niet bij ${store}`,
    boughtAt: (stores) => `tot nu toe bij ${stores}`,
    scan: "📷 Scannen",
    receipt: "🧾 Kassabon",
    details: "€ / datum",
    detailsLabel: "Prijs en houdbaarheidsdatum invoeren",
    price: "Prijs (€)",
    bestBefore: "Houdbaar tot",
    save: "Opslaan",
    detailsDone: (price, date) => [price ? `€ ${price.toFixed(2).replace(".", ",")}` : null, date ? `houdbaar tot ${date}` : null].filter(Boolean).join(" · "),
    extraTitle: "Gescand, niet op de lijst",
    scanAdded: (name, place) => `${name} → ${place}`,
    scanUnknown: (name) => `${name || "Onbekend"}: nieuw, achteraan toegevoegd`,
    scanFailed: "Scannen mislukt.",
    recurring: "🔁 Terugkerend",
    recurringTitle: "Terugkerende aankopen",
    recurringIntro: "Komt vanzelf op de lijst – op de gekozen dagen of om de paar dagen, 's ochtends om 8 uur; nooit twee keer zolang het nog open staat.",
    recurringNone: "Nog niets.",
    name: "Wat",
    namePlaceholder: "bijv. krat water",
    days: ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"],
    every: "of elke … dagen",
    list: "Lijst",
    listDefault: "Standaardlijst",
    add: "Toevoegen",
    remove: "Verwijderen",
    close: "Sluiten",
    needName: "Vul een naam in.",
    needWhen: "Kies weekdagen of „elke … dagen”.",
    when: (e, days) => (e.weekdays && e.weekdays.length ? e.weekdays.map((d) => days[d]).join(", ") : `elke ${e.every_days} dagen`),
  },
};

export function shoppingTexts(hass) {
  return pickLang(TEXT, hass);
}

export function installShopping(Dashboard, { el, DOMAIN, todoLists, sectionNames }) {
  const proto = Dashboard.prototype;
  const button = (cls, text, onClick) => {
    const b = el("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };

  const STORE_KEY = `${DOMAIN}.shop_store`;

  /** Choose the store you are in (null = everywhere); remembered on this device. */
  proto.setShopStore = function setShopStore(name) {
    this._shopStore = name || null;
    try {
      if (this._shopStore) window.localStorage.setItem(STORE_KEY, this._shopStore);
      else window.localStorage.removeItem(STORE_KEY);
    } catch {
      /* private mode: only for now */
    }
    this.loadShopping();
  };

  /** Chips "Everywhere · Rewe · Aldi · ＋" and the store's sections. */
  proto._storeBar = function _storeBar(data, t) {
    const bar = el("div", "storebar");
    bar.dataset.role = "shop-stores";
    bar.append(el("span", "lbl", t.storeWhere));
    const current = data.store || null;
    const chip = (label, name) => {
      const b = button(name === current || (!name && !current) ? "chip on" : "chip", label, () => this.setShopStore(name));
      b.dataset.store = name || "";
      return b;
    };
    bar.append(chip(t.storeAll, null));
    for (const store of data.stores || []) bar.append(chip(store.name, store.name));
    const add = button("chip", "＋", () => {
      const input = el("input");
      input.type = "text";
      input.maxLength = 60;
      input.placeholder = t.storeNew;
      input.dataset.role = "shop-store-new";
      input.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter" || !input.value.trim()) return;
        ev.preventDefault();
        try {
          await this._hass.callWS({ type: `${DOMAIN}/store_save`, name: input.value.trim() });
        } catch {
          return;
        }
        this.setShopStore(input.value.trim());
      });
      add.replaceWith(input);
      input.focus();
    });
    add.dataset.role = "shop-store-add";
    add.setAttribute("aria-label", t.storeNew);
    bar.append(add);
    if (current && this.openSectionsDialog) {
      const store = (data.stores || []).find((s) => s.name === current) || { name: current };
      const order = button("link", t.storeOrder(current), () => this.openSectionsDialog(store, () => this.loadShopping()));
      order.dataset.role = "shop-store-order";
      bar.append(order);
    }
    return bar;
  };

  proto.shoppingTitle = function shoppingTitle() {
    return shoppingTexts(this._hass).title;
  };

  proto.loadShopping = async function loadShopping() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      // 5.9 (#140): "I am at …" – only what is bought there, in that store's order
      if (this._shopStore === undefined) {
        try {
          this._shopStore = window.localStorage.getItem(STORE_KEY) || null;
        } catch {
          this._shopStore = null;
        }
      }
      this._shopping = await hass.callWS(this._shopStore ? { type: `${DOMAIN}/shopping_mode`, store: this._shopStore } : { type: `${DOMAIN}/shopping_mode` });
    } catch (err) {
      this._shopping = { items: [], error: (err && err.message) || true };
    }
    this._shopDone = {};
    this._shopUnknown = [];
    this._shopExtra = [];
    this._sig = "";
    this._update();
  };

  proto._shopCheck = async function _shopCheck(item) {
    const t = shoppingTexts(this._hass);
    if (this._shopDone[item.uid]) return;
    this._shopDone[item.uid] = { busy: true };
    this._sig = "";
    this._update();
    try {
      const res = await this._hass.callWS({ type: `${DOMAIN}/shopping_check`, list: item.list, uid: item.uid, summary: item.summary });
      if (res.status === "unknown") {
        this._shopUnknown.push({ content: res.name });
        this._shopDone[item.uid] = { text: t.unknown };
      } else {
        this._shopDone[item.uid] = { text: t.added(res), device_id: res.device_id, added: res.added || 1, suggest: res.suggest };
      }
    } catch {
      delete this._shopDone[item.uid];
      this.showNotice(t.failed);
    }
    this._sig = "";
    this._update();
  };

  proto.shoppingSig = function shoppingSig() {
    return [this._shopping, this._shopDone, this._shopUnknown, this._shopExtra];
  };

  /** 4.11: a barcode scanned in the store – ticks off the matching item, else into stock or collected. */
  proto._shopScan = async function _shopScan(code) {
    const t = shoppingTexts(this._hass);
    const value = String(code || "").trim();
    if (!value) return "";
    let res;
    try {
      res = await this._hass.callWS({ type: `${DOMAIN}/shopping_scan`, code: value });
    } catch {
      return t.scanFailed;
    }
    const place = (r) => [r.area, r.compartment].filter(Boolean).join(" · ");
    let message;
    if (res.status === "unknown") {
      if (!this._shopUnknown.some((u) => u.code && u.code === res.code)) {
        this._shopUnknown.push({ content: res.name || "", code: res.code, product: res.product || null });
      }
      message = t.scanUnknown(res.name);
    } else if (res.matched) {
      this._shopDone[res.uid] = { text: t.added(res), device_id: res.device_id, added: res.added || 1, suggest: res.suggest };
      message = t.scanAdded(res.content, place(res));
    } else {
      this._shopExtra.push({ content: res.content, text: t.added(res), device_id: res.device_id, added: res.added || 1, suggest: res.suggest, key: `x${this._shopExtra.length}` });
      message = t.scanAdded(res.content, place(res));
    }
    this._sig = "";
    this._update();
    return message;
  };

  /** Price and best-before date for what was just put into stock (inline under the item). */
  /** Price and best-before date of what was just put into stock (shopping mode, put away, barcode dialog). */
  proto._shopDetails = function _shopDetails(done, row, onSaved = null) {
    const hass = this._hass;
    const t = shoppingTexts(hass);
    const box = el("div", "shopdetails");
    const price = el("input");
    price.type = "text";
    price.inputMode = "decimal";
    price.placeholder = t.price;
    price.setAttribute("aria-label", t.price);
    price.dataset.f = "shop-price";
    const date = el("input");
    date.type = "date";
    date.setAttribute("aria-label", t.bestBefore);
    date.dataset.f = "shop-date";
    // 6.1 (#168): suggested from earlier purchases of exactly this product (or the table for fresh food)
    if (done.suggest && done.suggest.best_before) {
      date.value = done.suggest.best_before;
      date.classList.add("suggested");
      date.title = `💡 ${done.suggest.days}`;
      date.addEventListener("input", () => date.classList.remove("suggested"));
    }
    const save = button("primary", t.save, async () => {
      const msg = { type: `${DOMAIN}/shopping_details`, device_id: done.device_id, added: done.added || 1 };
      const amount = parseFloat(String(price.value).replace(",", "."));
      if (amount > 0) msg.price = Math.round(amount * 100) / 100;
      if (date.value) msg.best_before = date.value;
      if (msg.price && this._view === "shopping" && this._shopStore) msg.store = this._shopStore; // 5.9: price at this store
      if (!msg.price && !msg.best_before) return;
      save.disabled = true;
      try {
        const res = await hass.callWS(msg);
        if (res && res.device_id) done.device_id = res.device_id;
        done.details = t.detailsDone(msg.price, msg.best_before);
      } catch {
        save.disabled = false;
        return;
      }
      done.editing = false;
      if (onSaved) {
        box.remove();
        onSaved(done);
        return;
      }
      this._sig = "";
      this._update();
    });
    save.dataset.role = "shop-details-save";
    // household items have no best-before date to enter here; 📷 reads the printed date (5.1)
    const photo = done.kind === "household" ? null : this._datePhotoButton(date);
    box.append(...[price, done.kind === "household" ? null : date, photo, save].filter(Boolean));
    row.after(box);
    return box;
  };

  proto.openReceipt = function openReceipt() {
    this.openItemsDialog("pack");
    const file = this._form.querySelector('[data-role="receipt-file"]');
    if (file) file.click();
  };

  proto.canReadReceipt = function canReadReceipt() {
    return !!(this._canGenerate() && this._hass && this._hass.fetchWithAuth);
  };

  proto._renderShopping = function _renderShopping() {
    const hass = this._hass;
    const t = shoppingTexts(hass);
    const names = sectionNames(hass);
    const data = this._shopping;
    const frag = document.createDocumentFragment();
    const bar = el("div", "bar");
    const recurring = button("", t.recurring, () => this.openRecurringDialog());
    recurring.dataset.role = "shop-recurring";
    const reload = button("", t.reload, () => this.loadShopping());
    reload.dataset.role = "shop-reload";
    bar.append(el("span", "grow"));
    if (this._classic._hasBarcodeScanner && this._classic._hasBarcodeScanner()) {
      const scan = button("", t.scan, () => this._classic.scanBarcodeSeries((code) => this._shopScan(code)));
      scan.dataset.role = "shop-scan";
      bar.append(scan);
    }
    if (this.canReadReceipt()) {
      const receipt = button("", t.receipt, () => this.openReceipt());
      receipt.dataset.role = "shop-receipt";
      bar.append(receipt);
    }
    bar.append(recurring, reload);
    frag.append(bar);
    if (!data) {
      frag.append(el("p", "hint", t.loading));
      this._main.replaceChildren(frag);
      return;
    }
    frag.append(el("p", "lead", t.intro));
    if (!data.error) frag.append(this._storeBar(data, t));
    const all = data.items || [];
    // 5.9: at a store, what is only bought elsewhere goes to the end (folded)
    const items = data.store ? all.filter((i) => i.here !== false) : all;
    const elsewhere = data.store ? all.filter((i) => i.here === false) : [];
    if (data.error) {
      // 5.3.2: say why instead of an empty page
      const error = el("p", "note warn", t.loadFailed(data.error === true ? "" : data.error));
      error.dataset.role = "shop-error";
      frag.append(error);
    } else if (data.missing) {
      const missing = el("p", "note warn", t.listMissing(data.missing));
      missing.dataset.role = "shop-missing";
      frag.append(missing);
    } else if (!items.length) {
      frag.append(el("p", "note", data.configured === false || this._listChosen === false ? t.noList : t.empty));
    }
    // which lists were read: open items or why one could not be read
    const status = (data.lists || []).filter((l) => l.error || !items.length);
    if (status.length) {
      const box = el("div", "shoplists");
      box.dataset.role = "shop-lists";
      for (const l of status) box.append(el("p", `hint${l.error ? " warn" : ""}`, l.error ? t.listFailed(l.name, l.error) : t.listOpen(l.name, l.open)));
      frag.append(box);
    }
    const lists = new Set(items.map((i) => i.list));
    let current = null;
    let box = null;
    for (const item of items) {
      if (item.section !== current) {
        current = item.section;
        box = el("section", "stat shop");
        box.dataset.section = current;
        box.append(el("h3", "", names[current] || current));
        frag.append(box);
      }
      const done = this._shopDone[item.uid];
      const row = el("div", `boughtrow${done && !done.busy ? " done" : ""}`);
      row.dataset.uid = item.uid;
      const check = button(done ? "on" : "", done ? "✓" : "○", () => this._shopCheck(item));
      check.dataset.role = "shop-check";
      check.setAttribute("aria-label", t.check);
      check.disabled = !!done;
      const text = el("span", "name");
      text.append(el("span", "", item.summary));
      const where = !data.store && item.stores && item.stores.length ? `💶 ${item.stores[0]}` : null; // cheapest store
      const sub = [done && done.text, where, lists.size > 1 ? item.list_name : null].filter(Boolean).join(" · ");
      if (sub) text.append(el("span", "sub", sub));
      row.append(check, text);
      if (done && done.device_id) {
        if (done.details) text.append(el("span", "sub", done.details));
        const details = button("link", t.details, () => this._shopDetails(done, row));
        details.dataset.role = "shop-details";
        details.setAttribute("aria-label", t.detailsLabel);
        row.append(details);
      }
      box.append(row);
    }
    if (elsewhere.length) {
      const other = el("details", "stat shop elsewhere");
      other.dataset.role = "shop-elsewhere";
      other.append(el("summary", "", t.elsewhere(elsewhere.length, data.store)));
      for (const item of elsewhere) {
        const row = el("div", "boughtrow");
        row.dataset.uid = item.uid;
        const text = el("span", "name");
        text.append(el("span", "", item.summary), el("span", "sub", t.boughtAt(item.stores.join(", "))));
        const check = button("", "○", () => this._shopCheck(item));
        check.dataset.role = "shop-check";
        check.setAttribute("aria-label", t.check);
        row.append(check, text);
        other.append(row);
      }
      frag.append(other);
    }
    if (this._shopExtra.length) {
      const extra = el("section", "stat shop");
      extra.dataset.role = "shop-extra";
      extra.append(el("h3", "", t.extraTitle));
      for (const done of this._shopExtra) {
        const row = el("div", "boughtrow done");
        row.dataset.uid = done.key;
        const text = el("span", "name");
        text.append(el("span", "", done.content), el("span", "sub", [done.text, done.details].filter(Boolean).join(" · ")));
        const details = button("link", t.details, () => this._shopDetails(done, row));
        details.dataset.role = "shop-details";
        row.append(el("span", "", "✓"), text, details);
        extra.append(row);
      }
      frag.append(extra);
    }
    if (this._shopUnknown.length) {
      // 5.0 (#121): like put away – food packs and household items separately
      frag.append(...this._unknownButtons(this._shopUnknown, "shop-add-unknown", () => (this._shopUnknown = []), t.addUnknown));
    }
    this._main.replaceChildren(frag);
  };

  /** Recurring purchases: list with ✕, add with weekdays or every n days and a list. */
  proto.openRecurringDialog = async function openRecurringDialog() {
    const hass = this._hass;
    const t = shoppingTexts(hass);
    let items = [];
    try {
      items = (await hass.callWS({ type: `${DOMAIN}/recurring` })).items || [];
    } catch {
      items = [];
    }
    const listBox = el("div", "recurringlist");
    const draw = () => {
      listBox.replaceChildren();
      if (!items.length) listBox.append(el("p", "note", t.recurringNone));
      for (const e of items) {
        const row = el("div", "boughtrow");
        row.dataset.key = e.key;
        const text = el("span", "name");
        text.append(el("span", "", e.name), el("span", "sub", t.when(e, t.days)));
        const remove = button("", "✕", async () => {
          items = (await hass.callWS({ type: `${DOMAIN}/recurring_delete`, key: e.key })).items || [];
          draw();
        });
        remove.dataset.role = "recurring-remove";
        remove.setAttribute("aria-label", t.remove);
        row.append(text, remove);
        listBox.append(row);
      }
    };
    draw();
    const name = el("input");
    name.type = "text";
    name.maxLength = 120;
    name.placeholder = t.namePlaceholder;
    name.dataset.f = "recurring-name";
    const chosen = new Set();
    const days = el("div", "chips");
    t.days.forEach((label, i) => {
      const chip = button("daychip", label, () => {
        if (chosen.has(i)) chosen.delete(i);
        else chosen.add(i);
        chip.classList.toggle("on", chosen.has(i));
      });
      chip.dataset.day = String(i);
      days.append(chip);
    });
    const every = el("input");
    every.type = "number";
    every.min = "1";
    every.max = "365";
    every.inputMode = "numeric";
    every.dataset.f = "recurring-every";
    const list = el("select");
    list.dataset.f = "recurring-list";
    for (const l of [{ id: "", name: t.listDefault }, ...(todoLists ? todoLists(hass) : [])]) {
      const o = el("option", "", l.name);
      o.value = l.id;
      list.append(o);
    }
    const label = (text, control) => {
      const wrap = el("label", "", text);
      wrap.append(control);
      return wrap;
    };
    const error = el("div", "error");
    const add = button("primary", t.add, async () => {
      error.textContent = "";
      const msg = { type: `${DOMAIN}/recurring_set`, name: name.value.trim() };
      if (!msg.name) {
        error.textContent = t.needName;
        return;
      }
      if (chosen.size) msg.weekdays = [...chosen].sort();
      else if (parseInt(every.value, 10) > 0) msg.every_days = parseInt(every.value, 10);
      else {
        error.textContent = t.needWhen;
        return;
      }
      if (list.value) msg.list = list.value;
      items = (await hass.callWS(msg)).items || [];
      name.value = "";
      every.value = "";
      chosen.clear();
      for (const chip of days.children) chip.classList.remove("on");
      draw();
    });
    add.dataset.role = "recurring-add";
    const buttons = el("div", "buttons");
    buttons.append(button("cancel", t.close, () => this._closeDialog()));
    this._form.replaceChildren(
      el("h2", "", t.recurringTitle),
      el("p", "hint", t.recurringIntro),
      listBox,
      label(t.name, name),
      days,
      label(t.every, every),
      label(t.list, list),
      error,
      add,
      buttons,
    );
    this._submit = null;
    this._overlay.hidden = false;
  };
}
