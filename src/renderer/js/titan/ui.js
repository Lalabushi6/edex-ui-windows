// Building blocks shared by the Titan Protocol pages.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openModal, contextMenu } from "../core/ui.js";
import * as sfx from "../core/audio.js";
import * as db from "./db.js";
import * as L from "./logic.js";

export const ENGINE_COLOR = { body: "var(--t-body)", mind: "var(--t-mind)", money: "var(--t-money)", general: "var(--t-general)", all: "var(--t-all)", habits: "var(--t-all)" };

export function pageHead(kicker, title, subtitle, ...right) {
  return h("header", { class: "tp-head" },
    h("div", { class: "tp-head-text" },
      h("div", { class: "tp-kicker" }, kicker),
      h("h1", { class: "tp-title" }, title),
      subtitle && h("div", { class: "tp-subtitle" }, subtitle)),
    right.length ? h("div", { class: "tp-head-right" }, ...right) : null);
}

export function panel(title, opts, ...children) {
  const { sub, tools, cls = "", span } = opts || {};
  return h("section", { class: `tp-panel ${cls}${span ? ` tp-span-${span}` : ""}` },
    (title || sub || tools) && h("div", { class: "tp-panel-head" },
      title && h("div", { class: "tp-panel-title" }, title),
      sub && h("div", { class: "tp-panel-sub" }, sub),
      tools && h("div", { class: "tp-panel-tools" }, tools)),
    h("div", { class: "tp-panel-body" }, ...children));
}

export function metric(label, value, meta, { cls = "" } = {}) {
  return h("div", { class: `tp-metric ${cls}` },
    h("div", { class: "tp-metric-label" }, label),
    h("div", { class: "tp-metric-value" }, value),
    meta && h("div", { class: "tp-metric-meta" }, meta));
}

export function progress(pct, { state, color } = {}) {
  return h("div", { class: `tp-progress${state ? ` st-${state}` : ""}` }, h("i", { style: { width: `${Math.max(0, Math.min(100, pct))}%`, ...(color ? { background: color } : {}) } }));
}

export function empty(text, action) {
  return h("div", { class: "tp-empty" }, h("div", null, text), action || null);
}

export function btn(label, onclick, { kind = "", title, iconName, disabled } = {}) {
  return h("button", { class: `btn ${kind}`.trim(), type: "button", title, disabled, onclick }, iconName ? icon(iconName) : null, label);
}

export function iconBtn(name, title, onclick, { danger = false } = {}) {
  return h("button", { class: `icon-btn sm${danger ? " tp-danger" : ""}`, type: "button", title, "aria-label": title, onclick }, icon(name));
}

export function badge(text, { color, cls = "" } = {}) {
  return h("span", { class: `tp-badge ${cls}`, style: color ? { "--bc": color } : undefined }, text);
}

export function tabs(items, active, onPick) {
  return h("div", { class: "tp-tabs", role: "tablist" }, ...items.map((it) => h("button", {
    class: `tp-tab${it.id === active ? " active" : ""}`, type: "button", role: "tab", "aria-selected": it.id === active ? "true" : "false",
    onclick: () => onPick(it.id)
  }, it.label)));
}

export function seg(items, value, onPick) {
  return h("div", { class: "tp-seg" }, ...items.map((it) => h("button", {
    class: `tp-seg-btn${it.value === value ? " active" : ""}`, type: "button", onclick: () => onPick(it.value)
  }, it.label)));
}

export function datePill(value, onChange, { label = "Selected", max } = {}) {
  const input = h("input", { class: "input tp-date", type: "date", value, max });
  input.addEventListener("change", () => { if (L.isKey(input.value)) onChange(input.value); });
  return h("div", { class: "tp-date-pill" },
    h("button", { class: "icon-btn sm", type: "button", title: "Previous day", onclick: () => onChange(L.addDays(value, -1)) }, icon("back")),
    h("span", { class: "tp-kicker" }, label), input,
    h("button", { class: "icon-btn sm", type: "button", title: "Next day", disabled: max && value >= max, onclick: () => onChange(L.addDays(value, 1)) }, icon("forward")),
    value !== L.today() && h("button", { class: "btn sm", type: "button", onclick: () => onChange(L.today()) }, "Today"));
}

