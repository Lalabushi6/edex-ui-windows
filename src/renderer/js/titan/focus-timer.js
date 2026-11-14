// The focus timer runs on its own, outside any page: switching tabs or pages
// doesn't stop it. Time is kept as an end timestamp, so a slow or hidden
// window can't make it drift. The only timer is the one to the end of the
// block, plus a once-a-second tick while something on screen shows it.
import { toast } from "../core/ui.js";
import * as sfx from "../core/audio.js";
import * as db from "./db.js";
import * as L from "./logic.js";

export const DEFAULTS = { focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 15, longBreakAfter: 4, dailyTarget: 4 };
export const MODE_LABEL = { focus: "Focus", break: "Break", long: "Long break" };

const state = { mode: "focus", status: "idle", endsAt: 0, leftMs: null, cycle: 0 };
const subs = new Set();
let endTimer = null;
let tickTimer = null;

export function settings() {
  return { ...DEFAULTS, ...(db.get("focus_settings", "default") || {}) };
}

export function saveSettings(patch) {
  db.put("focus_settings", { ...settings(), ...patch, id: "default" });
  if (state.status === "idle") state.leftMs = null;
  emit();
}

const lengthMs = (mode) => {
  const s = settings();
  return (mode === "focus" ? s.focusMinutes : mode === "break" ? s.breakMinutes : s.longBreakMinutes) * 60000;
};

export function snapshot() {
  const total = lengthMs(state.mode);
  const left = state.status === "running" ? Math.max(0, state.endsAt - Date.now()) : state.leftMs ?? total;
  return { ...state, total, left, settings: settings() };
}

export function sessionsOn(key) {
  return db.get("focus_daily", key)?.completedSessions ?? 0;
}

export function subscribe(fn) {
  subs.add(fn);
  syncTick();
  return () => { subs.delete(fn); syncTick(); };
}

function emit() {
  const snap = snapshot();
  for (const fn of [...subs]) { try { fn(snap); } catch (_) {} }
}

function syncTick() {
  const want = state.status === "running" && subs.size > 0;
  if (want && !tickTimer) tickTimer = setInterval(emit, 1000);
  else if (!want && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

function arm() {
  clearTimeout(endTimer);
  endTimer = null;
  if (state.status === "running") endTimer = setTimeout(finish, Math.max(0, state.endsAt - Date.now()) + 50);
  syncTick();
}

export function start() {
  if (state.status === "running") return;
  const left = state.leftMs ?? lengthMs(state.mode);
  state.status = "running";
  state.endsAt = Date.now() + left;
  state.leftMs = null;
  arm();
  emit();
}

export function pause() {
  if (state.status !== "running") return;
  state.leftMs = Math.max(0, state.endsAt - Date.now());
  state.status = "paused";
  arm();
  emit();
}

export function reset() {
  state.mode = "focus";
  state.status = "idle";
  state.leftMs = null;
  state.cycle = 0;
  arm();
  emit();
}

export function setMode(mode) {
  state.mode = mode;
  state.status = "idle";
  state.leftMs = null;
  arm();
  emit();
}

function countSession() {
  const key = L.today();
  db.put("focus_daily", { dateKey: key, completedSessions: sessionsOn(key) + 1 });
  state.cycle++;
}

// Skip ends the block now: a skipped focus block still counts (as in the original).
export function skip() {
  if (state.mode === "focus") {
    countSession();
    state.mode = state.cycle % settings().longBreakAfter === 0 ? "long" : "break";
  } else state.mode = "focus";
  state.status = "idle";
  state.leftMs = null;
  arm();
  emit();
}

function finish() {
  endTimer = null;
  if (state.status !== "running") return;
  if (db.pref("sound", true)) sfx.play("granted");
  if (state.mode === "focus") {
    countSession();
    const s = settings();
    const done = sessionsOn(L.today());
    state.mode = state.cycle % s.longBreakAfter === 0 ? "long" : "break";
    state.status = "running";
    state.endsAt = Date.now() + lengthMs(state.mode);
    const msg = `Focus block done (${done}/${s.dailyTarget} today) — ${MODE_LABEL[state.mode].toLowerCase()} started`;
    toast(msg, { level: "ok", timeout: 6000 });
    window.edex.notices.add({ level: "info", kind: "timer", title: "Titan Protocol", body: msg }).catch(() => {});
  } else {
    state.mode = "focus";
    state.status = "idle";
    state.leftMs = null;
    const msg = "Break over — ready for the next focus block";
    toast(msg, { level: "info", timeout: 6000 });
    window.edex.notices.add({ level: "info", kind: "timer", title: "Titan Protocol", body: msg }).catch(() => {});
  }
  arm();
  emit();
}

export function fmt(ms) {
  const sec = Math.ceil(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export function stopAll() {
  clearTimeout(endTimer);
  clearInterval(tickTimer);
  endTimer = tickTimer = null;
}
