// Top bar: brand + mode, launcher search pill, media/volume, network,
// battery, clock, settings and power menu.
import { h, setText } from "../core/dom.js";
import { icon, LOGO_SVG } from "../core/icons.js";
import { poll } from "../core/poll.js";
import { onLive, onBattery } from "../core/live.js";
import * as settings from "../core/settings.js";
import { emit } from "../core/bus.js";
import { toast, contextMenu, popover, cleanError } from "../core/ui.js";
import { openLauncher } from "./launcher.js";
import { buildCalendar } from "./calendar.js";
import { openWifiPanel } from "./wifi.js";
import { onNowPlaying, openNowPlayingPopover, appName } from "./nowplaying.js";
import { openMixer } from "./mixer.js";
import { openBluetoothPanel } from "./bluetooth.js";
import { openBatteryPanel } from "./battery.js";
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
  // What another app is playing; click for art, seek and controls.
  const npLabel = h("button", { class: "status-item np-label", type: "button", hidden: true, onclick: () => openNowPlayingPopover(npLabel) });
  let npSig = "";
  const offNp = onNowPlaying((s) => {
    npLabel.hidden = !s;
    if (!s) return;
    const sig = `${s.title}|${s.artist}|${s.status}`;
    if (sig === npSig) return;
    npSig = sig;
    npLabel.replaceChildren(icon(s.status === "Playing" ? "audio" : "pause"), h("span", { class: "ellipsis" }, [s.title, s.artist].filter(Boolean).join(" — ")));
    npLabel.title = `${appName(s.app)}: ${[s.title, s.artist].filter(Boolean).join(" — ")}`;
  });

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
  const mixBtn = h("button", { class: "icon-btn", type: "button", title: "Volume mixer and output device" }, icon("mixer"));
  mixBtn.addEventListener("click", () => openMixer(mixBtn));
  volIcon.addEventListener("contextmenu", (e) => { e.preventDefault(); openMixer(mixBtn); });

  // Brightness (laptop panels only; hidden when the display has no control).
  const brightBtn = h("button", { class: "icon-btn status-bright", type: "button", title: "Display brightness", hidden: true }, icon("sun"));
  const brightness = brightnessControl(brightBtn);

  const snipBtn = h("button", { class: "icon-btn", type: "button", title: "Screen snip (Win+Shift+S)", onclick: () => runCommand("shell.snip") }, icon("snip"));

  // Network + battery + clock
  const net = h("button", { class: "status-item", type: "button", title: "Network", onclick: () => openWifiPanel(net) }, icon("wifi"));
  let netSig = "";
  const offNet = onLive(({ net: n }) => {
    const sig = `${n.online}|${n.type}|${n.iface}|${n.ip4}`;
    if (sig === netSig) return;
    netSig = sig;
    net.replaceChildren(icon(n.online ? "wifi" : "offline"), h("span", null, n.online ? (n.type === "wireless" ? "WI-FI" : "LAN") : "OFFLINE"));
    net.title = n.online ? `${n.iface} · ${n.ip4}` : "Offline";
    emit("net-state", n);
  });
  // Bluetooth: shown once a radio is found (checked after startup settles).
  const bt = h("button", { class: "icon-btn status-bt", type: "button", title: "Bluetooth", hidden: true }, icon("bluetooth"));
  const showBt = (s) => {
    bt.hidden = !s?.radio;
    if (!s?.radio) return;
    const n = (s.devices || []).filter((d) => d.connected).length;
    bt.classList.toggle("off", s.radio !== "On");
    bt.title = s.radio !== "On" ? "Bluetooth off" : n ? `Bluetooth · ${n} connected` : "Bluetooth on";
  };
  bt.addEventListener("click", () => openBluetoothPanel(bt, showBt));
  setTimeout(() => api.bluetooth.status().then(showBt).catch(() => {}), 15000);
  const battery = h("button", { class: "status-item", type: "button", hidden: true });
  battery.addEventListener("click", () => openBatteryPanel(battery));
  const offBattery = onBattery((b) => {
    battery.hidden = !b.hasBattery;
    if (!b.hasBattery) return;
    battery.replaceChildren(icon(b.charging ? "bolt" : "battery"), h("span", null, `${Math.round(b.percent)}%`));
    battery.title = `${b.charging ? "Charging" : (b.ac ? "Plugged in" : "On battery")}${b.saver ? " · battery saver on" : ""}`;
    battery.classList.toggle("warn-text", !b.ac && b.percent <= 15);
  });
  const clock = h("button", { class: "status-item status-clock", type: "button", title: "Calendar" });
  let clockFmt = null;
  let clockFmt24 = null;
  const clockPoll = poll(() => {
    const h24 = !!settings.get("clock24h");
    if (clockFmt24 !== h24) {
      clockFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: !h24 });
      clockFmt24 = h24;
    }
    setText(clock, clockFmt.format(new Date()));
  }, 5000, { fixed: true });
  settings.watch("clock24h", () => clockPoll.kick());
  clock.addEventListener("click", () => {
    if (clock.classList.contains("open")) return;
    clock.classList.add("open");
    popover(clock, () => buildCalendar(), { className: "calendar-pop", onClose: () => clock.classList.remove("open") });
  });

  const settingsBtn = h("button", { class: "icon-btn", type: "button", title: "Settings (Ctrl+,)", onclick: () => runCommand("settings.open") }, icon("gear"));
  const powerBtn = h("button", { class: "icon-btn", type: "button", title: "Power", onclick: (e) => powerMenu(e) }, icon("power"));

  root.append(brand, pill, h("div", { class: "status" },
    npLabel, media("prev", "prev", "Previous track"), media("playpause", "playpause", "Play / pause"), media("next", "next", "Next track"),
    h("span", { class: "status-sep" }),
    volIcon, volSlider, volLabel, mixBtn, brightBtn,
    h("span", { class: "status-sep" }),
    snipBtn, bt, net, battery, clock,
    h("span", { class: "status-sep" }),
    settingsBtn, powerBtn));

  return { stop() { volPoll.stop(); brightness.stop(); offNet(); offBattery(); clockPoll.stop(); offNp(); } };
}

