// Screen time: how long each program has been the focused window, per day,
// while someone is at the PC.
//
// The main process looks at the window in front every 5 s (so it keeps
// counting while other windows cover eDEX) and credits the time since its
// last look, timed on a clock that system clock changes don't move.
// Someone is at the PC while it's unlocked and awake, and either there was
// keyboard or mouse input in the last 2 minutes, or the program in front
// plays sound while something keeps the screen on (a video, a call, a game
// played with a controller). When they leave, the time since their last
// input is taken back, so the 2 minutes it takes to notice don't count.
// Only program names and seconds are stored, in userData, for two weeks.
"use strict";

const path = require("path");
const { powerMonitor } = require("electron");
const { JsonStore } = require("./store");

const SAMPLE_MS = 5000;
const IDLE_S = 120;
// Looks further apart than this: eDEX was paused or the PC slept.
const GAP_MS = 30000;
const WRITE_MS = 30000;
// While nobody is there, how often to check whether a video has started.
const AWAY_CHECK_MS = 30000;
const KEEP_DAYS = 14;
// Hosts whose window title names the real app (Store / UWP apps).
const HOSTS = new Set(["applicationframehost.exe"]);
// The desktop, taskbar, lock screen and task switchers are not "using an app".
const SKIP_CLASSES = new Set([
  "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "LockScreenControllerProxyWindow", "Windows.UI.Core.CoreWindow",
  "XamlExplorerHostIslandWindow", "MultitaskingViewFrame", "TaskSwitcherWnd", "ForegroundStaging",
  "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland"
]);

const now = () => performance.now();
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sameFile = (a, b) => !!a && String(a).toLowerCase() === String(b || "").toLowerCase();

class ScreenTime {
  constructor({ bridge, settings, userData, ownPids, notify = null }) {
    this.bridge = bridge;
    this.settings = settings;
    this.ownPids = ownPids;
    this.notify = notify;
    this.limitNoticed = new Set(); // `${day}|${app}` already told today
    this.store = new JsonStore(path.join(userData, "screentime.json"), { fallback: { days: {} } });
    if (!this.store.data || typeof this.store.data.days !== "object") this.store.data = { days: {} };
    this.timer = null;
    this.busy = false;
    this.last = 0; // when the last look started (monotonic ms)
    this.from = null; // start of the time at the PC not yet credited; null while nobody is there
    this.name = null; // the program seen at the last look
    this.inputAt = 0; // the latest keyboard or mouse input seen
    this.keptAt = 0; // the last look at which a video or call counted as being there
    this.awayCheck = -Infinity;
    this.asleep = false;
    this.sleptAt = 0;
    this.epoch = 0; // bumped on every leave, so a look that was waiting on the helper doesn't credit across it
    this.recent = []; // credits not yet confirmed by later input: { day, name, start, end }
    this.prune();
    settings.on("change", (changed) => { if ("screenTime" in changed) this.apply(); });
    // Locking and sleeping end the time at the PC at once (and save it):
    // waiting for the next look would count up to 5 s more, and a PC that
    // goes on to lose power would lose what wasn't written yet.
    powerMonitor.on("lock-screen", () => this.leave(this.leftAt(), { sync: true }));
    powerMonitor.on("unlock-screen", () => this.restart());
    powerMonitor.on("suspend", () => { this.asleep = true; this.sleptAt = now(); this.leave(this.leftAt(), { sync: true }); });
    powerMonitor.on("resume", () => { this.asleep = false; this.restart(); });
  }

  // Counting may start again from now (unlock, resume, tracking turned on).
  restart() {
    this.last = now();
    this.lastWall = Date.now();
  }

