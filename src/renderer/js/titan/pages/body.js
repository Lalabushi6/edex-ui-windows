// Body engine tools: workouts, sleep, weight and nutrition.
import { h, setText } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { confirm, openModal, prompt, toast } from "../../core/ui.js";
import * as db from "../db.js";
import * as L from "../logic.js";
import * as U from "../ui.js";
import * as C from "../charts.js";
import { SUBTABS } from "./engine.js";

const head = (ctx, page, kicker, title, sub, ...right) => [U.pageHead(kicker, title, sub, ...right), U.tabs(SUBTABS.body, page, (id) => ctx.go(id))];

// ── Workouts ──────────────────────────────────────────────────────────────
const EXERCISES = "Bench Press|Chest|Barbell;Incline Bench Press|Chest|Barbell;Decline Bench Press|Chest|Barbell;Dumbbell Press|Chest|Dumbbell;Dumbbell Incline Press|Chest|Dumbbell;Cable Fly|Chest|Cable;Machine Chest Press|Chest|Machine;Pushups|Chest|Bodyweight;Dumbbell Fly|Chest|Dumbbell;Pec Deck|Chest|Machine;Pull Ups|Back|Bodyweight;Lat Pulldown|Back|Cable;Barbell Row|Back|Barbell;Seated Cable Row|Back|Cable;Deadlift|Back|Barbell;Face Pull|Back|Cable;T-Bar Row|Back|Barbell;Single Arm Dumbbell Row|Back|Dumbbell;Chin Ups|Back|Bodyweight;Straight Arm Pulldown|Back|Cable;Overhead Press|Shoulders|Barbell;Dumbbell Shoulder Press|Shoulders|Dumbbell;Lateral Raise|Shoulders|Dumbbell;Front Raise|Shoulders|Dumbbell;Reverse Fly|Shoulders|Dumbbell;Arnold Press|Shoulders|Dumbbell;Cable Lateral Raise|Shoulders|Cable;Upright Row|Shoulders|Barbell;Rear Delt Fly Machine|Shoulders|Machine;Shrugs|Shoulders|Dumbbell;Barbell Curl|Arms|Barbell;Dumbbell Curl|Arms|Dumbbell;Hammer Curl|Arms|Dumbbell;Tricep Pushdown|Arms|Cable;Skullcrusher|Arms|Barbell;Dips|Arms|Bodyweight;Preacher Curl|Arms|Barbell;Concentration Curl|Arms|Dumbbell;Overhead Tricep Extension|Arms|Cable;Close Grip Bench Press|Arms|Barbell;Squat|Legs|Barbell;Front Squat|Legs|Barbell;Leg Press|Legs|Machine;Leg Curl|Legs|Machine;Leg Extension|Legs|Machine;Romanian Deadlift|Legs|Barbell;Lunges|Legs|Dumbbell;Hip Thrust|Legs|Barbell;Calf Raise|Legs|Machine;Bulgarian Split Squat|Legs|Dumbbell;Hack Squat|Legs|Machine;Goblet Squat|Legs|Dumbbell;Sumo Deadlift|Legs|Barbell;Step Ups|Legs|Dumbbell;Glute Kickback|Legs|Cable;Plank|Core|Bodyweight;Hanging Leg Raise|Core|Bodyweight;Cable Crunch|Core|Cable;Russian Twist|Core|Bodyweight;Ab Rollout|Core|Bodyweight;Bicycle Crunch|Core|Bodyweight;Weighted Decline Sit Up|Core|Dumbbell;Pallof Press|Core|Cable;Dead Bug|Core|Bodyweight;Mountain Climbers|Core|Bodyweight"
  .split(";").map((x) => { const [name, muscleGroup, equipment] = x.split("|"); return { name, muscleGroup, equipment }; });
const TEMPLATES = [
  ["Push Day", "Bench Press,Incline Bench Press,Overhead Press,Lateral Raise,Tricep Pushdown,Dips"],
  ["Pull Day", "Pull Ups,Barbell Row,Seated Cable Row,Face Pull,Barbell Curl,Hammer Curl"],
  ["Leg Day", "Squat,Romanian Deadlift,Leg Press,Leg Curl,Leg Extension,Calf Raise"],
  ["Upper Body", "Bench Press,Barbell Row,Overhead Press,Lat Pulldown,Barbell Curl,Tricep Pushdown"],
  ["Lower Body", "Squat,Romanian Deadlift,Hip Thrust,Leg Press,Lunges,Calf Raise"],
  ["Push Pull Legs", "Bench Press,Overhead Press,Pull Ups,Barbell Row,Squat,Romanian Deadlift"],
  ["Chest + Triceps", "Bench Press,Incline Bench Press,Cable Fly,Dumbbell Press,Tricep Pushdown,Skullcrusher"],
  ["Back + Biceps", "Pull Ups,Barbell Row,Seated Cable Row,Lat Pulldown,Barbell Curl,Hammer Curl"],
  ["Full Body", "Squat,Bench Press,Barbell Row,Overhead Press,Romanian Deadlift,Pull Ups"],
  ["Beginner Full Body", "Goblet Squat,Dumbbell Press,Single Arm Dumbbell Row,Dumbbell Shoulder Press,Lunges,Plank"]
];
const GROUPS = ["All", "Chest", "Back", "Shoulders", "Arms", "Legs", "Core"];
const EQUIPMENT = ["Barbell", "Dumbbell", "Cable", "Machine", "Bodyweight", "Kettlebell", "Band", "Other"];