// The brightness button opens a slider; the wheel over it nudges by 5%.
// Writes go through one at a time (a WMI call each) and the latest value wins.
function brightnessControl(btn) {
  let level = null;
  let pending = null;
  let writing = false;
  let slider = null;
  let label = null;
  const show = (v) => {
    if (v === null || v === undefined) { btn.hidden = true; return; }
    level = v;
    btn.hidden = false;
    btn.title = `Display brightness ${v}%`;
    if (slider && document.activeElement !== slider) slider.value = String(v);
    if (label) setText(label, `${v}%`);
  };
  const write = async (v) => {
    pending = v;
    if (writing) return;
    writing = true;
    while (pending !== null) {
      const next = pending;
      pending = null;
      try { show(await api.display.setBrightness(next)); } catch (e) { toast(cleanError(e), { level: "warn" }); break; }
    }
    writing = false;
  };
  // Brightness rarely changes behind our back; a slow refresh catches
  // keyboard brightness keys and adaptive brightness.
  const p = poll(() => api.display.brightness().then(show), 60000);
  btn.addEventListener("wheel", (e) => {
    if (level === null) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(100, level + (e.deltaY < 0 ? 5 : -5)));
    show(next);
    write(next);
  }, { passive: false });
  btn.addEventListener("click", () => {
    if (level === null || btn.classList.contains("open")) return;
    btn.classList.add("open");
    popover(btn, () => {
      slider = h("input", { class: "bright-slider", type: "range", min: 0, max: 100, step: 1, value: String(level), "aria-label": "Brightness" });
      label = h("span", { class: "bright-label" }, `${level}%`);
      slider.addEventListener("input", () => {
        const v = Number(slider.value);
        level = v;
        setText(label, `${v}%`);
        write(v);
      });
      setTimeout(() => slider?.focus(), 0);
      return h("div", { class: "bright-pop" }, icon("sun"), slider, label);
    }, { onClose: () => { btn.classList.remove("open"); slider = null; label = null; } });
  });
  return { stop: () => p.stop() };
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