  apply() {
    const on = this.settings.get("screenTime") !== false;
    if (on && !this.timer) {
      this.restart();
      this.from = null;
      this.timer = setInterval(() => this.sample(), SAMPLE_MS);
    } else if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.leave(now());
    }
  }

  // When the person at the PC left, as far as can be told: their last input,
  // or the last look at which a video or call kept them there.
  leftAt() {
    return Math.max(now() - powerMonitor.getSystemIdleTime() * 1000, this.keptAt);
  }

  async sample() {
    if (this.busy) return;
    this.busy = true;
    try {
      const t = now();
      const wall = Date.now();
      let prev = this.last;
      const prevWall = this.lastWall ?? wall;
      this.last = t;
      this.lastWall = wall;
      // A gap: nothing is credited for it, and someone whose last input came
      // before it left then. The wall clock running far ahead of the
      // monotonic one also counts, in case the latter stops while the PC
      // sleeps (a clock set forward looks the same, and costs one look).
      if (t - prev > GAP_MS || (wall - prevWall) - (t - prev) > GAP_MS) {
        this.leave(Math.max(this.inputAt, this.keptAt));
        prev = t;
      }
      const idle = powerMonitor.getSystemIdleTime() * 1000;
      this.inputAt = Math.max(this.inputAt, t - idle);
      // A resume Windows never reported: input since the suspend means it's
      // awake. (The idle timer counts whole seconds, hence the margin.)
      if (this.asleep && t - idle > this.sleptAt + 1000) this.asleep = false;
      if (this.asleep || powerMonitor.getSystemIdleState(IDLE_S) === "locked") {
        this.leave(Math.max(this.inputAt, this.keptAt));
        return;
      }
      const epoch = this.epoch;
      const quiet = idle >= IDLE_S * 1000;
      if (quiet) {
        // Nobody there already: check for a video only now and then.
        if (this.from === null && t - this.awayCheck < AWAY_CHECK_MS) return;
        this.awayCheck = t;
        const st = await this.bridge.call("saverBlocked", {}, 3000).catch(() => null);
        if (!st?.display) { this.leave(Math.max(this.inputAt, this.keptAt)); return; }
      }
      const fg = await this.bridge.call("foreground", {}, 3000).catch(() => undefined);
      if (epoch !== this.epoch) return;
      // The helper may be restarting: the next look credits this stretch.
      // (null is an answer: no window is in front.)
      if (fg === undefined) return;
      const end = now();
      let name = fg && !SKIP_CLASSES.has(fg.cls) ? this.nameFor(fg) : null;
      if (name === "__proto__") name = null;
      if (quiet) {
        // No input for 2 minutes, the screen is kept on: still there if the
        // program in front is the one playing sound.
        const sessions = name ? await this.bridge.call("audioSessions", {}, 3000).catch(() => null) : null;
        if (epoch !== this.epoch) return;
        if (!Array.isArray(sessions) || !sessions.some((s) => s && s.active && sameFile(s.exe, fg.exe))) {
          this.leave(Math.max(this.inputAt, this.keptAt));
          return;
        }
        this.keptAt = end;
      }
      if (this.from === null) this.from = prev;
      // A helper that failed for a while: only the last stretch goes to what's in front now.
      const start = Math.max(this.from, end - GAP_MS);
      if (name) this.credit(name, start, end);
      this.from = end;
      this.name = name;
      // Input (or a video still playing) after a credit confirms it.
      const sure = Math.max(this.inputAt, this.keptAt);
      this.recent = this.recent.filter((r) => r.end > sure);
      if (this.lastWrite === undefined || end - this.lastWrite > WRITE_MS) this.write();
    } finally {
      this.busy = false;
    }
  }

  // The person left at `at`: credit up to then, take back what was counted
  // after it, and save.
  leave(at, { sync = false } = {}) {
    if (this.from === null) return;
    this.epoch++;
    if (this.name && at > this.from) this.credit(this.name, this.from, Math.min(at, now()));
    for (const r of this.recent) {
      const s = Math.max(r.start, at);
      if (r.end > s) this.add(r.day, r.name, -(r.end - s) / 1000);
    }
    this.recent = [];
    this.from = null;
    this.write({ sync });
  }

  // Credits [start, end] (monotonic ms) to `name`, split at local midnight.
  // Days come from the clock as it reads now, so a clock change moves
  // neither the length nor the day of time already counted.
  credit(name, start, end) {
    if (!(end > start)) return;
    const t = now();
    const wallEnd = Date.now() - (t - end);
    const wallStart = wallEnd - (end - start);
    const midnight = new Date(wallEnd);
    midnight.setHours(0, 0, 0, 0);
    const parts = wallStart < midnight.getTime()
      ? [[wallStart, midnight.getTime()], [midnight.getTime(), wallEnd]]
      : [[wallStart, wallEnd]];
    for (const [a, b] of parts) {
      const day = dayKey(new Date(a));
      const s = end - (wallEnd - a), e = end - (wallEnd - b);
      this.add(day, name, (b - a) / 1000);
      const last = this.recent[this.recent.length - 1];
      if (last && last.day === day && last.name === name && Math.abs(last.end - s) < 1) last.end = e;
      else this.recent.push({ day, name, start: s, end: e });
    }
  }

  add(key, name, seconds) {
    const days = this.store.data.days;
    const day = (days[key] ||= {});
    // Names are window titles for Store apps; one called "constructor" or
    // "toString" must not pick up Object.prototype's members.
    const before = Object.hasOwn(day, name) ? day[name] : 0;
    const after = Math.max(0, Math.round((before + seconds) * 1000) / 1000);
    if (after > 0) day[name] = after;
    else delete day[name];
    if (!Object.keys(day).length) delete days[key];
    this.dirty = true;
    if (seconds > 0) this.checkLimit(key, name, before, after);
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

  // A gentle nudge, once per app per day, when it passes its daily limit.
  // Only the moment of passing it counts, so a restart later that day
  // doesn't say it again.
  checkLimit(day, name, before, after) {
    const limits = this.settings.get("screenTimeLimits") || {};
    const minutes = Object.hasOwn(limits, name) ? limits[name] : 0;
    if (!minutes || !this.notify || before >= minutes * 60 || after < minutes * 60) return;
    const key = `${day}|${name}`;
    if (this.limitNoticed.has(key)) return;
    this.limitNoticed.add(key);
    const h = Math.floor(minutes / 60);
    const label = h ? `${h} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
    this.notify(`Screen time: ${name}`, `You've used ${name} for ${label} today, your daily limit.`);
  }

  // Two weeks by date: days before the 14th-last are dropped, however few
  // days were recorded.
  prune() {
    const d = new Date();
    d.setDate(d.getDate() - (KEEP_DAYS - 1));
    const oldest = dayKey(d);
    for (const k of Object.keys(this.store.data.days)) if (k < oldest) delete this.store.data.days[k];
  }

  write({ sync = false } = {}) {
    if (!this.dirty) return;
    this.prune();
    this.lastWrite = now();
    this.dirty = false;
    if (sync) { this.store.save(); this.store.flushSync(); } else this.store.flush();
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
    const limits = this.settings.get("screenTimeLimits") || {};
    return {
      day: key, enabled: this.settings.get("screenTime") !== false, total: apps.reduce((a, b) => a + b.seconds, 0),
      apps: apps.slice(0, 30).map((a) => (Object.hasOwn(limits, a.name) ? { ...a, limit: limits[a.name] * 60 } : a)), week
    };
  }

  clear() {
    this.store.data = { days: {} };
    this.recent = [];
    if (this.from !== null) this.from = now();
    this.dirty = false;
    this.store.flush();
    return true;
  }

  // On quit or when Windows ends the session: whoever was there left at
  // their last input.
  flush() {
    this.leave(this.leftAt(), { sync: true });
    if (this.dirty) this.write({ sync: true });
  }
}

module.exports = { ScreenTime };
