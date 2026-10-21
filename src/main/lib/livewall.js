// Live wallpaper: while eDEX is hidden, its matrix rain, hex grid, starfield,
// globe, ASCII art or telemetry panels keep running as the Windows desktop
// background, behind the desktop icons (which stay clickable). One window per
// display, parented to Explorer's wallpaper layer by the native helper.
//
// It pauses (stops drawing) where a maximised or full-screen window covers
// it, on battery saver, and while a game runs; it goes away whenever eDEX is
// on screen, and comes back if Explorer restarts.
"use strict";

const path = require("path");
const { BrowserWindow, screen, powerMonitor } = require("electron");
const { APP_ORIGIN } = require("./protocol");

const TICK_MS = 3000;

class LiveWallpaper {
  constructor({ settings, windows, bridge, gameMode }) {
    this.settings = settings;
    this.windows = windows;
    this.bridge = bridge;
    this.gameMode = gameMode;
    this.mode = "none";
    this.wins = []; // { win, display, hwnd, attached, paused }
    this.forced = false; // development: run even while eDEX is visible
    this.queue = Promise.resolve();
    settings.on("change", (c) => {
      if ("liveWallpaper" in c || "liveWallpaperDisplays" in c) this.restart();
      else if ("theme" in c) for (const w of this.wins) if (!w.win.isDestroyed()) w.win.webContents.send("settings:changed", c);
    });
    for (const evt of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(evt, () => this.restart());
    gameMode?.on("change", () => this.tick());
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  attachTo(mainWin) {
    for (const evt of ["show", "hide", "minimize", "restore"]) mainWin.on(evt, () => this.sync());
    this.sync();
  }

  wanted() {
    if (this.settings.get("liveWallpaper") === "off") return false;
    const main = this.windows.win;
    const hidden = !main || main.isDestroyed() || !main.isVisible() || main.isMinimized();
    return this.forced || hidden;
  }

  sync() {
    this.queue = this.queue.then(() => (this.wanted() ? (this.wins.length ? null : this.start()) : this.stop())).catch(() => {});
    return this.queue;
  }

  restart() {
    this.queue = this.queue.then(() => this.stop()).then(() => (this.wanted() ? this.start() : null)).catch(() => {});
    return this.queue;
  }

  async start() {
    const effect = this.settings.get("liveWallpaper");
    if (effect === "off") return;
    const mode = await this.bridge.call("wallLocate", {}, 8000).catch(() => "none");
    this.mode = mode;
    if (mode === "none") return;
    const primary = screen.getPrimaryDisplay();
    const displays = this.settings.get("liveWallpaperDisplays") === "primary" ? [primary] : screen.getAllDisplays();
    for (const d of displays) {
      const win = new BrowserWindow({
        ...d.bounds,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        backgroundColor: "#000000",
        title: "eDEX-UI wallpaper",
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
      win.on("page-title-updated", (e) => e.preventDefault());
      const query = effect === "panels" ? "hud=1&wall=1" : `wall=${encodeURIComponent(effect)}${d.id === primary.id ? "&primary=1" : ""}`;
      win.loadURL(`${APP_ORIGIN}/index.html?${query}`);
      const entry = { win, display: d, hwnd: 0, attached: false, paused: false, failed: false };
      this.wins.push(entry);
      this.windows.addSatellite(win);
      win.on("closed", () => {
        this.wins = this.wins.filter((x) => x !== entry);
        // Explorer restarted (our parent went away): build them again. Not
        // after a failed attach, which would only fail again.
        if (!this.stopping && !entry.failed) setTimeout(() => this.sync(), 4000);
      });
      // Parented while still hidden (the helper shows it there), so it never
      // flashes over the other windows.
      win.once("ready-to-show", async () => {
        if (win.isDestroyed()) return;
        try { entry.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0)); } catch (_) { return; }
        const r = screen.dipToScreenRect(null, d.bounds);
        const res = await this.bridge.call("wallAttach", { hwnd: entry.hwnd, x: r.x, y: r.y, w: r.width, h: r.height }, 8000).catch(() => null);
        entry.attached = !!res?.ok;
        if (win.isDestroyed()) return;
        if (entry.attached) win.showInactive();
        else { entry.failed = true; win.destroy(); }
      });
    }
  }

  async stop() {
    this.stopping = true;
    const wins = this.wins;
    this.wins = [];
    for (const { win } of wins) if (!win.isDestroyed()) win.destroy();
    if (wins.length) await this.bridge.call("wallRefresh", {}, 4000).catch(() => {});
    this.stopping = false;
  }

  // Pause the wallpaper where it can't be seen, or while it shouldn't run.
  async tick() {
    if (!this.wins.length) return;
    const pauseAll = !!this.gameMode?.active || (this.settings.get("liveWallpaperPause") !== false && powerMonitor.isOnBatteryPower?.() && this.settings.get("perfProfile") !== "performance");
    let covered = null;
    if (!pauseAll && this.settings.get("liveWallpaperPause") !== false) covered = await this.bridge.call("wallCovered", {}, 3000).catch(() => null);
    for (const w of this.wins) {
      if (w.win.isDestroyed()) continue;
      const r = screen.dipToScreenRect(null, w.display.bounds);
      const hidden = pauseAll || (Array.isArray(covered) && covered[0] === r.x && covered[1] === r.y);
      if (hidden !== w.paused) {
        w.paused = hidden;
        w.win.webContents.send("app:visibility", { visible: !hidden, focused: false });
      }
    }
  }

  dispose() {
    clearInterval(this.timer);
    this.stopping = true;
    for (const { win } of this.wins) if (!win.isDestroyed()) win.destroy();
    this.wins = [];
  }
}

module.exports = { LiveWallpaper };
