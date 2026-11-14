// Titan Protocol rules: dates, engine scores, streaks, analytics, goals,
// nutrition targets and money summaries. Pure reads of the tables in db.js.
import * as db from "./db.js";

export const ENGINES = ["body", "mind", "money", "general"];
export const ENGINE_LABEL = { body: "Body", mind: "Mind", money: "Money", general: "General", all: "All", habits: "Habits" };
export const ENGINE_DESC = { body: "Fitness, sleep, nutrition", mind: "Learning, reading, focus", money: "Expenses, income, budgets", general: "Everything else" };
export const THRESHOLD = 60; // a day at or above this is a consistent day
const EMPTY = Object.freeze({ percent: 0, mainDone: 0, mainTotal: 0, secondaryDone: 0, secondaryTotal: 0, pointsDone: 0, pointsTotal: 0 });

// ── Dates (local calendar days as YYYY-MM-DD) ─────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => keyOf(new Date());
export const isKey = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export function parse(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parse(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}
export function range(from, to) {
  const out = [];
  if (!isKey(from) || !isKey(to) || from > to) return out;
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}
// Weeks start on Monday, as in the original.
export function weekStart(key) {
  const d = parse(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return keyOf(d);
}
export function monthStart(key) {
  return `${key.slice(0, 7)}-01`;
}
export function monthEnd(key) {
  const d = parse(monthStart(key));
  return keyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
export function addMonths(key, n) {
  const d = parse(monthStart(key));
  return keyOf(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
export function isoWeek(key) {
  const d = parse(key);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const w = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${pad(w)}`;
}
export const dayName = (key) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parse(key).getDay()];
export const shortDate = (key) => parse(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const longDate = (key) => parse(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
export const monthLabel = (key) => parse(key).toLocaleDateString(undefined, { month: "long", year: "numeric" });
export function daysBetween(a, b) {
  return Math.round((parse(b) - parse(a)) / 864e5);
}
export const dateOfMs = (ms) => keyOf(new Date(ms));

// ── Engine tasks ──────────────────────────────────────────────────────────
export function tasksOf(engine) {
  return db.all("tasks").filter((t) => t.engine === engine && t.isActive !== false);
}

export function completionSet(engine, key) {
  return new Set((index(engine).byDate.get(key) || []));
}

// Per engine: completions by date and by task, rebuilt when either table changes.
const indexes = new Map();
function index(engine) {
  const stamp = `${db.version("tasks")}:${db.version("completions")}`;
  const hit = indexes.get(engine);
  if (hit?.stamp === stamp) return hit;
  const byDate = new Map();
  const byTask = new Map();
  for (const c of db.all("completions")) {
    if (c.engine !== engine) continue;
    if (!byDate.has(c.dateKey)) byDate.set(c.dateKey, new Set());
    byDate.get(c.dateKey).add(c.taskId);
    if (!byTask.has(c.taskId)) byTask.set(c.taskId, new Set());
    byTask.get(c.taskId).add(c.dateKey);
  }
  const value = { stamp, byDate, byTask, tasks: tasksOf(engine) };
  indexes.set(engine, value);
  return value;
}

export function isDone(engine, taskId, key) {
  return !!index(engine).byDate.get(key)?.has(taskId);
}

// Points: main = 2, secondary = 1. A task done on fewer than 7 days a week
// stops counting for the rest of the week once its goal is met, so rest days
// don't cost anything. A task doesn't count on days before it existed.
export function dayScore(engine, key) {
  const ix = index(engine);
  const done = ix.byDate.get(key) || new Set();
  const ws = weekStart(key);
  let mainTotal = 0, mainDone = 0, secTotal = 0, secDone = 0;
  for (const t of ix.tasks) {
    if (t.createdAt && dateOfMs(t.createdAt) > key) continue;
    const dpw = t.daysPerWeek ?? 7;
    if (dpw < 7) {
      const dates = ix.byTask.get(t.id);
      let before = 0;
      if (dates) for (let k = ws; k < key; k = addDays(k, 1)) if (dates.has(k)) before++;
      if (before >= dpw) continue;
    }
    if (t.kind === "main") { mainTotal++; if (done.has(t.id)) mainDone++; }
    else { secTotal++; if (done.has(t.id)) secDone++; }
  }
  return points(mainTotal, mainDone, secTotal, secDone);
}

export function points(mainTotal, mainDone, secTotal, secDone) {
  const pointsTotal = mainTotal * 2 + secTotal;
  const pointsDone = mainDone * 2 + secDone;
  return { percent: pointsTotal ? Math.round((pointsDone / pointsTotal) * 100) : 0, mainDone, mainTotal, secondaryDone: secDone, secondaryTotal: secTotal, pointsDone, pointsTotal };
}

// The tasks shown for a day, with the weekly-goal rule applied ("rested").
export function dayTasks(engine, key) {
  const ix = index(engine);
  const done = ix.byDate.get(key) || new Set();
  const ws = weekStart(key);
  return ix.tasks.map((t) => {
    const dpw = t.daysPerWeek ?? 7;
    let weekCount = 0;
    const dates = ix.byTask.get(t.id);
    if (dates) for (let k = ws; k <= addDays(ws, 6); k = addDays(k, 1)) if (dates.has(k)) weekCount++;
    let before = 0;
    if (dpw < 7 && dates) for (let k = ws; k < key; k = addDays(k, 1)) if (dates.has(k)) before++;
    return { ...t, completed: done.has(t.id), weekCount, goalMet: dpw < 7 && before >= dpw, notYet: !!t.createdAt && dateOfMs(t.createdAt) > key };
  }).sort((a, b) => a.createdAt - b.createdAt);
}

export function scoreMap(engine, from, to) {
  const out = {};
  for (const k of range(from, to)) out[k] = dayScore(engine, k).percent;
  return out;
}

export function titanDay(key) {
  const perEngine = Object.fromEntries(ENGINES.map((e) => [e, dayScore(e, key)]));
  const active = ENGINES.filter((e) => perEngine[e].pointsTotal > 0);
  const percent = active.length ? Math.round(active.reduce((s, e) => s + perEngine[e].percent, 0) / active.length) : 0;
  return { perEngine, enginesActiveCount: active.length, percent };
}

export function titanMap(from, to) {
  const out = {};
  for (const k of range(from, to)) out[k] = titanDay(k).percent;
  return out;
}

// Where an engine's history starts: its first visit, task or completion.
export function engineStart(engine) {
  const meta = db.get("engine_meta", engine);
  let start = meta?.startDate || null;
  for (const t of tasksOf(engine)) {
    const k = t.createdAt ? dateOfMs(t.createdAt) : null;
    if (k && (!start || k < start)) start = k;
  }
  return start;
}

export function titanStart() {
  const starts = ENGINES.map(engineStart).filter(Boolean).sort();
  return starts[0] || null;
}

export function ensureEngineMeta(engine, key) {
  const meta = db.get("engine_meta", engine);
  if (!meta) db.put("engine_meta", { id: engine, startDate: key, createdAt: Date.now() });
  else if (key < meta.startDate) db.update("engine_meta", engine, { startDate: key });
}

export function toggleTask(engine, taskId, key) {
  const hit = db.all("completions").find((c) => c.taskId === taskId && c.dateKey === key && c.engine === engine);
  if (hit) db.remove("completions", hit.id);
  else db.insert("completions", { engine, taskId, dateKey: key });
  ensureEngineMeta(engine, key);
  return !hit;
}

export function setTaskDone(engine, taskId, key, done) {
  if (isDone(engine, taskId, key) !== done) toggleTask(engine, taskId, key);
}

export function addTask(engine, { title, kind = "main", daysPerWeek = 7 }) {
  const t = db.insert("tasks", {
    engine, title: String(title).trim().slice(0, 300), kind: kind === "secondary" ? "secondary" : "main",
    createdAt: Date.now(), daysPerWeek: Math.min(7, Math.max(1, Math.floor(daysPerWeek) || 7)), isActive: true
  });
  ensureEngineMeta(engine, today());
  return t;
}

export function deleteTask(taskId) {
  db.remove("tasks", taskId);
  db.removeWhere("completions", (c) => c.taskId === taskId);
  // A goal's daily task pointing at it goes too.
  db.removeWhere("goal_tasks", (g) => g.engineTaskRefId === String(taskId));
}

// Calendar colour of a day: grey (future / before start), red (0), yellow (< 60), green.
export function heat(pct, { future = false, beforeStart = false } = {}) {
  if (future || beforeStart) return { state: "grey", intensity: 0 };
  if (!pct) return { state: "red", intensity: 0 };
  if (pct < THRESHOLD) return { state: "yellow", intensity: Math.min(1, pct / THRESHOLD) };
  return { state: "green", intensity: Math.min(1, (pct - THRESHOLD) / 40) };
}

// Consistent days and streaks over [from, to] (clipped to the start and today).
export function consistency(map, from, to, start) {
  const lo = start && start > from ? start : from;
  const hi = to > today() ? today() : to;
  if (!lo || lo > hi) return { consistencyPct: 0, consistentDays: 0, daysElapsed: 0, currentStreak: 0, bestStreak: 0 };
  const days = range(lo, hi);
  let good = 0, run = 0, best = 0;
  for (const k of days) {
    if ((map[k] ?? 0) >= THRESHOLD) { good++; run++; best = Math.max(best, run); } else run = 0;
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0 && (map[days[i]] ?? 0) >= THRESHOLD; i--) current++;
  return { consistencyPct: days.length ? Math.round((good / days.length) * 100) : 0, consistentDays: good, daysElapsed: days.length, currentStreak: current, bestStreak: best };
}

// ── Dashboard summary ─────────────────────────────────────────────────────
export function summary(key = today()) {
  const titan = titanDay(key);
  const atRisk = ENGINES.map((e) => {
    const s = titan.perEngine[e];
    const active = s.pointsTotal > 0;
    if (active && s.percent >= THRESHOLD) return null;
    return { engine: e, label: ENGINE_LABEL[e], scorePct: s.percent, isActive: active, reason: active ? `Below threshold at ${s.percent}%` : "No active score yet" };
  }).filter(Boolean).sort((a, b) => (a.isActive === b.isActive ? a.scorePct - b.scorePct : a.isActive ? 1 : -1));
  const riskOrder = new Map(atRisk.map((r, i) => [r.engine, i]));
  const openMain = [];
  for (const e of ENGINES) {
    for (const t of dayTasks(e, key)) if (t.kind === "main" && !t.completed && !t.goalMet && !t.notYet) openMain.push({ ...t, engineLabel: ENGINE_LABEL[e] });
  }
  openMain.sort((a, b) => (riskOrder.get(a.engine) ?? 99) - (riskOrder.get(b.engine) ?? 99) || a.createdAt - b.createdAt);
  const top = openMain.slice(0, 6);
  let next;
  if (top[0]) next = { title: `Execute ${top[0].engineLabel} main task`, detail: top[0].title, page: top[0].engine, cta: "Open engine" };
  else if (atRisk[0]) next = { title: `${atRisk[0].label} needs attention`, detail: `${atRisk[0].reason} (${key})`, page: atRisk[0].engine, cta: "Resolve risk" };
  else next = { title: "Lock momentum with a focus block", detail: "No urgent risks detected. Convert the day into deep output.", page: "focus", cta: "Start focus" };
  return {
    dateKey: key, titan, atRisk, topOpenMain: top, nextBestAction: next,
    completedPoints: ENGINES.reduce((s, e) => s + titan.perEngine[e].pointsDone, 0),
    totalPoints: ENGINES.reduce((s, e) => s + titan.perEngine[e].pointsTotal, 0),
    openMainCount: openMain.length
  };
}

// This week's average against last week's, per engine (last 7 days vs the 7 before).
export function weekComparison(key = today()) {
  return ENGINES.map((e) => {
    const days = range(addDays(key, -13), key).map((k) => dayScore(e, k).percent);
    const last = Math.round(days.slice(0, 7).reduce((s, v) => s + v, 0) / 7);
    const now = Math.round(days.slice(7).reduce((s, v) => s + v, 0) / 7);
    return { engine: e, thisWeekAvg: now, lastWeekAvg: last, change: now - last };
  });
}

export function weekStats(key = today()) {
  let total = 0;
  let best = { dateKey: key, percent: 0 };
  const days = range(addDays(key, -6), key);
  const scores = [];
  for (const k of days) {
    const t = titanDay(k);
    for (const e of ENGINES) total += t.perEngine[e].mainDone + t.perEngine[e].secondaryDone;
    if (t.percent > best.percent) best = { dateKey: k, percent: t.percent };
    scores.push({ dateKey: k, percent: t.percent });
  }
  const active = scores.filter((s) => s.percent > 0);
  return { totalCompleted: total, bestDay: best, days: scores, avg: active.length ? Math.round(active.reduce((s, x) => s + x.percent, 0) / active.length) : 0 };
}

// ── Analytics ─────────────────────────────────────────────────────────────
export function analytics(days) {
  const end = today();
  const from = addDays(end, -(days - 1));
  const heatFrom = addDays(end, -83);
  const lo = from < heatFrom ? from : heatFrom;
  const all = range(lo, end);
  const titanBy = {};
  const engineBy = Object.fromEntries(ENGINES.map((e) => [e, {}]));
  for (const k of all) {
    const t = titanDay(k);
    titanBy[k] = t.percent;
    for (const e of ENGINES) engineBy[e][k] = t.perEngine[e].percent;
  }
  const win = range(from, end);
  const trend = win.map((k) => ({ dateKey: k, score: titanBy[k] ?? 0 }));
  const enginePerf = ENGINES.map((e) => ({ engine: e, score: win.length ? Math.round(win.reduce((s, k) => s + (engineBy[e][k] ?? 0), 0) / win.length) : 0 }));
  const weeks = new Map();
  for (const k of win) {
    const w = isoWeek(k);
    const cur = weeks.get(w) || { total: 0, count: 0 };
    cur.total += titanBy[k] ?? 0;
    cur.count++;
    weeks.set(w, cur);
  }
  const weekly = [...weeks.entries()].map(([week, v]) => ({ week, avg: v.count ? Math.round(v.total / v.count) : 0 }));
  let current = 0;
  for (let i = win.length - 1; i >= 0 && (titanBy[win[i]] ?? 0) >= THRESHOLD; i--) current++;
  let longest = 0, run = 0;
  for (const k of win) { if ((titanBy[k] ?? 0) >= THRESHOLD) { run++; longest = Math.max(longest, run); } else run = 0; }
  const last30 = range(addDays(end, -29), end);
  const last30Avg = Math.round(last30.reduce((s, k) => s + (titanBy[k] ?? titanDay(k).percent), 0) / last30.length);
  const bestWeekAvg = weekly.length ? Math.max(...weekly.map((w) => w.avg)) : 0;
  // How often each task got done since it was made (within the window).
  const reliability = [];
  for (const e of ENGINES) {
    const ix = index(e);
    for (const t of ix.tasks) {
      const made = t.createdAt ? dateOfMs(t.createdAt) : from;
      const start = made > from ? made : from;
      const n = range(start, end).length;
      if (!n) continue;
      const dates = ix.byTask.get(t.id) || new Set();
      let hit = 0;
      for (const k of dates) if (k >= start && k <= end) hit++;
      reliability.push({ title: t.title, engine: e, percent: Math.round((hit / n) * 100) });
    }
  }
  const sorted = [...reliability].sort((a, b) => b.percent - a.percent || a.title.localeCompare(b.title));
  const top = sorted.slice(0, 5);
  const topKeys = new Set(top.map((r) => `${r.engine}::${r.title}`));
  const bottom = [...reliability].sort((a, b) => a.percent - b.percent || a.title.localeCompare(b.title)).filter((r) => !topKeys.has(`${r.engine}::${r.title}`)).slice(0, 5);
  const heatDays = range(heatFrom, end).map((k) => ({ dateKey: k, score: titanBy[k] ?? 0 }));
  return { trend, enginePerf, weekly, heatDays, streaks: { current, longest, last30Avg, bestWeekAvg }, top, bottom, start: titanStart() };
}

// ── Habits ────────────────────────────────────────────────────────────────
export function habitDays(habitId) {
  const set = new Set();
  for (const l of db.groupBy("habit_logs", "habitId").get(habitId) || []) if (l.completed) set.add(l.dateKey);
  return set;
}

export function habitDone(habitId, key) {
  return (db.groupBy("habit_logs", "habitId").get(habitId) || []).some((l) => l.dateKey === key && l.completed);
}

export function toggleHabit(habitId, key) {
  const log = (db.groupBy("habit_logs", "habitId").get(habitId) || []).find((l) => l.dateKey === key);
  if (log) db.update("habit_logs", log.id, { completed: !log.completed });
  else db.insert("habit_logs", { habitId, dateKey: key, completed: true });
}

// A streak forgives one missed day a week: a second miss within seven days
// of the last one ends it (the original's rule). Today not done yet is a miss.
export function habitStreak(days, from = today()) {
  let n = 0;
  let lastMiss = -Infinity;
  for (let i = 0; i <= 1095; i++) {
    if (days.has(addDays(from, -i))) n++;
    else {
      if (i - lastMiss < 7) break;
      lastMiss = i;
    }
  }
  return n;
}

export function habitBest(days) {
  if (!days.size) return 0;
  const sorted = [...days].sort();
  const list = range(sorted[0], sorted[sorted.length - 1]);
  let best = 0, run = 0, lastMiss = -Infinity;
  for (let i = 0; i < list.length; i++) {
    if (days.has(list[i])) run++;
    else if (i - lastMiss < 7) {
      best = Math.max(best, run);
      run = 0;
      for (let j = lastMiss + 1; j < i; j++) if (days.has(list[j])) run++;
      lastMiss = i;
    } else lastMiss = i;
  }
  return Math.max(best, run);
}

// ── Goals ─────────────────────────────────────────────────────────────────
export function goalTasks(goalId) {
  return db.all("goal_tasks").filter((t) => t.goalId === goalId).sort((a, b) => a.createdAt - b.createdAt);
}

export function goalTaskDone(t, key = today()) {
  if ((t.taskType ?? "once") === "daily" && t.engine && t.engineTaskRefId) return isDone(t.engine, Number(t.engineTaskRefId), key);
  return !!t.completed;
}

export function goalProgress(goal) {
  const tasks = goalTasks(goal.id);
  if (tasks.length) {
    const once = tasks.filter((t) => (t.taskType ?? "once") === "once");
    if (once.length) {
      const done = once.filter((t) => t.completed).length;
      return { current: done, target: once.length, percent: Math.round((done / once.length) * 100) };
    }
    // Only daily tasks: today's share done.
    const done = tasks.filter((t) => goalTaskDone(t)).length;
    return { current: done, target: tasks.length, percent: Math.round((done / tasks.length) * 100), daily: true };
  }
  const created = dateOfMs(goal.createdAt);
  const end = goal.deadline < today() ? goal.deadline : today();
  if (created > end) return { current: 0, target: goal.target, percent: 0 };
  const days = range(created, end);
  if (goal.type === "consistency") {
    const th = goal.threshold ?? 50;
    let hit = 0;
    for (const k of days) {
      let pct;
      if (goal.engine === "habits") {
        const habits = db.all("habits").length;
        pct = habits ? (db.all("habit_logs").filter((l) => l.dateKey === k && l.completed).length / habits) * 100 : 0;
      } else if (goal.engine === "all") pct = titanDay(k).percent;
      else pct = dayScore(goal.engine, k).percent;
      if (pct >= th) hit++;
    }
    const current = Math.round((hit / days.length) * 100);
    return { current, target: goal.target, percent: goal.target ? Math.min(100, Math.round((current / goal.target) * 100)) : 0 };
  }
  if (goal.type === "value") {
    let current = 0;
    if (goal.engine === "body") current = [...db.all("body_weight_entries")].sort((a, b) => b.dateKey.localeCompare(a.dateKey))[0]?.weightKg ?? 0;
    else if (goal.engine === "money") current = db.all("money_tx").filter((t) => t.type === "income" && t.dateISO >= created).reduce((s, t) => s + t.amount, 0);
    return { current, target: goal.target, percent: goal.target ? Math.min(100, Math.round((current / goal.target) * 100)) : 0 };
  }
  let current = 0;
  const inRange = (k) => k >= created && k <= end;
  if (goal.engine === "habits") current = db.all("habit_logs").filter((l) => l.completed && inRange(l.dateKey)).length;
  else if (goal.engine === "mind" || goal.engine === "all") current = db.all("focus_daily").filter((f) => inRange(f.dateKey)).reduce((s, f) => s + f.completedSessions, 0);
  else if (goal.engine === "body") current = db.all("gym_sessions").filter((s) => inRange(s.dateKey)).length;
  else if (goal.engine === "money") current = db.all("money_tx").filter((t) => (t.type === "income" || t.type === "expense") && inRange(t.dateISO)).length;
  else if (goal.engine === "general") current = new Set(db.all("completions").filter((c) => c.engine === "general" && inRange(c.dateKey)).map((c) => c.dateKey)).size;
  return { current, target: goal.target, percent: goal.target > 0 ? Math.min(100, Math.round((current / goal.target) * 100)) : 0 };
}

// A daily goal task is a main task in its engine, so ticking either one ticks both.
export function addGoalTask(goalId, title, taskType, engine) {
  let ref = null;
  if (taskType === "daily" && engine) ref = String(addTask(engine, { title, kind: "main", daysPerWeek: 7 }).id);
  return db.insert("goal_tasks", { goalId, title: title.trim(), taskType, engine: engine || null, engineTaskRefId: ref, completed: false, createdAt: Date.now() });
}

export function toggleGoalTask(t) {
  if ((t.taskType ?? "once") === "daily" && t.engine && t.engineTaskRefId) toggleTask(t.engine, Number(t.engineTaskRefId), today());
  else db.update("goal_tasks", t.id, { completed: !t.completed });
}

export function deleteGoalTask(t) {
  if ((t.taskType ?? "once") === "daily" && t.engine && t.engineTaskRefId) {
    const id = Number(t.engineTaskRefId);
    db.remove("tasks", id);
    db.removeWhere("completions", (c) => c.taskId === id);
  }
  db.remove("goal_tasks", t.id);
}

export function deleteGoal(goalId) {
  for (const t of goalTasks(goalId)) deleteGoalTask(t);
  db.remove("goals", goalId);
}

export function daysLeft(deadline) {
  return daysBetween(today(), deadline);
}

// ── Nutrition (Mifflin-St Jeor, the original's activity steps) ────────────
const round5 = (n) => Math.round(n / 5) * 5;
export function activityMultiplier(steps, workouts) {
  let m = 1.2;
  if (steps >= 12000) m = 1.65; else if (steps >= 8000) m = 1.5; else if (steps >= 5000) m = 1.35;
  const extra = workouts >= 5 ? 0.15 : workouts >= 3 ? 0.1 : workouts >= 1 ? 0.05 : 0;
  return Math.min(1.9, Math.max(1.2, Number((m + extra).toFixed(2))));
}
export function nutritionTargets(p) {
  const bmr = p.sex === "male" ? 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age + 5 : 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age - 161;
  const activity_multiplier = activityMultiplier(p.steps_per_day, p.workouts_per_week);
  const tdee = bmr * activity_multiplier;
  const delta = p.goal === "maintain" ? 0 : ({ 0.25: 250, 0.5: 500, 0.75: 750, 1: 1000 }[p.rate_kg_per_week] ?? 0);
  const cal = p.goal === "cut" ? tdee - delta : p.goal === "bulk" ? tdee + delta : tdee;
  const protein_g = round5(p.weight_kg * (p.protein_preference === "high" ? 2 : 1.6));
  const fat_g = round5(p.weight_kg * 0.8);
  const carbs_g = round5(Math.max(0, cal - (protein_g * 4 + fat_g * 9)) / 4);
  return { bmr, activity_multiplier, tdee, calorie_target: Math.round(cal), protein_g, carbs_g, fat_g };
}

// ── Money ─────────────────────────────────────────────────────────────────
export const CURRENCY = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };
export const NEEDS = ["Food", "Transport", "Rent", "Groceries", "Utilities", "Health", "Education", "Bills", "Family", "Other Need"];
export const WANTS = ["Entertainment", "Dining Out", "Shopping", "Travel", "Dating/Social", "Gaming", "Luxury/Style", "Gadgets", "Other Want"];
export const INCOME = ["Salary", "Borrowed", "Other Income"];
export const DEEP_WORK_CATEGORIES = ["Main Job / College", "Side Hustle", "Freelance", "Investments", "Other"];
export const EARNING_CATEGORIES = new Set(["Side Hustle", "Freelance"]);

export function money(n, currency = db.pref("currency", "USD"), { cents = false } = {}) {
  const v = Number.isFinite(n) ? n : 0;
  const whole = Number.isInteger(Math.round(Math.abs(v) * 100) / 100);
  const s = new Intl.NumberFormat("en-US", { maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents && !whole ? 2 : 0 }).format(Math.abs(v));
  return `${v < 0 ? "−" : ""}${CURRENCY[currency] || "$"}${s}`;
}

// Spent counts expenses and repayments; income counts income and borrowing.
export function cashSummary(txs) {
  let spent = 0, income = 0, needs = 0, wants = 0;
  const categories = {};
  for (const t of txs) {
    if (t.type === "expense") {
      spent += t.amount;
      if (t.bucket === "need") needs += t.amount;
      if (t.bucket === "want") wants += t.amount;
      if (t.category) categories[t.category] = (categories[t.category] ?? 0) + t.amount;
    } else if (t.type === "repayment") spent += t.amount;
    else if (t.type === "income" || t.type === "borrowed") income += t.amount;
  }
  return { spent, income, net: income - spent, needs, wants, categories };
}

export function txOn(key) {
  return db.all("money_tx").filter((t) => t.dateISO === key);
}

export function txInMonth(key) {
  const a = monthStart(key), b = monthEnd(key);
  return db.all("money_tx").filter((t) => t.dateISO >= a && t.dateISO <= b);
}

export function budgetStatus(key = today()) {
  const spentBy = new Map();
  for (const t of txInMonth(key)) {
    if (t.type !== "expense") continue;
    const c = t.category ?? "Other";
    spentBy.set(c, (spentBy.get(c) ?? 0) + t.amount);
  }
  return db.all("budgets").map((b) => {
    const spent = spentBy.get(b.category) ?? 0;
    return { budget: b, spent, remaining: Math.max(0, b.monthlyLimit - spent), over: Math.max(0, spent - b.monthlyLimit), percent: b.monthlyLimit > 0 ? Math.min(100, Math.round((spent / b.monthlyLimit) * 100)) : 0 };
  });
}

export function addExpense({ amount, dateISO, category, bucket, note }) {
  return db.insert("money_tx", { dateISO, type: "expense", amount, category: category || null, bucket: bucket || null, note: note || null, loanId: null });
}
export function addIncome({ amount, dateISO, category, note }) {
  return db.insert("money_tx", { dateISO, type: "income", amount, category: category || null, bucket: null, note: note || null, loanId: null });
}
export function addBorrowed({ amount, dateISO, lender, dueISO, note }) {
  const loan = db.insert("money_loans", { lender: lender || null, amount, dateISO, dueISO: dueISO || null, status: "unpaid" });
  db.insert("money_tx", { dateISO, type: "borrowed", amount, category: null, bucket: null, note: note || null, loanId: loan.id });
  return loan;
}
export function repayLoan(loanId, dateISO = today()) {
  const loan = db.get("money_loans", loanId);
  if (!loan) throw new Error("Loan not found.");
  db.insert("money_tx", { dateISO, type: "repayment", amount: loan.amount, category: "Debt Repayment", bucket: null, note: loan.lender ? `Repaid ${loan.lender}` : null, loanId });
  db.update("money_loans", loanId, { status: "paid" });
}
export function deleteLoan(loanId) {
  db.remove("money_loans", loanId);
  db.removeWhere("money_tx", (t) => t.loanId === loanId);
}
export function deleteTx(id) {
  const t = db.get("money_tx", id);
  if (t?.type === "borrowed" && t.loanId) deleteLoan(t.loanId);
  else db.remove("money_tx", id);
}

export function earnings(from, to) {
  return db.all("deep_work_logs").filter((l) => l.dateKey >= from && l.dateKey <= to).reduce((s, l) => s + (l.earningsToday ?? 0), 0);
}

// ── Sleep ─────────────────────────────────────────────────────────────────
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function sleepMinutes(bed, wake) {
  let d = toMinutes(wake) - toMinutes(bed);
  if (d <= 0) d += 1440;
  return d;
}
export function hm(minutes) {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
export function clock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
// Bedtimes straddle midnight: 23:30 and 00:30 average to midnight, not noon.
export function averageClock(times, { night = false } = {}) {
  if (!times.length) return null;
  const vals = times.map((t) => {
    const m = toMinutes(t);
    return night && m >= 720 ? m - 1440 : m;
  });
  return clock(vals.reduce((s, v) => s + v, 0) / vals.length);
}
export const QUALITY = [null, { label: "Poor", color: "#ef4444" }, { label: "Fair", color: "#f97316" }, { label: "Good", color: "#eab308" }, { label: "Great", color: "#22d3ee" }, { label: "Excellent", color: "#34d399" }];