// Month calendar coloured by score. map: { dateKey: percent }.
export function calendar({ month, selected, map, start, onSelect, onMonth, title = "Calendar", compact = false }) {
  const first = L.monthStart(month);
  const last = L.monthEnd(month);
  const lead = (L.parse(first).getDay() + 6) % 7;
  const t = L.today();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h("span", { class: "tp-day pad" }));
  for (const k of L.range(first, last)) {
    const future = k > t, before = !!start && k < start;
    const v = L.heat(map[k] ?? 0, { future, beforeStart: before });
    cells.push(h("button", {
      class: `tp-day st-${v.state}${k === selected ? " selected" : ""}${k === t ? " today" : ""}`, type: "button",
      style: { "--heat": v.intensity.toFixed(2) }, disabled: future, title: future || before ? L.longDate(k) : `${L.longDate(k)} · ${map[k] ?? 0}%`,
      onclick: () => onSelect?.(k)
    }, String(Number(k.slice(8)))));
  }
  const nextDisabled = L.addMonths(month, 1) > L.monthStart(t);
  return h("div", { class: `tp-cal${compact ? " compact" : ""}` },
    h("div", { class: "tp-cal-head" },
      h("div", null, title && h("div", { class: "tp-kicker" }, title), h("div", { class: "tp-cal-month" }, L.monthLabel(first))),
      onMonth && h("div", { class: "tp-cal-nav" },
        h("button", { class: "icon-btn sm", type: "button", title: "Previous month", onclick: () => onMonth(L.addMonths(month, -1)) }, icon("back")),
        h("button", { class: "icon-btn sm", type: "button", title: "Next month", disabled: nextDisabled, onclick: () => onMonth(L.addMonths(month, 1)) }, icon("forward")))),
    h("div", { class: "tp-cal-dow" }, ..."MTWTFSS".split("").map((d) => h("span", null, d))),
    h("div", { class: "tp-cal-grid" }, ...cells),
    !compact && heatbars(month, map, start));
}

export function heatbars(month, map, start) {
  const t = L.today();
  return h("div", { class: "tp-heatbars" }, ...L.range(L.monthStart(month), L.monthEnd(month)).map((k) => {
    const v = L.heat(map[k] ?? 0, { future: k > t, beforeStart: !!start && k < start });
    return h("i", { class: `st-${v.state}`, style: { height: `${v.state === "grey" ? 0 : Math.max(3, Math.round(((map[k] ?? 0) / 100) * 44))}px`, "--heat": v.intensity.toFixed(2) }, title: `${k} · ${map[k] ?? 0}%` });
  }));
}

export function legend() {
  return h("div", { class: "tp-legend" },
    ...[["red", "0%"], ["yellow", `< ${L.THRESHOLD}%`], ["green", `${L.THRESHOLD}%+`], ["grey", "No data"]].map(([st, label]) => h("span", null, h("i", { class: `st-${st}` }), label)));
}

// A row with a checkbox. task: { title, completed, … }.
export function checkRow({ title, done, onToggle, meta = [], menu, cls = "", disabled = false, dim = false }) {
  return h("div", { class: `tp-row${done ? " done" : ""}${dim ? " dim" : ""} ${cls}` },
    h("button", {
      class: "tp-check", type: "button", disabled, "aria-pressed": done ? "true" : "false", title: done ? "Mark not done" : "Mark done",
      onclick: () => { if (!done && db.pref("sound", true)) sfx.play("expand"); onToggle(); }
    }, done ? icon("check") : null),
    h("span", { class: "tp-row-title ellipsis", title }, title),
    ...meta,
    menu && h("button", { class: "icon-btn sm", type: "button", title: "More", onclick: (e) => contextMenu(e, menu()) }, icon("more")));
}

