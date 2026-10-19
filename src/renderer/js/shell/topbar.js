// Top bar: brand + mode, launcher search pill, media/volume, network,
// battery, clock, settings and power menu.
import { h, setText } from "../core/dom.js";
import { icon, LOGO_SVG } from "../core/icons.js";
import { poll } from "../core/poll.js";
import * as settings from "../core/settings.js";
import { on } from "../core/bus.js";
import { toast, contextMenu, cleanError } from "../core/ui.js";
import { openLauncher } from "./launcher.js";
import { runCommand } from "../core/commands.js";

const api = window.edex;

export function initTopbar(root) {
  const mode = h("button", { class: "brand-mode", type: "button", title: "Click to switch between desktop and overlay mode" });
  const brand = h("div", { class: "brand" },
    h("span", { class: "brand-mark", svg: LOGO_SVG }),
    h("span", { class: "brand-name" }, "eDEX-UI"),
    mode);
  mode.addEventListener("click", () => settings.set({ mode: settings.get("mode") === "overlay" ? "desktop" : "overlay" }));
  const renderMode = () => setText(mode, settings.get("mode") === "overlay" ? "Overlay" : "Desktop");
  settings.watch("mode", renderMode);
  renderMode();

  const pill = h("button", { class: "search-pill", type: "button", onclick: () => openLauncher() },
    icon("search"), h("span", { class: "grow" }, "Search apps, files, windows, commands…"), h("span", { class: "kbd" }, "Ctrl+Shift+Space"));

  const media = (key, name, title) => h("button", { class: "icon-btn", type: "button", title, onclick: () => api.media.key(key).catch((e) => toast(cleanError(e), { level: "warn" })) }, icon(name));

  // Volume
  const volIcon = h("button", { class: "icon-btn", type: "button", title: "Mute / unmute" }, icon("volume"));
  const volSlider = h("input", { class: "vol-slider", type: "range", min: 0, max: 100, step: 1, title: "Volume" });
  const volLabel = h("span", { class: "muted", style: { minWidth: "2.2rem", fontSize: ".8rem" } }, "--");
  let muted = false;
  let dragging = false;
  const showVolume = (v) => {
    if (!v) return;
    muted = v.muted;
    volIcon.replaceChildren(icon(v.muted ? "mute" : "volume"));
    if (!dragging) volSlider.value = String(v.level);
    setText(volLabel, v.muted ? "MUTE" : `${v.level}%`);
  };
  volIcon.addEventListener("click", () => api.media.setMute(!muted).then(showVolume).catch((e) => toast(cleanError(e), { level: "warn" })));
  volSlider.addEventListener("input", () => {
    dragging = true;
    setText(volLabel, `${volSlider.value}%`);
    api.media.setVolume(Number(volSlider.value)).then(showVolume).catch(() => {});
  });
  volSlider.addEventListener("change", () => { dragging = false; });
  volSlider.addEventListener("wheel", (e) => {
    e.preventDefault();
    const next = Math.max(0, Math.min(100, Number(volSlider.value) + (e.deltaY < 0 ? 2 : -2)));
    volSlider.value = String(next);
    api.media.setVolume(next).then(showVolume).catch(() => {});
  }, { passive: false });
  const volPoll = poll(() => api.media.volume().then(showVolume), 5000);

  // Network + battery + clock
  const net = h("span", { class: "status-item", title: "Network" }, icon("wifi"));
  on("net-state", (n) => {
    net.replaceChildren(icon(n.online ? "wifi" : "offline"), h("span", null, n.online ? (n.type === "wireless" ? "WI-FI" : "LAN") : "OFFLINE"));
    net.title = n.online ? `${n.iface} · ${n.ip4}` : "Offline";
  });
  const battery = h("span", { class: "status-item", hidden: true });
  const batPoll = poll(async () => {
    const b = await api.sys.battery();
    battery.hidden = !b.hasBattery;
    if (!b.hasBattery) return;
    battery.replaceChildren(icon(b.charging ? "bolt" : "battery"), h("span", null, `${Math.round(b.percent)}%`));
    battery.title = b.charging ? "Charging" : (b.ac ? "Plugged in" : "On battery");
    battery.classList.toggle("warn-text", !b.ac && b.percent <= 15);
  }, 30000);
  const clock = h("span", { class: "status-item status-clock" });
  const clockPoll = poll(() => {
    const now = new Date();
    setText(clock, now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: !settings.get("clock24h") }));
    clock.title = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }, 5000);

  const settingsBtn = h("button", { class: "icon-btn", type: "button", title: "Settings (Ctrl+,)", onclick: () => runCommand("settings.open") }, icon("gear"));
  const powerBtn = h("button", { class: "icon-btn", type: "button", title: "Power", onclick: (e) => powerMenu(e) }, icon("power"));

  root.append(brand, pill, h("div", { class: "status" },
    media("prev", "prev", "Previous track"), media("playpause", "playpause", "Play / pause"), media("next", "next", "Next track"),
    h("span", { class: "status-sep" }),
    volIcon, volSlider, volLabel,
    h("span", { class: "status-sep" }),
    net, battery, clock,
    h("span", { class: "status-sep" }),
    settingsBtn, powerBtn));

  return { stop() { volPoll.stop(); batPoll.stop(); clockPoll.stop(); } };
}

export function powerMenu(e) {
  const act = (action) => api.power.action(action).catch((err) => toast(cleanError(err), { level: "warn" }));
  const r = e.currentTarget?.getBoundingClientRect?.();
  const anchor = r ? { clientX: r.right - 200, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} } : e;
  contextMenu(anchor, [
    { label: "Lock", icon: "lock", run: () => act("lock") },
    { label: "Sleep", icon: "moon", run: () => act("sleep") },
    { label: "Sign out", icon: "signout", run: () => act("signout") },
    { label: "Restart", icon: "restart", run: () => act("restart") },
    { label: "Shut down", icon: "power", danger: true, run: () => act("shutdown") },
    { separator: true },
    { label: "Hide eDEX", icon: "minimize", run: () => api.app.hide() },
    { label: "Reload interface", icon: "refresh", run: () => api.app.reload() },
    { label: "Quit eDEX", icon: "close", run: () => api.app.quit() }
  ]);
}
