// eDEX-UI main process entry point.
"use strict";

const path = require("path");
const { app, globalShortcut, Menu, powerMonitor } = require("electron");
const { registerSchemes, registerHandlers, APP_ORIGIN } = require("./lib/protocol");
const { NativeBridge } = require("./lib/native-bridge");
const { Settings } = require("./settings");
const { WindowManager, DEV_WINDOWED } = require("./window");
const { createTray } = require("./tray");
const { handle } = require("./ipc/util");
const { registerTerminal } = require("./ipc/terminal");
const { registerSystem } = require("./ipc/system");
const { registerFiles } = require("./ipc/files");
const { registerDesktop } = require("./ipc/desktop");
const { registerNetwork, registerClipboard, registerNotes, registerThemes, registerAlarms } = require("./ipc/extras");
const { registerMedia } = require("./ipc/media");
const { registerKeyboards } = require("./ipc/keyboards");
const { Takeover } = require("./lib/takeover");
const { registerWifi } = require("./ipc/wifi");
const { ScreenTime } = require("./lib/screentime");
const { Alerts } = require("./lib/alerts");
const { registerAudio } = require("./ipc/audio");
const { registerNowPlaying } = require("./ipc/nowplaying");
const { registerBluetooth } = require("./ipc/bluetooth");
const { registerDisk } = require("./ipc/disk");
const { registerArrange } = require("./ipc/arrange");
const { registerTools } = require("./ipc/tools");
const { registerAi } = require("./ipc/ai");
const { Hud } = require("./hud");
const { Telemetry } = require("./lib/telemetry");
const { IconService } = require("./lib/icon-service");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  registerSchemes();
  app.setAppUserModelId("com.edex-ui.windows");
  Menu.setApplicationMenu(null);

  let windows;
  let terminal;
  let clip;
  let notes;
  let bridge;
  let settings;
  let telemetry;
  let icons;
  let alarms;
  let keyboards;
  let takeover;
  let screenTime;
  let aux;
  let arrange;
  let tools;
  let ai;
  let hud;

  const quit = () => {
    if (windows) windows.quitting = true;
    app.quit();
  };

  // A second launch (e.g. from a shortcut) surfaces the running instance.
  app.on("second-instance", () => windows?.show());

  // The preload bridge is bound to the window, so it must never navigate away
  // from the bundled UI or spawn child windows that would inherit it.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.whenReady().then(() => {
    registerHandlers();
    settings = new Settings(app.getPath("userData"));
    bridge = new NativeBridge({ workDir: path.join(app.getPath("userData"), "native") });
    // A second helper for slow or long-running calls (media sessions,
    // Bluetooth, Windows Search, disk scans) so they never hold up the
    // telemetry the panels refresh every second. Started on first use, after
    // the first helper has compiled the shared interop types.
    aux = new NativeBridge({
      workDir: path.join(app.getPath("userData"), "native"),
      waitFor: () => bridge.call("ping", {}, 30000)
    });
    windows = new WindowManager({ settings, bridge });

    handle("app:info", () => ({
      version: app.getVersion(),
      dev: !app.isPackaged,
      windowed: DEV_WINDOWED,
      mode: windows.mode,
      platform: process.platform
    }));
    handle("app:quit", () => quit());
    handle("app:hide", () => windows.hide());
    handle("app:devtools", (event) => event.sender.toggleDevTools());
    handle("app:reload", (event) => event.sender.reloadIgnoringCache());
    handle("settings:get", () => settings.all());
    handle("settings:set", (_e, patch) => settings.set(patch));
    settings.on("change", (changed) => windows.send("settings:changed", changed));

    telemetry = new Telemetry({ bridge });
    icons = new IconService({ bridge, cacheFile: path.join(app.getPath("userData"), "icon-cache.json") });

    terminal = registerTerminal({ settings });
    registerSystem({ windows, telemetry });
    registerFiles({ windows, bridge, icons, aux });
    const desktop = registerDesktop({ windows, bridge, icons });
    registerNetwork({ settings });
    clip = registerClipboard({ settings, windows, bridge });
    notes = registerNotes();
    alarms = registerAlarms({ windows });
    registerThemes({ windows });
    registerMedia({ windows });
    keyboards = registerKeyboards({ windows });
    registerWifi();
    const ownPids = () => [process.pid, ...app.getAppMetrics().map((m) => m.pid)];
    const alerts = new Alerts({ telemetry, settings, windows });
    alerts.start();
    screenTime = new ScreenTime({
      bridge, settings, userData: app.getPath("userData"), ownPids,
      notify: (title, body) => alerts.notify("warn", title, body)
    });
    screenTime.apply();
    handle("screentime:get", (_e, offset) => screenTime.get(offset));
    handle("screentime:clear", () => screenTime.clear());
    handle("app:idle", () => powerMonitor.getSystemIdleTime());
    registerAudio({ bridge, ownPids });
    registerNowPlaying({ aux });
    registerBluetooth({ aux });
    registerDisk({ aux });
    arrange = registerArrange({ bridge, windows, ownPids });
    tools = registerTools({ settings, windows });
    ai = registerAi({ settings });
    hud = new Hud({ settings, windows, bridge });

    // The bridge starts right away (the panels' first readings come from
    // it) and primes CPU/process/network deltas so first values are real.
    bridge.warmUp();
    telemetry.warm();

    // Desktop takeover: first put back a taskbar a crashed session may have
    // left hidden, then follow the window.
    takeover = new Takeover({ settings, windows, bridge, userData: app.getPath("userData") });
    handle("takeover:state", () => takeover.state());
    handle("takeover:peek", () => takeover.peek(15000));
    const recovering = takeover.recover();

    const win = windows.create();
    recovering.finally(() => takeover.attach(win));
    hud.attach(win);
    createTray({ windows, settings, quit });
    registerHotkeys();
    applyLoginItem();
    settings.on("change", (changed) => {
      if ("hotkeyToggle" in changed || "hotkeyLauncher" in changed) registerHotkeys();
      if ("openAtLogin" in changed || "takeover" in changed) applyLoginItem();
    });

    // Rebuilding the installed-app index runs Get-StartApps (about a second
    // of helper time); the launcher answers from the disk cache until then,
    // so it is pushed well past startup.
    setTimeout(() => desktop.warm(), 25000);
  });

  function registerHotkeys() {
    globalShortcut.unregisterAll();
    const failures = [];
    const bind = (accelerator, fn) => {
      if (!accelerator) return;
      try {
        if (!globalShortcut.register(accelerator, fn)) failures.push(accelerator);
      } catch (_) {
        failures.push(accelerator);
      }
    };
    bind(settings.get("hotkeyToggle"), () => windows.toggle());
    bind(settings.get("hotkeyLauncher"), () => windows.toggle("launcher"));
    if (failures.length) {
      setTimeout(() => windows.send("app:notice", {
        level: "warn",
        message: `Hotkey unavailable (in use by another app): ${failures.join(", ")}`
      }), 4000);
    }
  }

  // At sign-in eDEX normally starts in the tray; when it has taken over the
  // desktop it starts on screen instead.
  function applyLoginItem() {
    const openAtLogin = settings.get("openAtLogin");
    const extra = settings.get("takeover") === true ? [] : ["--hidden"];
    const opts = { openAtLogin, args: extra };
    if (!app.isPackaged) {
      opts.path = process.execPath;
      opts.args = [path.resolve(app.getAppPath()), ...extra];
    }
    try { app.setLoginItemSettings(opts); } catch (_) {}
  }

  // Ctrl+C or closing the console eDEX was started from (npm start), and
  // termination requests: put the taskbar back, then exit.
  let exiting = false;
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(sig, () => {
      if (exiting) return;
      exiting = true;
      if (windows) windows.quitting = true;
      Promise.resolve(takeover?.restore()).finally(() => app.exit(0));
    });
  }

  // Quitting waits (briefly) for the taskbar to be put back.
  let restoredForQuit = false;
  app.on("before-quit", (event) => {
    if (windows) windows.quitting = true;
    if (restoredForQuit || !takeover?.hidden) return;
    event.preventDefault();
    takeover.restore().finally(() => {
      restoredForQuit = true;
      app.quit();
    });
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    terminal?.killAll();
    clip?.stop();
    alarms?.stop();
    keyboards?.stop();
    notes?.flush();
    screenTime?.flush();
    arrange?.flush();
    tools?.flush();
    ai?.stop();
    hud?.closeAll();
    icons?.flush();
    settings?.flush();
    bridge?.stop();
    aux?.stop();
  });

  // The tray keeps the app alive; quitting is explicit.
  app.on("window-all-closed", () => {
    if (windows?.quitting || !settings?.get("closeToTray")) app.quit();
  });
}
