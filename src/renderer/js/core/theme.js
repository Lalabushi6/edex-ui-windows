import { emit } from "./bus.js";

let current = { id: "tron", rgb: [170, 207, 209], black: "#000000", lightBlack: "#05080d", grey: "#262828", terminal: {}, extra: {} };

export function currentTheme() {
  return current;
}

export function accent(alpha = 1) {
  const [r, g, b] = current.rgb;
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export async function applyTheme(id) {
  const theme = await window.edex.themes.get(id);
  if (!theme) return null;
  current = theme;
  const root = document.documentElement.style;
  root.setProperty("--rgb", theme.rgb.join(" "));
  root.setProperty("--bg", theme.lightBlack);
  root.setProperty("--bg-deep", theme.black);
  root.setProperty("--grey", theme.grey);
  for (const [key, value] of Object.entries(theme.extra || {})) {
    if (!["--color_r", "--color_g", "--color_b"].includes(key)) root.setProperty(key, value);
  }
  emit("theme", theme);
  return theme;
}

export function terminalTheme() {
  const t = current.terminal || {};
  const fg = accent();
  return {
    background: t.background || current.lightBlack,
    foreground: t.foreground || fg,
    cursor: t.cursor || fg,
    cursorAccent: current.lightBlack,
    selectionBackground: t.selectionBackground || accent(0.3),
    ...Object.fromEntries(Object.entries(t).filter(([k]) => !["background", "foreground", "cursor", "selectionBackground", "cursorStyle"].includes(k)))
  };
}
