// eDEX-UI main process entry point.
"use strict";

const path = require("path");
const { app, globalShortcut, Menu } = require("electron");
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
const { registerNetwork, registerClipboard, registerNotes, registerThemes } = require("./ipc/extras");
const { registerMedia } = require("./ipc/media");

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
    windows = new WindowManager({ settings });

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

    terminal = registerTerminal({ settings });
    registerSystem({ windows, bridge });
    registerFiles({ windows, bridge });
    const desktop = registerDesktop({ windows, bridge });
    registerNetwork({ settings });
    clip = registerClipboard({ settings, windows });
    notes = registerNotes();
    registerThemes();
    registerMedia({ windows });

    windows.create();
    createTray({ windows, settings, quit });
    registerHotkeys();
    applyLoginItem();
    settings.on("change", (changed) => {
      if ("hotkeyToggle" in changed || "hotkeyLauncher" in changed) registerHotkeys();
      if ("openAtLogin" in changed) applyLoginItem();
    });

    // Warm the slow sources in the background so the first launcher open and
    // first dock refresh are instant.
    setTimeout(() => {
      bridge.warmUp();
      desktop.warm();
    }, 1500);
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

  function applyLoginItem() {
    const openAtLogin = settings.get("openAtLogin");
    const opts = { openAtLogin, args: ["--hidden"] };
    if (!app.isPackaged) {
      opts.path = process.execPath;
      opts.args = [path.resolve(app.getAppPath()), "--hidden"];
    }
    try { app.setLoginItemSettings(opts); } catch (_) {}
  }

  app.on("before-quit", () => {
    if (windows) windows.quitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    terminal?.killAll();
    clip?.stop();
    notes?.flush();
    settings?.flush();
    bridge?.stop();
  });

  // The tray keeps the app alive; quitting is explicit.
  app.on("window-all-closed", () => {
    if (windows?.quitting || !settings?.get("closeToTray")) app.quit();
  });
}
