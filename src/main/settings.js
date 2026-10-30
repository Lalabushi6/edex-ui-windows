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
  const tabs = v.tabs.slice(0, 40).map((t) => ({
    type: ["terminal", "files", "processes", "media", "disk", "browser", "ascii", "app"].includes(t?.type) ? t.type : "terminal",
    shell: typeof t?.shell === "string" ? t.shell.slice(0, 32) : undefined,
    cwd: typeof t?.cwd === "string" ? t.cwd.slice(0, 1024) : undefined,
    label: typeof t?.label === "string" ? t.label.slice(0, 32) : undefined,
    url: t?.type === "browser" && typeof t.url === "string" && /^https?:\/\//i.test(t.url) ? t.url.slice(0, 4096) : undefined,
    exe: t?.type === "app" && typeof t.exe === "string" ? t.exe.slice(0, 1024) : undefined,
    title: t?.type === "app" && typeof t.title === "string" ? t.title.slice(0, 200) : undefined,
    splits: t?.type === "terminal" && Array.isArray(t.splits)
      ? t.splits.slice(0, 3).map((s) => ({ shell: typeof s?.shell === "string" ? s.shell.slice(0, 32) : undefined }))
      : undefined,
    splitDir: t?.splitDir === "down" ? "down" : t?.splitDir === "right" ? "right" : undefined
  }));
  return { tabs, active: int(0, 39)(v.active, 0) };
};

// Custom command widgets: a title, the command, its shell and refresh rate.
const commandWidgets = () => (v, d) => {
  if (!Array.isArray(v)) return d;
  return v.slice(0, 12)
    .filter((w) => w && typeof w.command === "string" && w.command.trim())
    .map((w, i) => ({
      id: typeof w.id === "string" && /^[\w-]{1,32}$/.test(w.id) ? w.id : `cmd${Date.now().toString(36)}${i}`,
      title: typeof w.title === "string" && w.title.trim() ? w.title.trim().slice(0, 40) : "Command",
      command: w.command.slice(0, 2000),
      shell: w.shell === "cmd" ? "cmd" : "powershell",
      interval: int(5, 86400)(w.interval, 60),
      column: w.column === "left" ? "left" : "right"
    }));
};
// Internet radio favourites.
const stations = () => (v, d) => {
  if (!Array.isArray(v)) return d;
  return v.filter((s) => s && typeof s.url === "string" && /^https?:\/\/\S+$/i.test(s.url) && s.url.length <= 1024).slice(0, 100).map((s) => ({
    name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 80) : s.url.slice(0, 80),
    url: s.url,
    favicon: typeof s.favicon === "string" && /^https?:\/\//i.test(s.favicon) ? s.favicon.slice(0, 1024) : "",
    tags: typeof s.tags === "string" ? s.tags.slice(0, 120) : "",
    country: typeof s.country === "string" ? s.country.slice(0, 8) : ""
  }));
};
// Calendar subscriptions (.ics / webcal links).
const feeds = () => (v, d) => {
  if (!Array.isArray(v)) return d;
  return v.slice(0, 10).filter((f) => f && typeof f.url === "string" && /^(https?|webcal):\/\/\S+$/i.test(f.url.trim()) && f.url.length <= 2048).map((f, i) => ({
    id: typeof f.id === "string" && /^[\w-]{1,32}$/.test(f.id) ? f.id : `cal${Date.now().toString(36)}${i}`,
    name: typeof f.name === "string" && f.name.trim() ? f.name.trim().slice(0, 60) : "Calendar",
    url: f.url.trim().replace(/^webcal:/i, "https:"),
    color: typeof f.color === "string" && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color.toLowerCase() : "#7fc8ff",
    remind: f.remind === null || f.remind === undefined || f.remind === "" ? null : int(0, 1440)(f.remind, null),
    enabled: f.enabled !== false
  }));
};
// Workspaces: named setups (tabs, theme, layout, windows) with an optional
// hotkey and a time of day to switch on.
const LAYOUT_SNAPSHOT_KEYS = ["layoutPreset", "showTopbar", "showDock", "showLeftColumn", "showRightColumn", "columnsSide", "columnWidth", "filesPanel", "filesWidth", "bottomOrder", "showKeyboard", "hiddenWidgets", "widgetOrder"];
const layoutSnapshot = (l) => {
  if (!l || typeof l !== "object") return null;
  const layout = {};
  for (const k of LAYOUT_SNAPSHOT_KEYS) {
    if (l[k] === undefined) continue;
    const clean = sanitize(k, l[k], undefined);
    if (clean !== undefined) layout[k] = clean;
  }
  return layout;
};
const themeName = (t) => (typeof t === "string" && t ? t.slice(0, 64) : null);
const profiles = () => (v, d) => {
  if (!Array.isArray(v)) return d;
  const seen = new Set();
  return v.slice(0, 10).filter((p) => p && typeof p.id === "string" && /^[\w-]{1,32}$/.test(p.id) && !seen.has(p.id) && seen.add(p.id)).map((p) => {
    const layout = layoutSnapshot(p.layout);
    const sched = p.schedule && typeof p.schedule === "object" && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.schedule.time || "")
      ? { time: p.schedule.time, days: Array.isArray(p.schedule.days) ? [...new Set(p.schedule.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))] : [0, 1, 2, 3, 4, 5, 6] }
      : null;
    return {
      id: p.id,
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : "Workspace",
      tabs: p.id === "main" ? null : workspace()(p.tabs, null),
      theme: themeName(p.theme),
      layout,
      windows: !!p.windows,
      hotkey: accelerator()(p.hotkey, ""),
      schedule: sched
    };
  });
};
// Screen-time daily limits: program name -> minutes.
const limits = () => (v, d) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return d;
  const out = {};
  for (const [k, n] of Object.entries(v).slice(0, 60)) {
    const m = Math.round(Number(n));
    if (typeof k === "string" && k.length <= 120 && m >= 1 && m <= 1440) out[k] = m;
  }
  return out;
};