// ── Form dialog ───────────────────────────────────────────────────────────
// fields: [{ name, label, type, value, options, placeholder, hint, min, max, step, required, rows }]
// onSubmit(values) may throw (or return a string) to keep the dialog open with a message.
export function formDialog({ title, fields, submitLabel = "Save", onSubmit, wide = false, intro }) {
  return new Promise((resolve) => {
    openModal((close) => {
      const inputs = {};
      const err = h("div", { class: "tp-form-error", hidden: true });
      const rows = fields.filter(Boolean).map((f) => {
        let input;
        if (f.type === "select") {
          input = h("select", { class: "input" }, ...(f.options || []).map((o) => {
            if (o.group) return h("optgroup", { label: o.group }, ...o.options.map((x) => h("option", { value: x.value ?? x }, x.label ?? x)));
            return h("option", { value: o.value ?? o }, o.label ?? o);
          }));
          input.value = f.value ?? "";
        } else if (f.type === "textarea") {
          input = h("textarea", { class: "input", rows: f.rows || 4, placeholder: f.placeholder || "", spellcheck: true });
          input.value = f.value ?? "";
        } else if (f.type === "seg") {
          let val = f.value;
          const wrap = h("div", { class: "tp-seg" });
          const paint = () => wrap.replaceChildren(...f.options.map((o) => h("button", {
            class: `tp-seg-btn${o.value === val ? " active" : ""}`, type: "button", style: o.color ? { "--sc": o.color } : undefined,
            onclick: () => { val = o.value; paint(); f.onChange?.(val, inputs); }
          }, o.label)));
          paint();
          input = wrap;
          Object.defineProperty(wrap, "value", { get: () => val, set: (v) => { val = v; paint(); } });
        } else {
          input = h("input", {
            class: "input", type: f.type || "text", placeholder: f.placeholder || "", min: f.min, max: f.max, step: f.step,
            list: f.list, spellcheck: false, "data-autofocus": f.autofocus ? true : undefined
          });
          input.value = f.value ?? "";
          input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
        }
        if (f.onInput) input.addEventListener("input", () => f.onInput(input.value, inputs));
        if (f.type === "select" && f.onChange) input.addEventListener("change", () => f.onChange(input.value, inputs));
        inputs[f.name] = input;
        const wrap = h("label", { class: `tp-field${f.half ? " half" : ""}`, hidden: f.hidden },
          h("span", { class: "label" }, f.label),
          input,
          f.hint && h("span", { class: "tp-hint" }, f.hint));
        input.fieldWrap = wrap;
        return wrap;
      });
      const extra = h("div", { class: "tp-form-extra" });
      const submit = async () => {
        const values = {};
        for (const [k, el] of Object.entries(inputs)) values[k] = el.value;
        for (const f of fields.filter(Boolean)) {
          if (f.required && !String(values[f.name] ?? "").trim() && !inputs[f.name].fieldWrap.hidden) { showErr(`${f.label} is required.`); return; }
        }
        try {
          const r = await onSubmit(values, inputs);
          if (typeof r === "string") { showErr(r); return; }
          close(values);
        } catch (e) { showErr(e?.message || String(e)); }
      };
      const showErr = (m) => { err.textContent = m; err.hidden = false; };
      // Live previews (nutrition targets) render into `extra` through this hook.
      setTimeout(() => fields.filter(Boolean).find((f) => f.preview)?.preview(inputs, extra), 0);
      setTimeout(() => {
        const first = Object.values(inputs).find((el) => el.tagName === "INPUT" || el.tagName === "TEXTAREA");
        first?.focus();
      }, 0);
      return h("div", { class: `dialog tp-dialog${wide ? " wide" : ""}` },
        h("h2", { class: "dialog-title" }, title),
        intro && h("p", { class: "dialog-msg" }, intro),
        h("div", { class: "tp-form" }, ...rows),
        extra, err,
        h("div", { class: "dialog-actions" },
          h("button", { class: "btn", type: "button", onclick: () => close(null) }, "Cancel"),
          h("button", { class: "btn primary", type: "button", onclick: submit }, submitLabel)));
    }, { onClose: (r) => resolve(r ?? null), label: title, className: "tp-modal" });
  });
}

export const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export function engineDot(engine) {
  return h("i", { class: "tp-dot-engine", style: { background: ENGINE_COLOR[engine] || "var(--c)" } });
}
