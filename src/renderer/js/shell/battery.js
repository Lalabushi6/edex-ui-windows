// Battery panel (top bar): charge, time left, power source, and health from
// Windows' battery report (full-charge vs design capacity, charge cycles).
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { popover } from "../core/ui.js";

const api = window.edex;

const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const row = (label, value, title) => h("div", { class: "bat-row", title: title || "" }, h("span", { class: "muted" }, label), h("span", null, value));

export function openBatteryPanel(anchor) {
  if (anchor.classList.contains("open")) return;
  anchor.classList.add("open");
  popover(anchor, (close) => {
    const now = h("div", { class: "bat-now" }, h("div", { class: "empty" }, "Reading battery…"));
    const health = h("div", { class: "bat-health" }, h("div", { class: "empty" }, "Reading battery report…"));
    api.sys.battery().then((b) => {
      if (!b?.hasBattery) { now.replaceChildren(h("div", { class: "empty" }, "No battery")); return; }
      const pct = Math.round(b.percent);
      now.replaceChildren(...[
        h("div", { class: "bat-big" }, icon(b.charging ? "bolt" : "battery"), h("b", null, `${pct}%`),
          h("span", { class: "muted" }, b.charging ? "charging" : b.ac ? "plugged in" : "on battery")),
        h("div", { class: "bar" }, h("i", { style: { width: `${pct}%` } })),
        !b.ac && b.timeRemaining && row("Time left", mins(b.timeRemaining)),
        row("Battery saver", b.saver ? "on" : "off")].filter(Boolean));
    }).catch(() => now.replaceChildren(h("div", { class: "empty" }, "Battery unavailable")));
    api.tools.batteryHealth().then((r) => {
      if (!r?.present) { health.replaceChildren(h("div", { class: "empty" }, "No battery report available")); return; }
      const fmtWh = (mwh) => `${(mwh / 1000).toFixed(1)} Wh`;
      const verdict = r.health == null ? "" : r.health >= 80 ? "good" : r.health >= 60 ? "worn" : "replace soon";
      health.replaceChildren(...[
        h("div", { class: "bat-section" }, "HEALTH"),
        r.health != null && h("div", { class: "bat-big small" }, h("b", null, `${r.health}%`), h("span", { class: `muted bat-verdict ${verdict.replace(" ", "-")}` }, verdict)),
        r.health != null && h("div", { class: "bar" }, h("i", { style: { width: `${Math.min(100, r.health)}%` } })),
        row("Full charge", r.full ? fmtWh(r.full) : "—", "What the battery holds now"),
        row("Design capacity", r.design ? fmtWh(r.design) : "—", "What it held when new"),
        r.cycles != null && row("Charge cycles", String(r.cycles)),
        (r.chemistry || r.manufacturer) && row("Battery", [r.manufacturer, r.chemistry].filter(Boolean).join(" · "))].filter(Boolean));
    }).catch(() => health.replaceChildren(h("div", { class: "empty" }, "Battery report unavailable")));
    return h("div", { class: "bat-panel" },
      h("div", { class: "bat-title" }, icon("battery"), h("span", { class: "grow" }, "BATTERY")),
      now, health,
      h("div", { class: "bat-foot" },
        h("button", { class: "btn sm", type: "button", onclick: () => { close(); api.shell.openSettings("ms-settings:batterysaver").catch(() => {}); } }, icon("gear"), "Power settings")));
  }, { className: "bat-pop", onClose: () => anchor.classList.remove("open") });
}
