// Multi-monitor HUD: on every display except the one eDEX uses, a
// telemetry-only eDEX surface (system panels, globe, clock) that sits behind
// ordinary windows like the desktop does. It follows the main window: shown
// while eDEX is on screen, hidden with it.
"use strict";

const path = require("path");
const { BrowserWindow, screen } = require("electron");
const { APP_ORIGIN } = require("./lib/protocol");
const { DEV_WINDOWED } = require("./window");

class Hud {
  constructor({ settings, windows, bridge }) {
    this.settings = settings;
    this.windows = windows;
    this.bridge = bridge;
    this.huds = new Map(); // display id -> BrowserWindow
    this.timer = null;
    settings.on("change", (changed) => { if ("hudDisplays" in changed) this.sync(); });
    for (const evt of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(evt, () => this.schedule());
  }

  // Windowed development runs can preview one HUD on the primary display.
  _targets() {
    if (!this.settings.get("hudDisplays")) return [];
    const primary = screen.getPrimaryDisplay();
    const others = screen.getAllDisplays().filter((d) => d.id !== primary.id);
    if (!others.length && DEV_WINDOWED && process.env.EDEX_HUD_PREVIEW === "1") {
      const w = primary.workArea;
      return [{ id: "preview", bounds: { x: w.x + 40, y: w.y + 40, width: Math.min(1400, w.width - 80), height: Math.min(820, w.height - 80) } }];
    }
    return others;
  }

  attach(mainWin) {
    this.main = mainWin;
    for (const evt of ["show", "restore"]) mainWin.on(evt, () => this.showAll());
    for (const evt of ["hide", "minimize"]) mainWin.on(evt, () => this.hideAll());
    mainWin.on("closed", () => this.closeAll());
    this.sync();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 600);
  }

  sync() {
    const targets = this._targets();
    const wanted = new Set(targets.map((d) => String(d.id)));
    for (const [id, win] of this.huds) {
      if (!wanted.has(id)) { this._drop(id, win); continue; }
    }
    for (const d of targets) {
      const id = String(d.id);
      let win = this.huds.get(id);
      if (win && !win.isDestroyed()) { win.setBounds(d.bounds); continue; }
      win = this._create(d);
      this.huds.set(id, win);
    }
  }

  _create(display) {
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      resizable: false,
      thickFrame: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: "#000000",
      title: "eDEX-UI HUD",
      icon: path.join(__dirname, "assets", "icon.png"),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: true
      }
    });
    win.loadURL(`${APP_ORIGIN}/index.html?hud=1`);
    win.once("ready-to-show", () => { if (this._mainVisible() && !this.suspended) this._show(win); });
    const visibility = () => {
      if (!win.isDestroyed()) win.webContents.send("app:visibility", { visible: win.isVisible() && !win.isMinimized(), focused: win.isFocused() });
    };
    for (const evt of ["show", "hide", "focus", "blur"]) win.on(evt, visibility);
    // Clicking the HUD must not leave it in front of the apps on that screen.
    win.on("blur", () => this._toBack(win));
    win.on("closed", () => { for (const [id, w] of this.huds) if (w === win) this.huds.delete(id); });
    this.windows.addSatellite(win);
    return win;
  }

  _mainVisible() {
    const m = this.main;
    return !!m && !m.isDestroyed() && m.isVisible() && !m.isMinimized();
  }

  _show(win) {
    if (win.isDestroyed()) return;
    win.showInactive();
    this._toBack(win);
  }

  _toBack(win) {
    if (DEV_WINDOWED || !this.bridge || win.isDestroyed()) return;
    let hwnd;
    try { hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0)); } catch (_) { return; }
    this.bridge.call("sendToBack", { hwnd }, 4000).catch(() => {});
  }

  showAll() { if (!this.suspended) for (const win of this.huds.values()) this._show(win); }

  // Game mode: hidden while a game runs, back afterwards (if eDEX is shown).
  setSuspended(on) {
    this.suspended = on;
    if (on) this.hideAll();
    else if (this._mainVisible()) this.showAll();
  }

  hideAll() { for (const win of this.huds.values()) if (!win.isDestroyed()) win.hide(); }

  _drop(id, win) {
    this.huds.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }

  closeAll() { for (const [id, win] of this.huds) this._drop(id, win); }
}

module.exports = { Hud };
