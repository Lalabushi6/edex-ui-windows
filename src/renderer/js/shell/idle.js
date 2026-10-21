// Idle screen: after a few minutes without keyboard or mouse input (in any
// app), eDEX — when it is the window in front — fades into an animated
// screen with the clock, date and weather. Any input dismisses it.
//
// Idle style "wallpaper" swaps only the workspace for the ASCII wallpaper
// pane instead (the panels keep running). The screen saver windows reuse
// showIdleScreen with their own options.
import { h, setText } from "../core/dom.js";
import * as settings from "../core/settings.js";
import { poll } from "../core/poll.js";
import { emit } from "../core/bus.js";
import { startEffect } from "./fx.js";
import { mountWallpaper } from "./wallpaper.js";

const api = window.edex;
let overlay = null;

function weatherLine() {
  if (settings.get("allowNetworkGeolocation") === false) return Promise.resolve("");
  return api.net.weather().then((w) => {
    const t = w?.current?.temp ?? w?.current?.temperature;
    if (t == null) return "";
    const unit = settings.get("temperatureUnit") === "F" ? "°F" : "°C";
    const v = unit === "°F" ? Math.round(t * 9 / 5 + 32) : Math.round(t);
    return `${v}${unit}${w.place ? ` · ${w.place}` : ""}`;
  }).catch(() => "");
}

// effect: matrix | hex | stars | globe | ascii; info: show clock, date and
// weather; onDismiss: called after input closes it.
export function showIdleScreen({ effect = settings.get("idleEffect") || "matrix", info = true, onDismiss = null } = {}) {
  if (overlay) return;
  const ascii = effect === "ascii";
  const canvas = h("canvas", { class: "idle-canvas" });
  const clock = h("div", { class: "idle-clock" });
  const date = h("div", { class: "idle-date" });
  const extra = h("div", { class: "idle-extra" });
  overlay = h("div", { class: `idle-screen${ascii ? " ascii" : ""}`, role: "dialog", "aria-label": "Idle screen" }, canvas,
    info && h("div", { class: "idle-info" }, clock, date, extra, h("div", { class: "idle-hint" }, "MOVE THE MOUSE OR PRESS A KEY")));
  document.body.append(overlay);
  requestAnimationFrame(() => overlay?.classList.add("show"));
  const fx = ascii
    ? mountWallpaper(overlay, { clock: false, live: false })
    : startEffect(canvas, effect, { maxFps: 30 });
  if (ascii) canvas.remove();
  const tick = () => {
    const now = new Date();
    setText(clock, now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: !settings.get("clock24h") }));
    setText(date, now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase());
  };
  tick();
  const clockTimer = info ? setInterval(tick, 1000) : null;
  if (info) weatherLine().then((t) => setText(extra, t));
  const start = { x: null, y: null };
  const dismiss = (e) => {
    // Ignore the tiny jitter some mice report while untouched.
    if (e?.type === "mousemove") {
      if (start.x === null) { start.x = e.clientX; start.y = e.clientY; return; }
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) < 12) return;
    }
    e?.preventDefault?.();
    e?.stopPropagation?.();
    for (const t of ["mousemove", "mousedown", "keydown", "wheel", "touchstart"]) window.removeEventListener(t, dismiss, true);
    clearInterval(clockTimer);
    fx.stop();
    const el = overlay;
    overlay = null;
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
    onDismiss?.();
  };
  setTimeout(() => {
    for (const t of ["mousemove", "mousedown", "keydown", "wheel", "touchstart"]) window.addEventListener(t, dismiss, { capture: true, passive: false });
  }, 400);
}

export function initIdleScreen() {
  poll(async () => {
    if (!settings.get("idleScreen") || overlay) return;
    // Only when eDEX is what's in front: never cover another app.
    if (!document.hasFocus() && settings.get("mode") !== "overlay") return;
    let idle = 0;
    try { idle = await api.app.idle(); } catch (_) { return; }
    if (idle < (settings.get("idleMinutes") || 10) * 60) return;
    if (settings.get("idleStyle") === "wallpaper") emit("idle-wallpaper");
    else showIdleScreen();
  }, 15000, { fixed: true });
}
