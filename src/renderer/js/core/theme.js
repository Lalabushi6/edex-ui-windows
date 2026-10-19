import { emit } from "./bus.js";
import * as settings from "./settings.js";
import { setThemeLayout } from "./layout.js";

let current = {
  id: "tron", rgb: [170, 207, 209], black: "#000000", lightBlack: "#05080d", grey: "#262828",
  ansi: {}, terminal: {}, colorFilter: [], globe: {}, extra: {}
};

export function currentTheme() {
  return current;
}

export function accent(alpha = 1) {
  const [r, g, b] = current.rgb;
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function accentHex() {
  return `#${current.rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export async function applyTheme(id) {
  const theme = await window.edex.themes.get(id);
  if (!theme) return null;
  applyThemeData(theme);
  return theme;
}

const UI_FALLBACK = '"United Sans", "Segoe UI", sans-serif';
let appliedExtra = [];

// Applies a theme object (as returned by themes:get). The theme editor uses
// `preview` for live edits: everything updates except the globe, which is
// only rebuilt for real theme changes (it bakes colours into textures).
export function applyThemeData(theme, { preview = false } = {}) {
  current = theme;
  const root = document.documentElement.style;
  root.setProperty("--rgb", theme.rgb.join(" "));
  root.setProperty("--bg", theme.lightBlack);
  root.setProperty("--bg-deep", theme.black);
  root.setProperty("--grey", theme.grey);
  const ui = theme.fonts?.ui;
  root.setProperty("--font-ui", ui && ui !== "United Sans" ? `"${ui}", ${UI_FALLBACK}` : UI_FALLBACK);
  for (const key of appliedExtra) root.removeProperty(key);
  appliedExtra = [];
  for (const [key, value] of Object.entries(theme.extra || {})) {
    if (["--color_r", "--color_g", "--color_b"].includes(key)) continue;
    root.setProperty(key, value);
    appliedExtra.push(key);
  }
  let style = document.getElementById("theme-css");
  if (!style) {
    style = document.createElement("style");
    style.id = "theme-css";
    // Before the user's own CSS, so custom CSS always wins.
    document.head.insertBefore(style, document.getElementById("user-css"));
  }
  style.textContent = theme.css || "";
  setThemeLayout(theme.layout || null);
  emit("theme", { ...theme, preview });
}

// "rotate(180) saturate(0.5), mix(0.7)" → filter steps, as themes store them.
export function parseFilter(text) {
  const steps = [];
  for (const m of String(text || "").matchAll(/([a-z]+)\(\s*(-?[\d.]*)\s*\)/gi)) {
    steps.push({ func: m[1].toLowerCase(), arg: m[2] === "" ? null : Number(m[2]) });
  }
  return steps.slice(0, 12);
}

export function formatFilter(steps) {
  return (steps || []).map((s) => `${s.func}(${s.arg ?? ""})`).join(" ");
}

// ── Colour maths for the terminal palette ───────────────────────────────────
// eDEX-UI tints every ANSI colour towards the theme accent, so terminal output
// stays on-palette. Themes can replace the default tint with a filter chain
// (e.g. tron-colorfilter: rotate(180), saturate(0.5), mix(0.7)).
const BASE_ANSI = {
  black: "#2e3436", red: "#cc0000", green: "#4e9a06", yellow: "#c4a000", blue: "#3465a4", magenta: "#75507b",
  cyan: "#06989a", white: "#d3d7cf", brightBlack: "#555753", brightRed: "#ef2929", brightGreen: "#8ae234",
  brightYellow: "#fce94f", brightBlue: "#729fcf", brightMagenta: "#ad7fa8", brightCyan: "#34e2e2", brightWhite: "#eeeeec"
};

function parseColor(c) {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split("").map((x) => x + x).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 0, g: 0, b: 0 };
}

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function fromHsl({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function hwbAdjust(col, dw, db) {
  const { h } = toHsl(col);
  let w = Math.min(col.r, col.g, col.b) / 255;
  let bl = 1 - Math.max(col.r, col.g, col.b) / 255;
  w = Math.min(1, w + w * dw);
  bl = Math.min(1, bl + bl * db);
  if (w + bl >= 1) { const v = (w / (w + bl)) * 255; return { r: v, g: v, b: v }; }
  const pure = fromHsl({ h, s: 1, l: 0.5 });
  const k = 1 - w - bl;
  return { r: pure.r * k + w * 255, g: pure.g * k + w * 255, b: pure.b * k + w * 255 };
}

function applyStep(col, { func, arg }, target) {
  const a = arg ?? 0;
  switch (func) {
    case "negate": return { r: 255 - col.r, g: 255 - col.g, b: 255 - col.b };
    case "grayscale": { const v = col.r * 0.3 + col.g * 0.59 + col.b * 0.11; return { r: v, g: v, b: v }; }
    case "mix": { const w = arg ?? 0.5; return { r: target.r * w + col.r * (1 - w), g: target.g * w + col.g * (1 - w), b: target.b * w + col.b * (1 - w) }; }
    case "rotate": { const hsl = toHsl(col); hsl.h += a; return fromHsl(hsl); }
    case "saturate": { const hsl = toHsl(col); hsl.s += hsl.s * a; return fromHsl(hsl); }
    case "desaturate": { const hsl = toHsl(col); hsl.s -= hsl.s * a; return fromHsl(hsl); }
    case "lighten": { const hsl = toHsl(col); hsl.l += hsl.l * a; return fromHsl(hsl); }
    case "darken": { const hsl = toHsl(col); hsl.l -= hsl.l * a; return fromHsl(hsl); }
    case "whiten": return hwbAdjust(col, a, 0);
    case "blacken": return hwbAdjust(col, 0, a);
    default: return col;
  }
}

const DEFAULT_FILTER = [{ func: "grayscale", arg: null }, { func: "mix", arg: 0.3 }];

function colorify(base, target) {
  const steps = current.colorFilter?.length ? current.colorFilter : DEFAULT_FILTER;
  const t = parseColor(target);
  let col = parseColor(base);
  for (const step of steps) col = applyStep(col, step, t);
  return `#${[col.r, col.g, col.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

export function terminalFont() {
  const pick = settings.get("termFontFamily") || "theme";
  const family = pick === "theme" ? (current.terminal?.fontFamily || "Fira Mono") : pick;
  return `"${family}", "Fira Mono", Consolas, monospace`;
}

export function terminalTheme() {
  const t = current.terminal || {};
  const fg = t.foreground || accent();
  const theme = {
    background: t.background || current.lightBlack,
    foreground: fg,
    cursor: t.cursor || fg,
    cursorAccent: t.cursorAccent || current.lightBlack,
    selectionBackground: t.selectionBackground || accent(0.3)
  };
  const target = accentHex();
  for (const [name, base] of Object.entries(BASE_ANSI)) {
    theme[name] = current.ansi?.[name] || (name === "black" ? current.black : colorify(base, target));
  }
  return theme;
}

export function terminalCursorStyle() {
  return current.terminal?.cursorStyle || null;
}
