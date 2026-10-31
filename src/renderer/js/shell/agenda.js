// Tasks and calendar events, shared by the Tasks widget and the calendar.
// Stored in userData (tasks.json). Reminders use the main-process alarms
// (alarm sound, toast and a Windows notification even while eDEX is
// hidden); they are re-armed on every start for anything due in the next
// week, and a reminder missed while eDEX was closed is shown once.
import * as sfx from "../core/audio.js";
import { toast } from "../core/ui.js";
import { parseDuration } from "./convert.js";
import { notify as notice } from "./notices.js";

const api = window.edex;
const WEEK = 7 * 86400000;
let data = { tasks: [], events: [] };
let loaded = null;
const listeners = new Set();
let saveTimer = null;

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function loadAgenda() {
  if (!loaded) {
    loaded = api.tools.loadTasks().then((d) => {
      data = { tasks: d.tasks || [], events: d.events || [] };
      catchUp();
      schedule();
      loadFeedEvents();
      setInterval(schedule, 3600000);
      setInterval(() => loadFeedEvents(), 30 * 60 * 1000);
      notify();
    }).catch(() => {});
  }
  return loaded;
}

export const tasks = () => data.tasks;
export const events = () => data.events;

// ── Subscribed calendars (read-only, from .ics links) ──────────────────────
// Occurrences for about a month back and half a year ahead, refreshed when
// the main process downloads a feed and every half hour.
let feedEvents = []; // { id, date, time, title, feed, color, location, readOnly, start, remind }
const remindedFeed = new Set();
const timeOf = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export async function loadFeedEvents() {
  const now = Date.now();
  let list = [];
  try { list = await api.calendars.events({ from: now - 35 * 86400000, to: now + 185 * 86400000 }); } catch (_) { return; }
  const out = [];
  for (const o of list) {
    const base = { feed: o.feed, feedId: o.feedId, color: o.color, location: o.location, readOnly: true, title: o.title, start: o.start, remind: o.remind };
    if (o.allDay && o.wall) {
      // All-day events cover each of their days.
      for (let i = 0; i < Math.min(o.days || 1, 31); i++) {
        const d = new Date(o.wall.y, o.wall.m - 1, o.wall.d + i);
        out.push({ ...base, id: `${o.id}-${i}`, date: dayKey(d), time: null });
      }
    } else {
      out.push({ ...base, id: o.id, date: dayKey(new Date(o.start)), time: timeOf(o.start) });
    }
  }
  feedEvents = out;
  scheduleFeedReminders();
  notify();
}
api.calendars.onChange(() => { if (loaded) loadFeedEvents(); });

export const feedEventsAll = () => feedEvents;
export const eventsOn = (key) => [...data.events.filter((e) => e.date === key), ...feedEvents.filter((e) => e.date === key)]
  .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

function scheduleFeedReminders() {
  const now = Date.now();
  for (const e of feedEvents) {
    if (e.remind == null || e.time === null || remindedFeed.has(e.id)) continue;
    const at = e.start - e.remind * 60000;
    if (at > now && at - now <= WEEK) {
      api.alarm.set({ id: `feed-${e.id}`.slice(0, 64), inMs: at - now, label: `${e.title} at ${e.time}${e.feed ? ` (${e.feed})` : ""}`, kind: "reminder" }).catch(() => {});
      remindedFeed.add(e.id);
    }
  }
}

export function onAgenda(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() { for (const fn of listeners) { try { fn(data); } catch (e) { console.error(e); } } }

function changed() {
  notify();
  schedule();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.tools.saveTasks(data).catch((e) => console.error("tasks save failed", e)), 400);
}

// ── Tasks ───────────────────────────────────────────────────────────────────
export function addTask(input) {
  const { text, due } = parseWhen(input);
  if (!text) return null;
  const t = { id: uid(), text, done: false, due, created: Date.now(), reminded: false };
  data.tasks = [t, ...data.tasks];
  changed();
  return t;
}
export function toggleTask(id) {
  data.tasks = data.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  changed();
}
export function removeTask(id) {
  data.tasks = data.tasks.filter((t) => t.id !== id);
  api.alarm.clear(`task-${id}`).catch(() => {});
  changed();
}
export function clearDone() {
  data.tasks = data.tasks.filter((t) => !t.done);
  changed();
}

// ── Events ──────────────────────────────────────────────────────────────────
export function addEvent({ date, time = null, title, remind = null }) {
  if (!title || !date) return null;
  const ev = { id: uid(), date, time, title: title.slice(0, 200), remind, reminded: false };
  data.events = [...data.events, ev];
  changed();
  return ev;
}
export function removeEvent(id) {
  data.events = data.events.filter((e) => e.id !== id);
  api.alarm.clear(`event-${id}`).catch(() => {});
  changed();
}

