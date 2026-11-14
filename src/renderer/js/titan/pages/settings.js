// Titan Protocol settings: accent, units, backups (compatible with the
// original app's), the welcome walkthrough and clearing everything.
import { h } from "../../core/dom.js";
import { confirm, toast, cleanError, openModal } from "../../core/ui.js";
import * as db from "../db.js";
import * as L from "../logic.js";
import * as U from "../ui.js";

const api = window.edex;

export const ACCENTS = [
  { value: "edex", label: "eDEX theme", desc: "Follows the eDEX theme you use" },
  { value: "cyber", label: "Cyberpunk", desc: "Cyan accents, neon glow, dense HUD" },
  { value: "metal", label: "Black metallic", desc: "Clean silver on black, minimal glow" }
];

async function exportBackup() {
  await db.flush();
  try {
    const r = await api.titan.export();
    if (!r) return;
    db.setPrefs({ lastBackup: r.at });
    toast(`Backup saved: ${r.rows.toLocaleString()} rows`, { level: "ok", action: { label: "Show", run: () => api.fs.reveal(r.file) } });
  } catch (e) { toast(`Export failed: ${cleanError(e)}`, { level: "warn" }); }
}

async function importBackup() {
  await db.flush();
  let r;
  try { r = await api.titan.import(); } catch (e) { toast(`Import failed: ${cleanError(e)}`, { level: "warn", timeout: 6000 }); return; }
  if (!r) return;
  const { summary } = r;
  const ok = await confirm({
    title: "Replace all Titan Protocol data?",
    message: `${summary.file} holds ${summary.tables} tables and ${summary.rows.toLocaleString()} rows${summary.exportedAt ? ` (exported ${new Date(summary.exportedAt).toLocaleString()})` : ""}.${summary.dropped ? ` ${summary.dropped} unreadable rows will be skipped.` : ""} Importing replaces everything here now; export first if you want to keep it.`,
    confirmLabel: "Replace and import", danger: true
  });
  if (!ok) { toast("Import cancelled."); return; }
  db.replaceAll(r.tables);
  await db.flush();
  toast(`Import complete: ${summary.tables} tables, ${summary.rows.toLocaleString()} rows restored.`, { level: "ok", timeout: 4000 });
}

async function clearAll() {
  const ok = await confirm({ title: "Delete all Titan Protocol data?", message: `Every task, habit, journal entry, workout, transaction and goal (${db.rowCount().toLocaleString()} rows) is removed. This can't be undone — export a backup first if you might want it back.`, confirmLabel: "Delete everything", danger: true });
  if (!ok) return;
  db.replaceAll({});
  db.setPrefs({ dates: {} });
  toast("Titan Protocol data cleared", { level: "ok" });
}

export function render(ctx) {
  const accent = db.pref("accent", "edex");
  const last = db.pref("lastBackup", null);
  const counts = [["Tasks", "tasks"], ["Completions", "completions"], ["Habits", "habits"], ["Journal entries", "journal_entries"], ["Transactions", "money_tx"], ["Workouts", "gym_sessions"], ["Goals", "goals"], ["Meals", "nutrition_meals"]];
  return h("div", { class: "tp-page" },
    U.pageHead("Configuration", "Settings", "Titan Protocol inside eDEX — everything stays on this PC."),
    h("div", { class: "tp-grid tp-settings-grid" },
      U.panel("Appearance", null,
        h("div", { class: "tp-accent-grid" }, ...ACCENTS.map((a) => h("button", {
          class: `tp-accent tp-accent-${a.value}${accent === a.value ? " active" : ""}`, type: "button", onclick: () => db.setPrefs({ accent: a.value })
        }, h("i", null), h("b", null, a.label), h("span", { class: "muted" }, a.desc))))),
      U.panel("Units & sounds", null,
        h("div", { class: "tp-setting" }, h("div", null, h("b", null, "Currency"), h("div", { class: "muted" }, "Shown on cashflow, deep work and budgets")),
          U.seg(Object.keys(L.CURRENCY).map((c) => ({ value: c, label: `${c} ${L.CURRENCY[c]}` })), db.pref("currency", "USD"), (v) => db.setPrefs({ currency: v }))),
        h("div", { class: "tp-setting" }, h("div", null, h("b", null, "Lifting weights in"), h("div", { class: "muted" }, "Workout sets (body weight is always kg)")),
          U.seg([{ value: "lbs", label: "lbs" }, { value: "kg", label: "kg" }], db.pref("liftUnit", "lbs"), (v) => db.setPrefs({ liftUnit: v }))),
        h("div", { class: "tp-setting" }, h("div", null, h("b", null, "Sounds"), h("div", { class: "muted" }, "Tick and focus-timer sounds (eDEX's sound setting still applies)")),
          (() => { const sw = h("input", { class: "switch", type: "checkbox", checked: db.pref("sound", true) }); sw.addEventListener("change", () => db.setPrefs({ sound: sw.checked })); return sw; })())),
      U.panel("Data backup & restore", { cls: "tp-span-all" },
        h("div", { class: "tp-actions-row" },
          U.btn("Export data", exportBackup, { kind: "primary", iconName: "download" }),
          U.btn("Import data", importBackup, { iconName: "up" }),
          U.btn("Open data folder", () => api.app.openData().catch((e) => toast(cleanError(e), { level: "warn" })), { iconName: "folder" })),
        h("div", { class: "muted tp-pad" }, last ? `Last backup: ${new Date(last).toLocaleString()}` : "No backup made yet."),
        h("div", { class: "tp-note" }, "Backups use the same format as the Titan Protocol desktop app (titan-backup-YYYY-MM-DD.json), so you can bring your data over from it, or take it back. Importing replaces ALL data here."),
        h("div", { class: "tp-kv tp-counts" }, ...counts.flatMap(([label, t]) => [h("span", null, label), h("b", null, db.all(t).length.toLocaleString())]))),
      U.panel("Onboarding", null,
        h("div", { class: "muted" }, "Show the welcome walkthrough again."),
        h("div", { class: "tp-actions-row" }, U.btn("Replay onboarding", () => openOnboarding(), { iconName: "play" }))),
      U.panel("Danger zone", null,
        h("div", { class: "muted" }, "Remove every Titan Protocol record from this PC."),
        h("div", { class: "tp-actions-row" }, U.btn("Delete all data", clearAll, { kind: "danger", iconName: "trash" })))));
}

