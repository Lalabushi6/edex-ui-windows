// Window tiling: a snap-layout picker for one window (halves, quarters,
// thirds, centre, maximise), quick layouts for the visible windows, and
// saved arrangements that put every window back where it was.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { popover, openModal, toast, prompt, confirm, cleanError } from "../core/ui.js";

const api = window.edex;

// [preset, label, x, y, w, h] in a 0–1 box for the preview tile.
const SNAPS = [
  ["left", "Left half", 0, 0, 0.5, 1], ["right", "Right half", 0.5, 0, 0.5, 1],
  ["top", "Top half", 0, 0, 1, 0.5], ["bottom", "Bottom half", 0, 0.5, 1, 0.5],
  ["top-left", "Top-left quarter", 0, 0, 0.5, 0.5], ["top-right", "Top-right quarter", 0.5, 0, 0.5, 0.5],
  ["bottom-left", "Bottom-left quarter", 0, 0.5, 0.5, 0.5], ["bottom-right", "Bottom-right quarter", 0.5, 0.5, 0.5, 0.5],
  ["left-third", "Left third", 0, 0, 1 / 3, 1], ["center-third", "Middle third", 1 / 3, 0, 1 / 3, 1],
  ["right-third", "Right third", 2 / 3, 0, 1 / 3, 1], ["left-two-thirds", "Left two thirds", 0, 0, 2 / 3, 1],
  ["right-two-thirds", "Right two thirds", 1 / 3, 0, 2 / 3, 1], ["center", "Centre", 0.15, 0.1, 0.7, 0.8],
  ["maximize", "Maximise", 0, 0, 1, 1]
];

const tile = (preset) => h("span", { class: "snap-mini" },
  h("i", { style: { left: `${preset[2] * 100}%`, top: `${preset[3] * 100}%`, width: `${preset[4] * 100}%`, height: `${preset[5] * 100}%` } }));

export async function snapWindow(hwnd, preset) {
  try { await api.win.tile(hwnd, preset); } catch (e) { toast(cleanError(e), { level: "warn" }); }
}

export function openSnapPicker(anchor, hwnd, title = "") {
  popover(anchor, (close) => h("div", { class: "snap-pop" },
    h("div", { class: "snap-title" }, icon("grid4"), h("span", { class: "ellipsis" }, title ? `SNAP · ${title}` : "SNAP WINDOW")),
    h("div", { class: "snap-grid" }, ...SNAPS.map((s) => h("button", {
      class: "snap-btn", type: "button", title: s[1],
      onclick: () => { close(); snapWindow(hwnd, s[0]); }
    }, tile(s))))), { className: "snap-popover" });
}

export async function quickLayout(kind) {
  try {
    const n = await api.win.layout(kind);
    toast(`Arranged ${n} window${n === 1 ? "" : "s"}`, { level: "ok", timeout: 1600 });
  } catch (e) { toast(cleanError(e), { level: "warn" }); }
}

export async function saveArrangement() {
  const name = await prompt({ title: "Save window arrangement", message: "Remembers where every open window is (and which programs are open). Name it:", value: "" });
  if (!name) return;
  try {
    const n = await api.win.saveArrangement(name);
    toast(`Saved “${name}” (${n} windows)`, { level: "ok" });
  } catch (e) { toast(cleanError(e), { level: "warn" }); }
}

export async function restoreArrangement(name) {
  toast(`Restoring “${name}”…`, { timeout: 1500 });
  try {
    const r = await api.win.restoreArrangement(name);
    const parts = [`${r.placed} placed`];
    if (r.launched) parts.push(`${r.launched} started`);
    if (r.missing.length) parts.push(`not found: ${[...new Set(r.missing)].join(", ")}`);
    toast(`“${name}”: ${parts.join(" · ")}`, { level: r.missing.length ? "warn" : "ok", timeout: 5000 });
  } catch (e) { toast(cleanError(e), { level: "warn" }); }
}

export function openArrangements() {
  openModal((close) => {
    const list = h("div", { class: "arr-list" }, h("div", { class: "empty" }, "Loading…"));
    const load = async () => {
      const items = await api.win.arrangements().catch(() => []);
      if (!items.length) { list.replaceChildren(h("div", { class: "empty" }, "No saved arrangements yet")); return; }
      list.replaceChildren(...items.map((a) => h("div", { class: "arr-row" },
        h("div", { class: "arr-text" }, h("b", null, a.name), h("span", { class: "muted" }, `${a.count} windows · saved ${new Date(a.saved).toLocaleString()}`)),
        h("button", { class: "btn sm primary", type: "button", onclick: () => { close(); restoreArrangement(a.name); } }, "Restore"),
        h("button", {
          class: "icon-btn sm", type: "button", title: "Delete",
          onclick: async () => {
            if (!(await confirm({ title: "Delete arrangement", message: `Delete “${a.name}”?`, confirmLabel: "Delete" }))) return;
            await api.win.deleteArrangement(a.name).catch(() => {});
            load();
          }
        }, icon("trash")))));
    };
    load();
    return h("div", { class: "dialog arr-dialog" },
      h("h2", { class: "dialog-title" }, "Window arrangements"),
      h("div", { class: "arr-quick" },
        h("span", { class: "muted" }, "Arrange the visible windows:"),
        h("button", { class: "btn sm", type: "button", onclick: () => { close(); quickLayout("side"); } }, "Side by side"),
        h("button", { class: "btn sm", type: "button", onclick: () => { close(); quickLayout("columns"); } }, "Three columns"),
        h("button", { class: "btn sm", type: "button", onclick: () => { close(); quickLayout("grid"); } }, "Grid")),
      list,
      h("div", { class: "dialog-actions" },
        h("button", { class: "btn", type: "button", onclick: () => { close(); saveArrangement(); } }, icon("plus"), "Save current…"),
        h("span", { class: "grow" }),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Close")));
  }, { label: "Window arrangements" });
}
