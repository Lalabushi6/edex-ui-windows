// Analytics: trend, engine averages, a 12-week heatmap, weekly discipline,
// streaks and which tasks get done most and least.
import { h } from "../../core/dom.js";
import * as L from "../logic.js";
import * as U from "../ui.js";
import * as C from "../charts.js";

const RANGES = [{ value: 7, label: "7D" }, { value: 30, label: "30D" }, { value: 90, label: "90D" }, { value: 365, label: "1Y" }];

export function render(ctx) {
  const st = ctx.state;
  st.days = st.days || 30;
  const a = L.analytics(st.days);
  const reliable = (rows) => rows.length ? h("div", { class: "tp-list" }, ...rows.map((r) => h("div", { class: "tp-row" },
    U.engineDot(r.engine), h("span", { class: "tp-row-title ellipsis" }, r.title), h("span", { class: "tp-rel-bar" }, U.progress(r.percent, { color: U.ENGINE_COLOR[r.engine] })), h("b", null, `${r.percent}%`))))
    : U.empty("No data yet.");
  const label = (k) => (st.days <= 31 ? k.slice(5) : L.shortDate(k));
  return h("div", { class: "tp-page" },
    U.pageHead("Analytics", "Precision insights", "Derived from your own data — nothing leaves this PC.", U.seg(RANGES, st.days, (v) => { st.days = v; ctx.redraw(); })),
    h("div", { class: "tp-grid tp-an-grid" },
      U.panel("Titan score trend", { span: 2, sub: `${st.days} days` },
        C.lineChart(a.trend.map((p) => ({ label: label(p.dateKey), value: p.score, title: `${L.shortDate(p.dateKey)}: ${p.score}%` })), { threshold: L.THRESHOLD, width: 760, height: 230 })),
      U.panel("Streak stats", null,
        h("div", { class: "tp-metrics" },
          U.metric("Current streak", `${a.streaks.current}`, "days ≥ 60%"),
          U.metric("Longest streak", `${a.streaks.longest}`, "days in range"),
          U.metric("Best week avg", `${a.streaks.bestWeekAvg}%`),
          U.metric("Last 30d avg", `${a.streaks.last30Avg}%`))),
      U.panel("Engine performance", { sub: "average in range" },
        C.barChart(a.enginePerf.map((e) => ({ label: L.ENGINE_LABEL[e.engine], value: e.score, color: U.ENGINE_COLOR[e.engine] })), { max: 100, threshold: L.THRESHOLD })),
      U.panel("Weekly discipline", { sub: "ISO weeks" },
        C.barChart(a.weekly.map((w) => ({ label: w.week.slice(5), value: w.avg, cls: `st-${L.heat(w.avg).state}`, title: `${w.week}: ${w.avg}%` })), { max: 100, threshold: L.THRESHOLD })),
      U.panel("Consistency heatmap", { sub: "last 12 weeks" },
        h("div", { class: "tp-heat-wrap" }, C.heatGrid(a.heatDays.map((d) => {
          const v = L.heat(d.score, { beforeStart: !!a.start && d.dateKey < a.start });
          return { dateKey: d.dateKey, level: v.state === "grey" ? 0 : Math.max(0.25, d.score / 100), state: v.state, title: `${L.shortDate(d.dateKey)}: ${d.score}%` };
        }), { cell: 13 })), U.legend()),
      U.panel("Most reliable", { sub: "done since created" }, reliable(a.top)),
      U.panel("Least reliable", null, reliable(a.bottom))));
}
