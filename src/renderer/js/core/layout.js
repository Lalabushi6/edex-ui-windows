// Screen layout. Every region (top bar, dock, the two panel columns, the
// terminal / workspace, the file browser and the on-screen keyboard) can be
// shown, hidden or moved; presets reproduce the original eDEX-UI
// arrangements. The grid is built here from the settings, so any
// combination works without per-combination CSS.
import * as settings from "./settings.js";
import { emit } from "./bus.js";

export const LAYOUT_KEYS = [
  "showTopbar", "showDock", "showLeftColumn", "showRightColumn", "columnsSide",
  "filesPanel", "bottomOrder", "showKeyboard", "columnWidth", "filesWidth"
];

export const PRESETS = {
  shell: {
    label: "Shell", desc: "Top bar, dock and both panel columns around the workspace.",
    values: { showTopbar: true, showDock: true, showLeftColumn: true, showRightColumn: true, columnsSide: "split", filesPanel: "off" }
  },
  classic: {
    label: "Original eDEX-UI", desc: "No top bar or dock; file browser and keyboard along the bottom.",
    values: { showTopbar: false, showDock: false, showLeftColumn: true, showRightColumn: true, columnsSide: "split", filesPanel: "bottom", bottomOrder: "files-left", showKeyboard: true }
  },
  typeleft: {
    label: "Keyboard left", desc: "Like the original, with the keyboard on the left and files on the right.",
    values: { showTopbar: false, showDock: false, showLeftColumn: true, showRightColumn: true, columnsSide: "split", filesPanel: "bottom", bottomOrder: "keyboard-left", showKeyboard: true }
  },
  panels: {
    label: "Panels left", desc: "Both panel columns side by side on the left with files under them; terminal full height.",
    values: { showTopbar: false, showDock: false, showLeftColumn: true, showRightColumn: true, columnsSide: "left", filesPanel: "column", showKeyboard: false }
  },
  "panels-right": {
    label: "Panels right", desc: "The same with the panels on the right.",
    values: { showTopbar: false, showDock: false, showLeftColumn: true, showRightColumn: true, columnsSide: "right", filesPanel: "column", showKeyboard: false }
  },
  focus: {
    label: "Focus", desc: "Just the workspace, top bar and dock.",
    values: { showTopbar: true, showDock: true, showLeftColumn: false, showRightColumn: false, filesPanel: "off", showKeyboard: false }
  }
};

// Layout hints from the active theme (columns side, file panel position,
// bottom order) apply on top of the settings while "themeLayouts" is on.
let themeHints = {};
const THEME_KEYS = ["columnsSide", "filesPanel", "bottomOrder"];

export function setThemeLayout(hints) {
  themeHints = {};
  for (const k of THEME_KEYS) if (hints && hints[k] !== undefined) themeHints[k] = hints[k];
  applyLayout();
}

export function effective(key) {
  if (settings.get("themeLayouts") !== false && key in themeHints) return themeHints[key];
  return settings.get(key);
}

export function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  settings.set({ ...preset.values, layoutPreset: name });
}

// Which preset the current settings match, if any.
export function matchingPreset() {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (Object.entries(p.values).every(([k, v]) => k === "showKeyboard" || settings.get(k) === v)) return name;
  }
  return "custom";
}

// Grid columns / rows / areas for a set of layout values. Shared by the live
// layout and the preset previews in Settings.
export function computeGrid(v) {
  const left = v.showLeftColumn !== false;
  const right = v.showRightColumn !== false;
  const side = v.columnsSide || "split";
  let files = v.filesPanel || "off";
  const keyboard = !!v.showKeyboard;
  const widgets = [left && "left", right && "right"].filter(Boolean);
  if (files === "column" && !widgets.length) files = "bottom";

  let cols;
  if (side === "left") cols = [...widgets, "work"];
  else if (side === "right") cols = ["work", ...widgets];
  else cols = [left && "left", "work", right && "right"].filter(Boolean);

  const rows = [];
  const sizes = [];
  const kinds = [];
  const add = (row, size, kind) => { rows.push(row); sizes.push(size); kinds.push(kind); };
  if (v.showTopbar !== false) add(cols.map(() => "top"), "auto", "top");
  if (files === "column") {
    // Files sit under the panel columns; the workspace runs full height.
    const under = side === "split" ? (left ? "left" : "right") : null;
    add(cols, "minmax(0, 2.2fr)", "main");
    add(cols.map((c) => (c === "work" ? "work" : (!under || c === under ? "files" : c))), "minmax(0, 1fr)", "files");
  } else {
    add(cols, "minmax(0, 1fr)", "main");
  }
  const bottom = keyboard || files === "bottom";
  if (bottom) add(cols.map(() => "bottom"), "auto", "bottom");
  if (v.showDock !== false) add(cols.map(() => "dock"), "auto", "dock");
  return {
    cols, files, side, left, right, keyboard, bottom, kinds,
    columns: cols.map((c) => (c === "work" ? "minmax(0, 1fr)" : "var(--col-w)")).join(" "),
    rowSizes: sizes.join(" "),
    areas: rows.map((r) => `"${r.join(" ")}"`).join(" ")
  };
}

export function currentValues() {
  const v = {};
  for (const k of LAYOUT_KEYS) v[k] = settings.get(k);
  for (const k of THEME_KEYS) v[k] = effective(k);
  return v;
}

export function applyLayout() {
  const app = document.getElementById("app");
  if (!app) return;
  const g = computeGrid(currentValues());
  const { left, right, side, files, keyboard, bottom } = g;
  app.style.gridTemplateColumns = g.columns;
  app.style.gridTemplateRows = g.rowSizes;
  app.style.gridTemplateAreas = g.areas;

  const show = (id, on) => { const el = document.getElementById(id); if (el) el.hidden = !on; };
  show("topbar", settings.get("showTopbar") !== false);
  show("dock", settings.get("showDock") !== false);
  show("col-left", left);
  show("col-right", right);
  show("bottom", bottom);

  // The file browser lives in the bottom strip or its own grid cell.
  const panel = document.getElementById("filepanel");
  const strip = document.getElementById("bottom");
  if (panel && strip) {
    panel.hidden = files === "off";
    if (files === "column") {
      if (panel.parentElement !== app) app.insertBefore(panel, strip);
      panel.style.gridArea = "files";
    } else {
      if (panel.parentElement !== strip) strip.prepend(panel);
      panel.style.gridArea = "";
    }
    strip.classList.toggle("keyboard-left", effective("bottomOrder") === "keyboard-left");
    strip.classList.toggle("files-only", files === "bottom" && !keyboard);
  }

  const root = document.documentElement.style;
  root.setProperty("--ui-scale", String((settings.get("uiScale") || 100) / 100));
  root.setProperty("--col-scale", String((settings.get("columnWidth") || 100) / 100));
  root.setProperty("--files-w", `${settings.get("filesWidth") || 42}%`);
  app.dataset.files = files;
  app.dataset.side = side;
  emit("layout", { files, side, keyboard });
}

export function initLayout() {
  applyLayout();
  settings.watch(["uiScale", "themeLayouts", ...LAYOUT_KEYS], () => applyLayout());
  // Hand-tuned settings no longer match a preset. Checked once the whole
  // change has landed (a preset sets several keys at once).
  let pending = false;
  settings.watch(LAYOUT_KEYS.filter((k) => k !== "showKeyboard" && k !== "columnWidth" && k !== "filesWidth"), () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      const name = matchingPreset();
      if (settings.get("layoutPreset") !== name) settings.set({ layoutPreset: name });
    });
  });
}
