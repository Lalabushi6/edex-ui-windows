// Renderer entry point: load settings and theme, build the shell, register
// commands and hotkeys, restore the workspace.
import { $ } from "./core/dom.js";
import * as settings from "./core/settings.js";
import { applyTheme } from "./core/theme.js";
import { setWindowVisible, configure, profile, onSchedulingChange, setGameMode, poll } from "./core/poll.js";
import { onBattery } from "./core/live.js";
import { emit, on, markBooted } from "./core/bus.js";
import { command, initHotkeys, setKeys, comboFromAccelerator } from "./core/commands.js";
import { toast, cleanError, closeMenu } from "./core/ui.js";
import { mountWidgets, mountFixed } from "./widgets/registry.js";
import { initBackgroundFx } from "./shell/fx.js";
import { initIdleScreen, showIdleScreen } from "./shell/idle.js";
import { loadAgenda } from "./shell/agenda.js";
import { initAi, openAiPanel } from "./shell/ai.js";
import "./widgets/system.js";
import "./widgets/tools.js";
import "./widgets/globe.js";
import "./widgets/media.js";
import "./widgets/utility.js";
import { initCommandWidgets, editCommandWidget } from "./widgets/extra.js";
import "./widgets/tasks.js";
import "./widgets/lyrics.js";
import { player } from "./media/player.js";
import { Workspace } from "./workspace/workspace.js";
import { initTopbar } from "./shell/topbar.js";
import { initDock } from "./shell/dock.js";
import { openLauncher, launcherIsOpen, closeLauncher, preloadLauncher, loadAppsCached } from "./shell/launcher.js";
import { openSettings } from "./shell/settings-panel.js";
import { openHelp, openFileSearch, runBoot, showGreeting } from "./shell/extras.js";
import { initKeyboard, openLayoutsFolder, importLayouts } from "./shell/keyboard.js";
import { initLayout, applyPreset, PRESETS } from "./core/layout.js";
import { initFilePanel } from "./shell/filepanel.js";
import { openThemeEditor, openCssEditor, initCustomCss } from "./shell/theme-studio.js";
import { openArrangements, quickLayout, saveArrangement } from "./shell/arrange.js";
import { openUpdates, initUpdates } from "./shell/updates.js";
import { editWallpaperArt, mountWallpaper } from "./shell/wallpaper.js";
import { clearBrowsingData } from "./workspace/browser.js";
import { initNotices } from "./shell/notices.js";
import { openGameLibrary, loadGames } from "./shell/games.js";
import { initProfiles, switchProfile, newProfileDialog, captureProfile, activeProfile } from "./shell/profiles.js";
import { startEffect } from "./shell/fx.js";

const api = window.edex;
let workspace;
let dock;
let keyboard;

// Without the top bar and dock the launcher and settings stay reachable by
// hotkey; say so once when they are first hidden.
function hintHiddenChrome() {
  const hidden = settings.get("showTopbar") === false || settings.get("showDock") === false;
  let shown = false;
  try { shown = localStorage.getItem("edex.chromeHint") === "1"; } catch (_) {}
  if (!hidden || shown) return;
  try { localStorage.setItem("edex.chromeHint", "1"); } catch (_) {}
  toast("Top bar / dock hidden: Ctrl+Shift+Space opens the launcher, Ctrl+, settings, Ctrl+Shift+A switches windows", { timeout: 7000 });
}

function applyPerformance() {
  configure({ profile: settings.get("perfProfile") || "auto", throttle: settings.get("throttleUnfocused") !== false });
}

// Eco also switches off decorative CSS animation (scanlines, glows, pulses).
function applyProfileClass() {
  document.documentElement.classList.toggle("eco", profile().name === "eco");
}

function toggleLauncher(opts) {
  if (launcherIsOpen()) closeLauncher();
  else openLauncher(opts);
}

