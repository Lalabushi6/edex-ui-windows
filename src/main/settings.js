// Settings: a typed schema with defaults. The renderer can only write keys the
// schema knows, and every value is coerced/clamped before it is stored.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { JsonStore } = require("./lib/store");

const str = (max = 256) => (v, d) => (typeof v === "string" ? v.slice(0, max) : d);
const bool = () => (v, d) => (typeof v === "boolean" ? v : d);
const int = (min, max) => (v, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const oneOf = (...values) => (v, d) => (values.includes(v) ? v : d);
const strList = (maxItems, maxLen = 1024) => (v, d) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length <= maxLen).slice(0, maxItems) : d;
const accelerator = () => (v, d) =>
  typeof v === "string" && (v === "" || /^[A-Za-z0-9+`\-=[\];',./\\ ]{1,64}$/.test(v)) ? v : d;
const links = () => (v, d) => {
  if (!Array.isArray(v)) return d;
  return v
    .filter((x) => x && typeof x.name === "string" && typeof x.target === "string")
    .slice(0, 64)
    .map((x) => ({ name: x.name.slice(0, 64), target: x.target.slice(0, 2048) }));
};
const widgetOrder = () => (v, d) => {
  if (!v || typeof v !== "object") return d;
  const clean = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === "string" && x.length < 64).slice(0, 32) : []);
  return { left: clean(v.left), right: clean(v.right) };
};
const workspace = () => (v, d) => {
  if (v === null) return null;
  if (!v || !Array.isArray(v.tabs)) return d;
  const tabs = v.tabs.slice(0, 16).map((t) => ({
    type: ["terminal", "files", "processes", "media"].includes(t?.type) ? t.type : "terminal",
    shell: typeof t?.shell === "string" ? t.shell.slice(0, 32) : undefined,
    cwd: typeof t?.cwd === "string" ? t.cwd.slice(0, 1024) : undefined,
    label: typeof t?.label === "string" ? t.label.slice(0, 32) : undefined
  }));
  return { tabs, active: int(0, 15)(v.active, 0) };
};

const SCHEMA = {
  // Window behaviour
  mode: [oneOf("desktop", "overlay"), "desktop"],
  coverTaskbar: [bool(), true],
  overlayHideOnBlur: [bool(), true],
  hideAfterLaunch: [bool(), true],
  startHidden: [bool(), false],
  openAtLogin: [bool(), false],
  closeToTray: [bool(), true],
  hotkeyToggle: [accelerator(), "CommandOrControl+`"],
  hotkeyLauncher: [accelerator(), "CommandOrControl+Shift+Space"],

  // Appearance & feedback
  theme: [str(64), "tron"],
  uiScale: [int(70, 160), 100],
  bootAnimation: [bool(), true],
  bootLogo: [str(400), ""],
  bootSubtitle: [str(64), ""],
  audioEnabled: [bool(), true],
  audioVolume: [int(0, 100), 50],
  audioFeedback: [bool(), false],
  clock24h: [bool(), true],
  clockZones: [strList(6, 64), ["local", "UTC"]],
  temperatureUnit: [oneOf("C", "F"), "C"],

  // Layout
  showLeftColumn: [bool(), true],
  showRightColumn: [bool(), true],
  showKeyboard: [bool(), false],
  hiddenWidgets: [strList(32, 64), []],
  widgetOrder: [widgetOrder(), { left: [], right: [] }],
  workspace: [workspace(), null],

  // Terminal
  defaultShell: [str(32), "powershell"],
  termFontSize: [int(8, 32), 14],
  termScrollback: [int(100, 100000), 5000],
  termFontFamily: [oneOf("theme", "Fira Mono", "Fira Code", "Cascadia Mono", "Consolas"), "theme"],
  termCursorStyle: [oneOf("theme", "block", "bar", "underline"), "theme"],
  termCursorBlink: [bool(), true],
  termCopyOnSelect: [bool(), false],

  // Files
  showHidden: [bool(), false],
  confirmDelete: [bool(), true],
  explorerView: [oneOf("list", "grid"), "list"],
  explorerSort: [oneOf("name", "size", "modified", "type"), "name"],
  explorerSortDesc: [bool(), false],
  pinnedPaths: [strList(32), []],
  recentFiles: [strList(24), []],
  recentFolders: [strList(24), []],

  // Launcher & dock
  pinnedApps: [strList(40, 2048), []],
  quickLinks: [links(), []],
  webSearchUrl: [str(512), "https://www.google.com/search?q=%s"],

  // Media player
  mediaPlaylist: [strList(2000, 1024), []],
  mediaIndex: [int(0, 1999), 0],
  mediaPosition: [int(0, 864000), 0],
  mediaVolume: [int(0, 100), 80],
  mediaShuffle: [bool(), false],
  mediaRepeat: [oneOf("off", "all", "one"), "off"],

  // Network & privacy
  allowNetworkGeolocation: [bool(), true],
  clipboardHistory: [bool(), true],
  clipboardMax: [int(5, 200), 40]
};

function defaults() {
  const out = {};
  for (const [key, [, def]] of Object.entries(SCHEMA)) out[key] = structuredClone(def);
  return out;
}

function sanitize(key, value, current) {
  const entry = SCHEMA[key];
  if (!entry) return undefined;
  const [coerce, def] = entry;
  return coerce(value, current === undefined ? structuredClone(def) : current);
}

// Carries preferences over from the v1 settings file in the home directory.
function migrateLegacy() {
  const legacyPath = path.join(os.homedir(), ".edex-ui-settings.json");
  let legacy;
  try { legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8")); } catch (_) { return {}; }
  const out = {};
  const copy = (from, to = from, map = (v) => v) => {
    if (legacy[from] !== undefined) out[to] = map(legacy[from]);
  };
  copy("theme", "theme", (v) => (v === "default" ? "default" : v));
  copy("termFontSize");
  copy("termScrollback");
  copy("audioEnabled");
  copy("bootLogo");
  copy("bootSubtitle");
  copy("pinnedPaths");
  copy("recentFiles");
  copy("recentFolders");
  copy("allowNetworkGeolocation");
  copy("filesystemShowHidden", "showHidden");
  copy("explorerGridView", "explorerView", (v) => (v === false ? "list" : "grid"));
  return out;
}

class Settings extends EventEmitter {
  constructor(userDataDir) {
    super();
    this.store = new JsonStore(path.join(userDataDir, "settings.json"), { fallback: {} });
    const isFresh = !this.store.exists;
    const seed = isFresh ? migrateLegacy() : {};
    const merged = defaults();
    for (const [key, value] of Object.entries({ ...this.store.data, ...seed })) {
      const clean = sanitize(key, value, merged[key]);
      if (clean !== undefined) merged[key] = clean;
    }
    this.store.data = merged;
    if (isFresh) this.store.save();
  }

  get(key) {
    return this.store.data[key];
  }

  all() {
    return structuredClone(this.store.data);
  }

  // Applies a partial update; returns the keys that actually changed.
  set(patch) {
    if (!patch || typeof patch !== "object") throw new Error("Settings patch must be an object");
    const changed = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.prototype.hasOwnProperty.call(SCHEMA, key)) continue;
      const clean = sanitize(key, value, this.store.data[key]);
      if (JSON.stringify(clean) === JSON.stringify(this.store.data[key])) continue;
      this.store.data[key] = clean;
      changed[key] = clean;
    }
    if (Object.keys(changed).length) {
      this.store.save();
      this.emit("change", changed);
    }
    return changed;
  }

  flush() {
    this.store.flushSync();
  }
}

module.exports = { Settings, SCHEMA };
