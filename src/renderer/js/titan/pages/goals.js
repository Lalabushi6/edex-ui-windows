// Goals: a deadline and the tasks that get you there. A daily task is also a
// main task in its engine, so ticking it in either place ticks both.
import { h } from "../../core/dom.js";
import { confirm } from "../../core/ui.js";
import * as db from "../db.js";
import * as L from "../logic.js";
import * as U from "../ui.js";
import * as C from "../charts.js";

export async function goalDialog() {
  await U.formDialog({
    title: "New goal",
    submitLabel: "Create goal",
    intro: "After creating the goal you can add tasks. Daily tasks sync with your engine pages.",
    fields: [
      { name: "title", label: "Goal title", placeholder: 'e.g. "Get lean"', required: true },
      { name: "deadline", label: "Deadline", type: "date", value: L.addDays(L.today(), 30), required: true }
    ],
    onSubmit: (v) => {
      if (!v.title.trim()) return "Goal title is required.";
      if (!L.isKey(v.deadline)) return "Pick a deadline.";
      db.insert("goals", { title: v.title.trim().slice(0, 200), engine: "all", type: "count", target: 0, unit: "tasks", deadline: v.deadline, createdAt: Date.now() });
    }
  });
}

function addTaskForm(goal) {
  let type = "once";
  const title = h("input", { class: "input", placeholder: "Add a task…", spellcheck: false });
  const engine = h("select", { class: "input tp-goal-engine", hidden: true }, ...L.ENGINES.map((e) => h("option", { value: e }, L.ENGINE_LABEL[e])));
  const typeSeg = h("div", { class: "tp-seg" });
  const paint = () => {
    typeSeg.replaceChildren(...[["once", "One-time"], ["daily", "Daily"]].map(([v, label]) => h("button", {
      class: `tp-seg-btn${type === v ? " active" : ""}`, type: "button", title: v === "daily" ? "Repeats daily — also a main task in the engine you pick" : "Done once",
      onclick: () => { type = v; engine.hidden = v !== "daily"; paint(); }
    }, label)));
  };
  paint();
  const add = () => {
    const v = title.value.trim();
    if (!v) return;
    L.addGoalTask(goal.id, v.slice(0, 200), type, type === "daily" ? engine.value : null);
  };
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  return h("div", { class: "tp-goal-add" }, title, typeSeg, engine, U.btn("Add", add, { kind: "sm" }));
}

function goalCard(goal) {
  const t = L.today();
  const p = L.goalProgress(goal);
  const tasks = L.goalTasks(goal.id);
  const left = L.daysLeft(goal.deadline);
  // A goal made only of daily tasks is never "done": ticking today's tasks isn't finishing it.
  const complete = p.percent >= 100 && p.target > 0 && !p.daily;
  const state = complete ? "Completed ✓" : left < 0 ? "Expired" : left === 0 ? "Due today" : `${left} day${left === 1 ? "" : "s"} left`;
  return h("article", { class: `tp-goal${complete ? " complete" : left < 0 ? " expired" : ""}` },
    h("div", { class: "tp-goal-top" },
      C.ring(p.percent, { size: 60 }),
      h("div", { class: "tp-goal-head" },
        h("div", { class: "tp-goal-title" }, goal.title),
        h("div", { class: "muted" }, `${state} · due ${L.shortDate(goal.deadline)} · ${p.current}/${p.target}${p.daily ? " today" : ""}`)),
      U.iconBtn("trash", "Delete goal", async () => {
        if (await confirm({ title: "Delete this goal?", message: "Its tasks go too, including the engine tasks its daily tasks made.", confirmLabel: "Delete", danger: true })) L.deleteGoal(goal.id);
      }, { danger: true })),
    tasks.length ? h("div", { class: "tp-list" }, ...tasks.map((task) => {
      const daily = (task.taskType ?? "once") === "daily";
      return U.checkRow({
        title: task.title, done: L.goalTaskDone(task, t), onToggle: () => L.toggleGoalTask(task),
        meta: [daily ? U.badge(`↻ Daily${task.engine ? ` · ${L.ENGINE_LABEL[task.engine]}` : ""}`, { color: task.engine ? U.ENGINE_COLOR[task.engine] : undefined }) : U.badge("Once")],
        menu: () => [{ label: "Remove task", icon: "trash", danger: true, run: () => L.deleteGoalTask(task) }]
      });
    })) : h("div", { class: "muted tp-pad" }, "No tasks yet — add one below."),
    addTaskForm(goal));
}

export function render(ctx) {
  const t = L.today();
  const st = ctx.state;
  const goals = [...db.all("goals")].sort((a, b) => b.createdAt - a.createdAt);
  const isDone = (g) => { const p = L.goalProgress(g); return (p.percent >= 100 && p.target > 0 && !p.daily) || g.deadline < t; };
  const active = goals.filter((g) => !isDone(g));
  const finished = goals.filter(isDone);
  return h("div", { class: "tp-page" },
    U.pageHead("Targets & progress", "Goals", "Create goals and add the tasks that get you there. Daily tasks sync with the engine pages both ways.", U.btn("Add goal", () => goalDialog(), { kind: "primary", iconName: "plus" })),
    active.length ? h("div", { class: "tp-goal-grid" }, ...active.map(goalCard)) : U.panel(null, null, U.empty("No active goals.", U.btn("Add goal", () => goalDialog(), { kind: "sm" }))),
    finished.length > 0 && h("div", { class: "tp-section" },
      h("button", { class: "btn sm", type: "button", onclick: () => { st.showDone = !st.showDone; ctx.redraw(); } }, `${st.showDone ? "Hide" : "Show"} completed / expired (${finished.length})`),
      st.showDone && h("div", { class: "tp-goal-grid" }, ...finished.map(goalCard))));
}
