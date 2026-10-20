// Desktop takeover: eDEX as the whole Windows desktop.
//
//  - The eDEX window covers the full display (taskbar area included) in both
//    modes; the overlay sits above everything.
//  - In desktop mode the Windows taskbar is hidden while eDEX is on screen
//    (and set to auto-hide so maximised apps fill the screen); eDEX's dock
//    takes its place. Hiding or quitting eDEX always brings it back.
//  - "Show desktop" / "Minimise all" cannot leave you on the Windows desktop:
//    if eDEX gets minimised it is restored straight away.
//
// The taskbar is restored three ways: by this controller (hide / quit), by
// the native helper when eDEX's pipe closes (crash), and from a marker file
// on the next launch (if both processes were killed).
"use strict";

const fs = require("fs");
const path = require("path");

const KEYS = ["takeover", "takeoverHideTaskbar", "takeoverKeepVisible", "mode"];
const TICK_MS = 2000;

class Takeover {
  constructor({ settings, windows, bridge, userData, log = console }) {
    this.settings = settings;
    this.windows = windows;
    this.bridge = bridge;
    this.log = log;
    this.marker = path.join(userData, "taskbar-hidden.json");
    this.hidden = false;
    this.prev = -1;
    this.queue = Promise.resolve();
    this.timer = null;
    settings.on("change", (changed) => {
      if (KEYS.some((k) => k in changed)) this.sync();
    });
  }

  get active() {
    return this.settings.get("takeover") === true;
  }

  // Puts back a taskbar left hidden by a session that never cleaned up.
  async recover() {
    let marker = null;
    try { marker = JSON.parse(fs.readFileSync(this.marker, "utf8")); } catch (_) { return; }
    try {
      await this.bridge.call("taskbarShow", { prev: Number.isInteger(marker?.prev) ? marker.prev : -1 }, 8000);
      this.log.info?.("[takeover] restored the taskbar left hidden by a previous session");
    } catch (e) {
      this.log.warn(`[takeover] could not restore the taskbar: ${e.message}`);
      return;
    }
    try { fs.unlinkSync(this.marker); } catch (_) {}
  }

  attach(win) {
    for (const evt of ["show", "hide", "restore", "focus"]) win.on(evt, () => this.sync());
    win.on("minimize", () => {
      if (this.active && this.settings.get("takeoverKeepVisible") !== false && this.settings.get("mode") === "desktop") {
        setTimeout(() => { if (!win.isDestroyed() && win.isMinimized()) win.restore(); }, 150);
      }
      this.sync();
    });
    this.sync();
  }

  _wantHidden() {
    const win = this.windows.win;
    return this.active && this.settings.get("takeoverHideTaskbar") !== false && this.settings.get("mode") === "desktop" &&
      !!win && !win.isDestroyed() && win.isVisible();
  }

  // Serialised so quick show / hide sequences apply in order.
  sync() {
    this.queue = this.queue.then(() => this._sync()).catch((e) => this.log.warn(`[takeover] ${e.message}`));
    return this.queue;
  }

  async _sync() {
    const want = this._wantHidden();
    if (want && !this.hidden) {
      const st = await this.bridge.call("taskbarHide", { prev: -1 }, 8000);
      this.hidden = true;
      this.prev = Number.isInteger(st?.prev) ? st.prev : -1;
      try { fs.writeFileSync(this.marker, JSON.stringify({ prev: this.prev, at: Date.now() })); } catch (_) {}
      // Explorer may still pop the bar back while settling; check again soon.
      setTimeout(() => this._tick(), 1000);
    } else if (!want && this.hidden) {
      await this._show();
    }
    this._schedule();
  }

  async _show() {
    await this.bridge.call("taskbarShow", { prev: this.prev }, 8000);
    this.hidden = false;
    this.prev = -1;
    try { fs.unlinkSync(this.marker); } catch (_) {}
  }

  // While active: Explorer re-shows the taskbar now and then (the Start
  // menu, a restart of explorer.exe), and a minimised eDEX must come back.
  _schedule() {
    if (this.active && !this.timer) this.timer = setInterval(() => this._tick(), TICK_MS);
    else if (!this.active && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // Shows the hidden taskbar for a while (tray icons, Start), then hides it
  // again; the auto-hide state is left alone.
  async peek(ms = 15000) {
    if (!this.hidden) return false;
    this.peekUntil = Date.now() + ms;
    await this.bridge.call("taskbarPeek", {}, 4000);
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => { this.peekUntil = 0; this._tick(); }, ms);
    return true;
  }

  async _tick() {
    const win = this.windows.win;
    if (!win || win.isDestroyed()) return;
    if (this.settings.get("takeoverKeepVisible") !== false && this.settings.get("mode") === "desktop" && win.isMinimized()) win.restore();
    if (!this.hidden || Date.now() < (this.peekUntil || 0)) return;
    this.queue = this.queue.then(async () => {
      if (!this.hidden) return;
      const st = await this.bridge.call("taskbarState", {}, 4000);
      if (st?.visible) await this.bridge.call("taskbarHide", { prev: this.prev }, 8000);
    }).catch(() => {});
  }

  async state() {
    let taskbar = null;
    try { taskbar = await this.bridge.call("taskbarState", {}, 4000); } catch (_) {}
    return { active: this.active, hiddenByEdex: this.hidden, taskbar };
  }

  // Before quitting: put the taskbar back (bounded, so quit never hangs).
  async restore() {
    clearInterval(this.timer);
    this.timer = null;
    if (!this.hidden) return;
    await Promise.race([
      this.queue.then(() => (this.hidden ? this._show() : null)),
      new Promise((r) => setTimeout(r, 4000))
    ]).catch(() => {});
  }
}

module.exports = { Takeover };
