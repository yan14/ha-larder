/**
 * Larder dashboard (5.1): product history, recently used products and the best-before date from a photo.
 *
 * * **Product history** (#126): every container, bag and pack with the same contents over time, with figures
 *   and a hint. Opened from the card, the stock view, the barcode dialog and the search.
 * * **Recently used** (#125): chips in ＋ and in the search; one tap adds one pack again at its usual place.
 * * **📷 next to the date** (#123): the AI reads the printed best-before date.
 * `installHistory` attaches the methods to the dashboard class (like larder-dashboard-items.js).
 */

const TEXT = {
  de: {
    title: (name) => `Verlauf: ${name}`,
    none: "Noch kein Verlauf – er entsteht, sobald etwas davon geleert, verbraucht oder weggeworfen wird.",
    perYear: (n) => (n === 1 ? "1× im letzten Jahr" : `${n}× im letzten Jahr`),
    avgDays: (n) => `hält im Schnitt ${n} ${n === 1 ? "Tag" : "Tage"}`,
    thrown: (n, of) => `${n} von ${of} weggeworfen`,
    thrownValue: (v) => `ca. ${v} weggeworfen`,
    since: (d) => `seit ${d}`,
    prices: "Preise",
    hints: {
      thrown_often: (h) => `💡 ${h.thrown} von ${h.of} Mal weggeworfen – lieber kleinere Mengen kaufen oder einfrieren?`,
      usually_days: (h) => `💡 Wird meist nach etwa ${h.days} Tagen aufgebraucht.`,
    },
    outcome: { eaten: "😋 gegessen", thrown: "🗑 weggeworfen" },
    emptied: "geleert",
    stored: (n) => `${n} ${n === 1 ? "Tag" : "Tage"} gelagert`,
    close: "Schließen",
    link: "📜 Verlauf",
    recent: "Zuletzt verwendet",
    recentAdded: (name, place) => `${name} → ${place}`,
    noArea: "ohne Bereich",
    datePhoto: "MHD vom Foto lesen",
    dateBusy: "MHD wird gelesen …",
    dateFailed: "Kein MHD auf dem Foto erkannt.",
  },
  en: {
    title: (name) => `History: ${name}`,
    none: "No history yet – it starts once some of it is emptied, used up or thrown away.",
    perYear: (n) => `${n}× in the last year`,
    avgDays: (n) => `lasts ${n} ${n === 1 ? "day" : "days"} on average`,
    thrown: (n, of) => `${n} of ${of} thrown away`,
    thrownValue: (v) => `about ${v} thrown away`,
    since: (d) => `since ${d}`,
    prices: "Prices",
    hints: {
      thrown_often: (h) => `💡 Thrown away ${h.thrown} of ${h.of} times – buy smaller amounts or freeze some?`,
      usually_days: (h) => `💡 Usually used up after about ${h.days} days.`,
    },
    outcome: { eaten: "😋 eaten", thrown: "🗑 thrown away" },
    emptied: "emptied",
    stored: (n) => `stored ${n} ${n === 1 ? "day" : "days"}`,
    close: "Close",
    link: "📜 History",
    recent: "Recently used",
    recentAdded: (name, place) => `${name} → ${place}`,
    noArea: "no area",
    datePhoto: "Read the date from a photo",
    dateBusy: "Reading the date …",
    dateFailed: "No best-before date recognised in the photo.",
  },
};

export function historyTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