// ── Welcome walkthrough ───────────────────────────────────────────────────
const STEPS = [
  { title: "Welcome to Titan Protocol", body: () => [h("p", null, "Your personal operating system for building discipline, tracking progress and becoming your best self — running inside eDEX, with your data kept on this PC.")] },
  { kicker: "Your life stack", title: "The four engines", body: () => [h("div", { class: "tp-onb-engines" }, ...L.ENGINES.map((e) => h("div", { class: "tp-onb-engine", style: { "--ec": U.ENGINE_COLOR[e] } }, h("b", null, L.ENGINE_LABEL[e]), h("span", { class: "muted" }, L.ENGINE_DESC[e]))))] },
  { kicker: "How it works", title: "Scoring system", body: () => [
    h("div", { class: "tp-kv" }, h("span", null, "Main task"), h("b", null, "2 pts"), h("span", null, "Secondary task"), h("b", null, "1 pt"), h("span", null, "Daily progress"), h("b", null, `${L.THRESHOLD}%+ = consistent day`)),
    h("p", { class: "muted" }, "Each engine scores the share of its points you earn in a day. Your Titan Score is the average of the engines you're using. Tasks done fewer than 7 days a week stop counting once their weekly goal is met, so rest days don't hurt.")] },
  { kicker: "Build discipline", title: "Daily habits", body: () => [h("p", null, "Build streaks. Track daily. Watch your consistency grow. A streak forgives one missed day a week.")] },
  { title: "You're all set", body: () => [h("p", null, "Start on the dashboard. Press ", h("span", { class: "kbd" }, "Ctrl+K"), " inside Titan for quick navigation, or type \"titan\" in the eDEX launcher.")] }
];

export function openOnboarding() {
  let i = 0;
  openModal((close) => {
    const box = h("div", { class: "dialog tp-dialog tp-onb" });
    const paint = () => {
      const s = STEPS[i];
      box.replaceChildren(
        h("div", { class: "tp-onb-dots" }, ...STEPS.map((_, j) => h("i", { class: j === i ? "on" : j < i ? "done" : "" }))),
        s.kicker && h("div", { class: "tp-kicker" }, s.kicker),
        h("h2", { class: "dialog-title" }, s.title),
        h("div", { class: "tp-onb-body" }, ...s.body()),
        h("div", { class: "dialog-actions" },
          i > 0 ? U.btn("Back", () => { i--; paint(); }) : U.btn("Skip", () => close(true)),
          U.btn(i === STEPS.length - 1 ? "Get started" : "Next", () => { if (i === STEPS.length - 1) close(true); else { i++; paint(); } }, { kind: "primary" })));
    };
    paint();
    return box;
  }, { label: "Titan Protocol welcome", className: "tp-modal", onClose: () => { if (!db.pref("onboarded", false)) db.setPrefs({ onboarded: true }, { redraw: false }); } });
}
