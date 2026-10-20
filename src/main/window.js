// Owns the single eDEX window and its two presentation modes:
//
//   desktop  A full-screen surface that sits *behind* ordinary windows, so it
//            acts as your desktop: launch an app and it opens on top; close it
//            and you are back in eDEX instead of the Windows desktop.
//   overlay  Always-on-top HUD summoned by the global hotkey. It hides itself
//            when it loses focus or after launching something.
"use strict";

const path = require("path");
const { BrowserWindow, screen, app } = require("electron");
const { APP_ORIGIN } = require("./lib/protocol");

const DEV_WINDOWED = process.env.EDEX_DEV_WINDOWED === "1";

class WindowManager {
  constructor({ settings, bridge = null }) {
    this.settings = settings;
    this.bridge = bridge;
    this.fitTimer = null;
    this.win = null;
    this.satellites = new Set();
    this.quitting = false;
    this.blurHideSuppressed = 0;
    this.blurTimer = null;
    settings.on("change", (changed) => {
      if ("mode" in changed || "coverTaskbar" in changed || "takeover" in changed) this.applyMode();
    });
  }

  get mode() {
    return this.settings.get("mode");
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  send(channel, payload) {
    const wc = this.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
    // HUD windows on other displays follow settings (theme, units …).
    if (channel === "settings:changed" || channel === "kb:changed") {
      for (const win of this.satellites) if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  addSatellite(win) {
    this.satellites.add(win);
    win.on("closed", () => this.satellites.delete(win));
  }

  _targetDisplay() {
    if (this.mode === "overlay") return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return screen.getPrimaryDisplay();
  }

  _targetBounds() {
    const display = this._targetDisplay();
    if (DEV_WINDOWED) {
      const { workArea } = display;
      const width = Math.min(1600, workArea.width - 80);
      const height = Math.min(940, workArea.height - 80);
      return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height
      };
    }
    return this.coversScreen ? display.bounds : display.workArea;
  }

  // Desktop takeover always uses the whole display, taskbar area included.
  get coversScreen() {
    return this.settings.get("takeover") === true || this.settings.get("coverTaskbar");
  }

  create() {
    const bounds = this._targetBounds();
    this.win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      resizable: DEV_WINDOWED,
      // No invisible resize frame or shadow around the full-screen surface.
      thickFrame: DEV_WINDOWED,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: "#000000",
      title: "eDEX-UI",
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
    this.applyMode();

    const win = this.win;
    win.loadURL(`${APP_ORIGIN}/index.html`);
    win.once("ready-to-show", () => {
      // When eDEX has taken over the desktop it is always shown at launch.
      const hidden = !DEV_WINDOWED && this.settings.get("takeover") !== true &&
        (this.settings.get("startHidden") || process.argv.includes("--hidden"));
      if (!hidden) this.show();
    });

    const emitVisibility = () => this.send("app:visibility", {
      visible: win.isVisible() && !win.isMinimized(),
      focused: win.isFocused()
    });
    for (const evt of ["show", "hide", "minimize", "restore", "focus"]) win.on(evt, emitVisibility);
    win.on("blur", () => {
      emitVisibility();
      this._maybeHideOnBlur();
    });

    win.on("close", (event) => {
      if (this.quitting || !this.settings.get("closeToTray")) return;
      event.preventDefault();
      this.hide();
    });
    win.on("closed", () => { this.win = null; });

    const refit = () => this.applyMode();
    screen.on("display-metrics-changed", refit);
    screen.on("display-added", refit);
    screen.on("display-removed", refit);
    return win;
  }

  applyMode() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const overlay = this.mode === "overlay";
    win.setSkipTaskbar(overlay);
    if (overlay) win.setAlwaysOnTop(true, this.coversScreen && !DEV_WINDOWED ? "screen-saver" : "floating");
    else win.setAlwaysOnTop(false);
    win.setBounds(this._targetBounds());
    this.fitExact();
    this.send("app:mode", { mode: this.mode });
  }

  // Square corners, no border, and the monitor's exact physical pixels (see
  // FitWindow in native/bridge.ps1). Electron places the window in DIPs,
  // which at 125 % / 150 % scaling can round a pixel short.
  fitExact() {
    const win = this.win;
    if (DEV_WINDOWED || !this.bridge || !win || win.isDestroyed()) return;
    clearTimeout(this.fitTimer);
    this.fitTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      let hwnd;
      try { hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0)); } catch (_) { return; }
      this.bridge.call("fitWindow", { hwnd, cover: this.coversScreen }, 5000).catch(() => {});
    }, 60);
  }

  _maybeHideOnBlur() {
    clearTimeout(this.blurTimer);
    if (this.mode !== "overlay" || !this.settings.get("overlayHideOnBlur") || this.blurHideSuppressed > 0) return;
    this.blurTimer = setTimeout(() => {
      if (this.win && !this.win.isDestroyed() && !this.win.isFocused() && this.blurHideSuppressed === 0) this.hide();
    }, 150);
  }

  // Native dialogs steal focus; without this an overlay would hide itself
  // (and its dialog's parent) the moment a confirmation appeared.
  async withDialog(fn) {
    this.blurHideSuppressed++;
    try {
      return await fn(this.win && !this.win.isDestroyed() ? this.win : undefined);
    } finally {
      this.blurHideSuppressed--;
    }
  }

  show(command) {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    if (this.mode === "overlay") win.setBounds(this._targetBounds());
    if (win.isMinimized()) win.restore();
    win.show();
    this.fitExact();
    if (this.mode !== "overlay") {
      // Windows refuses focus to background apps; a momentary topmost flip
      // reliably lifts the window above whatever currently has focus.
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
    }
    win.focus();
    app.focus({ steal: true });
    if (command) this.send("app:command", { name: command, toggle: false });
  }

  hide() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    clearTimeout(this.blurTimer);
    win.hide();
  }

  toggle(command) {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    // Already in front: a plain toggle hides, a command toggles its panel.
    if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
      if (command) this.send("app:command", { name: command, toggle: true });
      else this.hide();
      return;
    }
    this.show(command);
  }

  // Called before handing focus to another app or window.
  yieldFocus() {
    if (this.mode === "overlay" && this.settings.get("hideAfterLaunch")) this.hide();
  }
}

module.exports = { WindowManager, DEV_WINDOWED };
