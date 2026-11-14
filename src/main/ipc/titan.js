// Titan Protocol: the life-tracking sub-app (four engines, habits, journal,
// goals, focus timer, workouts, sleep, weight, nutrition, money). Its data is
// one JSON document in userData, laid out as the tables of the original
// Titan Protocol app, so a backup made by either one imports into the other.
"use strict";

const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");
const { JsonStore } = require("../lib/store");
const { handle } = require("./util");

const VERSION = 1; // the original's schema version; its importer refuses newer ones
const ENGINES = ["body", "mind", "money", "general"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 200000;
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

// ── Field types ────────────────────────────────────────────────────────────
// Each returns the clean value, or throws for a value a row can't keep.
const BAD = Symbol("bad");
const opt = (type, fallback) => ({ ...type, optional: true, fallback });
const int = (min = 0, max = Number.MAX_SAFE_INTEGER) => ({
  parse: (v) => {
    const n = typeof v === "string" && v.trim() ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) return BAD;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
});
const num = (min = -1e12, max = 1e12) => ({
  parse: (v) => {
    const n = typeof v === "string" && v.trim() ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) return BAD;
    return Math.min(max, Math.max(min, n));
  }
});
const str = (max, { min = 0, pattern } = {}) => ({
  parse: (v) => {
    if (typeof v !== "string") return BAD;
    const s = v.slice(0, max);
    if (s.trim().length < min) return BAD;
    if (pattern && !pattern.test(s)) return BAD;
    return s;
  }
});
const oneOf = (...values) => ({ parse: (v) => (values.includes(v) ? v : BAD) });
const bool = () => ({ parse: (v) => (typeof v === "boolean" ? v : v === 1 || v === "true" ? true : v === 0 || v === "false" ? false : BAD) });
const nullable = (type) => ({ parse: (v) => (v === null || v === undefined || v === "" ? null : type.parse(v)), optional: true, fallback: null });
// A day as YYYY-MM-DD. Older backups can hold full timestamps.
const date = () => ({
  parse: (v) => {
    if (typeof v !== "string") return BAD;
    const t = v.trim();
    if (DATE.test(t)) return t;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? BAD : new Date(ms).toISOString().slice(0, 10);
  }
});
const isoTime = () => ({
  parse: (v) => {
    if (typeof v !== "string") return BAD;
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? BAD : new Date(ms).toISOString();
  }
});
const sid = () => str(64, { min: 1, pattern: /^[\w-]+$/ });
const time = () => str(5, { pattern: /^\d{1,2}:\d{2}$/ });

