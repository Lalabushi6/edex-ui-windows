// Habits: tick today, streaks that forgive one missed day a week, and
// twelve weeks of history for each habit and for all of them together.
import { h } from "../../core/dom.js";
import { confirm, prompt } from "../../core/ui.js";
import * as db from "../db.js";
import * as L from "../logic.js";
import * as U from "../ui.js";
import * as C from "../charts.js";

const ENGINES = [...L.ENGINES, "all"];

export async function habitDialog() {
  await U.formDialog({
    title: "Add a habit to track",
    submitLabel: "Add habit",
    fields: [
      { name: "title", label: "Habit name", placeholder: "e.g. Meditate 10 minutes", required: true },
      { name: "engine", label: "Engine", type: "seg", value: "general", options: ENGINES.map((e) => ({ value: e, label: L.ENGINE_LABEL[e], color: U.ENGINE_COLOR[e] })) },
      { name: "icon", label: "Icon (emoji)", placeholder: "e.g. 🧘", hint: "Optional — one emoji or a short symbol." }
    ],
    onSubmit: (v) => {
      if (!v.title.trim()) return "Habit name is required.";
      db.insert("habits", { title: v.title.trim().slice(0, 200), engine: v.engine, icon: [...(v.icon.trim() || "~")].slice(0, 4).join(""), createdAt: Date.now() });
    }
  });
}

export function render(ctx) {
  const t = L.today();
  const habits = [...db.all("habits")].sort((a, b) => a.createdAt - b.createdAt);
  const from = L.addDays(t, -83);
  const days = L.range(from, t);
  const doneToday = habits.filter((x) => L.habitDone(x.id, t)).length;
  const countBy = new Map();
  for (const l of db.all("habit_logs")) if (l.completed && l.dateKey >= from) countBy.set(l.dateKey, (countBy.get(l.dateKey) || 0) + 1);

  const rows = habits.map((x) => {
    const set = L.habitDays(x.id);
    const done = set.has(t);
    const cur = L.habitStreak(set, t);
    const best = L.habitBest(set);
    return h("div", { class: `tp-habit${done ? " done" : ""}`, style: { "--ec": U.ENGINE_COLOR[x.engine] } },
      h("button", { class: "tp-check big", type: "button", title: done ? "Mark incomplete" : "Mark complete", "aria-pressed": done ? "true" : "false", onclick: () => L.toggleHabit(x.id, t) }, done ? "✓" : null),
      h("div", { class: "tp-habit-icon" }, x.icon || "~"),
      h("div", { class: "tp-habit-main" },
        h("div", { class: "tp-habit-title ellipsis", title: x.title }, x.title),
        h("div", { class: "tp-habit-meta" }, U.badge(L.ENGINE_LABEL[x.engine], { color: U.ENGINE_COLOR[x.engine] }), h("span", null, "Current ", h("b", null, `${cur}d`)), h("span", null, "Best ", h("b", null, `${best}d`)))),
      h("div", { class: "tp-habit-heat" }, C.heatGrid(days.slice(-56).map((k) => ({ dateKey: k, level: set.has(k) ? 1 : 0, title: `${L.shortDate(k)}: ${set.has(k) ? "done" : "—"}` })), { cell: 8, gap: 2, labels: false })),
      h("div", { class: "tp-habit-tools" },
        U.iconBtn("edit", "Rename habit", async () => { const v = await prompt({ title: "Rename habit", value: x.title }); if (v) db.update("habits", x.id, { title: v.slice(0, 200) }); }),
        U.iconBtn("trash", "Delete habit", async () => {
          if (!await confirm({ title: "Delete this habit?", message: "This permanently removes the habit and all its completion history. This action cannot be undone.", confirmLabel: "Delete", danger: true })) return;
          db.removeWhere("habit_logs", (l) => l.habitId === x.id);
          db.remove("habits", x.id);
        }, { danger: true })));
  });

  return h("div", { class: "tp-page" },
    U.pageHead("Discipline system", "Habits", habits.length ? "Build streaks. Track daily. Watch your consistency grow." : "No habits tracked yet — add one to start building your streak.", U.btn("Add habit", () => habitDialog(), { kind: "primary", iconName: "plus" })),
    h("div", { class: "tp-grid tp-habits-grid" },
      U.panel(null, null, h("div", { class: "tp-metrics" },
        U.metric("Today", `${doneToday}/${habits.length}`),
        U.metric("Rate", `${habits.length ? Math.round((doneToday / habits.length) * 100) : 0}%`),
        U.metric("Tracking", `${habits.length}`, habits.length === 1 ? "habit" : "habits"))),
      U.panel("Activity", { sub: "last 12 weeks" }, h("div", { class: "tp-heat-wrap" }, C.heatGrid(days.map((k) => ({
        dateKey: k, level: habits.length ? (countBy.get(k) || 0) / habits.length : 0, title: `${L.shortDate(k)}: ${countBy.get(k) || 0} completed`
      })), { cell: 13 }))),
      U.panel("Your habits", { cls: "tp-span-all", tools: U.iconBtn("plus", "Add habit", () => habitDialog()) },
        rows.length ? h("div", { class: "tp-habit-list" }, ...rows) : U.empty('No habits yet. "Add habit" starts one.', U.btn("Add habit", () => habitDialog(), { kind: "sm" })))));
}
