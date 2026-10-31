// Workspaces: named setups ("Work", "Gaming", "Study"). Each has its own
// tabs (kept running in the background), and can remember a theme, a layout
// and where your app windows were. Switch from the top bar, the launcher, a
// hotkey of its own, or at a time of day.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { openModal, toast, contextMenu, prompt, confirm, cleanError } from "../core/ui.js";
import { emit } from "../core/bus.js";

const api = window.edex;
// Settings a workspace's layout snapshot covers.
export const LAYOUT_SNAPSHOT_KEYS = ["layoutPreset", "showTopbar", "showDock", "showLeftColumn", "showRightColumn", "columnsSide", "columnWidth", "filesPanel", "filesWidth", "bottomOrder", "showKeyboard", "hiddenWidgets", "widgetOrder"];
let workspace = null;

const arrangementName = (p) => `Workspace · ${p.name}`;
const slug = (name) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "ws"}-${Date.now().toString(36).slice(-4)}`;
const snapshotLayout = () => Object.fromEntries(LAYOUT_SNAPSHOT_KEYS.map((k) => [k, settings.get(k)]));

// Every workspace, "Main" first (it exists even before you make others).
export function profiles() {
  const list = settings.get("profiles") || [];
  const main = list.find((p) => p.id === "main") || { id: "main", name: "Main", tabs: null, theme: null, layout: null, windows: false, hotkey: "", schedule: null };
  return [main, ...list.filter((p) => p.id !== "main")];
}

export const activeProfile = () => profiles().find((p) => p.id === (settings.get("activeProfile") || "main")) || profiles()[0];

function save(list) {
  return settings.set({ profiles: list.map(({ ...p }) => p) });
}

export function updateProfile(id, patch) {
  return save(profiles().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

export function initProfiles(ws) {
  workspace = ws;
}

export async function switchProfile(id, { scheduled = false } = {}) {
  const p = profiles().find((x) => x.id === id);
  if (!p || !workspace) return;
  const from = activeProfile();
  const moved = await workspace.switchProfile(id);
  // Workspaces that don't remember a theme or layout share the one you had
  // before entering one that does; it comes back when you leave it.
  const base = { theme: null, layout: null, ...(settings.get("profileBase") || {}) };
  if (from.id !== p.id) {
    if (p.theme && !from.theme) base.theme = settings.get("theme");
    if (p.layout && !from.layout) base.layout = snapshotLayout();
    settings.set({ profileBase: base });
  }
  const theme = p.theme || (from.theme && from.id !== p.id ? base.theme : null);
  const layout = p.layout || (from.layout && from.id !== p.id ? base.layout : null);
  if (theme && theme !== settings.get("theme")) settings.set({ theme });
  if (layout) settings.set(layout);
  if (p.windows) api.win.restoreArrangement(arrangementName(p)).catch(() => {});
  if (moved || scheduled) toast(`${scheduled ? "Scheduled switch — " : ""}Workspace: ${p.name}`, { timeout: 1800 });
}

// Remembers the current theme / layout / window positions for a workspace
// (whichever it is set to remember).
export async function captureProfile(id) {
  const p = profiles().find((x) => x.id === id);
  if (!p) return;
  const patch = {};
  if (p.theme !== null) patch.theme = settings.get("theme");
  if (p.layout !== null) patch.layout = snapshotLayout();
  if (p.windows) await api.win.saveArrangement(arrangementName(p)).catch((e) => toast(cleanError(e), { level: "warn" }));
  await updateProfile(id, patch);
  toast(`Saved the current setup to “${p.name}”`, { level: "ok", timeout: 1800 });
}

export function setRemember(id, what, on) {
  const p = profiles().find((x) => x.id === id);
  if (!p) return;
  if (what === "theme") updateProfile(id, { theme: on ? settings.get("theme") : null });
  else if (what === "layout") updateProfile(id, { layout: on ? snapshotLayout() : null });
  else if (what === "windows") {
    updateProfile(id, { windows: on });
    if (on) api.win.saveArrangement(arrangementName(p)).catch((e) => toast(cleanError(e), { level: "warn" }));
  }
}

export async function renameProfile(id) {
  const p = profiles().find((x) => x.id === id);
  if (!p) return;
  const name = await prompt({ title: "Rename workspace", value: p.name });
  if (!name) return;
  if (p.windows) {
    // The saved window positions follow the name.
    await api.win.saveArrangement(`Workspace · ${name.slice(0, 40)}`).catch(() => {});
    api.win.deleteArrangement(arrangementName(p)).catch(() => {});
  }
  updateProfile(id, { name: name.slice(0, 40) });
}

export async function deleteProfile(id) {
  const p = profiles().find((x) => x.id === id);
  if (!p || id === "main") return;
  if (!(await confirm({ title: `Delete “${p.name}”?`, message: "Its tabs close (terminals in it end). Your apps and files aren't touched.", confirmLabel: "Delete", danger: true }))) return;
  if ((settings.get("activeProfile") || "main") === id) await switchProfile("main");
  workspace?.dropProfile(id);
  if (p.windows) api.win.deleteArrangement(arrangementName(p)).catch(() => {});
  await save(profiles().filter((x) => x.id !== id));
}

// "New workspace…": a name, what to start with, and what to remember.
export function newProfileDialog() {
  return new Promise((resolve) => {
    openModal((close) => {
      const name = h("input", { class: "input", placeholder: "Work, Gaming, Study…", spellcheck: false, "data-autofocus": true });
      const check = (label, checked = false) => {
        const el = h("input", { type: "checkbox", checked });
        return { el, row: h("label", { class: "ws-check" }, el, label) };
      };
      const copy = check("Start with a copy of the tabs open now (otherwise one terminal)");
      const theme = check("Remember the current theme");
      const layout = check("Remember the current layout (regions, columns, widgets)");
      const wins = check("Remember where my app windows are, and put them back when switching");
      const create = async () => {
        const n = name.value.trim().slice(0, 40);
        if (!n) { name.focus(); return; }
        if (profiles().length >= 10) { toast("At most 10 workspaces", { level: "warn" }); return; }
        const id = slug(n);
        let tabs = null;
        if (copy.el.checked) {
          const specs = workspace.visibleTabs().filter((t) => t.profile !== "*" && t.type !== "app").map((t) => t.serialize()).filter(Boolean);
          tabs = { tabs: specs, active: 0 };
        }
        const p = { id, name: n, tabs, theme: theme.el.checked ? settings.get("theme") : null, layout: layout.el.checked ? snapshotLayout() : null, windows: wins.el.checked, hotkey: "", schedule: null };
        if (p.windows) await api.win.saveArrangement(arrangementName(p)).catch(() => {});
        await save([...profiles(), p]);
        close(id);
      };
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
      return h("div", { class: "dialog ws-dialog" },
        h("h2", { class: "dialog-title" }, "New workspace"),
        h("p", { class: "dialog-msg" }, "A workspace has its own tabs (they keep running while you're in another one), and can bring back a theme, a layout and your app windows when you switch to it."),
        name, copy.row, theme.row, layout.row, wins.row,
        h("div", { class: "dialog-actions" },
          h("button", { class: "btn", type: "button", onclick: () => close(null) }, "Cancel"),
          h("button", { class: "btn primary", type: "button", onclick: create }, "Create and switch")));
    }, { label: "New workspace", onClose: (id) => { if (id) switchProfile(id); resolve(id || null); } });
  });
}

function profileMenu(e) {
  const current = settings.get("activeProfile") || "main";
  const cur = activeProfile();
  contextMenu(e, [
    ...profiles().map((p) => ({ label: p.name, icon: p.id === current ? "check" : "layers", hint: p.hotkey ? p.hotkey.replace("CommandOrControl", "Ctrl") : "", run: () => switchProfile(p.id) })),
    { separator: true },
    { label: "New workspace…", icon: "plus", run: () => newProfileDialog() },
    (cur.theme !== null || cur.layout !== null || cur.windows) && { label: `Save the current setup to “${cur.name}”`, icon: "check", run: () => captureProfile(cur.id) },
    { label: "Workspace settings…", icon: "gear", run: () => emit("open-settings", { page: "workspaces" }) }
  ]);
}

// The top-bar switcher: the current workspace's name.
export function profilesButton() {
  const label = h("span", null);
  const btn = h("button", { class: "brand-mode ws-btn", type: "button", title: "Workspace — click to switch" }, icon("layers"), label);
  const render = () => setText(label, activeProfile().name.toUpperCase());
  btn.addEventListener("click", (e) => profileMenu(e));
  settings.watch(["profiles", "activeProfile"], render);
  render();
  return btn;
}
