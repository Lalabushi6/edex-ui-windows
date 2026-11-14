// Titan Protocol, the sub-app shown in a workspace tab: a navigation rail,
// a status ticker and the pages. Pages are drawn from the data each time it
// changes (or when they're shown again), never on a timer.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openModal } from "../core/ui.js";
import * as db from "./db.js";
import * as L from "./logic.js";
import * as F from "./focus-timer.js";
import * as Dashboard from "./pages/dashboard.js";
import * as Command from "./pages/command.js";
import * as Analytics from "./pages/analytics.js";
import * as Engine from "./pages/engine.js";
import * as Habits from "./pages/habits.js";
import * as Journal from "./pages/journal.js";
import * as Goals from "./pages/goals.js";
import * as Focus from "./pages/focus.js";
import * as Body from "./pages/body.js";
import * as Money from "./pages/money.js";
import * as Settings from "./pages/settings.js";

export const ROUTES = {
  dashboard: { label: "Dashboard", icon: "gauge", render: Dashboard.render, keywords: "home overview score" },
  command: { label: "Command Center", icon: "command", render: Command.render, keywords: "all tasks today" },
  analytics: { label: "Analytics", icon: "chart", render: Analytics.render, keywords: "trends stats heatmap reliability" },
  body: { label: "Body", icon: "heart", render: (c) => Engine.render(c, "body"), mount: () => Engine.mount("body"), keywords: "fitness health engine" },
  mind: { label: "Mind", icon: "brain", render: (c) => Engine.render(c, "mind"), mount: () => Engine.mount("mind"), keywords: "learning reading engine" },
  money: { label: "Money", icon: "coin", render: (c) => Engine.render(c, "money"), mount: () => Engine.mount("money"), keywords: "finance engine" },
  general: { label: "General", icon: "layers", render: (c) => Engine.render(c, "general"), mount: () => Engine.mount("general"), keywords: "other engine" },
  habits: { label: "Habits", icon: "flame", render: Habits.render, keywords: "streak daily" },
  journal: { label: "Journal", icon: "book", render: Journal.render, keywords: "diary notes reflection" },
  goals: { label: "Goals", icon: "target", render: Goals.render, keywords: "targets deadline" },
  focus: { label: "Focus Timer", icon: "timer", render: Focus.render, keywords: "pomodoro deep work" },
  "body/workouts": { label: "Workouts", icon: "dumbbell", render: Body.workouts, mount: Body.seedGym, keywords: "gym exercise sets reps templates" },
  "body/sleep": { label: "Sleep Tracker", icon: "moon", render: Body.sleep, keywords: "bedtime wake rest" },
  "body/weight": { label: "Weight Tracker", icon: "scale", render: Body.weight, keywords: "kg body weight" },
  "body/nutrition": { label: "Nutrition", icon: "food", render: Body.nutrition, keywords: "calories macros protein meals diet" },
  "money/cashflow": { label: "Finance Tracker", icon: "wallet", render: Money.cashflow, keywords: "expenses income spending loans cashflow" },
  "money/deep-work": { label: "Deep Work", icon: "bolt", render: Money.deepWork, keywords: "earnings side hustle freelance" },
  "money/budgets": { label: "Budgets", icon: "flag", render: Money.budgets, keywords: "spending limits monthly" },
  settings: { label: "Settings", icon: "gear", render: Settings.render, keywords: "backup import export theme" }
};

const NAV = [
  ["Core", ["dashboard", "command", "analytics"]],
  ["Engines", ["body", "mind", "money", "general"]],
  ["Track", ["habits", "journal", "goals"]],
  ["Tools", ["focus", "body/workouts", "body/sleep", "body/weight", "body/nutrition", "money/cashflow"]]
];

const ACCENT_RGB = { cyber: "56 189 248", metal: "214 219 226" };
let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  document.head.append(h("link", { rel: "stylesheet", href: "css/titan.css" }));
}

export const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><polygon points="12,2 22,10 18,22 6,22 2,10"/><path d="M12 2v20M2 10l16 12M22 10L6 22" stroke-opacity=".45"/></svg>';

export class TitanApp {
  constructor(host, { page = "dashboard", onPage, visible = true } = {}) {
    this.host = host;
    this.page = ROUTES[page] ? page : "dashboard";
    this.onPage = onPage;
    this.visible = visible;
    this.stale = false;
    this.states = new Map();
    this.timers = [];
    this.current = null;
    this.renderedDay = null;
  }