async function registerCommands() {
  const cmd = (id, title, run, extra = {}) => command({ id, title, run, ...extra });
  cmd("launcher.open", "Open launcher", () => toggleLauncher(), { keys: "Ctrl+Shift+Space", icon: "search", keywords: "search start menu run" });
  cmd("palette.open", "Command palette", () => openLauncher({ query: ">" }), { keys: "Ctrl+Shift+P", icon: "command" });
  cmd("windows.show", "Switch window", () => openLauncher({ filter: "windows" }), { keys: "Ctrl+Shift+A", icon: "window", keywords: "alt tab task switcher" });
  cmd("settings.open", "eDEX settings", () => openSettings(), { keys: "Ctrl+,", icon: "gear", keywords: "settings preferences options config" });
  cmd("help.open", "Keyboard shortcuts", () => openHelp(), { keys: "F1", icon: "help", keywords: "help cheatsheet" });
  cmd("terminal.new", "New terminal tab", () => workspace.add("terminal"), { keys: "Ctrl+Shift+T", icon: "terminal", keywords: "shell console powershell cmd" });
  cmd("files.new", "New file explorer tab", () => workspace.add("files"), { keys: "Ctrl+Shift+E", icon: "folder", keywords: "explorer browse" });
  cmd("processes.open", "Process manager", () => workspace.openProcesses(), { icon: "process", keywords: "task manager kill end process" });
  cmd("tab.close", "Close tab", () => workspace.closeActive(), { keys: "Ctrl+Shift+W", icon: "close" });
  cmd("tab.next", "Next tab", () => workspace.cycle(1), { icon: "forward" });
  cmd("tab.prev", "Previous tab", () => workspace.cycle(-1), { icon: "back" });
  // Ctrl+Tab / Ctrl+Shift+Tab unless changed in Settings → General.
  const applyTabKeys = () => {
    setKeys("tab.next", comboFromAccelerator(settings.get("hotkeyTabNext")));
    setKeys("tab.prev", comboFromAccelerator(settings.get("hotkeyTabPrev")));
  };
  applyTabKeys();
  settings.watch(["hotkeyTabNext", "hotkeyTabPrev"], applyTabKeys);
  for (let i = 1; i <= 9; i++) cmd(`tab.${i}`, `Go to tab ${i}`, () => workspace.byIndex(i - 1), { keys: `Ctrl+${i}`, hidden: true });
  cmd("files.search", "Find files…", () => {
    const cwd = workspace.active?.type === "files" ? workspace.active.cwd : null;
    openFileSearch(cwd || undefined);
  }, {
    keys: "Ctrl+Shift+F", icon: "search", keywords: "search find locate",
    // In a focused terminal the same keys open find-in-terminal instead.
    when: () => !document.activeElement?.closest?.(".xterm")
  });
  cmd("snapshot.export", "Export system snapshot", async () => {
    try {
      const path = await api.sys.snapshot();
      toast("Snapshot saved to Documents", { level: "ok", action: { label: "Show", run: () => api.fs.reveal(path) } });
    } catch (e) { toast(cleanError(e), { level: "warn" }); }
  }, { keys: "Ctrl+Shift+S", icon: "snapshot", keywords: "report json export diagnostics" });
  cmd("keyboard.toggle", "Toggle on-screen keyboard", () => settings.set({ showKeyboard: !settings.get("showKeyboard") }), { keys: "Ctrl+Shift+K", icon: "keyboard" });
  cmd("keyboard.password", "On-screen keyboard: password mode", () => {
    if (!settings.get("showKeyboard")) settings.set({ showKeyboard: true });
    keyboard?.togglePassword();
  }, { icon: "lock", keywords: "keyboard secret hide feedback kb_passmode" });
  cmd("keyboard.folder", "Open custom keyboard layouts folder", () => openLayoutsFolder(), { icon: "folder", keywords: "keyboard layout custom json" });
  cmd("keyboard.import", "Import keyboard layout…", () => importLayouts(), { icon: "download", keywords: "keyboard layout custom json" });
  cmd("settings.keyboard", "Keyboard settings", () => openSettings("keyboard"), { icon: "keyboard", keywords: "on-screen keyboard layout azerty qwertz dvorak colemak" });
  cmd("layout.left", "Toggle left column", () => settings.set({ showLeftColumn: !settings.get("showLeftColumn") }), { icon: "layout", keywords: "panel sidebar hide show" });
  cmd("layout.right", "Toggle right column", () => settings.set({ showRightColumn: !settings.get("showRightColumn") }), { icon: "layout", keywords: "panel sidebar hide show" });
  cmd("layout.topbar", "Toggle top bar", () => settings.set({ showTopbar: settings.get("showTopbar") === false }), { icon: "layout", keywords: "status bar header hide show" });
  cmd("layout.dock", "Toggle dock", () => settings.set({ showDock: settings.get("showDock") === false }), { icon: "layout", keywords: "taskbar windows hide show" });
  cmd("layout.files", "Toggle file browser panel", () => settings.set({ filesPanel: settings.get("filesPanel") === "off" ? (settings.get("columnsSide") === "split" ? "bottom" : "column") : "off" }), { icon: "folder", keywords: "filesystem panel bottom edex" });
  for (const [name, preset] of Object.entries(PRESETS)) {
    cmd(`layout.preset.${name}`, `Layout: ${preset.label}`, () => applyPreset(name), { icon: "layout", keywords: `layout preset arrangement ${preset.desc}` });
  }
  cmd("settings.layout", "Layout settings", () => openSettings("layout"), { icon: "layout", keywords: "arrange columns panels topbar dock" });
  cmd("settings.theme", "Theme editor", () => openThemeEditor(), { icon: "palette", keywords: "colours colors fonts theme customise customize css" });
  cmd("settings.css", "Edit custom CSS", () => openCssEditor(), { icon: "code", keywords: "style css customise customize" });
  cmd("takeover.toggle", "Toggle desktop takeover", () => {
    const on = settings.get("takeover") !== true;
    settings.set({ takeover: on });
    toast(on ? "eDEX has taken over the desktop" : "Desktop takeover off — Windows taskbar restored", { timeout: 2200 });
  }, { icon: "desktop", keywords: "fullscreen taskbar hide windows desktop shell replace kiosk" });
  cmd("ai.open", "Ask Claude", () => openAiPanel({}), { keys: "Ctrl+Shift+J", icon: "ai", keywords: "ai assistant chat claude help question" });
  cmd("disk.open", "Disk usage map", () => workspace.openDisk(), { icon: "disk", keywords: "storage space analyzer treemap sunburst large files folders windirstat" });
  cmd("widgets.command", "New command widget…", () => editCommandWidget(), { icon: "terminal", keywords: "custom widget script output panel powershell" });
  cmd("idle.show", "Show idle screen", () => showIdleScreen(), { icon: "moon", keywords: "screensaver idle clock matrix" });
  cmd("saver.start", "Start screen saver", () => api.saver.start().catch((e) => toast(cleanError(e), { level: "warn" })), { icon: "saver", keywords: "screensaver idle lock away blank screen all monitors" });
  cmd("browser.new", "New browser tab", () => workspace.openBrowser(""), { keys: "Ctrl+Shift+B", icon: "globe", keywords: "web internet chrome edge website page url" });
  cmd("browser.clear", "Clear browsing data…", () => clearBrowsingData(), { icon: "trash", keywords: "browser cookies cache history sign out" });
  cmd("apptab.pick", "Show a window as a tab…", () => workspace.pickApp(document.querySelector("#workspace .tab-actions .icon-btn:last-child") || document.body), { icon: "apptab", keywords: "app window tab dock embed integrate" });
  cmd("apptab.all", "Toggle: every open window as a tab", () => {
    const on = settings.get("appTabs") !== "all";
    settings.set({ appTabs: on ? "all" : "off" });
    toast(on ? "Every open window now has a tab" : "Window tabs closed — windows put back", { timeout: 2200 });
  }, { icon: "apptab", keywords: "app windows tabs taskbar integrate" });
  cmd("wallpaper.open", "ASCII wallpaper tab", () => workspace.openWallpaper(), { icon: "wallpaper", keywords: "ascii art wallpaper idle pane background" });
  cmd("wallpaper.edit", "Edit ASCII wallpaper art…", () => editWallpaperArt(), { icon: "edit", keywords: "ascii art wallpaper nfo block letters" });
  cmd("updates.check", "Check for updates", () => openUpdates(), { icon: "update", keywords: "update upgrade new version release github download" });
  cmd("games.open", "Games", () => openGameLibrary(), { keys: "Ctrl+Shift+G", icon: "gamepad", keywords: "games library steam epic xbox game pass play" });
  cmd("games.rescan", "Rescan game library", () => loadGames(true).then((l) => toast(`${l.length} games found`, { level: "ok" })), { icon: "refresh", keywords: "games steam epic xbox refresh" });
  cmd("settings.games", "Game mode settings", () => openSettings("games"), { icon: "gamepad", keywords: "game mode quiet focus gaming" });
  cmd("gamemode.toggle", "Game mode: on / auto", () => {
    const next = settings.get("gameMode") === "on" ? "auto" : "on";
    settings.set({ gameMode: next });
    toast(next === "on" ? "Game mode on — eDEX is resting" : "Game mode: automatic (when a game runs)", { timeout: 2000 });
  }, { icon: "gamepad", keywords: "game mode quiet pause gaming" });
  cmd("dnd.toggle", "Do not disturb", () => {
    const on = !settings.get("dnd");
    settings.set({ dnd: on });
    toast(on ? "Do not disturb on — notifications wait in the bell" : "Do not disturb off", { timeout: 2000 });
  }, { icon: "moon", keywords: "quiet notifications silence focus" });
  cmd("profiles.new", "New workspace…", () => newProfileDialog(), { icon: "layers", keywords: "workspace profile setup work gaming study" });
  cmd("profiles.save", "Save the current setup to this workspace", () => captureProfile(activeProfile().id), { icon: "layers", keywords: "workspace profile remember layout theme windows" });
  cmd("settings.workspaces", "Workspace settings", () => openSettings("workspaces"), { icon: "layers", keywords: "workspace profile hotkey schedule" });
  cmd("settings.calendars", "Calendar subscriptions", () => openSettings("calendar"), { icon: "calendar", keywords: "google outlook icloud ics webcal subscribe events" });
  cmd("library.open", "Music library", () => { settings.set({ mediaSource: "local", mediaView: "library" }); workspace.openMedia(); }, { icon: "album", keywords: "music library albums artists songs" });
  cmd("radio.open", "Internet radio", () => { settings.set({ mediaSource: "local", mediaView: "radio" }); workspace.openMedia(); }, { icon: "radio", keywords: "radio stations stream internet fm" });
  cmd("lyrics.toggle", "Media player: lyrics", () => emit("lyrics-toggle"), { icon: "lyrics", keywords: "lyrics words karaoke song" });
  cmd("apps.inside", "Toggle: open apps inside eDEX", () => {
    const on = !settings.get("openAppsInside");
    settings.set({ openAppsInside: on });
    toast(on ? "New app windows will open as tabs inside eDEX" : "Apps open in their own windows again", { timeout: 2200 });
  }, { icon: "apptab", keywords: "apps inside tabs embed windows open" });
  cmd("hud.toggle", "Toggle multi-monitor HUD", () => {
    const on = !settings.get("hudDisplays");
    settings.set({ hudDisplays: on });
    toast(on ? "HUD on: other displays show eDEX panels" : "HUD off", { timeout: 2000 });
  }, { icon: "desktop", keywords: "second monitor display screen hud telemetry" });
  cmd("windows.arrangements", "Window arrangements…", () => openArrangements(), { icon: "grid4", keywords: "tile snap layout restore save windows workspace fancyzones" });
  cmd("windows.side", "Windows: side by side", () => quickLayout("side"), { icon: "layout", keywords: "tile snap split two windows" });
  cmd("windows.columns", "Windows: three columns", () => quickLayout("columns"), { icon: "layout", keywords: "tile snap split windows" });
  cmd("windows.grid", "Windows: grid", () => quickLayout("grid"), { icon: "grid4", keywords: "tile snap four windows quarters" });
  cmd("windows.save", "Save window arrangement…", () => saveArrangement(), { icon: "grid4", keywords: "layout remember windows positions workspace" });
  cmd("mode.toggle", "Switch desktop / overlay mode", () => settings.set({ mode: settings.get("mode") === "overlay" ? "desktop" : "overlay" }), { icon: "window", keywords: "overlay desktop hud always on top" });
  cmd("app.hide", "Hide eDEX", () => api.app.hide(), { icon: "minimize", keywords: "show desktop minimize" });
  cmd("app.reload", "Reload interface", () => api.app.reload(), { icon: "refresh" });
  cmd("app.devtools", "Toggle developer tools", () => api.app.devtools(), { keys: "Ctrl+Shift+I", icon: "code" });
  cmd("app.quit", "Quit eDEX", () => api.app.quit(), { icon: "close", keywords: "exit close" });
  cmd("apps.refresh", "Refresh installed apps", async () => { await loadAppsCached(true); dock?.refresh(); toast("App list refreshed", { level: "ok" }); }, { icon: "apps", keywords: "rescan start menu" });
  cmd("shell.snip", "Screen snip", () => api.shell.snip().catch((e) => toast(cleanError(e), { level: "warn" })), { icon: "snip", keywords: "screenshot capture snipping tool print screen" });
  cmd("perf.cycle", "Cycle performance profile", () => {
    const order = ["auto", "performance", "balanced", "eco"];
    const next = order[(order.indexOf(settings.get("perfProfile") || "auto") + 1) % order.length];
    settings.set({ perfProfile: next });
    toast(`Performance profile: ${next[0].toUpperCase()}${next.slice(1)}`, { timeout: 1800 });
  }, { icon: "gauge", keywords: "eco battery power saver speed performance" });
  cmd("settings.performance", "Performance settings", () => openSettings("performance"), { icon: "gauge", keywords: "eco gpu throttle resource usage" });
  cmd("taskmgr.open", "Windows Task Manager", () => api.shell.taskManager().catch((e) => toast(cleanError(e), { level: "warn" })), { icon: "process" });
  cmd("player.open", "Media player", () => workspace.openMedia(), { keys: "Ctrl+Shift+M", icon: "audio", keywords: "music video playlist play songs" });
  cmd("player.toggle", "Media player: play / pause", () => player().toggle(), { icon: "playpause", keywords: "music pause resume" });
  cmd("player.next", "Media player: next track", () => player().next(), { icon: "next", keywords: "music skip" });
  cmd("player.prev", "Media player: previous track", () => player().prev(), { icon: "prev", keywords: "music back" });
  cmd("player.add", "Media player: add files…", async () => {
    const files = await api.player.pickFiles().catch(() => []);
    if (files.length) emit("open-media", { paths: files, play: !player().playing });
  }, { icon: "plus", keywords: "music video open queue" });
  cmd("notes.new", "New note", () => emit("new-note", { title: `Note ${new Date().toLocaleString()}` }), { icon: "note" });
  cmd("clipboard.clear", "Clear clipboard history", () => api.clip.clear(), { icon: "clipboard" });
  cmd("explorer.thispc", "This PC (all drives)", () => emit("open-path", { path: "" }), { icon: "drive", keywords: "drives disks computer" });
  for (const [key, label, iconName] of [["playpause", "Play / pause media", "playpause"], ["next", "Next track", "next"], ["prev", "Previous track", "prev"], ["mute", "Mute / unmute volume", "mute"]]) {
    cmd(`media.${key}`, label, () => api.media.key(key).catch((e) => toast(cleanError(e), { level: "warn" })), { icon: iconName, keywords: "music audio sound" });
  }
  for (const [action, label, iconName] of [["lock", "Lock computer", "lock"], ["sleep", "Sleep", "moon"], ["signout", "Sign out", "signout"], ["restart", "Restart computer", "restart"], ["shutdown", "Shut down computer", "power"]]) {
    cmd(`power.${action}`, label, () => api.power.action(action).catch((e) => toast(cleanError(e), { level: "warn" })), { icon: iconName, keywords: "power" });
  }
  try {
    for (const place of await api.fs.places()) {
      cmd(`place.${place.id}`, `Open ${place.label}`, () => emit("open-path", { path: place.path }), { icon: "folder", keywords: `folder ${place.label}` });
    }
  } catch (_) {}
}

