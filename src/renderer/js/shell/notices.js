// Notification centre (interface side): the top-bar bell with its unread
// count, the history panel, Do Not Disturb, and notify() for notifications
// raised in the interface (downloads, missed reminders …). Main-process
// notifications (alerts, reminders, timers, updates) arrive as notices:new.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { toast, popover, cleanError } from "../core/ui.js";
import { runCommand } from "../core/commands.js";
import { openUrl } from "../core/links.js";

const api = window.edex;
let state = { unread: 0, quiet: false, dnd: false, quietReasons: [] };
const listeners = new Set();
const KIND_ICON = { alert: "battery", reminder: "bell", timer: "timer", download: "download", update: "update", screentime: "clock", game: "gamepad", calendar: "calendar", radio: "audio", info: "info" };

export const isQuiet = () => !!state.quiet;

function emitState() {
  for (const fn of listeners) { try { fn(state); } catch (_) {} }
}

// A notification raised in the interface: a toast (unless it's quiet
// time) and an entry in the history.
export function notify({ level = "info", kind = "info", title, body = "", action = null, toastAction = null, timeout = 6000 }) {
  if (!state.quiet) toast(body ? `${title} — ${body}` : title, { level, timeout, action: toastAction || undefined });
  api.notices.add({ level, kind, title, body, action }).catch(() => {});
}

function runAction(a) {
  if (!a) return;
  if (a.type === "reveal") api.fs.reveal(a.value).catch((e) => toast(cleanError(e), { level: "warn" }));
  else if (a.type === "open") api.fs.open(a.value).catch((e) => toast(cleanError(e), { level: "warn" }));
  else if (a.type === "command") runCommand(a.value);
  else if (a.type === "updates") runCommand("updates.check");
  else if (a.type === "url") openUrl(a.value);
}

function when(at) {
  const d = new Date(at);
  const now = new Date();
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins} min ago`;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function initNotices() {
  api.notices.onNew(({ notice, toast: show, unread }) => {
    state = { ...state, unread };
    emitState();
    if (show) toast(notice.body ? `${notice.title} — ${notice.body}` : notice.title, { level: notice.level, timeout: notice.level === "error" ? 12000 : 7000, action: notice.action ? { label: "Open", run: () => runAction(notice.action) } : undefined });
  });
  api.notices.onChange((s) => { state = { ...state, ...s }; emitState(); });
  api.notices.list().then((l) => { state = { unread: l.unread, quiet: l.quiet, dnd: l.dnd, quietReasons: l.quietReasons }; emitState(); }).catch(() => {});
}

// The top-bar bell.
export function noticesButton() {
  const badge = h("span", { class: "nc-badge", hidden: true });
  const btn = h("button", { class: "icon-btn nc-btn", type: "button", title: "Notifications" }, icon("bell"), badge);
  const render = (s) => {
    badge.hidden = !s.unread;
    setText(badge, s.unread > 9 ? "9+" : String(s.unread));
    btn.classList.toggle("quiet", !!s.quiet);
    btn.replaceChildren(icon(s.quiet ? "moon" : "bell"), badge);
    btn.title = s.quiet ? `Notifications — ${s.dnd ? "Do Not Disturb" : "quiet while a game runs"}` : `Notifications${s.unread ? ` (${s.unread} new)` : ""}`;
  };
  listeners.add(render);
  render(state);
  btn.addEventListener("click", () => openPanel(btn));
  return btn;
}

function openPanel(anchor) {
  if (anchor.classList.contains("open")) return;
  anchor.classList.add("open");
  let off = null;
  popover(anchor, (close) => {
    const list = h("div", { class: "nc-list" });
    const dnd = h("input", { type: "checkbox", class: "switch", checked: !!settings.get("dnd") });
    dnd.addEventListener("change", () => settings.set({ dnd: dnd.checked }));
    const note = h("div", { class: "nc-note muted" });
    const render = async () => {
      const l = await api.notices.list().catch(() => ({ items: [] }));
      setText(note, l.quietReasons?.includes("game") && !l.dnd ? "Quiet while a game runs — notifications wait here" : l.dnd ? "Do Not Disturb — nothing pops up or rings; it's all kept here" : "");
      note.hidden = !note.textContent;
      if (!l.items.length) { list.replaceChildren(h("div", { class: "empty" }, "No notifications")); return; }
      let day = "";
      const rows = [];
      for (const n of l.items) {
        const d = new Date(n.at).toDateString();
        if (d !== day) {
          day = d;
          rows.push(h("div", { class: "nc-day" }, d === new Date().toDateString() ? "TODAY" : new Date(n.at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }).toUpperCase()));
        }
        rows.push(h("div", { class: `nc-item ${n.level}${n.action ? " has-action" : ""}`, title: n.action ? "Click to open" : "", onclick: (e) => {
          if (e.target.closest(".nc-x")) return;
          if (n.action) { close(); runAction(n.action); }
        } },
        h("span", { class: "nc-ico" }, icon(KIND_ICON[n.kind] || "info")),
        h("div", { class: "nc-text" }, h("div", { class: "nc-title" }, n.title), n.body && h("div", { class: "nc-body muted" }, n.body)),
        h("span", { class: "nc-time muted" }, when(n.at)),
        h("button", { class: "icon-btn sm nc-x", type: "button", title: "Dismiss", onclick: () => api.notices.remove(n.id).then(render) }, icon("close"))));
      }
      list.replaceChildren(...rows);
    };
    render();
    api.notices.seen().catch(() => {});
    off = api.notices.onNew(() => { render(); });
    return h("div", { class: "nc" },
      h("div", { class: "nc-head" }, h("span", { class: "panel-title" }, "Notifications"), h("span", { class: "grow" }),
        h("label", { class: "nc-dnd", title: "Silence pop-ups, sounds and Windows notifications (critical battery warnings still show)" }, dnd, "Do not disturb"),
        h("button", { class: "btn sm", type: "button", onclick: () => api.notices.clear().then(render) }, "Clear")),
      note, list);
  }, { className: "nc-pop", onClose: () => { anchor.classList.remove("open"); off?.(); } });
}
