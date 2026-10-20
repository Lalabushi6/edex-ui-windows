// Screen time: how long each program has been the focused window, per day.
// Sampled every few seconds in the main process (so it keeps counting while
// other windows cover eDEX); idle and locked time is skipped. Only program
// names and seconds are stored, in userData, for the last two weeks.
"use strict";

const path = require("path");
const { powerMonitor } = require("electron");
const { JsonStore } = require("./store");

const SAMPLE_MS = 5000;
const IDLE_S = 120;
const KEEP_DAYS = 14;
// Hosts whose window title names the real app (Store / UWP apps).
const HOSTS = new Set(["applicationframehost.exe"]);
// The desktop / taskbar / lock screen are not "using an app".
const SKIP_CLASSES = new Set(["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "LockScreenControllerProxyWindow", "Windows.UI.Core.CoreWindow"]);

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

class ScreenTime {
  constructor({ bridge, settings, userData, ownPids }) {
    this.bridge = bridge;
    this.settings = settings;
    this.ownPids = ownPids;
    this.store = new JsonStore(path.join(userData, "screentime.json"), { fallback: { days: {} } });
    if (!this.store.data || typeof this.store.data.days !== "object") this.store.data = { days: {} };
    this.timer = null;
    this.busy = false;
    settings.on("change", (changed) => { if ("screenTime" in changed) this.apply(); });
  }

  apply() {
    const on = this.settings.get("screenTime") !== false;
    if (on && !this.timer) this.timer = setInterval(() => this.sample(), SAMPLE_MS);
    else if (!on && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async sample() {
    if (this.busy) return;
    this.busy = true;
    try {
      const state = powerMonitor.getSystemIdleState(IDLE_S);
      if (state !== "active") return;
      const fg = await this.bridge.call("foreground", {}, 3000);
      if (!fg || SKIP_CLASSES.has(fg.cls)) return;
      const name = this.nameFor(fg);
      if (!name) return;
      const key = dayKey();
      const days = this.store.data.days;
      const day = (days[key] ||= {});
      day[name] = (day[name] || 0) + SAMPLE_MS / 1000;
      this.prune();
      // Written at most every 30 s (and on quit), not on every sample.
      this.dirty = true;
      if (Date.now() - (this.lastWrite || 0) > 30000) {
        this.lastWrite = Date.now();
        this.dirty = false;
        this.store.flush();
      }
    } catch (_) {
      // The helper may be restarting; the next sample counts again.
    } finally {
      this.busy = false;
    }
  }

  nameFor(fg) {
    if (this.ownPids().includes(fg.pid)) return "eDEX-UI";
    const exe = String(fg.exe || "");
    const base = path.basename(exe).toLowerCase();
    if (HOSTS.has(base)) return (fg.title || "").trim().slice(0, 60) || null;
    if (fg.desc && fg.desc.length <= 60 && !/^(application|launcher|host)$/i.test(fg.desc)) return fg.desc;
    if (!base) return (fg.title || "").trim().slice(0, 60) || null;
    const stem = base.replace(/\.exe$/i, "");
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  }

  prune() {
    const keys = Object.keys(this.store.data.days).sort();
    while (keys.length > KEEP_DAYS) delete this.store.data.days[keys.shift()];
  }

  get(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(0, Math.min(KEEP_DAYS - 1, Number(offsetDays) || 0)));
    const key = dayKey(d);
    const day = this.store.data.days[key] || {};
    const apps = Object.entries(day).map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const w = new Date();
      w.setDate(w.getDate() - i);
      const k = dayKey(w);
      week.push({ day: k, seconds: Object.values(this.store.data.days[k] || {}).reduce((a, b) => a + b, 0) });
    }
    return { day: key, enabled: this.settings.get("screenTime") !== false, total: apps.reduce((a, b) => a + b.seconds, 0), apps: apps.slice(0, 30), week };
  }

  clear() {
    this.store.data = { days: {} };
    this.dirty = false;
    this.store.flush();
    return true;
  }

  flush() {
    if (!this.dirty) return;
    this.store.save();
    this.store.flushSync();
    this.dirty = false;
  }
}

module.exports = { ScreenTime };
