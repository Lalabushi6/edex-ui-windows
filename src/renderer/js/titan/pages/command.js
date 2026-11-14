// Command Center: every engine's tasks for one day, and the Titan score
// calendar over the last few months.
import { h } from "../../core/dom.js";
import * as db from "../db.js";
import * as L from "../logic.js";
import * as U from "../ui.js";
import { taskDialog, taskRow } from "./engine.js";

export function render(ctx) {
  const t = L.today();
  const key = db.selectedDate("command", t) > t ? t : db.selectedDate("command", t);
  const setDate = (k) => db.setSelectedDate("command", k > t ? t : k);
  const st = ctx.state;
  st.months = st.months || 3;
  const day = L.titanDay(key);
  const all = L.ENGINES.flatMap((e) => L.dayTasks(e, key));
  const main = all.filter((x) => x.kind === "main");
  const sec = all.filter((x) => x.kind !== "main");
  const start = L.titanStart();
  const from = L.addMonths(L.monthStart(t), -(st.months - 1));
  const map = L.titanMap(from, t);
  const cons = L.consistency(map, from, t, start);
  const totals = L.points(main.filter((x) => !x.goalMet && !x.notYet).length, main.filter((x) => x.completed && !x.notYet).length,
    sec.filter((x) => !x.goalMet && !x.notYet).length, sec.filter((x) => x.completed && !x.notYet).length);

  const list = (title, rows, emptyText) => U.panel(title, { sub: `${rows.filter((r) => r.completed).length}/${rows.length}`, tools: U.iconBtn("plus", "Add task", () => taskDialog(null)) },
    rows.length ? h("div", { class: "tp-list" }, ...rows.map((r) => taskRow(r, key, { showEngine: true }))) : U.empty(emptyText));

  return h("div", { class: "tp-page" },
    U.pageHead("Command center", "All engines. One view.", `Every task for ${L.longDate(key)}`, U.datePill(key, setDate, { max: t }), U.btn("New task", () => taskDialog(null), { kind: "primary", iconName: "plus" })),
    h("div", { class: "tp-grid tp-cc-grid" },
      U.panel("Day score", { cls: "tp-hero" },
        h("div", { class: "tp-hero-row" },
          h("div", { class: "tp-bignum" }, `${day.percent}%`),
          h("div", { class: "tp-hero-meta" },
            h("div", null, `Main ${totals.mainDone}/${totals.mainTotal}`),
            h("div", null, `Secondary ${totals.secondaryDone}/${totals.secondaryTotal}`),
            h("div", null, `${day.enginesActiveCount}/4 engines active`))),
        h("div", { class: "tp-chips" }, ...L.ENGINES.map((e) => h("button", { class: "tp-chip", type: "button", style: { "--ec": U.ENGINE_COLOR[e] }, onclick: () => ctx.go(e) },
          L.ENGINE_LABEL[e].toUpperCase(), h("b", null, day.perEngine[e].pointsTotal ? `${day.perEngine[e].percent}%` : "—"))))),
      U.panel("Consistency", { sub: `last ${st.months} months` },
        h("div", { class: "tp-metrics" },
          U.metric("Consistent days", `${cons.consistentDays}/${cons.daysElapsed}`, `${cons.consistencyPct}%`),
          U.metric("Current streak", `${cons.currentStreak}`, "days"),
          U.metric("Best streak", `${cons.bestStreak}`, "days"))),
      list("Main tasks", main, "No main tasks yet."),
      list("Secondary tasks", sec, "No secondary tasks yet."),
      U.panel("Titan calendar", { cls: "tp-span-all", tools: U.seg([{ value: 2, label: "2 months" }, { value: 3, label: "3 months" }], st.months, (v) => { st.months = v; ctx.redraw(); }) },
        h("div", { class: `tp-cal-months cols-${st.months}` }, ...Array.from({ length: st.months }, (_, i) => U.calendar({
          month: L.addMonths(from, i), selected: key, map, start, title: null, compact: true, onSelect: setDate
        }))),
        U.legend())));
}
