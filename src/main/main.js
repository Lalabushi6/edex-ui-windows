// eDEX-UI main process entry point.
"use strict";

const path = require("path");
const { app, dialog, globalShortcut, Menu, powerMonitor, session, shell } = require("electron");
// The portable build keeps its data beside the .exe; this has to happen
// before anything (the single-instance lock included) touches userData.
const portable = require("./lib/portable");
portable.apply();
const paths = require("./lib/paths");
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
const { registerUpdates } = require("./ipc/updates");
const { registerBrowser } = require("./ipc/browser");
const { registerAppTabs } = require("./ipc/apptabs");
const { registerSpotify } = require("./ipc/spotify");
const { registerGames } = require("./ipc/games");
const { registerLyrics } = require("./ipc/lyrics");
const { registerRadio } = require("./ipc/radio");
const { registerLibrary } = require("./ipc/library");
const { registerCalendarFeeds } = require("./ipc/calfeeds");
const { Hud } = require("./hud");
const { Screensaver } = require("./lib/screensaver");
const { Notices } = require("./lib/notices");
const { GameMode } = require("./lib/gamemode");
const { LiveWallpaper } = require("./lib/livewall");
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
  let updates;
  let browser;
  let appTabs;
  let spotify;
  let saver;
  let notices;
  let games;
  let gameMode;
  let lyrics;
  let library;
  let calfeeds;
  let livewall;
  let profileTimer;
  let lastHotkeyFailures = "";

  const quit = () => {
    if (windows) windows.quitting = true;
    app.quit();
  };

  // A second launch (e.g. from a shortcut) surfaces the running instance.
  app.on("second-instance", () => windows?.show());

  // The preload bridge is bound to the window, so it must never navigate away
  // from the bundled UI or spawn child windows that would inherit it.
  // Browser tabs are web pages with their own rules (see ipc/browser.js).
  app.on("web-contents-created", (_event, contents) => {
    if (browser?.isBrowserSession(contents.session)) return;
    contents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.whenReady().then(async () => {
    registerHandlers();
    // First run of the portable build on a PC that has the installed version:
    // offer to bring its settings along to the drive.
    const pstate = portable.state();
    if (pstate.portable && pstate.fresh && portable.hasPcProfile()) {
      const { response } = await dialog.showMessageBox({
        type: "question", buttons: ["Copy them to the drive", "Start fresh"], defaultId: 0, cancelId: 1, noLink: true,
        title: "eDEX-UI portable",
        message: "Copy your eDEX settings from this PC?",
        detail: `This portable copy keeps everything in "${portable.DATA_DIR}" next to the .exe. eDEX is also installed on this PC: copy its settings, notes, tasks, themes and keyboard layouts to the drive?`
      }).catch(() => ({ response: 1 }));
      if (response === 0) portable.copyFromPc();
    }
    // The interface never needs camera, microphone, location, notifications
    // from web content, USB/HID/serial devices or downloads; only fullscreen
    // (media player video) is granted.
    const ses = session.defaultSession;
    const ALLOWED_PERMISSIONS = new Set(["fullscreen"]);
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
    ses.setDevicePermissionHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    // The encrypted AI key and Spotify sign-in never become readable through
    // file previews.
    paths.addSensitive(path.join(app.getPath("userData"), "ai-key.bin"));
    paths.addSensitive(path.join(app.getPath("userData"), "spotify-token.bin"));
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
      platform: process.platform,
      portable: portable.state().portable,
      portableNote: portable.state().reason,
      dataDir: app.getPath("userData")
    }));
    handle("app:openData", async () => {
      const err = await shell.openPath(app.getPath("userData"));
      if (err) throw new Error(err);
      return true;
    });
    handle("app:quit", () => quit());
    handle("app:hide", () => windows.hide());
    handle("app:devtools", (event) => event.sender.toggleDevTools());
    handle("app:reload", (event) => event.sender.reloadIgnoringCache());
    handle("settings:get", () => settings.all());
    handle("settings:set", (_e, patch) => settings.set(patch));
    settings.on("change", (changed) => windows.send("settings:changed", changed));

    // Notification centre: every eDEX notification goes through it.
    notices = new Notices({ settings, windows, userData: app.getPath("userData") });
    handle("notices:list", () => notices.list());
    handle("notices:seen", () => { notices.markSeen(); return true; });
    handle("notices:remove", (_e, id) => { notices.remove(String(id || "")); return true; });
    handle("notices:clear", () => { notices.clear(); return true; });
    // From the interface (downloads, missed reminders …), which shows its own toast.
    handle("notices:add", (_e, entry = {}) => {
      notices.add(entry, { toast: false, system: entry?.system === "never" ? "never" : "hidden" });
      return true;
    });
    settings.on("change", (changed) => { if ("dnd" in changed) notices.broadcast(); });

    telemetry = new Telemetry({ bridge });
    icons = new IconService({ bridge, cacheFile: path.join(app.getPath("userData"), "icon-cache.json") });

    terminal = registerTerminal({ settings });
    registerSystem({ windows, telemetry });
    registerFiles({ windows, bridge, icons, aux });
    const desktop = registerDesktop({ windows, bridge, icons });
    registerNetwork({ settings });
    clip = registerClipboard({ settings, windows, bridge });
    notes = registerNotes();
    alarms = registerAlarms({ windows, notices });
    registerThemes({ windows });
    registerMedia({ windows });
    keyboards = registerKeyboards({ windows });
    registerWifi();
    const ownPids = () => [process.pid, ...app.getAppMetrics().map((m) => m.pid)];
    const alerts = new Alerts({ telemetry, settings, notices });
    alerts.start();
    screenTime = new ScreenTime({
      bridge, settings, userData: app.getPath("userData"), ownPids,
      notify: (title, body) => notices.add({ level: "warn", kind: "screentime", title, body })
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

    // Game library, and game mode while one runs.
    games = registerGames({ settings, windows, bridge, aux });
    gameMode = new GameMode({ settings, bridge, games, ownPids });
    const applyGame = () => {
      const st = { active: gameMode.active, name: gameMode.name };
      windows.send("app:game", st);
      hud.setSuspended(st.active);
      notices.setQuiet("game", st.active && settings.get("gameModeQuiet") !== false);
    };
    gameMode.on("change", applyGame);
    settings.on("change", (c) => { if ("gameModeQuiet" in c) applyGame(); });
    handle("game:state", () => ({ active: gameMode.active, name: gameMode.name }));

    updates = registerUpdates({ settings, windows, notices });
    browser = registerBrowser({ windows, notices });
    appTabs = registerAppTabs({ windows, bridge, aux, ownPids, settings, isGame: (exe) => !!games.match(exe), gameMode });
    spotify = registerSpotify({ settings, windows });
    saver = new Screensaver({ settings, windows, bridge, ownPids, windowed: DEV_WINDOWED, gameMode });
    lyrics = registerLyrics({ settings });
    registerRadio({ windows });
    library = registerLibrary({ settings, windows });
    calfeeds = registerCalendarFeeds({ settings, windows });
    livewall = new LiveWallpaper({ settings, windows, bridge, gameMode });
    // Development runs can poke these from the main-process inspector.
    if (!app.isPackaged) globalThis.__edex = { livewall, gameMode, notices, games };
    handle("saver:start", () => saver.start({ preview: true }));
    handle("saver:dismiss", () => { saver.stop(true); return true; });

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
    browser.attach(win);
    livewall.attachTo(win);
    createTray({ windows, settings, quit, startSaver: () => saver.start({ preview: true }) });
    registerHotkeys();
    applyLoginItem();
    settings.on("change", (changed) => {
      if ("hotkeyToggle" in changed || "hotkeyLauncher" in changed || "profiles" in changed) registerHotkeys();
      if ("openAtLogin" in changed || "takeover" in changed) applyLoginItem();
    });

    // Workspaces that switch at a time of day (checked twice a minute; each
    // fires once per day at its minute).
    const fired = new Map();
    profileTimer = setInterval(() => {
      const now = new Date();
      const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const stamp = `${now.toDateString()} ${hm}`;
      for (const p of settings.get("profiles") || []) {
        if (!p.schedule || p.schedule.time !== hm || !p.schedule.days.includes(now.getDay()) || fired.get(p.id) === stamp) continue;
        fired.set(p.id, stamp);
        windows.send("app:command", { name: "profile", id: p.id, scheduled: true });
      }
    }, 20000);

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
    // A workspace's hotkey brings eDEX up in that workspace.
    for (const p of settings.get("profiles") || []) {
      if (!p.hotkey) continue;
      bind(p.hotkey, () => {
        windows.show();
        windows.send("app:command", { name: "profile", id: p.id });
      });
    }
    // Said once per set of failures, not on every re-registration.
    const said = failures.join(", ");
    if (said && said !== lastHotkeyFailures) {
      setTimeout(() => windows.send("app:notice", {
        level: "warn",
        message: `Hotkey unavailable (in use by another app): ${said}`
      }), 4000);
    }
    lastHotkeyFailures = said;
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
    } else if (portable.state().exe) {
      // The portable build runs from a temporary copy; sign-in must start
      // the .exe on the drive.
      opts.path = portable.state().exe;
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

  // Quitting waits (briefly) for the taskbar to be put back and for windows
  // shown as app tabs to return to where they were.
  let restoredForQuit = false;
  app.on("before-quit", (event) => {
    if (windows) windows.quitting = true;
    if (restoredForQuit || (!takeover?.hidden && !appTabs?.count)) return;
    event.preventDefault();
    Promise.allSettled([takeover?.restore(), appTabs?.releaseAll()]).finally(() => {
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
    updates?.stop();
    spotify?.stop();
    saver?.dispose();
    livewall?.dispose();
    gameMode?.dispose();
    games?.stop();
    games?.flush();
    lyrics?.flush();
    library?.flush();
    calfeeds?.stop();
    appTabs?.stop();
    notices?.flush();
    clearInterval(profileTimer);
    browser?.closeAll();
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