// The exercise list and starter templates, once (as the original did).
export function seedGym() {
  if (!db.all("gym_exercises").length) db.bulkInsert("gym_exercises", EXERCISES.map((e) => ({ ...e, createdAt: Date.now() })));
  if (!db.all("gym_templates").length) {
    const byName = new Map(db.all("gym_exercises").map((e) => [e.name, e.id]));
    for (const [name, list] of TEMPLATES) {
      const tpl = db.insert("gym_templates", { name, createdAt: Date.now() });
      db.bulkInsert("gym_template_exercises", list.split(",").map((n) => byName.get(n)).filter(Boolean).map((exerciseId, order) => ({ templateId: tpl.id, exerciseId, order })));
    }
  }
}

const exName = (id) => db.get("gym_exercises", id)?.name || "Unknown";
const tplExercises = (tplId) => db.all("gym_template_exercises").filter((x) => x.templateId === tplId).sort((a, b) => a.order - b.order);
const activeSession = () => db.all("gym_sessions").find((s) => s.endedAt === null || s.endedAt === undefined) || null;
const duration = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;
};

function startWorkout(tplId) {
  if (activeSession()) { toast("You already have an active workout. Finish it before starting a new one.", { level: "warn" }); return; }
  db.insert("gym_sessions", { dateKey: L.today(), templateId: tplId, startedAt: Date.now(), endedAt: null });
}

function editTemplate(tplId) {
  openModal((close) => {
    const box = h("div", { class: "dialog tp-dialog wide" });
    const paint = () => {
      const tpl = db.get("gym_templates", tplId);
      if (!tpl) { close(); return; }
      const rows = tplExercises(tplId);
      const pick = h("select", { class: "input" }, ...GROUPS.slice(1).map((g) => h("optgroup", { label: g },
        ...db.all("gym_exercises").filter((e) => e.muscleGroup === g).sort((a, b) => a.name.localeCompare(b.name)).map((e) => h("option", { value: e.id }, e.name)))),
        h("optgroup", { label: "Other" }, ...db.all("gym_exercises").filter((e) => !GROUPS.includes(e.muscleGroup)).map((e) => h("option", { value: e.id }, e.name))));
      const move = (i, d) => {
        const list = rows.map((r) => r.id);
        const j = i + d;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        list.forEach((id, order) => db.update("gym_template_exercises", id, { order }));
        paint();
      };
      box.replaceChildren(
        h("h2", { class: "dialog-title" }, `Edit template · ${tpl.name}`),
        h("div", { class: "tp-list" }, ...(rows.length ? rows.map((r, i) => h("div", { class: "tp-row" },
          h("span", { class: "tp-num" }, String(i + 1)), h("span", { class: "tp-row-title" }, exName(r.exerciseId)),
          U.iconBtn("up", "Move up", () => move(i, -1)), U.iconBtn("chevronDown", "Move down", () => move(i, 1)),
          U.iconBtn("close", "Remove", () => { db.remove("gym_template_exercises", r.id); paint(); }, { danger: true })))
          : [h("div", { class: "muted tp-pad" }, "No exercises yet.")])),
        h("div", { class: "tp-goal-add" }, pick, U.btn("Add exercise", () => {
          db.insert("gym_template_exercises", { templateId: tplId, exerciseId: Number(pick.value), order: rows.length });
          paint();
        }, { kind: "sm" })),
        h("div", { class: "dialog-actions" },
          U.btn("Rename", async () => { const v = await prompt({ title: "Rename template", value: tpl.name }); if (v) { db.update("gym_templates", tplId, { name: v.slice(0, 120) }); paint(); } }),
          U.btn("Done", () => close(true), { kind: "primary" })));
    };
    paint();
    return box;
  }, { label: "Edit template", className: "tp-modal" });
}

