// Notification centre: a history of what eDEX told you (reminders, timers,
// battery and disk alerts, downloads, updates, screen-time limits …), kept
// for two weeks in notifications.json. Every eDEX notification goes through
// here, so Do Not Disturb (and quiet game mode) silence toasts, sounds and
// Windows notifications in one place; the history still records them.
//
// Windows only lets Store-packaged apps read other apps' notifications, so
// this holds eDEX's own.
"use strict";

const path = require("path");
const { Notification } = require("electron");
const { JsonStore } = require("./store");

const KEEP_MS = 14 * 86400000;
const MAX = 200;
const LEVELS = new Set(["info", "ok", "warn", "error"]);
const KINDS = new Set(["alert", "reminder", "timer", "download", "update", "screentime", "game", "calendar", "radio", "info"]);
const ACTIONS = new Set(["reveal", "open", "command", "updates", "url"]);

class Notices {
  constructor({ settings, windows, userData }) {
    this.settings = settings;
    this.windows = windows;
    this.store = new JsonStore(path.join(userData, "notifications.json"), { fallback: { items: [], seen: 0 } });
    this.quietReasons = new Set(); // e.g. "game"
    this.prune();
  }

  get items() {
    return Array.isArray(this.store.data.items) ? this.store.data.items : [];
  }

  // Do Not Disturb, or something (a game) asked for quiet.
  get quiet() {
    return !!this.settings.get("dnd") || this.quietReasons.size > 0;
  }

  setQuiet(reason, on) {
    const was = this.quiet;
    if (on) this.quietReasons.add(reason); else this.quietReasons.delete(reason);
    if (was !== this.quiet) this.broadcast();
  }

  prune() {
    const cutoff = Date.now() - KEEP_MS;
    this.store.data.items = this.items.filter((n) => n && n.at > cutoff).slice(-MAX);
  }

  // entry: { level, kind, title, body, action }; opts.toast: show an in-app
  // toast; opts.system: "always" | "hidden" (only while eDEX is hidden) |
  // "never"; opts.critical: ignores Do Not Disturb (critical battery).
  add(entry = {}, { toast = true, system = "hidden", critical = false } = {}) {
    const n = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      level: LEVELS.has(entry.level) ? entry.level : "info",
      kind: KINDS.has(entry.kind) ? entry.kind : "info",
      title: String(entry.title || "eDEX-UI").slice(0, 120),
      body: String(entry.body || "").slice(0, 400),
      action: cleanAction(entry.action)
    };
    this.store.data.items = [...this.items, n].slice(-MAX);
    this.store.save();
    const quiet = this.quiet && !critical;
    this.windows.send("notices:new", { notice: n, toast: toast && !quiet, unread: this.unread() });
    if (!quiet && system !== "never") this.systemNotify(n, system);
    return n;
  }

  systemNotify(n, system) {
    const win = this.windows.win;
    const onScreen = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    if (system === "hidden" && onScreen) return;
    try {
      if (!Notification.isSupported()) return;
      const note = new Notification({ title: `eDEX-UI — ${n.title}`, body: n.body, silent: n.level !== "error" && n.kind !== "reminder" && n.kind !== "timer" });
      note.on("click", () => this.windows.show());
      note.show();
    } catch (_) {}
  }

  unread() {
    const seen = Number(this.store.data.seen) || 0;
    return this.items.filter((n) => n.at > seen).length;
  }

  list() {
    this.prune();
    return { items: [...this.items].reverse(), unread: this.unread(), quiet: this.quiet, dnd: !!this.settings.get("dnd"), quietReasons: [...this.quietReasons] };
  }

  markSeen() {
    this.store.data.seen = Date.now();
    this.store.save();
    this.broadcast();
  }

  remove(id) {
    this.store.data.items = this.items.filter((n) => n.id !== id);
    this.store.save();
    this.broadcast();
  }

  clear() {
    this.store.data.items = [];
    this.store.save();
    this.broadcast();
  }

  broadcast() {
    this.windows.send("notices:changed", { unread: this.unread(), quiet: this.quiet, dnd: !!this.settings.get("dnd"), quietReasons: [...this.quietReasons] });
  }

  flush() {
    this.store.flushSync();
  }
}

function cleanAction(a) {
  if (!a || typeof a !== "object" || !ACTIONS.has(a.type)) return null;
  const value = typeof a.value === "string" ? a.value.slice(0, 2048) : "";
  if (a.type === "url" && !/^https?:\/\//i.test(value)) return null;
  if (a.type === "command" && !/^[\w.-]{1,64}$/.test(value)) return null;
  return { type: a.type, value };
}

module.exports = { Notices };