// ── Tables (the original app's IndexedDB stores) ──────────────────────────
// key: primary key field; auto: numeric ids handed out in order.
const TABLES = {
  engine_meta: { key: "id", fields: { id: oneOf(...ENGINES), startDate: date(), createdAt: int() } },
  tasks: {
    key: "id", auto: true,
    fields: { id: int(1), engine: oneOf(...ENGINES), title: str(300, { min: 1 }), kind: oneOf("main", "secondary"), createdAt: int(), daysPerWeek: opt(int(1, 7), 7), isActive: opt(bool(), true) }
  },
  completions: { key: "id", auto: true, fields: { id: int(1), engine: oneOf(...ENGINES), taskId: int(), dateKey: date() } },
  money_tx: {
    key: "id",
    fields: {
      id: sid(), dateISO: date(), type: oneOf("expense", "income", "borrowed", "repayment"), amount: num(0),
      category: nullable(str(80)), bucket: nullable(oneOf("need", "want")), note: nullable(str(500)), loanId: nullable(sid())
    }
  },
  money_loans: {
    key: "id",
    fields: { id: sid(), lender: nullable(str(120)), amount: num(0), dateISO: date(), dueISO: nullable(date()), status: oneOf("unpaid", "paid") }
  },
  budgets: { key: "id", auto: true, fields: { id: int(1), category: str(80, { min: 1 }), monthlyLimit: num(0), createdAt: int() } },
  nutrition_profiles: {
    key: "id",
    fields: {
      id: sid(), created_at: isoTime(), updated_at: isoTime(), height_cm: num(50, 280), weight_kg: num(20, 400), age: int(10, 120),
      sex: oneOf("male", "female"), bodyfat_pct: nullable(num(1, 80)), steps_per_day: int(0, 100000), workouts_per_week: int(0, 21),
      activity_multiplier: num(1, 3), goal: oneOf("cut", "bulk", "maintain"), rate_kg_per_week: oneOf(0, 0.25, 0.5, 0.75, 1),
      calorie_target: num(0, 20000), protein_g: num(0, 2000), carbs_g: nullable(num(0, 3000)), fat_g: nullable(num(0, 2000))
    }
  },
  nutrition_meals: {
    key: "id",
    fields: { id: sid(), dateISO: date(), created_at: isoTime(), name: str(120, { min: 1 }), calories: num(0, 50000), protein_g: num(0, 5000), carbs_g: nullable(num(0, 5000)), fat_g: nullable(num(0, 5000)) }
  },
  focus_settings: {
    key: "id",
    fields: { id: oneOf("default"), focusMinutes: int(1, 240), breakMinutes: int(1, 120), longBreakMinutes: int(1, 120), longBreakAfter: int(1, 20), dailyTarget: int(1, 50) }
  },
  focus_daily: { key: "dateKey", fields: { dateKey: date(), completedSessions: int(0, 1000) } },
  deep_work_tasks: {
    key: "id", auto: true,
    fields: { id: int(1), taskName: str(200, { min: 1 }), category: oneOf("Main Job / College", "Side Hustle", "Freelance", "Investments", "Other"), createdAt: int() }
  },
  deep_work_logs: { key: "id", auto: true, fields: { id: int(1), taskId: int(), dateKey: date(), completed: bool(), earningsToday: num(0) } },
  gym_exercises: { key: "id", auto: true, fields: { id: int(1), name: str(120, { min: 1 }), muscleGroup: str(40, { min: 1 }), equipment: str(40, { min: 1 }), createdAt: int() } },
  gym_templates: { key: "id", auto: true, fields: { id: int(1), name: str(120, { min: 1 }), createdAt: int() } },
  gym_template_exercises: { key: "id", auto: true, fields: { id: int(1), templateId: int(), exerciseId: int(), order: int() } },
  gym_sessions: { key: "id", auto: true, fields: { id: int(1), dateKey: date(), templateId: int(), startedAt: int(), endedAt: nullable(int()) } },
  gym_sets: { key: "id", auto: true, fields: { id: int(1), sessionId: int(), exerciseId: int(), setIndex: int(), weight: num(0, 10000), reps: num(0, 10000) } },
  body_weight_entries: { key: "dateKey", fields: { dateKey: date(), weightKg: num(1, 700), createdAt: int() } },
  sleep_entries: {
    key: "dateKey",
    fields: { dateKey: date(), bedtime: time(), wakeTime: time(), durationMinutes: int(0, 1440), quality: oneOf(1, 2, 3, 4, 5), notes: opt(str(2000), ""), createdAt: int() }
  },
  habits: { key: "id", auto: true, fields: { id: int(1), title: str(200, { min: 1 }), engine: oneOf(...ENGINES, "all"), icon: opt(str(16), "~"), createdAt: int() } },
  habit_logs: { key: "id", auto: true, fields: { id: int(1), habitId: int(), dateKey: date(), completed: bool() } },
  journal_entries: { key: "dateKey", fields: { dateKey: date(), content: str(200000), updatedAt: int() } },
  goals: {
    key: "id", auto: true,
    fields: {
      id: int(1), title: str(200, { min: 1 }), engine: oneOf(...ENGINES, "all", "habits"), type: oneOf("consistency", "count", "value"),
      target: num(0), unit: opt(str(40), ""), deadline: date(), createdAt: int(), threshold: opt(num(0, 100), undefined)
    }
  },
  goal_tasks: {
    key: "id", auto: true,
    fields: {
      id: int(1), goalId: int(), title: str(200, { min: 1 }), taskType: opt(oneOf("daily", "once"), "once"),
      engine: nullable(oneOf(...ENGINES)), engineTaskRefId: nullable(str(32)), completed: opt(bool(), false), createdAt: int()
    }
  },
  achievements: { key: "id", auto: true, fields: { id: int(1), type: str(80, { min: 1 }), unlockedAt: int() } }
};
const TABLE_NAMES = Object.keys(TABLES);

function cleanRow(spec, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [name, type] of Object.entries(spec.fields)) {
    const v = raw[name];
    // An auto id that is missing is handed out afterwards.
    if ((v === undefined || v === null) && spec.auto && name === spec.key) continue;
    if (v === undefined || (v === null && !type.optional)) {
      if (!type.optional) return null;
      if (type.fallback !== undefined) out[name] = type.fallback;
      continue;
    }
    const parsed = type.parse(v);
    if (parsed === BAD) {
      if (!type.optional) return null;
      if (type.fallback !== undefined) out[name] = type.fallback;
      continue;
    }
    out[name] = parsed;
  }
  return out;
}

// Rows that can't be read are dropped, and a key seen twice keeps its last row.
function cleanTable(name, rows) {
  const spec = TABLES[name];
  if (!spec || !Array.isArray(rows)) return [];
  const byKey = new Map();
  const loose = [];
  for (const raw of rows.slice(0, MAX_ROWS)) {
    const row = cleanRow(spec, raw);
    if (!row) continue;
    if (row[spec.key] === undefined) loose.push(row);
    else byKey.set(row[spec.key], row);
  }
  if (loose.length) {
    let next = 1;
    for (const k of byKey.keys()) if (typeof k === "number" && k >= next) next = k + 1;
    for (const row of loose) byKey.set(next, { [spec.key]: next++, ...row });
  }
  return [...byKey.values()];
}

const PREFS = {
  currency: oneOf("USD", "EUR", "GBP", "INR"),
  accent: oneOf("edex", "cyber", "metal"),
  liftUnit: oneOf("lbs", "kg"),
  sound: bool(),
  onboarded: bool(),
  navCollapsed: bool(),
  lastBackup: nullable(isoTime())
};