function activeWorkout(ctx, s) {
  const tpl = db.get("gym_templates", s.templateId);
  const sets = db.all("gym_sets").filter((x) => x.sessionId === s.id);
  const exIds = [...new Set([...tplExercises(s.templateId).map((x) => x.exerciseId), ...sets.map((x) => x.exerciseId)])];
  const unit = db.pref("liftUnit", "lbs");
  const clock = h("b", null, duration(Date.now() - s.startedAt));
  ctx.every(1000, () => setText(clock, duration(Date.now() - s.startedAt)));
  const extra = h("select", { class: "input" }, h("option", { value: "" }, "Add an exercise…"), ...db.all("gym_exercises").sort((a, b) => a.name.localeCompare(b.name)).map((e) => h("option", { value: e.id }, e.name)));
  extra.addEventListener("change", () => {
    if (!extra.value) return;
    const id = Number(extra.value);
    const n = sets.filter((x) => x.exerciseId === id).length;
    db.insert("gym_sets", { sessionId: s.id, exerciseId: id, setIndex: n, weight: 0, reps: 0 });
  });
  const field = (set, name) => {
    const input = h("input", { class: "input tp-num-input", type: "number", min: 0, step: name === "weight" ? 0.5 : 1, value: set[name] || "", placeholder: "0", "data-keep": `set-${set.id}-${name}` });
    input.addEventListener("change", () => { const v = Math.max(0, Number(input.value) || 0); db.update("gym_sets", set.id, { [name]: v }); });
    return input;
  };
  return U.panel(`Active workout · ${tpl?.name || "Workout"}`, { cls: "tp-span-all tp-active-workout", tools: h("span", { class: "muted" }, "Elapsed ", clock) },
    h("div", { class: "tp-workout-ex" }, ...exIds.map((exId) => {
      const mine = sets.filter((x) => x.exerciseId === exId).sort((a, b) => a.setIndex - b.setIndex);
      return h("div", { class: "tp-ex-block" },
        h("div", { class: "tp-ex-name" }, exName(exId), h("span", { class: "muted" }, ` · ${mine.length} set${mine.length === 1 ? "" : "s"}`)),
        ...mine.map((set, i) => h("div", { class: "tp-set-row" },
          h("span", { class: "tp-num" }, `Set ${i + 1}`), field(set, "weight"), h("span", { class: "muted" }, unit), h("span", { class: "muted" }, "×"), field(set, "reps"), h("span", { class: "muted" }, "reps"),
          U.iconBtn("close", "Delete set", () => db.remove("gym_sets", set.id), { danger: true }))),
        h("button", { class: "btn sm", type: "button", onclick: () => {
          const last = mine[mine.length - 1];
          db.insert("gym_sets", { sessionId: s.id, exerciseId: exId, setIndex: mine.length, weight: last?.weight || 0, reps: last?.reps || 0 });
        } }, icon("plus"), "Set"));
    })),
    h("div", { class: "tp-goal-add" }, extra),
    h("div", { class: "dialog-actions" },
      U.btn("Discard", async () => {
        if (!await confirm({ title: "Discard this workout?", message: "All its sets will be deleted.", confirmLabel: "Discard", danger: true })) return;
        db.removeWhere("gym_sets", (x) => x.sessionId === s.id);
        db.remove("gym_sessions", s.id);
      }, { kind: "danger" }),
      U.btn("Finish workout", async () => {
        if (await confirm({ title: "Finish this workout?", confirmLabel: "Finish" })) db.update("gym_sessions", s.id, { endedAt: Date.now() });
      }, { kind: "primary" })));
}

