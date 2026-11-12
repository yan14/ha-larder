// Tests für "Larder experimental": seit 2.0 eine Ableitung des Dashboards (Spielwiese für neue Ideen).
process.env.TZ = "Europe/Berlin";

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "customElements", "Event", "CustomEvent"]) {
  globalThis[key] = dom.window[key];
}

const { LarderExperimental } = await import("../../custom_components/larder/frontend/larder-experimental.js");
const { LarderDashboard } = await import("../../custom_components/larder/frontend/larder-dashboard.js");

test("Larder experimental erbt vom Dashboard und zeigt seinen eigenen Titel", async () => {
  assert.ok(LarderExperimental.prototype instanceof LarderDashboard);
  assert.equal(customElements.get("larder-experimental"), LarderExperimental);
  assert.equal(customElements.get("larder-dashboard"), LarderDashboard);
  const el = document.createElement("larder-experimental");
  document.body.appendChild(el);
  el.hass = {
    entities: {}, devices: {}, areas: {}, states: {}, language: "de", user: { is_admin: true, name: "Yan" }, services: {},
    callWS: async () => ({}), hassUrl: (p) => p,
  };
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.shadowRoot.querySelector("h1").textContent, "Larder experimental");
});