function cleanPrefs(raw, base = {}) {
  const out = { ...base };
  if (!raw || typeof raw !== "object") return out;
  for (const [k, type] of Object.entries(PREFS)) {
    if (!(k in raw)) continue;
    const v = type.parse(raw[k]);
    if (v !== BAD) out[k] = v;
  }
  // Per-page selected dates ("body", "money" …), as the original kept them.
  if (raw.dates && typeof raw.dates === "object") {
    const dates = { ...(base.dates || {}) };
    for (const [k, v] of Object.entries(raw.dates).slice(0, 20)) {
      if (/^[a-z]{1,16}$/.test(k) && typeof v === "string" && DATE.test(v)) dates[k] = v;
    }
    out.dates = dates;
  }
  return out;
}

function emptyTables() {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, []]));
}

// A backup (ours or the original's): { version?, exportedAt?, tables: { name: rows } }.
function readBackup(parsed) {
  if (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object") {
    throw new Error("Not a Titan Protocol backup (it has no tables)");
  }
  if (Number.isFinite(parsed.version) && parsed.version > VERSION) {
    throw new Error(`That backup is from a newer Titan Protocol (schema ${parsed.version})`);
  }
  const tables = emptyTables();
  let rows = 0;
  let known = 0;
  let dropped = 0;
  for (const name of TABLE_NAMES) {
    const incoming = parsed.tables[name];
    if (!Array.isArray(incoming)) continue;
    known++;
    tables[name] = cleanTable(name, incoming);
    rows += tables[name].length;
    dropped += Math.max(0, Math.min(incoming.length, MAX_ROWS) - tables[name].length);
  }
  if (!known) throw new Error("That backup has none of Titan Protocol's tables");
  return { tables, summary: { tables: known, rows, dropped, exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt.slice(0, 40) : null } };
}

function registerTitan({ windows }) {
  const userData = app.getPath("userData");
  const store = new JsonStore(path.join(userData, "titan.json"), { fallback: { version: VERSION, tables: emptyTables(), prefs: {} } });
  // Whatever an older or hand-edited file holds is read through the same checks.
  {
    const d = store.data || {};
    const tables = emptyTables();
    for (const name of TABLE_NAMES) tables[name] = cleanTable(name, d.tables?.[name]);
    store.data = { version: VERSION, tables, prefs: cleanPrefs(d.prefs) };
  }

  handle("titan:load", () => store.data);

  // { tables?: { name: rows }, prefs?: {…} }: the tables named are replaced.
  handle("titan:save", (_e, patch) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid Titan payload");
    let changed = false;
    if (patch.tables && typeof patch.tables === "object") {
      for (const [name, rows] of Object.entries(patch.tables)) {
        if (!TABLES[name]) continue;
        if (!Array.isArray(rows)) throw new Error(`Invalid rows for ${name}`);
        store.data.tables[name] = cleanTable(name, rows);
        changed = true;
      }
    }
    if (patch.prefs) {
      store.data.prefs = cleanPrefs(patch.prefs, store.data.prefs);
      changed = true;
    }
    if (changed) store.save();
    return true;
  });

  handle("titan:export", async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await windows.withDialog((win) => dialog.showSaveDialog(win, {
      title: "Export Titan Protocol backup",
      defaultPath: path.join(app.getPath("documents"), `titan-backup-${stamp}.json`),
      filters: [{ name: "Titan Protocol backup", extensions: ["json"] }]
    }));
    if (canceled || !filePath) return null;
    const tables = store.data.tables;
    const payload = { version: VERSION, exportedAt: new Date().toISOString(), app: "eDEX-UI Titan Protocol", tables };
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    const rows = TABLE_NAMES.reduce((n, t) => n + tables[t].length, 0);
    store.data.prefs = { ...store.data.prefs, lastBackup: payload.exportedAt };
    store.save();
    return { file: filePath, rows, at: payload.exportedAt };
  });

  // Reads a backup and returns its cleaned tables; nothing is replaced until
  // the interface has asked and sends them back with titan:save.
  handle("titan:import", async () => {
    const { canceled, filePaths } = await windows.withDialog((win) => dialog.showOpenDialog(win, {
      title: "Import a Titan Protocol backup",
      filters: [{ name: "Titan Protocol backup", extensions: ["json"] }],
      properties: ["openFile"]
    }));
    if (canceled || !filePaths.length) return null;
    const st = await fs.promises.stat(filePaths[0]);
    if (st.size > MAX_IMPORT_BYTES) throw new Error("That file is too large for a Titan backup");
    let parsed;
    try { parsed = JSON.parse((await fs.promises.readFile(filePaths[0], "utf8")).replace(/^﻿/, "")); } catch (_) { throw new Error("That file isn't valid JSON"); }
    const { tables, summary } = readBackup(parsed);
    return { tables, summary: { ...summary, file: path.basename(filePaths[0]) } };
  });

  return { flush: () => store.flushSync() };
}

module.exports = { registerTitan, readBackup, cleanTable, TABLE_NAMES };