export function workouts(ctx) {
  const st = ctx.state;
  st.tab = st.tab || "templates";
  st.group = st.group || "All";
  st.q = st.q ?? "";
  const s = activeSession();
  let body;
  if (st.tab === "templates") {
    const tpls = [...db.all("gym_templates")].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    body = U.panel("Your templates", { cls: "tp-span-all", tools: U.btn("Create template", async () => {
      const name = await prompt({ title: "Create template", placeholder: "e.g. Push Day", confirmLabel: "Create" });
      if (name) editTemplate(db.insert("gym_templates", { name: name.slice(0, 120), createdAt: Date.now() }).id);
    }, { kind: "sm", iconName: "plus" }) },
    tpls.length ? h("div", { class: "tp-tpl-grid" }, ...tpls.map((tpl) => {
      const ex = tplExercises(tpl.id);
      return h("article", { class: "tp-tpl" },
        h("div", { class: "tp-tpl-name" }, tpl.name),
        h("div", { class: "muted tp-tpl-list" }, ex.length ? ex.map((x) => exName(x.exerciseId)).join(" · ") : "No exercises"),
        h("div", { class: "tp-tpl-tools" },
          U.btn("Start workout", () => startWorkout(tpl.id), { kind: "primary sm", iconName: "play" }),
          U.btn("Edit", () => editTemplate(tpl.id), { kind: "sm" }),
          U.iconBtn("trash", "Delete template", async () => {
            if (!await confirm({ title: "Delete this template?", message: "Its exercise list goes too. Past workouts stay in the history.", confirmLabel: "Delete", danger: true })) return;
            db.removeWhere("gym_template_exercises", (x) => x.templateId === tpl.id);
            db.remove("gym_templates", tpl.id);
          }, { danger: true })));
    })) : U.empty("No templates yet. Create one to get started."));
  } else if (st.tab === "exercises") {
    const q = st.q.trim().toLowerCase();
    const list = db.all("gym_exercises").filter((e) => (st.group === "All" || e.muscleGroup === st.group) && (!q || e.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
    const search = h("input", { class: "input", placeholder: "Search exercises…", value: st.q, "data-keep": "ex-search", spellcheck: false });
    search.addEventListener("input", () => { st.q = search.value; ctx.redraw(); });
    body = U.panel("Exercise database", { cls: "tp-span-all", sub: `${list.length} shown`, tools: U.btn("Add custom exercise", async () => {
      await U.formDialog({
        title: "Add custom exercise", submitLabel: "Add",
        fields: [
          { name: "name", label: "Exercise name", required: true },
          { name: "muscleGroup", label: "Muscle group", type: "select", value: st.group === "All" ? "Chest" : st.group, options: GROUPS.slice(1) },
          { name: "equipment", label: "Equipment", type: "select", value: "Barbell", options: EQUIPMENT }
        ],
        onSubmit: (v) => { db.insert("gym_exercises", { name: v.name.trim().slice(0, 120), muscleGroup: v.muscleGroup, equipment: v.equipment, createdAt: Date.now() }); }
      });
    }, { kind: "sm", iconName: "plus" }) },
    h("div", { class: "tp-toolbar" }, search, U.seg(GROUPS.map((g) => ({ value: g, label: g })), st.group, (g) => { st.group = g; ctx.redraw(); })),
    list.length ? h("div", { class: "tp-ex-grid" }, ...list.map((e) => h("div", { class: "tp-row" },
      h("span", { class: "tp-row-title ellipsis" }, e.name), U.badge(e.muscleGroup), h("span", { class: "muted" }, e.equipment),
      U.iconBtn("trash", "Delete exercise", async () => {
        if (await confirm({ title: "Delete this exercise?", message: `"${e.name}" leaves every template it's in.`, confirmLabel: "Delete", danger: true })) {
          db.removeWhere("gym_template_exercises", (x) => x.exerciseId === e.id);
          db.remove("gym_exercises", e.id);
        }
      }, { danger: true })))) : U.empty("No exercises found."));
  } else {
    const unit = db.pref("liftUnit", "lbs");
    const done = db.all("gym_sessions").filter((x) => x.endedAt).sort((a, b) => b.startedAt - a.startedAt);
    st.open = st.open || {};
    body = U.panel("Workout history", { cls: "tp-span-all", sub: `${done.length} sessions` },
      done.length ? h("div", { class: "tp-list" }, ...done.map((sess) => {
        const sets = db.all("gym_sets").filter((x) => x.sessionId === sess.id);
        const volume = sets.reduce((a, x) => a + x.weight * x.reps, 0);
        const open = !!st.open[sess.id];
        const byEx = new Map();
        for (const x of sets.sort((a, b) => a.setIndex - b.setIndex)) { if (!byEx.has(x.exerciseId)) byEx.set(x.exerciseId, []); byEx.get(x.exerciseId).push(x); }
        return h("div", { class: "tp-history" },
          h("div", { class: "tp-row" },
            h("button", { class: "icon-btn sm", type: "button", title: open ? "Collapse" : "Expand", onclick: () => { st.open[sess.id] = !open; ctx.redraw(); } }, icon(open ? "chevronDown" : "chevron")),
            h("span", { class: "tp-row-title" }, db.get("gym_templates", sess.templateId)?.name || "Workout"),
            h("span", { class: "muted" }, L.longDate(sess.dateKey)),
            U.badge(duration(sess.endedAt - sess.startedAt)), U.badge(`${sets.length} sets`), U.badge(`${Math.round(volume).toLocaleString()} ${unit}`),
            U.iconBtn("trash", "Delete session", async () => {
              if (!await confirm({ title: "Delete this session?", message: "It and all its sets will be removed.", confirmLabel: "Delete", danger: true })) return;
              db.removeWhere("gym_sets", (x) => x.sessionId === sess.id);
              db.remove("gym_sessions", sess.id);
            }, { danger: true })),
          open && h("div", { class: "tp-history-body" }, ...(byEx.size ? [...byEx.entries()].map(([exId, list]) => h("div", { class: "tp-ex-block" },
            h("div", { class: "tp-ex-name" }, exName(exId)),
            ...list.map((x, i) => h("div", { class: "muted" }, `Set ${i + 1}: ${x.weight} ${unit} × ${x.reps} reps`)))) : [h("div", { class: "muted" }, "No sets recorded.")])));
      })) : U.empty("No completed workouts yet. Start one from the Templates tab."));
  }
  const thisWeek = db.all("gym_sessions").filter((x) => x.endedAt && x.dateKey >= L.weekStart(L.today())).length;
  return h("div", { class: "tp-page" },
    ...head(ctx, "body/workouts", "Body engine", "Workouts", `Track your gym sessions · ${thisWeek} this week`),
    h("div", { class: "tp-grid" },
      s && activeWorkout(ctx, s),
      h("div", { class: "tp-span-all" }, U.tabs([{ id: "templates", label: "Templates" }, { id: "exercises", label: "Exercises" }, { id: "history", label: "History" }], st.tab, (id) => { st.tab = id; ctx.redraw(); })),
      body));
}

// ── Sleep ─────────────────────────────────────────────────────────────────
export function sleep(ctx) {
  const t = L.today();
  const st = ctx.state;
  const entries = [...db.all("sleep_entries")].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  const recent = entries.slice(0, 7);
  const avg = (f) => (recent.length ? recent.reduce((s, e) => s + f(e), 0) / recent.length : 0);
  const form = st.form || (st.form = { dateKey: t, bedtime: "23:00", wakeTime: "07:00", quality: 3, notes: "" });
  const existing = db.get("sleep_entries", form.dateKey);
  const dur = h("b", null, L.hm(L.sleepMinutes(form.bedtime, form.wakeTime)));
  const inp = (name, type) => {
    const el = h("input", { class: "input", type, value: form[name], max: type === "date" ? t : undefined });
    el.addEventListener("input", () => { form[name] = el.value; setText(dur, L.hm(L.sleepMinutes(form.bedtime, form.wakeTime))); });
    if (type === "date") el.addEventListener("change", () => { const e = db.get("sleep_entries", el.value); if (e) Object.assign(form, { bedtime: e.bedtime, wakeTime: e.wakeTime, quality: e.quality, notes: e.notes || "" }); ctx.redraw(); });
    return el;
  };
  const notes = h("textarea", { class: "input", rows: 2, placeholder: "How did you sleep?" });
  notes.value = form.notes;
  notes.addEventListener("input", () => { form.notes = notes.value; });
  const qual = U.seg(L.QUALITY.slice(1).map((q, i) => ({ value: i + 1, label: `${i + 1} · ${q.label}` })), form.quality, (v) => { form.quality = v; ctx.redraw(); });
  const save = () => {
    if (!L.isKey(form.dateKey)) { toast("Pick a date", { level: "warn" }); return; }
    db.put("sleep_entries", { dateKey: form.dateKey, bedtime: form.bedtime, wakeTime: form.wakeTime, durationMinutes: L.sleepMinutes(form.bedtime, form.wakeTime), quality: form.quality, notes: form.notes.slice(0, 2000), createdAt: Date.now() });
    toast("Sleep logged", { level: "ok", timeout: 1400 });
  };
  const days = L.range(L.addDays(t, -13), t);
  return h("div", { class: "tp-page" },
    ...head(ctx, "body/sleep", "Body engine", "Sleep tracker", "Track your sleep patterns and optimise recovery."),
    h("div", { class: "tp-grid" },
      U.panel(null, { cls: "tp-span-all" }, h("div", { class: "tp-metrics" },
        U.metric("Avg duration", recent.length ? L.hm(avg((e) => e.durationMinutes)) : "—", "last 7 entries"),
        U.metric("Avg quality", recent.length ? `${avg((e) => e.quality).toFixed(1)} / 5` : "—", recent.length ? L.QUALITY[Math.round(avg((e) => e.quality))]?.label : ""),
        U.metric("Avg bedtime", L.averageClock(recent.map((e) => e.bedtime), { night: true }) || "--:--"),
        U.metric("Avg wake", L.averageClock(recent.map((e) => e.wakeTime)) || "--:--"))),
      U.panel(existing ? "Update sleep entry" : "Log sleep", null,
        h("div", { class: "tp-form" },
          h("label", { class: "tp-field" }, h("span", { class: "label" }, "Night of / woke on"), inp("dateKey", "date")),
          h("label", { class: "tp-field half" }, h("span", { class: "label" }, "Bedtime"), inp("bedtime", "time")),
          h("label", { class: "tp-field half" }, h("span", { class: "label" }, "Wake time"), inp("wakeTime", "time")),
          h("div", { class: "tp-field" }, h("span", { class: "label" }, "Duration"), dur),
          h("div", { class: "tp-field" }, h("span", { class: "label" }, "Quality"), qual),
          h("label", { class: "tp-field" }, h("span", { class: "label" }, "Notes"), notes)),
        h("div", { class: "dialog-actions" }, U.btn(existing ? "Update entry" : "Save entry", save, { kind: "primary" }))),
      U.panel("Sleep duration", { sub: "last 14 days" },
        entries.length ? C.barChart(days.map((k) => {
          const e = db.get("sleep_entries", k);
          return { label: k.slice(8), value: e ? e.durationMinutes / 60 : 0, color: e ? L.QUALITY[e.quality]?.color : undefined, title: e ? `${L.shortDate(k)}: ${L.hm(e.durationMinutes)} · ${L.QUALITY[e.quality]?.label}` : `${L.shortDate(k)}: —` };
        }), { max: Math.max(10, ...entries.slice(0, 14).map((e) => e.durationMinutes / 60)), unit: "h", threshold: 8 }) : U.empty("No sleep data yet. Log your first night to see trends.")),
      U.panel("History", { cls: "tp-span-all", sub: `${entries.length} nights` },
        entries.length ? h("div", { class: "tp-list" }, ...entries.slice(0, 60).map((e) => h("div", { class: "tp-row" },
          h("span", { class: "tp-row-title" }, L.longDate(e.dateKey)),
          h("span", { class: "muted" }, `${e.bedtime} → ${e.wakeTime}`), U.badge(L.hm(e.durationMinutes)), U.badge(L.QUALITY[e.quality]?.label || "", { color: L.QUALITY[e.quality]?.color }),
          e.notes && h("span", { class: "muted ellipsis tp-grow", title: e.notes }, e.notes),
          U.iconBtn("edit", "Edit", () => { st.form = { dateKey: e.dateKey, bedtime: e.bedtime, wakeTime: e.wakeTime, quality: e.quality, notes: e.notes || "" }; ctx.redraw(); }),
          U.iconBtn("trash", "Delete", async () => { if (await confirm({ title: "Delete this entry?", confirmLabel: "Delete", danger: true })) db.remove("sleep_entries", e.dateKey); }, { danger: true }))))
          : U.empty("No entries logged yet."))));
}

// ── Weight ────────────────────────────────────────────────────────────────
export function weight(ctx) {
  const t = L.today();
  const st = ctx.state;
  st.date = st.date || t;
  const entries = [...db.all("body_weight_entries")].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const latest = entries[entries.length - 1];
  const at = (days) => { const cut = L.addDays(t, -days); return [...entries].reverse().find((e) => e.dateKey <= cut); };
  const change = (days) => {
    const base = at(days);
    if (!latest || !base || base === latest) return "—";
    const d = latest.weightKg - base.weightKg;
    return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(1)} kg`;
  };
  const date = h("input", { class: "input", type: "date", value: st.date, max: t });
  date.addEventListener("change", () => { st.date = date.value; ctx.redraw(); });
  const existing = db.get("body_weight_entries", st.date);
  const kg = h("input", { class: "input", type: "number", step: 0.1, min: 1, placeholder: "e.g. 75.5", value: existing?.weightKg ?? "", "data-keep": "weight-kg" });
  const save = () => {
    const v = U.num(kg.value);
    if (!(v > 0 && v < 700)) { toast("Enter a weight in kg", { level: "warn" }); return; }
    if (!L.isKey(st.date)) return;
    db.put("body_weight_entries", { dateKey: st.date, weightKg: Math.round(v * 10) / 10, createdAt: Date.now() });
    toast("Weight logged", { level: "ok", timeout: 1400 });
  };
  kg.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
  const chartRows = entries.slice(-90);
  return h("div", { class: "tp-page" },
    ...head(ctx, "body/weight", "Body engine", "Weight tracker", "One reading a day — the latest per day counts."),
    h("div", { class: "tp-grid" },
      U.panel(null, { cls: "tp-span-all" }, h("div", { class: "tp-metrics" },
        U.metric("Current weight", latest ? `${latest.weightKg.toFixed(1)} kg` : "No entries", latest ? L.shortDate(latest.dateKey) : ""),
        U.metric("7-day change", change(7), "Last 7 days"),
        U.metric("30-day change", change(30), "Last 30 days"),
        U.metric("Entries", `${entries.length}`))),
      U.panel("Log weight", { sub: existing ? `Logged: ${existing.weightKg} kg` : "" },
        h("div", { class: "tp-form" },
          h("label", { class: "tp-field half" }, h("span", { class: "label" }, "Date"), date),
          h("label", { class: "tp-field half" }, h("span", { class: "label" }, "Weight (kg)"), kg)),
        h("div", { class: "dialog-actions" }, U.btn(existing ? "Update" : "Log weight", save, { kind: "primary" }))),
      U.panel("Weight trend", { sub: chartRows.length ? `${chartRows.length} entries` : "" },
        chartRows.length > 1 ? C.lineChart(chartRows.map((e) => ({ label: L.shortDate(e.dateKey), value: e.weightKg, title: `${L.shortDate(e.dateKey)}: ${e.weightKg} kg` })), {
          unit: "", min: Math.floor(Math.min(...chartRows.map((e) => e.weightKg)) - 1), max: Math.ceil(Math.max(...chartRows.map((e) => e.weightKg)) + 1), area: false
        }) : U.empty("No weight entries yet. Log your first weight to see a trend.")),
      U.panel("Weight history", { cls: "tp-span-all", sub: "last 30 entries" },
        entries.length ? h("div", { class: "tp-list" }, ...[...entries].reverse().slice(0, 30).map((e, i, arr) => {
          const prev = arr[i + 1];
          const d = prev ? e.weightKg - prev.weightKg : null;
          return h("div", { class: "tp-row" },
            h("span", { class: "tp-row-title" }, L.longDate(e.dateKey)), h("b", null, `${e.weightKg.toFixed(1)} kg`),
            d !== null && h("span", { class: `tp-change ${d > 0 ? "up" : d < 0 ? "down" : ""}` }, `${d > 0 ? "▲" : d < 0 ? "▼" : "■"} ${Math.abs(d).toFixed(1)}`),
            U.iconBtn("trash", "Delete", () => db.remove("body_weight_entries", e.dateKey), { danger: true }));
        })) : U.empty("No entries logged yet."))));
}

// ── Nutrition ─────────────────────────────────────────────────────────────
const PROFILE_DEFAULT = { sex: "male", age: 28, height_cm: 175, weight_kg: 75, bodyfat_pct: null, steps_per_day: 7000, workouts_per_week: 3, goal: "maintain", rate_kg_per_week: 0, protein_preference: "high" };

export async function profileDialog() {
  const p = db.get("nutrition_profiles", "default");
  const cur = p ? { ...PROFILE_DEFAULT, ...p, protein_preference: p.protein_g >= Math.round(p.weight_kg * 1.8) ? "high" : "normal" } : PROFILE_DEFAULT;
  const read = (inputs) => ({
    sex: inputs.sex.value, age: Math.round(U.num(inputs.age.value)), height_cm: U.num(inputs.height_cm.value), weight_kg: U.num(inputs.weight_kg.value),
    bodyfat_pct: inputs.bodyfat_pct.value.trim() ? U.num(inputs.bodyfat_pct.value) : null, steps_per_day: Math.round(U.num(inputs.steps_per_day.value)),
    workouts_per_week: Math.round(U.num(inputs.workouts_per_week.value)), goal: inputs.goal.value,
    rate_kg_per_week: inputs.goal.value === "maintain" ? 0 : Number(inputs.rate_kg_per_week.value), protein_preference: inputs.protein_preference.value
  });
  const valid = (v) => v.age >= 10 && v.age <= 120 && v.height_cm >= 50 && v.height_cm <= 280 && v.weight_kg >= 20 && v.weight_kg <= 400 && v.steps_per_day >= 0 && v.workouts_per_week >= 0;
  let previewEl = null;
  const refresh = (inputs) => {
    if (!previewEl) return;
    inputs.rate_kg_per_week.fieldWrap.hidden = inputs.goal.value === "maintain";
    const v = read(inputs);
    if (!valid(v)) { previewEl.replaceChildren(h("div", { class: "muted" }, "Fill in the fields to see your targets.")); return; }
    const tg = L.nutritionTargets(v);
    previewEl.replaceChildren(h("div", { class: "tp-kicker" }, "Computed targets"), h("div", { class: "tp-kv" },
      h("span", null, "Calories / day"), h("b", null, `${tg.calorie_target} kcal`),
      h("span", null, "Protein"), h("b", null, `${tg.protein_g} g`),
      h("span", null, "Carbs"), h("b", null, `${tg.carbs_g} g`),
      h("span", null, "Fat"), h("b", null, `${tg.fat_g} g`),
      h("span", null, "BMR"), h("b", null, `${Math.round(tg.bmr)} kcal`),
      h("span", null, "Activity multiplier"), h("b", null, `× ${tg.activity_multiplier}`),
      h("span", null, "TDEE"), h("b", null, `${Math.round(tg.tdee)} kcal`)));
  };
  const live = { onInput: (_v, inputs) => refresh(inputs), onChange: (_v, inputs) => refresh(inputs) };
  await U.formDialog({
    title: p ? "Edit nutrition profile" : "Nutrition setup", submitLabel: "Save profile", wide: true,
    intro: "Targets use the Mifflin-St Jeor equation, your activity and your goal.",
    fields: [
      { name: "sex", label: "Sex", type: "seg", value: cur.sex, options: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }], half: true, ...live },
      { name: "age", label: "Age", type: "number", value: cur.age, min: 10, max: 120, half: true, ...live },
      { name: "height_cm", label: "Height (cm)", type: "number", value: cur.height_cm, half: true, ...live },
      { name: "weight_kg", label: "Weight (kg)", type: "number", value: cur.weight_kg, step: 0.1, half: true, ...live },
      { name: "bodyfat_pct", label: "Body fat % (optional)", type: "number", value: cur.bodyfat_pct ?? "", half: true, ...live },
      { name: "steps_per_day", label: "Average steps / day", type: "number", value: cur.steps_per_day, half: true, ...live },
      { name: "workouts_per_week", label: "Workouts / week", type: "number", value: cur.workouts_per_week, half: true, ...live },
      { name: "protein_preference", label: "Protein preference", type: "seg", value: cur.protein_preference, options: [{ value: "high", label: "High" }, { value: "normal", label: "Normal" }], half: true, ...live },
      { name: "goal", label: "Goal", type: "seg", value: cur.goal, options: [{ value: "cut", label: "Cut" }, { value: "maintain", label: "Maintain" }, { value: "bulk", label: "Bulk" }], ...live },
      { name: "rate_kg_per_week", label: "Rate (kg per week)", type: "seg", value: cur.rate_kg_per_week || 0.5, options: [0.25, 0.5, 0.75, 1].map((r) => ({ value: r, label: `${r}` })), ...live,
        preview: (inputs, extra) => { previewEl = h("div", { class: "tp-preview" }); extra.append(previewEl); refresh(inputs); } }
    ],
    onSubmit: (_v, inputs) => {
      const v = read(inputs);
      if (!valid(v)) return "Check the numbers: age 10–120, height 50–280 cm, weight 20–400 kg.";
      const tg = L.nutritionTargets(v);
      const now = new Date().toISOString();
      db.put("nutrition_profiles", {
        id: "default", created_at: p?.created_at || now, updated_at: now, height_cm: v.height_cm, weight_kg: v.weight_kg, age: v.age, sex: v.sex,
        bodyfat_pct: v.bodyfat_pct, steps_per_day: v.steps_per_day, workouts_per_week: v.workouts_per_week, activity_multiplier: tg.activity_multiplier,
        goal: v.goal, rate_kg_per_week: v.rate_kg_per_week, calorie_target: tg.calorie_target, protein_g: tg.protein_g, carbs_g: tg.carbs_g, fat_g: tg.fat_g
      });
    }
  });
}

export async function mealDialog(dateISO = L.today()) {
  await U.formDialog({
    title: "New meal", submitLabel: "Save meal",
    fields: [
      { name: "name", label: "Name", placeholder: "e.g. Chicken and rice", required: true },
      { name: "calories", label: "Calories", type: "number", min: 0, half: true, required: true },
      { name: "protein_g", label: "Protein (g)", type: "number", min: 0, half: true, required: true },
      { name: "carbs_g", label: "Carbs (g)", type: "number", min: 0, half: true },
      { name: "fat_g", label: "Fat (g)", type: "number", min: 0, half: true }
    ],
    onSubmit: (v) => {
      if (!v.name.trim()) return "Meal name is required.";
      const cal = U.num(v.calories), pro = U.num(v.protein_g);
      if (!(cal >= 0)) return "Calories must be a valid number.";
      if (!(pro >= 0)) return "Protein must be a valid number.";
      const opt = (x) => (String(x).trim() === "" ? null : U.num(x) >= 0 ? U.num(x) : null);
      db.insert("nutrition_meals", { dateISO, created_at: new Date().toISOString(), name: v.name.trim().slice(0, 120), calories: cal, protein_g: pro, carbs_g: opt(v.carbs_g), fat_g: opt(v.fat_g) });
    }
  });
}

export function nutrition(ctx) {
  const t = L.today();
  const key = db.selectedDate("nutrition", t) > t ? t : db.selectedDate("nutrition", t);
  const p = db.get("nutrition_profiles", "default");
  const meals = db.all("nutrition_meals").filter((m) => m.dateISO === key).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const tot = meals.reduce((s, m) => ({ cal: s.cal + m.calories, p: s.p + m.protein_g, c: s.c + (m.carbs_g || 0), f: s.f + (m.fat_g || 0) }), { cal: 0, p: 0, c: 0, f: 0 });
  const macro = (label, have, want, unit = "g") => h("div", { class: "tp-macro" },
    h("div", { class: "tp-macro-head" }, h("span", null, label), h("b", null, `${Math.round(have)}${want ? ` / ${Math.round(want)}` : ""} ${unit}`)),
    U.progress(want ? (have / want) * 100 : 0, { state: want && have > want * 1.1 ? "red" : want && have >= want * 0.9 ? "green" : "yellow" }));
  return h("div", { class: "tp-page" },
    ...head(ctx, "body/nutrition", "Body engine", "Nutrition", `Meals and macros · ${L.longDate(key)}`, U.datePill(key, (k) => db.setSelectedDate("nutrition", k > t ? t : k), { max: t })),
    h("div", { class: "tp-grid" },
      !p && U.panel("Nutrition setup", { cls: "tp-span-all" }, U.empty("Set up your profile to get calorie and macro targets.", U.btn("Set up profile", () => profileDialog(), { kind: "primary" }))),
      U.panel("Totals", { sub: key === t ? "today" : L.shortDate(key) },
        h("div", { class: "tp-hero-split" },
          C.ring(p ? (tot.cal / p.calorie_target) * 100 : 0, { size: 130, stroke: 9, text: `${Math.round(tot.cal)}` }),
          h("div", { class: "tp-macros" },
            macro("Calories", tot.cal, p?.calorie_target, "kcal"),
            macro("Protein", tot.p, p?.protein_g),
            macro("Carbs", tot.c, p?.carbs_g),
            macro("Fat", tot.f, p?.fat_g)))),
      p && U.panel("Targets", { sub: `${p.goal}${p.goal !== "maintain" ? ` · ${p.rate_kg_per_week} kg/wk` : ""}`, tools: U.btn("Edit", () => profileDialog(), { kind: "sm", iconName: "edit" }) },
        h("div", { class: "tp-kv" },
          h("span", null, "Calories"), h("b", null, `${p.calorie_target} kcal`),
          h("span", null, "Protein"), h("b", null, `${p.protein_g} g`),
          h("span", null, "Carbs"), h("b", null, `${p.carbs_g ?? "—"} g`),
          h("span", null, "Fat"), h("b", null, `${p.fat_g ?? "—"} g`),
          h("span", null, "Activity"), h("b", null, `× ${p.activity_multiplier} · ${p.steps_per_day.toLocaleString()} steps · ${p.workouts_per_week} workouts`)),
        h("div", { class: "muted tp-pad" }, "Targets come from your nutrition profile — edit it any time.")),
      U.panel("Meals", { cls: "tp-span-all", sub: `${meals.length} logged`, tools: U.btn("Add meal", () => mealDialog(key), { kind: "sm", iconName: "plus" }) },
        meals.length ? h("div", { class: "tp-list" }, ...meals.map((m) => h("div", { class: "tp-row" },
          h("span", { class: "tp-row-title ellipsis" }, m.name),
          h("span", { class: "muted" }, `${Math.round(m.calories)} kcal · P ${m.protein_g}g · C ${m.carbs_g == null ? "—" : `${m.carbs_g}g`} · F ${m.fat_g == null ? "—" : `${m.fat_g}g`}`),
          U.iconBtn("trash", "Delete meal", () => db.remove("nutrition_meals", m.id), { danger: true }))))
          : U.empty("No meals logged for this date.", U.btn("Add meal", () => mealDialog(key), { kind: "sm" })))));
}
