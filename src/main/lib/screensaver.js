// Screen saver mode: after the chosen minutes without keyboard or mouse input
// anywhere (Windows' own idle timer), eDEX covers every display with its idle
// effect, above all apps, even while eDEX itself is hidden in the tray. Any
// input ends it, and Windows can lock at that moment, like the classic
// "On resume, display logon screen" option.
//
// It holds back while a full-screen app is in front or something asks
// Windows to keep the display on (video playback, presentations, calls).
"use strict";

const path = require("path");
const { BrowserWindow, screen, powerMonitor } = require("electron");
const { APP_ORIGIN } = require("./protocol");

const CHECK_MS = 10000;

class Screensaver {
  constructor({ settings, windows, bridge, ownPids, windowed = false }) {
    this.settings = settings;
    this.windows = windows;
    this.bridge = bridge;
    this.ownPids = ownPids;
    this.windowed = windowed;
    this.wins = [];
    this.locked = false;
    this.preview = false;
    powerMonitor.on("lock-screen", () => { this.locked = true; this.stop(false); });
    powerMonitor.on("unlock-screen", () => { this.locked = false; });
    powerMonitor.on("suspend", () => this.stop(false));
    this.timer = setInterval(() => this.tick(), CHECK_MS);
  }

  get running() {
    return this.wins.length > 0;
  }

  async tick() {
    if (!this.settings.get("screensaver") || this.running || this.locked || this.checking) return;
    if (powerMonitor.getSystemIdleTime() < (this.settings.get("screensaverMinutes") || 15) * 60) return;
    this.checking = true;
    try {
      if (this.settings.get("screensaverRespectApps") !== false) {
        const st = await this.bridge.call("saverBlocked", { exclude: this.ownPids() }, 4000).catch(() => null);
        if (st?.fullscreen || st?.display) return;
      }
      // Input may have arrived while the helper answered.
      if (powerMonitor.getSystemIdleTime() >= (this.settings.get("screensaverMinutes") || 15) * 60) this.start();
    } finally {
      this.checking = false;
    }
  }

  start({ preview = false } = {}) {
    if (this.running) return false;
    this.preview = preview;
    const primary = screen.getPrimaryDisplay();
    const displays = this.settings.get("screensaverAllDisplays") === false ? [primary] : screen.getAllDisplays();
    for (const d of displays) {
      const b = this.windowed
        ? { x: d.workArea.x + 60, y: d.workArea.y + 60, width: Math.min(1280, d.workArea.width - 120), height: Math.min(760, d.workArea.height - 120) }
        : d.bounds;
      const win = new BrowserWindow({
        ...b,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        thickFrame: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        backgroundColor: "#000000",
        title: "eDEX-UI screen saver",
        icon: path.join(__dirname, "..", "assets", "icon.png"),
        webPreferences: {
          preload: path.join(__dirname, "..", "preload.js"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webviewTag: false,
          spellcheck: false,
          backgroundThrottling: false
        }
      });
      if (!this.windowed) win.setAlwaysOnTop(true, "screen-saver");
      win.on("page-title-updated", (e) => e.preventDefault());
      win.loadURL(`${APP_ORIGIN}/index.html?saver=1${d.id === primary.id ? "&primary=1" : ""}`);
      win.once("ready-to-show", () => {
        if (win.isDestroyed()) return;
        win.show();
        if (d.id === primary.id) win.focus();
      });
      win.on("closed", () => { this.wins = this.wins.filter((w) => w !== win); });
      this.windows.addSatellite(win);
      this.wins.push(win);
    }
    // Input anywhere ends it, even if Windows kept focus on another app.
    // (The idle timer counts whole seconds.)
    const started = Date.now();
    clearInterval(this.watch);
    this.watch = setInterval(() => {
      if (Date.now() - started > 1800 && powerMonitor.getSystemIdleTime() < 1) this.stop(true);
    }, 350);
    return true;
  }

  // byUser: ended by input (may lock Windows); otherwise closed by eDEX.
  stop(byUser = true) {
    clearInterval(this.watch);
    this.watch = null;
    const wins = this.wins;
    this.wins = [];
    for (const w of wins) if (!w.isDestroyed()) w.destroy();
    if (wins.length && byUser && !this.preview && this.settings.get("screensaverLock")) {
      this.bridge.call("lock").catch(() => {});
    }
    this.preview = false;
  }

  dispose() {
    clearInterval(this.timer);
    this.stop(false);
  }
}

module.exports = { Screensaver };