// Multi-monitor HUD (a second window on another display): telemetry panels,
// globe and a large clock; no top bar, dock or workspace.
async function mainHud() {
  document.documentElement.classList.add("hud");
  await settings.loadSettings();
  initCustomCss();
  await applyTheme(settings.get("theme")).catch(() => applyTheme("tron"));
  document.getElementById("boot")?.remove();
  settings.watch("theme", (id) => applyTheme(id).catch(() => {}));
  applyPerformance();
  settings.watch(["perfProfile", "throttleUnfocused"], applyPerformance);
  onBattery((b) => configure({ battery: !!b.hasBattery && (!b.ac || !!b.saver) }));
  api.app.onVisibility(({ visible, focused }) => setWindowVisible(visible, focused));
  initBackgroundFx();
  const work = $("#work");
  const clock = document.createElement("div");
  clock.className = "hud-clock";
  const time = document.createElement("div");
  const date = document.createElement("div");
  date.className = "hud-date";
  clock.append(time, date);
  const center = document.createElement("div");
  center.className = "column hud-center";
  work.replaceChildren(clock, center);
  const tick = () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: !settings.get("clock24h") });
    date.textContent = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).toUpperCase();
  };
  tick();
  // The shared scheduler pauses it while the HUD is hidden (game mode, eDEX hidden).
  poll(tick, 1000, { fixed: true });
  mountFixed([
    [$("#col-left-body"), ["system", "cpu", "memory", "gpu", "top"]],
    [center, ["globe"]],
    [$("#col-right-body"), ["network", "storage", "weather", "media", "screentime"]]
  ]);
  markBooted();
}

