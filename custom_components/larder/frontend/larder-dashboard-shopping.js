/**
 * Larder dashboard (4.10): shopping mode – the shopping lists by store section; ticking an item off puts it into
 * stock at its usual place – and recurring purchases (a crate of water every Friday).
 *
 * `installShopping` attaches the methods to the dashboard class (like larder-dashboard-items.js).
 */

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
};

export function shoppingTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

export function installShopping(Dashboard, { el, DOMAIN, todoLists, sectionNames }) {
  const proto = Dashboard.prototype;
  const button = (cls, text, onClick) => {
    const b = el("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };

  proto.shoppingTitle = function shoppingTitle() {
    return shoppingTexts(this._hass).title;
  };

  proto.loadShopping = async function loadShopping() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._shopping = await hass.callWS({ type: `${DOMAIN}/shopping_mode` });
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
        this._shopDone[item.uid] = { text: t.added(res), device_id: res.device_id, added: res.added || 1 };
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
      this._shopDone[res.uid] = { text: t.added(res), device_id: res.device_id, added: res.added || 1 };
      message = t.scanAdded(res.content, place(res));
    } else {
      this._shopExtra.push({ content: res.content, text: t.added(res), device_id: res.device_id, added: res.added || 1, key: `x${this._shopExtra.length}` });
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
    const save = button("primary", t.save, async () => {
      const msg = { type: `${DOMAIN}/shopping_details`, device_id: done.device_id, added: done.added || 1 };
      const amount = parseFloat(String(price.value).replace(",", "."));
      if (amount > 0) msg.price = Math.round(amount * 100) / 100;
      if (date.value) msg.best_before = date.value;
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
    const items = data.items || [];
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
      const sub = [done && done.text, lists.size > 1 ? item.list_name : null].filter(Boolean).join(" · ");
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
