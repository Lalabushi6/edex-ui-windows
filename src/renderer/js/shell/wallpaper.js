// ASCII wallpaper: your own ASCII art drawn large in the theme colour, with
// an optional animation (scanline, glitch, typing, pulse), a clock and an
// ambient effect behind it. Shown by the wallpaper tab, the idle pane that
// takes the terminal's place, and as an idle-screen / screen-saver effect.
import { h, setText } from "../core/dom.js";
import * as settings from "../core/settings.js";
import { normalizeArt, fitArt, blockText, openBootLogoEditor } from "./boot-art.js";
import { startEffect } from "./fx.js";

export const WALLPAPER_EFFECTS = [["none", "Still"], ["scan", "Scanline"], ["glitch", "Glitch"], ["type", "Typing"], ["pulse", "Pulse"]];
export const WALLPAPER_BACKDROPS = [["none", "None"], ["matrix", "Matrix rain"], ["hex", "Hex grid"], ["stars", "Starfield"]];

// The wallpaper's own art; otherwise multi-line boot art; otherwise block
// letters of the boot title (or "eDEX").
export function wallpaperArt() {
  const own = normalizeArt(settings.get("wallpaperArt"));
  if (own) return own;
  const boot = normalizeArt(settings.get("bootLogo"));
  if (boot.includes("\n")) return boot;
  return blockText((boot || "eDEX").slice(0, 24));
}

export function editWallpaperArt(onSaved) {
  openBootLogoEditor(onSaved, {
    key: "wallpaperArt",
    title: "ASCII wallpaper",
    emptyLabel: "Default (boot logo art, or eDEX block letters)",
    emptyHint: "Leave empty to use your boot logo art (or eDEX in block letters)."
  });
}

// Mounts a wallpaper into `container`; options default to the settings.
export function mountWallpaper(container, opts = {}) {
  const o = () => ({
    clock: opts.clock ?? settings.get("wallpaperClock") !== false,
    effect: opts.effect ?? settings.get("wallpaperEffect") ?? "scan",
    backdrop: opts.backdrop ?? settings.get("wallpaperBackdrop") ?? "none"
  });
  const canvas = h("canvas", { class: "wp-canvas", "aria-hidden": "true" });
  const art = h("pre", { class: "wp-art", "aria-hidden": "true" });
  const stage = h("div", { class: "wp-stage" }, art);
  const time = h("div", { class: "wp-time" });
  const date = h("div", { class: "wp-date" });
  const clockEl = h("div", { class: "wp-clock" }, time, date);
  const root = h("div", { class: "wallpaper" }, canvas, stage, clockEl);
  container.append(root);

  let fx = null;
  let typeTimer = null;
  let clockTimer = null;
  let current = o();

  const fit = () => {
    const r = stage.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    fitArt(art, r.width * 0.92, r.height * 0.92);
  };

  // Typing: the art appears line by line, then stays.
  const typeIn = (text) => {
    clearInterval(typeTimer);
    const lines = text.split("\n");
    let n = 0;
    art.textContent = lines.map((l) => " ".repeat([...l].length)).join("\n");
    fit();
    typeTimer = setInterval(() => {
      n++;
      art.textContent = lines.map((l, i) => (i < n ? l : " ".repeat([...l].length))).join("\n");
      if (n >= lines.length) clearInterval(typeTimer);
    }, Math.max(20, Math.min(120, 1800 / lines.length)));
  };

  const tick = () => {
    const now = new Date();
    setText(time, now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: !settings.get("clock24h") }));
    setText(date, now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase());
  };

  const render = () => {
    current = o();
    root.className = `wallpaper fx-${current.effect}${current.clock ? " with-clock" : ""}`;
    const text = wallpaperArt();
    art.dataset.text = text;
    art.textContent = text;
    requestAnimationFrame(() => {
      fit();
      if (current.effect === "type") typeIn(text);
    });
    fx?.stop();
    fx = current.backdrop !== "none" ? startEffect(canvas, current.backdrop, { maxFps: 15, scale: 0.6 }) : null;
    clockEl.hidden = !current.clock;
    clearInterval(clockTimer);
    if (current.clock) { tick(); clockTimer = setInterval(tick, 1000); }
  };

  const ro = new ResizeObserver(() => fit());
  ro.observe(stage);
  const unwatch = opts.live === false ? () => {} : settings.watch(["wallpaperArt", "bootLogo", "wallpaperEffect", "wallpaperClock", "wallpaperBackdrop", "clock24h"], render);
  render();

  return {
    root,
    refresh: render,
    stop() {
      unwatch();
      ro.disconnect();
      clearInterval(typeTimer);
      clearInterval(clockTimer);
      fx?.stop();
      root.remove();
    }
  };
}