// Screen saver window (one per display): the chosen effect, plus the clock
// and weather on the main display. Input closes every one of them.
async function mainSaver() {
  document.documentElement.classList.add("saver");
  await settings.loadSettings();
  initCustomCss();
  await applyTheme(settings.get("theme")).catch(() => applyTheme("tron"));
  document.getElementById("boot")?.remove();
  const primary = new URLSearchParams(location.search).has("primary");
  showIdleScreen({ effect: settings.get("screensaverEffect") || "matrix", info: primary, onDismiss: () => api.saver.dismiss() });
}

// Live wallpaper window (behind the desktop icons, one per display): an
// effect or the ASCII wallpaper; it never takes input.
async function mainWallpaper(effect) {
  document.documentElement.classList.add("saver", "wall");
  await settings.loadSettings();
  initCustomCss();
  await applyTheme(settings.get("theme")).catch(() => applyTheme("tron"));
  settings.watch("theme", (id) => applyTheme(id).catch(() => {}));
  document.getElementById("boot")?.remove();
  api.app.onVisibility(({ visible }) => setWindowVisible(visible, false));
  const host = document.createElement("div");
  host.className = "wall-host";
  document.body.append(host);
  if (effect === "ascii") mountWallpaper(host);
  else {
    const canvas = document.createElement("canvas");
    canvas.className = "wall-canvas";
    host.append(canvas);
    startEffect(canvas, effect, { maxFps: 20, scale: 0.75 });
  }
}