const SCHEMA = {
  // Window behaviour
  mode: [oneOf("desktop", "overlay"), "desktop"],
  coverTaskbar: [bool(), true],
  takeover: [bool(), false],
  takeoverHideTaskbar: [bool(), true],
  takeoverKeepVisible: [bool(), true],
  overlayHideOnBlur: [bool(), true],
  hideAfterLaunch: [bool(), true],
  startHidden: [bool(), false],
  openAtLogin: [bool(), false],
  closeToTray: [bool(), true],
  hotkeyToggle: [accelerator(), "CommandOrControl+`"],
  hotkeyLauncher: [accelerator(), "CommandOrControl+Shift+Space"],
  // Next / previous workspace tab: inside eDEX, and from an app tab's window.
  hotkeyTabNext: [accelerator(), "CommandOrControl+Tab"],
  hotkeyTabPrev: [accelerator(), "CommandOrControl+Shift+Tab"],

  // Appearance & feedback
  theme: [str(64), "tron"],
  uiScale: [int(70, 160), 100],
  bootAnimation: [bool(), true],
  bootLogo: [str(12000), ""],
  bootSubtitle: [str(64), ""],
  audioEnabled: [bool(), true],
  audioVolume: [int(0, 100), 50],
  audioFeedback: [bool(), false],
  clock24h: [bool(), true],
  clockZones: [strList(6, 64), ["local", "UTC"]],
  temperatureUnit: [oneOf("C", "F"), "C"],

  // Performance
  perfProfile: [oneOf("auto", "performance", "balanced", "eco"), "auto"],
  throttleUnfocused: [bool(), true],
  termGpu: [bool(), true],

  // Layout
  layoutPreset: [oneOf("shell", "classic", "typeleft", "panels", "panels-right", "focus", "custom"), "shell"],
  showTopbar: [bool(), true],
  showDock: [bool(), true],
  showLeftColumn: [bool(), true],
  showRightColumn: [bool(), true],
  columnsSide: [oneOf("split", "left", "right"), "split"],
  columnWidth: [int(70, 160), 100],
  filesPanel: [oneOf("off", "bottom", "column"), "off"],
  filesWidth: [int(25, 70), 42],
  bottomOrder: [oneOf("files-left", "keyboard-left"), "files-left"],
  filesFollowTerminal: [bool(), true],
  filesView: [oneOf("list", "grid"), "list"],
  themeLayouts: [bool(), true],
  customCss: [str(50000), ""],
  showKeyboard: [bool(), false],
  keyboardLayout: [(v, d) => (typeof v === "string" && (v === "auto" || /^[A-Za-z0-9][\w.-]{0,63}$/.test(v)) ? v : d), "auto"],
  hiddenWidgets: [strList(32, 64), []],
  shownWidgets: [strList(32, 64), []],
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
  mediaEqOn: [bool(), false],
  mediaEqPreset: [str(32), "flat"],
  mediaEq: [(v, d) => (Array.isArray(v) && v.length === 10 ? v.map((x) => Math.max(-12, Math.min(12, Math.round(Number(x) * 2) / 2 || 0))) : d), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  mediaSource: [oneOf("local", "spotify"), "local"],
  mediaView: [oneOf("player", "library", "radio"), "player"],
  musicFolders: [strList(12, 1024), []],
  radioStations: [stations(), []],
  lyrics: [bool(), true],

  // Visualizer (media player)
  vizStyle: [oneOf("bars", "mirror", "line", "wave", "radial", "dots", "blocks"), "bars"],
  vizBars: [int(16, 128), 64],
  vizColor: [oneOf("theme", "gradient", "rainbow", "custom"), "theme"],
  vizCustomColor: [(v, d) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d), "#ff9a3d"],
  vizPeaks: [bool(), false],
  vizReflection: [bool(), true],
  vizSmoothing: [int(0, 95), 78],
  vizSensitivity: [int(50, 200), 100],

  // Spotify (Web API with the user's own Client ID; tokens live encrypted
  // outside settings)
  spotifyClientId: [(v, d) => (typeof v === "string" && (v === "" || /^[0-9a-f]{32}$/i.test(v.trim())) ? v.trim().toLowerCase() : d), ""],

  // Timer
  pomodoroWork: [int(1, 120), 25],
  pomodoroBreak: [int(1, 60), 5],
  pomodoroLong: [int(1, 90), 15],
  pomodoroRounds: [int(2, 8), 4],

  // Alerts
  alertBattery: [bool(), true],
  alertBatteryLevel: [int(5, 50), 20],
  alertDisk: [bool(), true],
  alertDiskGb: [int(1, 200), 5],

  // Desktop extras
  hudDisplays: [bool(), false],
  idleScreen: [bool(), false],
  idleMinutes: [int(1, 120), 10],
  idleStyle: [oneOf("screen", "wallpaper"), "screen"],
  idleEffect: [oneOf("matrix", "hex", "stars", "globe", "ascii"), "matrix"],
  backgroundFx: [oneOf("none", "matrix", "hex", "stars"), "none"],

  // ASCII wallpaper (a workspace pane, the idle pane and an idle/saver effect)
  wallpaperArt: [str(12000), ""],
  wallpaperEffect: [oneOf("none", "scan", "glitch", "type", "pulse"), "scan"],
  wallpaperClock: [bool(), true],
  wallpaperBackdrop: [oneOf("none", "matrix", "hex", "stars"), "none"],

  // Screen saver: system-wide, over every app, while eDEX runs
  screensaver: [bool(), false],
  screensaverMinutes: [int(1, 240), 15],
  screensaverEffect: [oneOf("matrix", "hex", "stars", "globe", "ascii"), "matrix"],
  screensaverLock: [bool(), false],
  screensaverRespectApps: [bool(), true],
  screensaverAllDisplays: [bool(), true],

  // Browser tabs and app tabs
  browserLinks: [bool(), false],
  browserHome: [(v, d) => (typeof v === "string" && (v === "" || /^https?:\/\/\S+$/i.test(v)) ? v.slice(0, 2048) : d), ""],
  appTabs: [oneOf("off", "all"), "off"],
  openAppsInside: [bool(), false],
  appTabsCtrlTab: [bool(), true],

  // Notification centre
  dnd: [bool(), false],

  // Games: the library, and game mode while one runs
  gameMode: [oneOf("auto", "on", "off"), "auto"],
  gameModeQuiet: [bool(), true],

  // Calendar subscriptions
  calendarFeeds: [feeds(), []],

  // Workspaces
  profiles: [profiles(), []],
  activeProfile: [(v, d) => (typeof v === "string" && /^[\w-]{1,32}$/.test(v) ? v : d), "main"],
  // The theme / layout of workspaces that don't remember their own, kept
  // while you're in one that does.
  profileBase: [(v, d) => (v && typeof v === "object" && !Array.isArray(v) ? { theme: themeName(v.theme), layout: layoutSnapshot(v.layout) } : d), null],

  // Live wallpaper (behind the desktop icons while eDEX is hidden)
  liveWallpaper: [oneOf("off", "matrix", "hex", "stars", "globe", "ascii", "panels"), "off"],
  liveWallpaperDisplays: [oneOf("all", "primary"), "all"],
  liveWallpaperPause: [bool(), true],

  // Updates from the GitHub releases page
  updateCheck: [bool(), true],
  updateSkip: [str(32), ""],
  updateLastCheck: [int(0, 8.64e15), 0],
  indexSearch: [bool(), true],
  commandWidgets: [commandWidgets(), []],
  screenTimeLimits: [limits(), {}],

  // AI assistant (Claude); the API key lives encrypted outside settings.
  aiEnabled: [bool(), false],
  aiModel: [oneOf("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"), "claude-opus-5-5"],

  // Network & privacy
  allowNetworkGeolocation: [bool(), true],
  screenTime: [bool(), true],
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
    // Most main-process modules watch settings.
    this.setMaxListeners(50);
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