  async mount() {
    loadCss();
    this.host.replaceChildren(h("div", { class: "tp-loading" }, "INITIALISING TITAN PROTOCOL…"));
    await db.load();
    this.nav = h("nav", { class: "tp-nav-list", "aria-label": "Titan Protocol" });
    this.ticker = h("div", { class: "tp-ticker", role: "status" });
    this.content = h("div", { class: "tp-content" });
    const collapse = h("button", { class: "icon-btn sm tp-collapse", type: "button", title: "Collapse navigation", onclick: () => db.setPrefs({ navCollapsed: !db.pref("navCollapsed", false) }) }, icon("back"));
    this.root = h("div", { class: "tp-root" },
      h("aside", { class: "tp-nav" },
        h("div", { class: "tp-brand" }, h("span", { class: "tp-logo", svg: LOGO }), h("span", { class: "tp-brand-text" }, h("b", null, "TITAN"), h("span", null, "PROTOCOL")), collapse),
        this.nav),
      h("div", { class: "tp-main" }, this.ticker, this.content));
    this.host.replaceChildren(this.root);
    this.offDb = db.onChange(() => this.redraw());
    if (this.visible) this.offFocus = F.subscribe(() => this.paintTicker());
    this.go(this.page, { force: true });
    if (!db.pref("onboarded", false)) setTimeout(() => Settings.openOnboarding(), 300);
  }

  state(page) {
    if (!this.states.has(page)) this.states.set(page, {});
    return this.states.get(page);
  }

  go(page, { force = false } = {}) {
    if (!ROUTES[page]) page = "dashboard";
    const changed = page !== this.page;
    if (!changed && !force) return;
    this.disposePage();
    this.page = page;
    try { ROUTES[page].mount?.(); } catch (e) { console.error("titan page mount failed", e); }
    this.redraw({ resetScroll: changed });
    this.onPage?.(page, ROUTES[page].label);
  }

