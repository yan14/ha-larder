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
    failed: "Abhaken fehlgeschlagen.",
    addUnknown: (n) => (n === 1 ? "＋ 1 neuen Artikel anlegen" : `＋ ${n} neue Artikel anlegen`),
    reload: "🔄 Aktualisieren",
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
    failed: "Ticking off failed.",
    addUnknown: (n) => (n === 1 ? "＋ Add 1 new item" : `＋ Add ${n} new items`),
    reload: "🔄 Refresh",
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
    } catch {
      this._shopping = { items: [], error: true };
    }
    this._shopDone = {};
    this._shopUnknown = [];
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
        this._shopUnknown.push(res.name);
        this._shopDone[item.uid] = { text: t.unknown };
      } else {
        this._shopDone[item.uid] = { text: t.added(res) };
      }
    } catch {
      delete this._shopDone[item.uid];
      this.showNotice(t.failed);
    }
    this._sig = "";
    this._update();
  };

  proto.shoppingSig = function shoppingSig() {
    return [this._shopping, this._shopDone, this._shopUnknown];
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
    bar.append(el("span", "grow"), recurring, reload);
    frag.append(bar);
    if (!data) {
      this._main.replaceChildren(frag);
      return;
    }
    frag.append(el("p", "lead", t.intro));
    const items = data.items || [];
    if (!items.length) frag.append(el("p", "note", this._listChosen === false ? t.noList : t.empty));
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
      box.append(row);
    }
    if (this._shopUnknown.length) {
      const rows = this._shopUnknown.map((content) => ({ content, quantity: 1 }));
      const add = button("primary", t.addUnknown(rows.length), () => {
        this._shopUnknown = [];
        this.openItemsDialog("pack", { rows });
      });
      add.dataset.role = "shop-add-unknown";
      frag.append(add);
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
