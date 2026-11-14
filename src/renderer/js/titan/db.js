// Titan Protocol data: the original app's tables held in memory, saved to
// titan.json (main process) a moment after each change. Only changed tables
// go over IPC. Reads are plain array scans; indexes are memoised per table
// and dropped when that table changes.
const api = window.edex.titan;

export const TABLES = [
  "engine_meta", "tasks", "completions", "money_tx", "money_loans", "budgets", "nutrition_profiles", "nutrition_meals",
  "focus_settings", "focus_daily", "deep_work_tasks", "deep_work_logs", "gym_exercises", "gym_templates",
  "gym_template_exercises", "gym_sessions", "gym_sets", "body_weight_entries", "sleep_entries", "habits", "habit_logs",
  "journal_entries", "goals", "goal_tasks", "achievements"
];
const KEY = { engine_meta: "id", focus_daily: "dateKey", body_weight_entries: "dateKey", sleep_entries: "dateKey", journal_entries: "dateKey" };
// Tables whose ids are strings (UUIDs, "default"); the rest count up from 1.
const STRING_IDS = new Set(["money_tx", "money_loans", "nutrition_profiles", "nutrition_meals", "focus_settings", "engine_meta"]);

const keyOf = (table) => KEY[table] || "id";

let doc = null;
let loading = null;
const dirty = new Set();
let prefsDirty = false;
let saveTimer = null;
let saving = Promise.resolve();
const versions = new Map();
const memo = new Map();
const subs = new Set();
let notifyQueued = false;
let quietDepth = 0;

export function loaded() {
  return !!doc;
}

export async function load() {
  if (doc) return doc;
  if (!loading) {
    loading = api.load().then((d) => {
      const tables = {};
      for (const t of TABLES) tables[t] = Array.isArray(d?.tables?.[t]) ? d.tables[t] : [];
      doc = { tables, prefs: d?.prefs && typeof d.prefs === "object" ? d.prefs : {} };
      return doc;
    }).finally(() => { loading = null; });
  }
  return loading;
}

// ── Change notification ────────────────────────────────────────────────────
// Subscribers run once per burst of changes (a microtask later). A change
// made inside quietly() saves but doesn't redraw (the journal's typing).
export function onChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function quietly(fn) {
  quietDepth++;
  try { return fn(); } finally { quietDepth--; }
}

function touched(table) {
  if (table) {
    dirty.add(table);
    versions.set(table, (versions.get(table) || 0) + 1);
    for (const k of [...memo.keys()]) if (k.startsWith(`${table}|`)) memo.delete(k);
  }
  scheduleSave();
  if (quietDepth || notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const fn of [...subs]) { try { fn(); } catch (e) { console.error("titan view update failed", e); } }
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

// Sends what changed. Resolves once main has it (it writes the file itself).
export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!doc || (!dirty.size && !prefsDirty)) return saving;
  const patch = {};
  if (dirty.size) {
    patch.tables = {};
    for (const t of dirty) patch.tables[t] = doc.tables[t];
    dirty.clear();
  }
  if (prefsDirty) { patch.prefs = doc.prefs; prefsDirty = false; }
  saving = saving.catch(() => {}).then(() => api.save(patch)).catch((e) => {
    console.error("titan save failed", e);
    throw e;
  });
  return saving.catch(() => {});
}

// ── Reads ─────────────────────────────────────────────────────────────────
export function all(table) {
  return doc ? doc.tables[table] : [];
}

export function find(table, pred) {
  return all(table).filter(pred);
}

export function get(table, key) {
  return byKey(table).get(key) ?? null;
}

// Memoised lookups, rebuilt after the table changes.
export function cached(table, name, build) {
  const k = `${table}|${name}`;
  if (!memo.has(k)) memo.set(k, build(all(table)));
  return memo.get(k);
}

function byKey(table) {
  return cached(table, "key", (rows) => new Map(rows.map((r) => [r[keyOf(table)], r])));
}

// rows grouped by a field ("dateKey" → [rows]).
export function groupBy(table, field) {
  return cached(table, `group:${field}`, (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[field];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  });
}

export function version(table) {
  return versions.get(table) || 0;
}

// ── Writes ────────────────────────────────────────────────────────────────
function nextId(table) {
  let max = 0;
  for (const r of all(table)) if (typeof r.id === "number" && r.id > max) max = r.id;
  return max + 1;
}

export function uuid() {
  return crypto.randomUUID();
}

export function insert(table, row) {
  const k = keyOf(table);
  const r = { ...row };
  if (r[k] === undefined || r[k] === null) r[k] = STRING_IDS.has(table) ? uuid() : nextId(table);
  const rows = doc.tables[table];
  const i = rows.findIndex((x) => x[k] === r[k]);
  if (i >= 0) rows[i] = r;
  else rows.push(r);
  touched(table);
  return r;
}

// Inserts or replaces by key.
export const put = insert;

export function update(table, key, patch) {
  const k = keyOf(table);
  const rows = doc.tables[table];
  const i = rows.findIndex((x) => x[k] === key);
  if (i < 0) return null;
  rows[i] = { ...rows[i], ...patch, [k]: key };
  touched(table);
  return rows[i];
}

export function remove(table, key) {
  const k = keyOf(table);
  const rows = doc.tables[table];
  const i = rows.findIndex((x) => x[k] === key);
  if (i < 0) return false;
  rows.splice(i, 1);
  touched(table);
  return true;
}

export function removeWhere(table, pred) {
  const rows = doc.tables[table];
  const keep = rows.filter((r) => !pred(r));
  if (keep.length === rows.length) return 0;
  doc.tables[table] = keep;
  touched(table);
  return rows.length - keep.length;
}

export function bulkInsert(table, list) {
  const k = keyOf(table);
  let id = STRING_IDS.has(table) ? 0 : nextId(table);
  const out = [];
  for (const row of list) {
    const r = { ...row };
    if (r[k] === undefined || r[k] === null) r[k] = STRING_IDS.has(table) ? uuid() : id++;
    doc.tables[table].push(r);
    out.push(r);
  }
  touched(table);
  return out;
}

// Every table at once (import, clear). Tables not given end up empty.
export function replaceAll(tables) {
  for (const t of TABLES) {
    doc.tables[t] = Array.isArray(tables?.[t]) ? tables[t] : [];
    dirty.add(t);
    versions.set(t, (versions.get(t) || 0) + 1);
  }
  memo.clear();
  touched(null);
}

// ── Preferences (inside titan.json, not eDEX settings) ────────────────────
export function pref(key, fallback) {
  const v = doc?.prefs?.[key];
  return v === undefined || v === null ? fallback : v;
}

export function setPrefs(patch, { redraw = true } = {}) {
  doc.prefs = { ...doc.prefs, ...patch };
  prefsDirty = true;
  if (redraw) touched(null);
  else scheduleSave();
}

export function selectedDate(page, fallback) {
  return doc?.prefs?.dates?.[page] || fallback;
}

export function setSelectedDate(page, dateKey) {
  setPrefs({ dates: { ...(doc.prefs.dates || {}), [page]: dateKey } });
}

export function rowCount() {
  return TABLES.reduce((n, t) => n + all(t).length, 0);
}
