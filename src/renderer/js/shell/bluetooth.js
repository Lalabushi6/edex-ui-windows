// Bluetooth panel (top bar): radio on / off and paired devices with their
// connection state. Pairing and connecting happen in Windows' Bluetooth
// settings (Windows has no public API for connecting a paired device).
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { popover, toast, cleanError } from "../core/ui.js";

const api = window.edex;
const KIND_ICON = { AudioVideo: "audio", Phone: "phone", Computer: "desktop", Peripheral: "keyboard", LowEnergy: "bluetooth" };

export function openBluetoothPanel(anchor, onState) {
  if (anchor.classList.contains("open")) return;
  anchor.classList.add("open");
  popover(anchor, (close) => {
    const toggle = h("input", { type: "checkbox", class: "switch", title: "Bluetooth on / off", "aria-label": "Bluetooth" });
    const list = h("div", { class: "bt-list" }, h("div", { class: "empty" }, "Looking for devices…"));
    const refreshBtn = h("button", { class: "icon-btn sm", type: "button", title: "Refresh" }, icon("refresh"));

    const render = (s) => {
      onState?.(s);
      if (!s?.radio) {
        toggle.disabled = true;
        list.replaceChildren(h("div", { class: "empty" }, "No Bluetooth adapter found"));
        return;
      }
      toggle.disabled = false;
      toggle.checked = s.radio === "On";
      if (s.radio !== "On") { list.replaceChildren(h("div", { class: "empty" }, "Bluetooth is off")); return; }
      const devices = [...(s.devices || [])].sort((a, b) => b.connected - a.connected || a.name.localeCompare(b.name));
      if (!devices.length) { list.replaceChildren(h("div", { class: "empty" }, "No paired devices")); return; }
      list.replaceChildren(...devices.map((d) => h("div", { class: `bt-row${d.connected ? " on" : ""}` },
        icon(KIND_ICON[d.kind] || "bluetooth"),
        h("span", { class: "bt-name ellipsis", title: d.name }, d.name),
        h("span", { class: "bt-state" }, d.connected ? "CONNECTED" : "paired"))));
    };
    const load = async (fresh = false) => {
      try { render(await api.bluetooth.status({ fresh })); } catch (e) { list.replaceChildren(h("div", { class: "empty" }, cleanError(e))); }
    };
    toggle.addEventListener("change", async () => {
      const on = toggle.checked;
      toggle.disabled = true;
      list.replaceChildren(h("div", { class: "empty" }, on ? "Turning Bluetooth on…" : "Turning Bluetooth off…"));
      try { render(await api.bluetooth.radio(on)); } catch (e) { toast(cleanError(e), { level: "warn" }); load(true); }
    });
    refreshBtn.addEventListener("click", () => { list.replaceChildren(h("div", { class: "empty" }, "Refreshing…")); load(true); });
    load();
    return h("div", { class: "bt-panel" },
      h("div", { class: "bt-title" }, icon("bluetooth"), h("span", { class: "grow" }, "BLUETOOTH"), refreshBtn, toggle),
      list,
      h("div", { class: "bt-foot" },
        h("button", { class: "btn sm", type: "button", onclick: () => { close(); api.shell.openSettings("ms-settings:bluetooth").catch(() => {}); } }, icon("gear"), "Bluetooth settings")));
  }, { className: "bt-pop", onClose: () => anchor.classList.remove("open") });
}
