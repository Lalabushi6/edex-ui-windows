// Renderer entry point: load settings and theme, build the shell, register
// commands and hotkeys, restore the workspace.
import { $ } from "./core/dom.js";
import * as settings from "./core/settings.js";
import { applyTheme } from "./core/theme.js";
import { setWindowVisible, configure, profile, onSchedulingChange } from "./core/poll.js";
import { onBattery } from "./core/live.js";
import { emit, markBooted } from "./core/bus.js";
import { command, initHotkeys } from "./core/commands.js";
import { toast, cleanError, closeMenu } from "./core/ui.js";
import { mountWidgets } from "./widgets/registry.js";
import "./widgets/system.js";
import "./widgets/tools.js";
import "./widgets/globe.js";
import "./widgets/media.js";
import "./widgets/utility.js";
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
  cmd("tab.next", "Next tab", () => workspace.cycle(1), { keys: "Ctrl+Tab", icon: "forward" });
  cmd("tab.prev", "Previous tab", () => workspace.cycle(-1), { keys: "Ctrl+Shift+Tab", icon: "back" });
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

async function main() {
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
  api.app.onCommand(({ name, toggle }) => {
    if (name === "launcher") toggle ? toggleLauncher() : openLauncher();
    else if (name === "settings") openSettings();
  });

  initHotkeys();
  initTopbar($("#topbar"));
  dock = initDock($("#dock"));
  mountWidgets($("#col-left-body"), $("#col-right-body"));
  workspace = new Workspace($("#workspace"));
  await registerCommands();
  keyboard = initKeyboard($("#keyboard"), () => workspace.activeTerminal());
  initFilePanel($("#filepanel"), () => workspace.activeTerminal());
  await workspace.init();
  preloadLauncher();
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  await boot;
  markBooted();
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