async function main() {
  console.log("%cmade by lalabushi", "color:#7fc8ff;font:600 11px monospace;letter-spacing:.2em");
  const params = new URLSearchParams(location.search);
  if (params.has("hud")) {
    if (params.has("wall")) document.documentElement.classList.add("wall");
    return mainHud();
  }
  if (params.has("saver")) return mainSaver();
  if (params.has("wall")) return mainWallpaper(params.get("wall"));
  await settings.loadSettings();
  initLayout();
  initCustomCss();
  await applyTheme(settings.get("theme")).catch(() => applyTheme("tron"));
  const boot = runBoot();

  settings.watch("theme", (id) => applyTheme(id).catch(() => {}));
  settings.watch(["showTopbar", "showDock"], hintHiddenChrome);
  onSchedulingChange(applyProfileClass);
  applyPerformance();
  settings.watch(["perfProfile", "throttleUnfocused"], applyPerformance);
  // Auto profile: Eco on battery or with Windows battery saver on.
  onBattery((b) => configure({ battery: !!b.hasBattery && (!b.ac || !!b.saver) }));
  api.app.onVisibility(({ visible, focused }) => {
    setWindowVisible(visible, focused);
    if (!visible) closeMenu();
  });
  api.app.onNotice(({ level, message }) => toast(message, { level, timeout: 6000 }));
  on("open-settings", ({ page } = {}) => openSettings(page));
  api.app.onCommand(({ name, toggle, id, scheduled, delta }) => {
    if (name === "launcher") toggle ? toggleLauncher() : openLauncher();
    else if (name === "settings") openSettings();
    else if (name === "profile") switchProfile(id, { scheduled });
    // Ctrl+Tab pressed while an app tab's window was in front.
    else if (name === "tab-cycle") workspace?.cycle(delta < 0 ? -1 : 1);
  });
  initNotices();
  // Game mode: nothing refreshes or animates while a game is in front.
  api.games.onGameMode(({ active }) => setGameMode(active));
  api.games.state().then(({ active }) => setGameMode(active)).catch(() => {});

  initHotkeys();
  initBackgroundFx();
  initIdleScreen();
  initUpdates();
  initAi();
  initTopbar($("#topbar"));
  dock = initDock($("#dock"));
  initCommandWidgets();
  mountWidgets($("#col-left-body"), $("#col-right-body"));
  workspace = new Workspace($("#workspace"));
  initProfiles(workspace);
  await registerCommands();
  keyboard = initKeyboard($("#keyboard"), () => workspace.activeTerminal());
  initFilePanel($("#filepanel"), () => workspace.activeTerminal());
  await workspace.init();
  preloadLauncher();
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  await boot;
  markBooted();
  // Re-arms task and event reminders even when the Tasks widget is hidden.
  loadAgenda();
  showGreeting($("#workspace"));
  workspace.focus();
}

main().catch((e) => {
  console.error("eDEX failed to start", e);
  document.getElementById("boot")?.remove();
  document.body.append(Object.assign(document.createElement("pre"), {
    textContent: `eDEX failed to start:\n${e?.stack || e}`,
    style: "position:fixed;inset:2rem;color:#ff8080;white-space:pre-wrap;z-index:9999"
  }));
});