  disposePage() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    try { this.current?.dispose?.(); } catch (_) {}
    this.current = null;
  }

  ctx() {
    return {
      go: (p) => this.go(p),
      redraw: () => this.redraw(),
      state: this.state(this.page),
      // An interval that lives as long as this drawing of the page.
      every: (ms, fn) => { this.timers.push(setInterval(fn, ms)); }
    };
  }

  redraw({ resetScroll = false } = {}) {
    if (!this.content) return;
    if (!this.visible) { this.stale = true; return; }
    this.stale = false;
    const scroll = resetScroll ? 0 : this.content.scrollTop;
    // The field being typed in comes back focused, caret and all.
    const a = document.activeElement;
    const keep = a && this.content.contains(a) ? a.dataset?.keep : null;
    const sel = keep && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
    this.disposePage();
    let out;
    try { out = ROUTES[this.page].render(this.ctx()); } catch (e) {
      console.error("titan page failed", e);
      out = h("div", { class: "tp-page" }, h("div", { class: "tp-empty" }, h("b", null, "This page hit an error."), h("div", { class: "muted" }, String(e?.message || e)), h("button", { class: "btn sm", type: "button", onclick: () => this.go("dashboard", { force: true }) }, "Back to dashboard")));
    }
    this.current = out instanceof Node ? null : out;
    this.content.replaceChildren(out instanceof Node ? out : out.el);
    this.content.scrollTop = scroll;
    if (keep) {
      const el = this.content.querySelector(`[data-keep="${CSS.escape(keep)}"]`);
      if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(...sel); } catch (_) {} }
    }
    this.renderedDay = L.today();
    const accent = db.pref("accent", "edex");
    this.root.classList.toggle("tp-collapsed", !!db.pref("navCollapsed", false));
    if (ACCENT_RGB[accent]) this.root.style.setProperty("--rgb", ACCENT_RGB[accent]);
    else this.root.style.removeProperty("--rgb");
    this.root.dataset.accent = accent;
    this.paintNav();
    this.paintTicker();
  }

  paintNav() {
    const item = (id) => {
      const r = ROUTES[id];
      const on = this.page === id || (id !== "body" && id !== "money" && this.page.startsWith(`${id}/`)) || (id === "money/cashflow" && this.page.startsWith("money/"));
      return h("button", { class: `tp-nav-item${on ? " active" : ""}`, type: "button", title: r.label, onclick: () => { this.go(id); } }, icon(r.icon), h("span", null, r.label));
    };
    this.nav.replaceChildren(
      ...NAV.map(([group, ids]) => h("div", { class: "tp-nav-group" }, h("div", { class: "tp-nav-label" }, group), ...ids.map(item))),
      h("div", { class: "tp-nav-spacer" }),
      h("div", { class: "tp-nav-group" }, item("settings")),
      h("div", { class: "tp-nav-hint" }, h("span", { class: "kbd" }, "Ctrl+K"), " quick nav"));
  }

  paintTicker() {
    if (!this.ticker || !this.visible) return;
    const sum = L.summary();
    const f = F.snapshot();
    const seg = (label, value, cls = "") => [h("span", { class: "tp-tick-sep" }, "//"), h("span", null, `${label}: `, h("b", { class: cls }, value))];
    this.ticker.replaceChildren(
      h("span", { class: "tp-tick-sys" }, "SYS.TITAN"),
      ...seg("SCORE", `${sum.titan.percent}%`),
      ...seg("ENGINES", `${sum.titan.enginesActiveCount}/4`),
      ...seg("MAIN.OPEN", String(sum.openMainCount)),
      ...seg("DATE", sum.dateKey),
      ...(f.status !== "idle" ? seg(F.MODE_LABEL[f.mode].toUpperCase(), `${F.fmt(f.left)}${f.status === "paused" ? " ❚❚" : ""}`, "tp-tick-focus") : []),
      ...seg("STATUS", "OPERATIONAL"),
      h("span", { class: "tp-tick-cursor" }, "_"));
  }

  activate() {
    if (this.visible && !this.stale && this.renderedDay === L.today()) return;
    this.visible = true;
    if (this.root && !this.offFocus) this.offFocus = F.subscribe(() => this.paintTicker());
    // Hidden, the page was taken down (its timers with it): it's drawn again,
    // with whatever changed meanwhile and the right day.
    if (this.root) this.redraw();
  }

  // Nothing of Titan's runs while its tab is hidden, except a focus block's
  // end-of-block timer.
  deactivate() {
    db.flush();
    this.visible = false;
    this.offFocus?.();
    this.offFocus = null;
    this.disposePage();
    this.stale = true;
  }

  focus() {
    this.current?.focus?.();
  }

  // Ctrl+K: jump to a page or run an action.
  palette() {
    const actions = [
      ...Object.entries(ROUTES).map(([id, r]) => ({ label: `Go to ${r.label}`, icon: r.icon, hint: "Page", keywords: `${id} ${r.keywords || ""}`, run: () => this.go(id) })),
      { label: "New task", icon: "plus", hint: "Action", keywords: "add capture todo", run: () => Engine.taskDialog(null) },
      { label: "New habit", icon: "flame", hint: "Action", keywords: "add", run: () => { this.go("habits"); Habits.habitDialog(); } },
      { label: "New goal", icon: "target", hint: "Action", keywords: "add", run: () => { this.go("goals"); Goals.goalDialog(); } },
      { label: "Add expense", icon: "wallet", hint: "Action", keywords: "spend money cost", run: () => { this.go("money/cashflow"); Money.txDialog("expense"); } },
      { label: "Add income", icon: "wallet", hint: "Action", keywords: "earn money salary", run: () => { this.go("money/cashflow"); Money.txDialog("income"); } },
      { label: "Add meal", icon: "food", hint: "Action", keywords: "food calories log", run: () => { this.go("body/nutrition"); Body.mealDialog(); } },
      { label: "Log sleep", icon: "moon", hint: "Action", keywords: "bed", run: () => this.go("body/sleep") },
      { label: "Log weight", icon: "scale", hint: "Action", keywords: "kg", run: () => this.go("body/weight") },
      { label: "Write today's journal", icon: "book", hint: "Action", keywords: "diary", run: () => { db.setSelectedDate("journal", L.today()); this.go("journal"); setTimeout(() => this.focus(), 50); } },
      F.snapshot().status === "running"
        ? { label: "Pause focus timer", icon: "pause", hint: "Focus", keywords: "pomodoro stop", run: () => F.pause() }
        : { label: "Start focus timer", icon: "play", hint: "Focus", keywords: "pomodoro begin", run: () => { F.start(); this.go("focus"); } },
      { label: "Export Titan backup", icon: "download", hint: "Data", keywords: "save json", run: () => this.go("settings") }
    ];
    openModal((close) => {
      const input = h("input", { class: "input", placeholder: "Type a command…", spellcheck: false, "data-autofocus": true });
      const list = h("div", { class: "tp-pal-list", role: "listbox" });
      let shown = [];
      let sel = 0;
      const paint = () => {
        const q = input.value.trim().toLowerCase();
        shown = actions.filter((a) => !q || `${a.label} ${a.keywords}`.toLowerCase().includes(q));
        sel = Math.min(sel, Math.max(0, shown.length - 1));
        list.replaceChildren(...(shown.length ? shown.map((a, i) => h("button", {
          class: `tp-pal-item${i === sel ? " active" : ""}`, type: "button", role: "option",
          onclick: () => { close(); a.run(); }, onmousemove: () => { if (sel !== i) { sel = i; paint(); } }
        }, icon(a.icon), h("span", { class: "grow" }, a.label), h("span", { class: "muted" }, a.hint))) : [h("div", { class: "muted tp-pad" }, "No results found.")]));
        list.children[sel]?.scrollIntoView?.({ block: "nearest" });
      };
      input.addEventListener("input", () => { sel = 0; paint(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); paint(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
        else if (e.key === "Enter") { e.preventDefault(); const a = shown[sel]; if (a) { close(); a.run(); } }
      });
      paint();
      return h("div", { class: "dialog tp-palette" }, h("div", { class: "tp-kicker" }, "Titan OS command palette"), input, list);
    }, { label: "Titan command palette", className: "tp-modal" });
  }

  dispose() {
    this.disposePage();
    this.offDb?.();
    this.offFocus?.();
    this.offFocus = null;
    db.flush();
  }
}
