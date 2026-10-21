// Mounts side-column widgets, honours hidden/ordered preferences and lets the
// user drag a widget by its header to reorder it (within or across columns).
import { h, setText } from "../core/dom.js";
import * as settings from "../core/settings.js";

const defs = new Map();
const mounted = new Map(); // id -> { el, instance }
let columns = {};

export function defineWidget(def) {
  defs.set(def.id, def);
}

export function widgetDefs() {
  return [...defs.values()];
}

function createPanel(def) {
  const sub = h("span", { class: "panel-sub" });
  const tools = h("div", { class: "panel-tools" });
  const head = h("div", { class: "panel-head", draggable: "true", title: "Drag to reorder" },
    h("span", { class: "panel-title" }, def.title), sub, tools);
  const body = h("div", { class: "panel-body" });
  const el = h("section", { class: "panel", id: `w-${def.id}`, dataset: { widget: def.id } }, head, body);
  return {
    el, head, body, tools,
    setSub: (text) => setText(sub, text),
    setSubTitle: (text) => { sub.title = text || ""; }
  };
}

// Widgets with defaultHidden start hidden until switched on (shownWidgets).
export function widgetHidden(id) {
  const def = defs.get(id);
  if ((settings.get("hiddenWidgets") || []).includes(id)) return true;
  return !!def?.defaultHidden && !(settings.get("shownWidgets") || []).includes(id);
}

export function setWidgetShown(id, on) {
  const hidden = new Set(settings.get("hiddenWidgets") || []);
  const shown = new Set(settings.get("shownWidgets") || []);
  if (on) { hidden.delete(id); shown.add(id); } else { hidden.add(id); shown.delete(id); }
  settings.set({ hiddenWidgets: [...hidden], shownWidgets: [...shown] });
}

function layout() {
  const order = settings.get("widgetOrder") || { left: [], right: [] };
  const hidden = new Set([...defs.keys()].filter((id) => widgetHidden(id)));
  const placed = { left: [], right: [] };
  const seen = new Set();
  for (const side of ["left", "right"]) {
    for (const id of order[side] || []) {
      if (defs.has(id) && !seen.has(id)) { placed[side].push(id); seen.add(id); }
    }
  }
  const byDefault = [...defs.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  for (const def of byDefault) {
    if (!seen.has(def.id)) placed[def.column].push(def.id);
  }
  return {
    left: placed.left.filter((id) => !hidden.has(id)),
    right: placed.right.filter((id) => !hidden.has(id))
  };
}

// Panels are placed immediately, but their contents are built one or two at
// a time in idle frames, so startup never spends one long block building
// every widget at once.
const queue = [];
let pumping = null;
const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 16));

function build(job) {
  const { id, def, panel, entry } = job;
  if (entry.cancelled) return;
  try { entry.instance = def.create(panel) || null; } catch (e) {
    console.error(`widget ${id} failed`, e);
    panel.body.append(h("div", { class: "empty" }, "Widget failed to load"));
  }
  entry.pending = false;
}

function pump() {
  if (pumping || !queue.length) return;
  pumping = idle((deadline) => {
    pumping = null;
    let built = 0;
    while (queue.length && (built === 0 || deadline.timeRemaining() > 6)) {
      build(queue.shift());
      built++;
    }
    pump();
  }, { timeout: 250 });
}

function render() {
  const plan = layout();
  const wanted = new Set([...plan.left, ...plan.right]);
  for (const [id, entry] of mounted) {
    if (wanted.has(id)) continue;
    entry.cancelled = true;
    try { entry.instance?.destroy?.(); } catch (e) { console.error(e); }
    entry.el.remove();
    mounted.delete(id);
  }
  for (const side of ["left", "right"]) {
    const col = columns[side];
    for (const id of plan[side]) {
      let entry = mounted.get(id);
      if (!entry) {
        const def = defs.get(id);
        const panel = createPanel(def);
        entry = { el: panel.el, instance: null, pending: true, cancelled: false };
        mounted.set(id, entry);
        wireDrag(panel);
        queue.push({ id, def, panel, entry });
      }
      col.append(entry.el); // append moves existing nodes into order
    }
  }
  pump();
}

function saveOrder() {
  const read = (col) => [...col.querySelectorAll(":scope > .panel")].map((p) => p.dataset.widget);
  settings.set({ widgetOrder: { left: read(columns.left), right: read(columns.right) } });
}

let dragId = null;

function wireDrag(panel) {
  panel.head.addEventListener("dragstart", (e) => {
    dragId = panel.el.dataset.widget;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-edex-widget", dragId);
    panel.el.classList.add("dragging");
  });
  panel.head.addEventListener("dragend", () => {
    panel.el.classList.remove("dragging");
    dragId = null;
    document.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  });
}

function wireColumn(col) {
  const target = (e) => {
    const panels = [...col.querySelectorAll(":scope > .panel")].filter((p) => p.dataset.widget !== dragId);
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return { el: p, before: true };
    }
    return panels.length ? { el: panels[panels.length - 1], before: false } : null;
  };
  col.addEventListener("dragover", (e) => {
    if (!dragId) return;
    e.preventDefault();
    document.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
    const t = target(e);
    if (t) t.el.classList.add(t.before ? "drop-before" : "drop-after");
  });
  col.addEventListener("drop", (e) => {
    if (!dragId) return;
    e.preventDefault();
    const moving = mounted.get(dragId)?.el;
    const t = target(e);
    if (!moving) return;
    if (!t) col.append(moving);
    else if (t.before) col.insertBefore(moving, t.el);
    else t.el.after(moving);
    saveOrder();
  });
}

// A fixed set of widgets in given containers, without drag-to-reorder or
// the saved order (the multi-monitor HUD).
export function mountFixed(plan) {
  for (const [container, ids] of plan) {
    for (const id of ids) {
      const def = defs.get(id);
      if (!def) continue;
      const panel = createPanel(def);
      panel.head.removeAttribute("draggable");
      panel.head.title = "";
      const entry = { el: panel.el, instance: null, pending: true, cancelled: false };
      container.append(panel.el);
      queue.push({ id, def, panel, entry });
    }
  }
  pump();
}

// Custom command widgets come and go with settings.
export function undefineWidget(id) {
  defs.delete(id);
  const entry = mounted.get(id);
  if (entry) {
    entry.cancelled = true;
    try { entry.instance?.destroy?.(); } catch (e) { console.error(e); }
    entry.el.remove();
    mounted.delete(id);
  }
}

export function refreshWidgets() {
  if (columns.left) render();
}

export function mountWidgets(left, right) {
  columns = { left, right };
  wireColumn(left);
  wireColumn(right);
  render();
  settings.watch(["hiddenWidgets", "shownWidgets", "widgetOrder"], () => render());
}
