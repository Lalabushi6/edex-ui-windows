// Dashboard: the Titan Score (average of the engines in play today), each
// engine at a glance, the week's trend and today's planner.
import { h } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import * as L from "../logic.js";
import * as U from "../ui.js";
import * as C from "../charts.js";
import { taskDialog, taskRow } from "./engine.js";

export const QUICK = [
  { label: "Capture task", page: "command", desc: "Open command center", iconName: "plus" },
  { label: "Start focus", page: "focus", desc: "Launch a focus block", iconName: "timer" },
  { label: "Review goals", page: "goals", desc: "Check daily targets", iconName: "flag" },
  { label: "Log journal", page: "journal", desc: "Record a reflection", iconName: "note" }
];

export function render(ctx) {
  const t = L.today();
  const sum = L.summary(t);
  const titan = sum.titan;
  const cmp = L.weekComparison(t);
  const week = L.weekStats(t);
  const spark = Object.fromEntries(L.ENGINES.map((e) => [e, L.range(L.addDays(t, -6), t).map((k) => L.dayScore(e, k).percent)]));
  const cmpActive = cmp.filter((c) => c.thisWeekAvg > 0 || c.lastWeekAvg > 0);
  const weekAvg = cmpActive.length ? Math.round(cmpActive.reduce((s, c) => s + c.thisWeekAvg, 0) / cmpActive.length) : 0;

  const hero = U.panel("Titan score", { cls: "tp-hero tp-dash-hero", sub: L.longDate(t) },
    h("div", { class: "tp-hero-split" },
      C.gauge(titan.percent, { sub: `${titan.enginesActiveCount}/4 ENGINES` }),
      h("div", { class: "tp-engine-bars" }, ...L.ENGINES.map((e) => {
        const s = titan.perEngine[e];
        return h("button", { class: "tp-engine-bar", type: "button", onclick: () => ctx.go(e) },
          h("span", { class: "tp-engine-bar-name" }, U.engineDot(e), L.ENGINE_LABEL[e]),
          U.progress(s.percent, { color: U.ENGINE_COLOR[e] }),
          h("span", { class: "tp-engine-bar-val" }, s.pointsTotal ? `${s.percent}%` : "—"));
      }))));

  const compare = U.panel("vs last week", { sub: `avg ${weekAvg}%` },
    h("div", { class: "tp-compare" }, ...cmp.map((c) => h("div", { class: `tp-compare-row ${c.change > 0 ? "up" : c.change < 0 ? "down" : ""}` },
      h("span", null, U.engineDot(c.engine), L.ENGINE_LABEL[c.engine]),
      h("b", null, `${c.thisWeekAvg}%`),
      h("span", { class: "tp-change" }, c.change > 0 ? "▲" : c.change < 0 ? "▼" : "■", ` ${Math.abs(c.change)}%`)))));

  const radar = U.panel("Engine overview", { cls: "tp-center" }, C.radar(L.ENGINES.map((e) => ({ label: L.ENGINE_LABEL[e], value: titan.perEngine[e].percent }))));

  const sysRow = (label, value, pct) => h("div", { class: "tp-sys-row" }, h("span", null, label), U.progress(pct), h("b", null, value));
  const status = U.panel("System status", null,
    sysRow("Engines active", `${titan.enginesActiveCount}/4`, (titan.enginesActiveCount / 4) * 100),
    sysRow("Points", `${sum.completedPoints}/${sum.totalPoints}`, sum.totalPoints ? (sum.completedPoints / sum.totalPoints) * 100 : 0),
    sysRow("Main open", `${sum.openMainCount}`, sum.openMainCount ? Math.min(100, sum.openMainCount * 12) : 0),
    sysRow("Tasks done (7d)", `${week.totalCompleted}`, Math.min(100, week.totalCompleted * 2)));

  const pulse = U.panel("Weekly pulse", { sub: `best ${week.bestDay.percent ? `${L.dayName(week.bestDay.dateKey)} ${week.bestDay.percent}%` : "—"}` },
    week.days.some((d) => d.percent > 0)
      ? h("div", { class: "tp-pulse" }, ...week.days.map((d) => h("div", { class: `tp-pulse-col${d.dateKey === t ? " today" : ""}`, title: `${L.shortDate(d.dateKey)} · ${d.percent}%` },
        h("div", { class: "tp-pulse-bar" }, h("i", { class: `st-${L.heat(d.percent).state}`, style: { height: `${Math.max(4, d.percent)}%` } })),
        h("span", null, L.dayName(d.dateKey).slice(0, 2)))))
      : U.empty("No data yet — tick a task in any engine."));

  const cards = h("div", { class: "tp-engine-cards" }, ...L.ENGINES.map((e) => {
    const s = titan.perEngine[e];
    return h("article", { class: "tp-engine-card", style: { "--ec": U.ENGINE_COLOR[e] } },
      h("div", { class: "tp-engine-card-top" },
        h("div", null, h("div", { class: "tp-kicker" }, L.ENGINE_DESC[e]), h("div", { class: "tp-engine-card-name" }, L.ENGINE_LABEL[e])),
        h("div", { class: "tp-engine-card-score" }, s.pointsTotal ? `${s.percent}%` : "—")),
      C.sparkline(spark[e]),
      h("div", { class: "tp-engine-card-stats" },
        h("span", null, "Main ", h("b", null, `${s.mainDone}/${s.mainTotal}`)),
        h("span", null, "Secondary ", h("b", null, `${s.secondaryDone}/${s.secondaryTotal}`)),
        h("span", null, "Pts ", h("b", null, `${s.pointsDone}/${s.pointsTotal}`))),
      h("button", { class: "btn sm", type: "button", onclick: () => ctx.go(e) }, "Enter", icon("forward")));
  }));

  const trend = U.panel("7-day Titan score trend", { span: 2 },
    C.lineChart(week.days.map((d) => ({ label: L.dayName(d.dateKey), value: d.percent, title: `${L.shortDate(d.dateKey)}: ${d.percent}%` })), { threshold: L.THRESHOLD, width: 700, height: 190 }));

  const snapshot = U.panel("This week", null,
    h("div", { class: "tp-metrics col" },
      U.metric("Avg Titan score", `${week.avg}%`),
      U.metric("Tasks completed", `${week.totalCompleted}`),
      U.metric("Best day", week.bestDay.percent ? `${L.dayName(week.bestDay.dateKey)} ${week.bestDay.percent}%` : "—")));

  const nba = sum.nextBestAction;
  const planner = U.panel("Today planner", { cls: "tp-planner", span: 3, sub: `Planning date · ${t}` },
    h("div", { class: "tp-planner-grid" },
      h("div", { class: "tp-planner-block" },
        h("div", { class: "tp-kicker" }, "Titan score summary"),
        h("div", { class: "tp-bignum" }, `${titan.percent}%`),
        h("div", { class: "muted" }, `${sum.completedPoints}/${sum.totalPoints} pts · ${titan.enginesActiveCount}/4 engines · ${sum.openMainCount} main open`)),
      h("div", { class: "tp-planner-block" },
        h("div", { class: "tp-kicker" }, "Engines at risk"),
        sum.atRisk.length ? h("div", { class: "tp-list" }, ...sum.atRisk.map((r) => h("button", { class: "tp-row tp-link-row", type: "button", onclick: () => ctx.go(r.engine) },
          U.engineDot(r.engine), h("span", { class: "tp-row-title" }, r.label), h("span", { class: "muted ellipsis" }, r.reason), icon("forward"))))
          : h("div", { class: "muted" }, "All engines are above threshold.")),
      h("div", { class: "tp-planner-block" },
        h("div", { class: "tp-kicker" }, "Top incomplete main tasks"),
        sum.topOpenMain.length ? h("div", { class: "tp-list" }, ...sum.topOpenMain.map((task) => taskRow(task, t, { showEngine: true })))
          : h("div", { class: "muted" }, "No incomplete main tasks detected.")),
      h("div", { class: "tp-planner-block tp-nba" },
        h("div", { class: "tp-kicker" }, "Next best action"),
        h("div", { class: "tp-nba-title" }, nba.title),
        h("div", { class: "muted" }, nba.detail),
        U.btn(nba.cta, () => ctx.go(nba.page), { kind: "primary sm" })),
      h("div", { class: "tp-planner-block" },
        h("div", { class: "tp-kicker" }, "Quick actions"),
        h("div", { class: "tp-quick" },
          ...QUICK.map((q) => h("button", { class: "tp-quick-btn", type: "button", title: q.desc, onclick: () => (q.page === "command" ? taskDialog(null) : ctx.go(q.page)) }, icon(q.iconName), h("span", null, q.label)))))));

  return h("div", { class: "tp-page" },
    U.pageHead("Titan Protocol", "Titan OS", `System online · ${L.longDate(t)} · four engines, one view`),
    // Shorter panels are stacked in pairs so they line up with the tall ones.
    h("div", { class: "tp-grid tp-dash-grid" }, hero, h("div", { class: "tp-stack" }, compare, status), radar, h("div", { class: "tp-stack" }, pulse, snapshot), trend, cards, planner));
}