export function eventTime(ev) {
  const [y, m, d] = ev.date.split("-").map(Number);
  const [hh, mm] = (ev.time || "09:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}
const remindAt = (ev) => (ev.remind == null ? null : eventTime(ev) - ev.remind * 60000);

// ── Reminders ───────────────────────────────────────────────────────────────
function schedule() {
  const now = Date.now();
  for (const t of data.tasks) {
    if (t.done || t.reminded || !t.due) { api.alarm.clear(`task-${t.id}`).catch(() => {}); continue; }
    if (t.due > now && t.due - now <= WEEK) api.alarm.set({ id: `task-${t.id}`, inMs: t.due - now, label: t.text, kind: "reminder" }).catch(() => {});
  }
  for (const ev of data.events) {
    const at = remindAt(ev);
    if (at == null || ev.reminded) continue;
    if (at > now && at - now <= WEEK) {
      api.alarm.set({ id: `event-${ev.id}`, inMs: at - now, label: `${ev.title}${ev.time ? ` at ${ev.time}` : ""}`, kind: "reminder" }).catch(() => {});
    }
  }
}

// Reminders that came due while eDEX wasn't running (within a day).
function catchUp() {
  const now = Date.now();
  let dirty = false;
  for (const t of data.tasks) {
    if (!t.done && !t.reminded && t.due && t.due <= now && now - t.due < 86400000) {
      t.reminded = true;
      dirty = true;
      notice({ level: "warn", kind: "reminder", title: "Missed reminder", body: t.text, timeout: 10000 });
    }
  }
  for (const ev of data.events) {
    const at = remindAt(ev);
    if (at != null && !ev.reminded && at <= now && now - at < 86400000) {
      ev.reminded = true;
      dirty = true;
      notice({ level: "warn", kind: "reminder", title: "Missed reminder", body: ev.title, timeout: 10000 });
    }
  }
  if (dirty) changed();
}

// With Do Not Disturb (or a game running) reminders ring silently: the
// notification centre keeps them.
api.alarm.onFired(({ id, label, quiet }) => {
  if (typeof id !== "string") return;
  if (id.startsWith("task-")) {
    const t = data.tasks.find((x) => `task-${x.id}` === id);
    if (!t) return;
    t.reminded = true;
    if (!quiet) {
      sfx.play("alarm");
      toast(`Reminder: ${t.text}`, { level: "ok", timeout: 15000, action: { label: "Done", run: () => toggleTask(t.id) } });
    }
    changed();
  } else if (id.startsWith("event-")) {
    const ev = data.events.find((x) => `event-${x.id}` === id);
    if (!ev) return;
    ev.reminded = true;
    if (!quiet) {
      sfx.play("alarm");
      toast(`${ev.title}${ev.time ? ` at ${ev.time}` : ""}`, { level: "ok", timeout: 15000 });
    }
    changed();
  } else if (id.startsWith("feed-") && !quiet) {
    sfx.play("alarm");
    toast(label || "Calendar event", { level: "ok", timeout: 15000 });
  }
});

// ── "call mum at 6pm", "report in 2h", "dentist tomorrow 9:30" ─────────────
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseClock(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2] || 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && hh < 12) hh += 12;
  if (ap === "am" && hh === 12) hh = 0;
  if (hh > 23 || mm > 59 || (!ap && !m[2] && hh > 23)) return null;
  return [hh, mm];
}

export function parseWhen(input) {
  let text = String(input || "").trim();
  let due = null;
  const now = new Date();
  const at = (base, clock) => {
    const d = new Date(base);
    const [hh, mm] = clock || [9, 0];
    d.setHours(hh, mm, 0, 0);
    return d;
  };
  // in 2h / in 30 min
  let m = /\s*\bin\s+(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?:\s*\d+\s*(?:minutes?|mins?|m))?)\s*$/i.exec(text);
  if (m) {
    const ms = parseDuration(m[1].replace(/\s+/g, ""));
    if (ms) { due = Date.now() + ms; text = text.slice(0, m.index).trim(); }
  }
  // (today|tomorrow|monday…) (at) 5pm
  if (!due) {
    m = /\s*\b(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?\s*$/i.exec(text);
    if (m) {
      const word = m[1].toLowerCase();
      const clock = m[2] ? parseClock(m[2]) : word === "tonight" ? [20, 0] : null;
      const base = new Date(now);
      if (word === "tomorrow") base.setDate(base.getDate() + 1);
      else if (DAYS.includes(word)) {
        const diff = (DAYS.indexOf(word) - now.getDay() + 7) % 7 || 7;
        base.setDate(base.getDate() + diff);
      }
      due = at(base, clock).getTime();
      text = text.slice(0, m.index).trim();
    }
  }
  // at 17:30 / at 6pm
  if (!due) {
    m = /\s*\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i.exec(text);
    const clock = m && parseClock(m[1]);
    if (clock) {
      let d = at(now, clock);
      if (d.getTime() <= Date.now()) d = new Date(d.getTime() + 86400000);
      due = d.getTime();
      text = text.slice(0, m.index).trim();
    }
  }
  return { text: text.replace(/\s+(?:by|on)$/i, "").trim().slice(0, 300), due };
}

export function dueLabel(due) {
  if (!due) return "";
  const d = new Date(due);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days === -1) return `yesterday ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
