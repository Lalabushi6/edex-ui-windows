// Focus timer page: focus / break / long break, cycles, today's sessions
// against a daily target, and the timer settings.
import { h, setText } from "../../core/dom.js";
import * as L from "../logic.js";
import * as U from "../ui.js";
import * as C from "../charts.js";
import * as F from "../focus-timer.js";

const COLORS = { focus: "var(--t-money)", break: "var(--t-mind)", long: "var(--t-general)" };

export function render(ctx) {
  const t = L.today();
  const st = ctx.state;
  const snap = F.snapshot();
  const s = snap.settings;
  const today = F.sessionsOn(t);
  const week = L.range(L.addDays(t, -6), t).map((k) => ({ k, n: F.sessionsOn(k) }));
  const weekTotal = week.reduce((a, b) => a + b.n, 0);

  const ringHost = h("div", { class: "tp-focus-ring" });
  const timeEl = h("div", { class: "tp-focus-time" });
  const modeEl = h("div", { class: "tp-kicker" });
  const controls = h("div", { class: "tp-focus-controls" });
  const paint = (sn) => {
    const pct = sn.total ? (1 - sn.left / sn.total) * 100 : 0;
    ringHost.replaceChildren(C.ring(pct, { size: 220, stroke: 9, color: COLORS[sn.mode], text: "" }));
    setText(timeEl, F.fmt(sn.left));
    setText(modeEl, `${F.MODE_LABEL[sn.mode]} · ${sn.status === "running" ? "running" : sn.status === "paused" ? "paused" : "ready"}`);
    controls.replaceChildren(
      sn.status === "running" ? U.btn("Pause", () => F.pause(), { kind: "primary", iconName: "pause" }) : U.btn(sn.status === "paused" ? "Resume" : "Start", () => F.start(), { kind: "primary", iconName: "play" }),
      U.btn("Skip", () => F.skip(), { iconName: "next" }),
      U.btn("Reset", () => F.reset(), { iconName: "restart" }));
  };
  paint(snap);
  const off = F.subscribe(paint);

  const settingsForm = () => {
    const f = (name, label, min, max) => {
      const input = h("input", { class: "input", type: "number", min, max, value: s[name] });
      input.dataset.name = name;
      return h("label", { class: "tp-field half" }, h("span", { class: "label" }, label), input);
    };
    const wrap = h("div", { class: "tp-form" },
      f("focusMinutes", "Focus (min)", 1, 240), f("breakMinutes", "Break (min)", 1, 120), f("longBreakMinutes", "Long break (min)", 1, 120),
      f("longBreakAfter", "Long break after", 1, 20), f("dailyTarget", "Daily target", 1, 50));
    const save = () => {
      const patch = {};
      for (const input of wrap.querySelectorAll("input")) {
        const n = Math.round(Number(input.value));
        if (Number.isFinite(n) && n >= Number(input.min)) patch[input.dataset.name] = Math.min(Number(input.max), n);
      }
      F.saveSettings(patch);
      st.settings = false;
    };
    return h("div", null, wrap, h("div", { class: "dialog-actions" }, U.btn("Cancel", () => { st.settings = false; ctx.redraw(); }), U.btn("Save", save, { kind: "primary" })));
  };

  const el = h("div", { class: "tp-page" },
    U.pageHead("Deep work", "Focus timer", "Blocks keep running while you use the rest of eDEX — a notification says when one ends."),
    h("div", { class: "tp-grid tp-focus-grid" },
      U.panel(null, { cls: "tp-focus-main" },
        U.seg([{ value: "focus", label: "Focus" }, { value: "break", label: "Break" }, { value: "long", label: "Long break" }], snap.mode, (m) => F.setMode(m)),
        h("div", { class: "tp-focus-dial" }, ringHost, h("div", { class: "tp-focus-center" }, timeEl, modeEl)),
        controls,
        h("div", { class: "tp-focus-cycle" }, ...Array.from({ length: s.longBreakAfter }, (_, i) => h("i", { class: i < snap.cycle % s.longBreakAfter ? "on" : "" })),
          h("span", { class: "muted" }, `Cycle ${snap.cycle % s.longBreakAfter}/${s.longBreakAfter}`))),
      U.panel("Today", { sub: `target ${s.dailyTarget}` },
        h("div", { class: "tp-metrics col" },
          U.metric("Sessions", `${today}/${s.dailyTarget}`, today >= s.dailyTarget ? "Target reached" : `${s.dailyTarget - today} to go`),
          U.metric("Focus time", L.hm(today * s.focusMinutes)),
          U.metric("Last 7 days", `${weekTotal}`, "sessions")),
        U.progress((today / s.dailyTarget) * 100, { state: today >= s.dailyTarget ? "green" : "yellow" })),
      U.panel("Last 7 days", null, C.barChart(week.map((d) => ({ label: L.dayName(d.k), value: d.n, title: `${L.shortDate(d.k)}: ${d.n} sessions` })), { max: Math.max(s.dailyTarget, ...week.map((d) => d.n)), unit: "", threshold: s.dailyTarget, height: 150 })),
      U.panel("Timer settings", { tools: !st.settings && U.iconBtn("gear", "Edit settings", () => { st.settings = true; ctx.redraw(); }) },
        st.settings ? settingsForm() : h("div", { class: "tp-kv" },
          h("span", null, "Focus"), h("b", null, `${s.focusMinutes} min`),
          h("span", null, "Break"), h("b", null, `${s.breakMinutes} min`),
          h("span", null, "Long break"), h("b", null, `${s.longBreakMinutes} min`),
          h("span", null, "Long break after"), h("b", null, `${s.longBreakAfter} blocks`),
          h("span", null, "Daily target"), h("b", null, `${s.dailyTarget} sessions`)))));
  return { el, dispose: off };
}
