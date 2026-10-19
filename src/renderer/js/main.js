// Renderer entry point: load settings and theme, build the shell, register
// commands and hotkeys, restore the workspace.
import { $ } from "./core/dom.js";
import * as settings from "./core/settings.js";
import { applyTheme } from "./core/theme.js";
import { setWindowVisible } from "./core/poll.js";
import { emit } from "./core/bus.js";
import { command, initHotkeys } from "./core/commands.js";
import { toast, cleanError, closeMenu } from "./core/ui.js";
import { mountWidgets } from "./widgets/registry.js";
import "./widgets/system.js";
import "./widgets/tools.js";
import "./widgets/globe.js";
import { Workspace } from "./workspace/workspace.js";
import { initTopbar } from "./shell/topbar.js";
import { initDock } from "./shell/dock.js";
import { openLauncher, launcherIsOpen, closeLauncher, preloadLauncher, loadAppsCached } from "./shell/launcher.js";
import { openSettings } from "./shell/settings-panel.js";
import { openHelp, openFileSearch, initKeyboard, runBoot } from "./shell/extras.js";

const api = window.edex;
let workspace;
let dock;

function applyLayout() {
  document.documentElement.style.setProperty("--ui-scale", String(settings.get("uiScale") / 100));
  const app = $("#app");
  app.classList.toggle("no-left", !settings.get("showLeftColumn"));
  app.classList.toggle("no-right", !settings.get("showRightColumn"));
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
  cmd("settings.open", "Settings", () => openSettings(), { keys: "Ctrl+,", icon: "gear", keywords: "preferences options config" });
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
  }, { keys: "Ctrl+Shift+F", icon: "search", keywords: "search find locate" });
  cmd("snapshot.export", "Export system snapshot", async () => {
    try {
      const path = await api.sys.snapshot();
      toast("Snapshot saved to Documents", { level: "ok", action: { label: "Show", run: () => api.fs.reveal(path) } });
    } catch (e) { toast(cleanError(e), { level: "warn" }); }
  }, { keys: "Ctrl+Shift+S", icon: "snapshot", keywords: "report json export diagnostics" });
  cmd("keyboard.toggle", "Toggle on-screen keyboard", () => settings.set({ showKeyboard: !settings.get("showKeyboard") }), { keys: "Ctrl+Shift+K", icon: "keyboard" });
  cmd("layout.left", "Toggle left column", () => settings.set({ showLeftColumn: !settings.get("showLeftColumn") }), { icon: "layout", keywords: "panel sidebar hide show" });
  cmd("layout.right", "Toggle right column", () => settings.set({ showRightColumn: !settings.get("showRightColumn") }), { icon: "layout", keywords: "panel sidebar hide show" });
  cmd("mode.toggle", "Switch desktop / overlay mode", () => settings.set({ mode: settings.get("mode") === "overlay" ? "desktop" : "overlay" }), { icon: "window", keywords: "overlay desktop hud always on top" });
  cmd("app.hide", "Hide eDEX", () => api.app.hide(), { icon: "minimize", keywords: "show desktop minimize" });
  cmd("app.reload", "Reload interface", () => api.app.reload(), { icon: "refresh" });
  cmd("app.devtools", "Toggle developer tools", () => api.app.devtools(), { keys: "Ctrl+Shift+I", icon: "code" });
  cmd("app.quit", "Quit eDEX", () => api.app.quit(), { icon: "close", keywords: "exit close" });
  cmd("apps.refresh", "Refresh installed apps", async () => { await loadAppsCached(true); dock?.refresh(); toast("App list refreshed", { level: "ok" }); }, { icon: "apps", keywords: "rescan start menu" });
  cmd("taskmgr.open", "Windows Task Manager", () => api.shell.taskManager().catch((e) => toast(cleanError(e), { level: "warn" })), { icon: "process" });
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
  applyLayout();
  await applyTheme(settings.get("theme")).catch(() => applyTheme("tron"));
  const boot = runBoot();

  settings.watch(["uiScale", "showLeftColumn", "showRightColumn"], applyLayout);
  settings.watch("theme", (id) => applyTheme(id).catch(() => {}));
  api.app.onVisibility(({ visible }) => {
    setWindowVisible(visible);
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
  mountWidgets($("#col-left"), $("#col-right"));
  workspace = new Workspace($("#workspace"));
  await registerCommands();
  initKeyboard($("#keyboard"), () => workspace.activeTerminal());
  await workspace.init();
  preloadLauncher();
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  await boot;
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