export function installHistory(Dashboard, { el, DOMAIN, money }) {
  const proto = Dashboard.prototype;
  const button = (cls, label, onClick) => {
    const b = el("button", cls, label);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };
  const isDe = (hass) => String((hass && hass.language) || "").toLowerCase().startsWith("de");
  const fmtDay = (hass, value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(isDe(hass) ? "de-DE" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  /** A link "📜 History" for a product (stock view, barcode dialog). */
  proto._historyLink = function _historyLink(content, role) {
    const link = button("link", historyTexts(this._hass).link, () => this.openProductHistory(content));
    link.dataset.role = role;
    return link;
  };

  proto.openProductHistory = async function openProductHistory(content) {
    const hass = this._hass;
    const t = historyTexts(hass);
    let res;
    try {
      res = await hass.callWS({ type: `${DOMAIN}/product_history`, content });
    } catch {
      res = { name: content, records: [], summary: { count: 0 } };
    }
    const de = isDe(hass);
    const parts = [el("h2", "", t.title(res.name || content))];
    const s = res.summary || {};
    if (!s.count) {
      parts.push(el("p", "hint", t.none));
    } else {
      const answered = (s.eaten || 0) + (s.thrown || 0);
      const facts = [
        t.perYear(s.per_year || 0),
        s.avg_days !== null && s.avg_days !== undefined ? t.avgDays(s.avg_days) : null,
        answered ? t.thrown(s.thrown || 0, answered) : null,
        s.thrown_value ? t.thrownValue(money(s.thrown_value, de)) : null,
      ].filter(Boolean);
      const box = el("div", "historyfacts");
      box.dataset.role = "history-facts";
      for (const fact of facts) box.append(el("span", "fact", fact));
      parts.push(box);
      if (res.hint && t.hints[res.hint.key]) {
        const hint = el("p", "note", t.hints[res.hint.key](res.hint));
        hint.dataset.role = "history-hint";
        parts.push(hint);
      }
    }
    if (res.price_history && res.price_history.length > 1) {
      const line = el("p", "sub", `${t.prices}: ${res.price_history.map((p) => money(p.price, de)).join(" → ")}`);
      line.dataset.role = "history-prices";
      parts.push(line);
    }
    if (res.records && res.records.length) {
      const list = el("ul", "historylist");
      list.dataset.role = "history-records";
      for (const r of res.records) {
        const item = el("li");
        const place = [r.area, r.compartment].filter(Boolean).join(" · ") || t.noArea;
        const what = r.outcome ? t.outcome[r.outcome] : t.emptied;
        item.append(
          el("span", "name", `${fmtDay(hass, r.emptied)} · ${what}`),
          el("span", "sub", [r.name, place, r.days_stored !== null && r.days_stored !== undefined ? t.stored(r.days_stored) : null].filter(Boolean).join(" · ")),
        );
        list.append(item);
      }
      parts.push(list);
    }
    const close = button("cancel", t.close, () => this._closeDialog());
    const row = el("div", "buttons");
    row.append(close);
    parts.push(row);
    this._form.replaceChildren(...parts);
    this._submit = null;
    this._overlay.hidden = false;
    return res;
  };

  /** Chips of the recently used products; one tap adds one pack at its usual place. */
  proto._recentChips = async function _recentChips(box) {
    const hass = this._hass;
    const t = historyTexts(hass);
    let items = [];
    try {
      items = ((await hass.callWS({ type: `${DOMAIN}/recent_products` })) || {}).items || [];
    } catch {
      items = [];
    }
    if (!items.length || !box.isConnected) return [];
    const chips = el("div", "recentchips");
    for (const item of items) {
      const chip = button("chip", `＋ ${item.content}`, async () => {
        chip.disabled = true;
        let res;
        try {
          res = await hass.callWS({ type: `${DOMAIN}/recent_add`, content: item.content });
        } catch {
          res = null;
        }
        chip.disabled = false;
        if (res && res.status === "added") this._codeAdded(res);
      });
      chip.dataset.role = "recent-chip";
      chip.title = [item.area, item.compartment].filter(Boolean).join(" · ");
      chips.append(chip);
    }
    box.replaceChildren(el("h3", "", t.recent), chips);
    return items;
  };

  /** Whether the AI can read a date from a photo (like the receipt: administrators with an AI Task). */
  proto.canReadDate = function canReadDate() {
    return !!(this.canReadReceipt && this.canReadReceipt());
  };

  /** 📷 next to a date field: the AI reads the printed date, the field is filled in (a "change" follows). */
  proto._datePhotoButton = function _datePhotoButton(input, status = null) {
    if (!this.canReadDate()) return null;
    const hass = this._hass;
    const t = historyTexts(hass);
    const file = el("input");
    file.type = "file";
    file.accept = "image/*";
    file.setAttribute("capture", "environment");
    file.hidden = true;
    file.dataset.role = "date-photo-file";
    const btn = button("icon", "📷", () => file.click());
    btn.dataset.role = "date-photo";
    btn.title = t.datePhoto;
    btn.setAttribute("aria-label", t.datePhoto);
    const say = (text) => {
      if (status) status.textContent = text;
      else if (text) this.showNotice(text);
    };
    file.addEventListener("change", async () => {
      const photo = file.files && file.files[0];
      file.value = "";
      if (!photo) return;
      btn.disabled = true;
      say(t.dateBusy);
      try {
        const body = new FormData();
        body.append("file", photo, photo.name || "date.jpg");
        const res = await hass.fetchWithAuth(`/api/${DOMAIN}/date_photo`, { method: "POST", body });
        const data = await res.json();
        if (!res.ok || !data.date) throw new Error(data.message || t.dateFailed);
        input.value = data.date;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        say("");
      } catch (err) {
        say((err && err.message) || t.dateFailed);
      } finally {
        btn.disabled = false;
      }
    });
    const wrap = el("span", "datephoto");
    wrap.append(btn, file);
    return wrap;
  };
}
