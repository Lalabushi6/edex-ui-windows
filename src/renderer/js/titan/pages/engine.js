// Engine pages (Body, Mind, Money, General): the day's score, a calendar
// coloured by score, consistency and streaks, and the main / secondary tasks.
import { h } from "../../core/dom.js";
import { confirm, prompt, toast } from "../../core/ui.js";
import * as db from "../db.js";
import * as L from "../logic.js";
import * as U from "../ui.js";

const TITLES = { body: "Body Control", mind: "Mind Control", money: "Money Engine", general: "General Ops" };
export const SUBTABS = {
  body: [{ id: "body", label: "Overview" }, { id: "body/nutrition", label: "Nutrition" }, { id: "body/workouts", label: "Workouts" }, { id: "body/weight", label: "Weight" }, { id: "body/sleep", label: "Sleep" }],
  money: [{ id: "money", label: "Tasks" }, { id: "money/cashflow", label: "Cashflow" }, { id: "money/deep-work", label: "Deep Work" }, { id: "money/budgets", label: "Budgets" }]
};

const DPW = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: n === 7 ? "7 days (every day)" : `${n} day${n > 1 ? "s" : ""} per week` }));

// New task in an engine (or any engine, when `engine` is null).
export async function taskDialog(engine = null, { title = "" } = {}) {
  const r = await U.formDialog({
    title: engine ? `New ${L.ENGINE_LABEL[engine]} task` : "New task",
    submitLabel: "Create",
    fields: [
      !engine && { name: "engine", label: "Engine", type: "select", value: "body", options: L.ENGINES.map((e) => ({ value: e, label: L.ENGINE_LABEL[e] })) },
      { name: "title", label: "Title", placeholder: "Task title", value: title, required: true },
      { name: "kind", label: "Priority", type: "seg", value: "main", options: [{ value: "main", label: "Main · 2 pts" }, { value: "secondary", label: "Secondary · 1 pt" }] },
      { name: "dpw", label: "How many days per week?", type: "select", value: "7", options: DPW, hint: "Set less than 7 if you take rest days — skipping won't hurt your score once the weekly goal is met." }
    ],
    onSubmit: (v) => {
      if (!v.title.trim()) return "Title required.";
      L.addTask(engine || v.engine, { title: v.title, kind: v.kind, daysPerWeek: Number(v.dpw) });
    }
  });
  if (r) toast("Task added", { level: "ok", timeout: 1400 });
}

export function taskMenu(t) {
  return [
    { label: t.kind === "main" ? "Move to secondary" : "Move to main", icon: "up", run: () => db.update("tasks", t.id, { kind: t.kind === "main" ? "secondary" : "main" }) },
    { label: "Rename…", icon: "edit", run: async () => { const v = await prompt({ title: "Rename task", value: t.title }); if (v) db.update("tasks", t.id, { title: v.slice(0, 300) }); } },
    {
      label: "Days per week…", icon: "calendar", run: async () => {
        const r = await U.formDialog({ title: "Days per week", fields: [{ name: "dpw", label: "Target", type: "select", value: String(t.daysPerWeek ?? 7), options: DPW }], onSubmit: () => {} });
        if (r) db.update("tasks", t.id, { daysPerWeek: Number(r.dpw) });
      }
    },
    { separator: true },
    { label: "Delete task", icon: "trash", danger: true, run: async () => { if (await confirm({ title: "Delete this task?", message: `"${t.title}" and its completion history will be removed.`, confirmLabel: "Delete", danger: true })) L.deleteTask(t.id); } }
  ];
}

export function taskRow(t, key, { showEngine = false } = {}) {
  const dpw = t.daysPerWeek ?? 7;
  const meta = [];
  if (showEngine) meta.push(U.badge(L.ENGINE_LABEL[t.engine], { color: U.ENGINE_COLOR[t.engine] }));
  if (dpw < 7) meta.push(U.badge(t.goalMet ? `Week goal met ${t.weekCount}/${dpw}` : `${t.weekCount}/${dpw} this week`, { cls: t.goalMet ? "ok" : "" }));
  meta.push(U.badge(t.kind === "main" ? "2 pts" : "1 pt", { cls: t.kind === "main" ? "main" : "" }));
  return U.checkRow({
    title: t.title, done: t.completed, dim: (t.goalMet && !t.completed) || t.notYet,
    onToggle: () => L.toggleTask(t.engine, t.id, key),
    meta, menu: () => taskMenu(t)
  });
}

export function render(ctx, engine) {
  const t = L.today();
  const key = db.selectedDate(engine, t) > t ? t : db.selectedDate(engine, t);
  const st = ctx.state;
  if (!st.month || st.forKey !== key) { st.month = L.monthStart(key); st.forKey = key; }
  const setDate = (k) => { db.setSelectedDate(engine, k > t ? t : k); };
  const tasks = L.dayTasks(engine, key);
  const score = L.dayScore(engine, key);
  const start = L.engineStart(engine);
  const mFrom = st.month, mTo = L.monthEnd(st.month);
  const map = L.scoreMap(engine, mFrom, mTo);
  const cons = L.consistency(map, mFrom, mTo, start);
  // All-time streak, back from the selected day.
  const streakMap = L.scoreMap(engine, L.addDays(key, -365) < (start || key) ? (start || key) : L.addDays(key, -365), key);
  const allTime = L.consistency(streakMap, start || key, key, start);
  const main = tasks.filter((x) => x.kind === "main");
  const sec = tasks.filter((x) => x.kind !== "main");
  const list = (title, rows, emptyText) => U.panel(title, { sub: `${rows.filter((r) => r.completed).length}/${rows.length}`, tools: U.iconBtn("plus", "Add task", () => taskDialog(engine)) },
    rows.length ? h("div", { class: "tp-list" }, ...rows.map((r) => taskRow(r, key))) : U.empty(emptyText, U.btn("Add task", () => taskDialog(engine), { kind: "sm" })));

  return h("div", { class: "tp-page" },
    U.pageHead(`${L.ENGINE_LABEL[engine]} engine`, TITLES[engine], `Daily performance log · ${L.longDate(key)}`, U.datePill(key, setDate, { max: t })),
    SUBTABS[engine] && U.tabs(SUBTABS[engine], engine, (id) => ctx.go(id)),
    h("div", { class: "tp-grid tp-engine-grid" },
      U.panel("Day score", { cls: "tp-hero", sub: score.pointsTotal ? `${score.pointsDone}/${score.pointsTotal} pts` : "Plan not set" },
        h("div", { class: "tp-hero-row" },
          h("div", { class: "tp-bignum" }, `${score.percent}%`),
          h("div", { class: "tp-hero-meta" },
            h("div", null, `Main ${score.mainDone}/${score.mainTotal}`),
            h("div", null, `Secondary ${score.secondaryDone}/${score.secondaryTotal}`),
            h("div", null, `Points ${score.pointsDone}/${score.pointsTotal}`))),
        U.progress(score.percent, { state: L.heat(score.percent).state })),
      U.panel("Consistency", { sub: L.monthLabel(st.month) },
        h("div", { class: "tp-metrics" },
          U.metric("Consistent days", `${cons.consistentDays}/${cons.daysElapsed}`, `${cons.consistencyPct}% this month`),
          U.metric("Current streak", `${allTime.currentStreak}`, "days ≥ 60%"),
          U.metric("Best streak", `${Math.max(cons.bestStreak, allTime.bestStreak)}`, "days"))),
      U.panel(null, { cls: "tp-cal-panel" },
        U.calendar({ month: st.month, selected: key, map, start, onSelect: setDate, onMonth: (m) => { st.month = m; ctx.redraw(); } }),
        U.legend()),
      list("Main tasks", main, "No main tasks yet."),
      list("Secondary tasks", sec, "No secondary tasks yet.")));
}

export function mount(engine) {
  // The engine's history starts the first time its page is opened.
  L.ensureEngineMeta(engine, db.selectedDate(engine, L.today()) > L.today() ? L.today() : db.selectedDate(engine, L.today()));
}
