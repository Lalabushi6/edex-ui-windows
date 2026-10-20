// Weather forecast and timer / stopwatch widgets.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll, appActive } from "../core/poll.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { toast, prompt, contextMenu } from "../core/ui.js";
import { on, emit } from "../core/bus.js";
import { defineWidget } from "./registry.js";

const api = window.edex;

// ── Weather ─────────────────────────────────────────────────────────────────
// WMO weather interpretation codes, as returned by Open-Meteo.
function describeWeather(code, day = true) {
  if (code === 0) return { text: day ? "Clear sky" : "Clear night", icon: day ? "sun" : "moon" };
  if (code === 1) return { text: "Mostly clear", icon: day ? "sun" : "moon" };
  if (code === 2) return { text: "Partly cloudy", icon: "cloud" };
  if (code === 3) return { text: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { text: "Fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { text: "Drizzle", icon: "rain" };
  if (code >= 61 && code <= 67) return { text: code >= 66 ? "Freezing rain" : "Rain", icon: "rain" };
  if (code >= 71 && code <= 77) return { text: "Snow", icon: "snow" };
  if (code >= 80 && code <= 82) return { text: "Rain showers", icon: "rain" };
  if (code === 85 || code === 86) return { text: "Snow showers", icon: "snow" };
  if (code >= 95) return { text: "Thunderstorm", icon: "storm" };
  return { text: "Unknown", icon: "cloud" };
}

defineWidget({
  id: "weather",
  order: 2.5,
  title: "Weather",
  column: "right",
  create(panel) {
    const nowIcon = h("span", { class: "wx-icon" });
    const temp = h("span", { class: "wx-temp" }, "--");
    const cond = h("span", { class: "wx-cond" }, "--");
    const detail = h("span", { class: "wx-detail muted" });
    const days = h("div", { class: "wx-days" });
    const body = h("div", { class: "wx" },
      h("div", { class: "wx-now" }, nowIcon, temp, h("div", { class: "wx-text" }, cond, detail)),
      days);
    const off = h("div", { class: "empty", hidden: true }, "Weather needs outbound lookups (Settings → Privacy)");
    panel.body.append(body, off);
    panel.tools.append(h("button", { class: "icon-btn sm", type: "button", title: "Refresh", onclick: () => p.kick() }, icon("refresh")));

    let last = null;
    const unit = () => settings.get("temperatureUnit");
    const render = () => {
      const w = last;
      const enabled = settings.get("allowNetworkGeolocation") !== false;
      body.hidden = !enabled || !w;
      off.hidden = enabled;
      if (!enabled) { panel.setSub(""); return; }
      if (!w) { panel.setSub("UNAVAILABLE"); return; }
      const c = w.current;
      const d = describeWeather(c.code, c.day);
      nowIcon.replaceChildren(icon(d.icon));
      setText(temp, fmt.temperature(c.temp, unit()));
      setText(cond, d.text.toUpperCase());
      setText(detail, `Feels ${fmt.temperature(c.feels, unit())} · ${Math.round(c.humidity)}% RH · ${Math.round(c.wind)} km/h`);
      panel.setSub(w.place || "");
      const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
      days.replaceChildren(...w.daily.slice(0, 4).map((day, i) => {
        const dd = describeWeather(day.code, true);
        const label = i === 0 ? "TODAY" : dayFmt.format(new Date(`${day.date}T12:00:00`)).toUpperCase();
        const deg = (v) => fmt.temperature(v, unit()).replace(/°[CF]$/, "°");
        return h("div", { class: "wx-day", title: `${dd.text}${day.rain !== null ? ` · ${day.rain}% chance of rain` : ""}` },
          h("span", { class: "label" }, label),
          icon(dd.icon),
          h("span", null, `${deg(day.max)} / ${deg(day.min)}`),
          h("span", { class: "muted" }, day.rain !== null ? `${day.rain}%` : ""));
      }));
    };
    const p = poll(async () => {
      last = settings.get("allowNetworkGeolocation") !== false ? await api.net.weather() : null;
      render();
    }, 20 * 60 * 1000);
    const unwatch = settings.watch(["allowNetworkGeolocation", "temperatureUnit"], (_v, key) => (key === "temperatureUnit" ? render() : p.kick()));
    return { destroy() { p.stop(); unwatch(); } };
  }
});

// ── Screen time ─────────────────────────────────────────────────────────────
// Focused-app time per day, tracked by the main process (see
// main/lib/screentime.js); stored only on this PC.
const hm = (s) => {
  const m = Math.round(s / 60);
  if (m < 1) return "<1m";
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

defineWidget({
  id: "screentime",
  order: 5.5,
  title: "Screen Time",
  column: "right",
  create(panel) {
    let offset = 0;
    const week = h("div", { class: "st-week" });
    const list = h("div", { class: "st-list" });
    const off = h("div", { class: "empty", hidden: true }, "Screen time is off (Settings → Privacy)");
    const dayBtn = h("button", { class: "icon-btn sm", type: "button", title: "Show yesterday" }, icon("back"));
    panel.tools.append(dayBtn);
    panel.body.append(week, list, off);

    const render = (d) => {
      off.hidden = d.enabled;
      week.hidden = list.hidden = !d.enabled;
      panel.setSub(`${offset ? "YESTERDAY" : "TODAY"} · ${hm(d.total)}`);
      const max = Math.max(1, ...d.week.map((w) => w.seconds));
      const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
      week.replaceChildren(...d.week.map((w) => {
        const date = new Date(`${w.day}T12:00:00`);
        return h("div", { class: `st-day${w.day === d.day ? " current" : ""}`, title: `${date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}: ${hm(w.seconds)}` },
          h("span", { class: "st-col" }, h("i", { style: { height: `${Math.max(3, (w.seconds / max) * 100)}%` } })),
          h("span", { class: "st-lbl" }, dayFmt.format(date)));
      }));
      const top = d.apps.slice(0, 6);
      const topMax = Math.max(1, top[0]?.seconds || 1);
      list.replaceChildren(...(top.length ? top.map((a) => {
        const over = a.limit && a.seconds >= a.limit;
        return h("div", {
          class: `st-row${over ? " over" : ""}`, dataset: { app: a.name },
          title: `${a.name}: ${hm(a.seconds)}${a.limit ? ` of ${hm(a.limit)} daily limit` : ""}`
        },
        h("span", { class: "st-name" }, a.name),
        h("span", { class: "st-bar" }, h("i", { style: { width: `${(a.seconds / topMax) * 100}%` } }),
          a.limit ? h("b", { class: "st-limit", style: { left: `${Math.min(100, (a.limit / topMax) * 100)}%` } }) : null),
        h("span", { class: "st-time" }, hm(a.seconds)));
      }) : [h("div", { class: "empty" }, offset ? "Nothing recorded yesterday" : "Counting — check back in a few minutes")]));
    };
    const setLimit = async (app) => {
      const current = (settings.get("screenTimeLimits") || {})[app];
      const value = await prompt({ title: `Daily limit: ${app}`, message: "Minutes a day (a notice when it's reached). Leave empty to remove the limit.", value: current ? String(current) : "" });
      if (value === null) return;
      const next = { ...(settings.get("screenTimeLimits") || {}) };
      const m = Math.round(Number(value));
      if (!value.trim()) delete next[app];
      else if (m >= 1 && m <= 1440) next[app] = m;
      else { toast("Enter 1–1440 minutes", { level: "warn" }); return; }
      settings.set({ screenTimeLimits: next });
      setTimeout(() => p.kick(), 300);
    };
    const p = poll(async () => render(await api.screenTime.get(offset)), 60000);
    dayBtn.addEventListener("click", () => {
      offset = offset ? 0 : 1;
      dayBtn.replaceChildren(icon(offset ? "forward" : "back"));
      dayBtn.title = offset ? "Show today" : "Show yesterday";
      p.kick();
    });
    const unwatch = settings.watch("screenTime", () => p.kick());
    panel.el.addEventListener("contextmenu", (e) => contextMenu(e, [
      e.target.closest?.(".st-row") && { label: `Daily limit for ${e.target.closest(".st-row").dataset.app}…`, icon: "bell", run: () => setLimit(e.target.closest(".st-row").dataset.app) },
      { label: settings.get("screenTime") !== false ? "Pause tracking" : "Resume tracking", icon: "timer", run: () => settings.set({ screenTime: settings.get("screenTime") === false }) },
      { label: "Clear history", icon: "trash", danger: true, run: async () => { await api.screenTime.clear(); p.kick(); toast("Screen time history cleared", { level: "ok" }); } }
    ]));
    return { destroy() { p.stop(); unwatch(); } };
  }
});

// ── Timer / stopwatch ───────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
function clockText(ms, tenths) {
  const total = Math.max(0, ms);
  const s = Math.floor(total / 1000);
  const hours = Math.floor(s / 3600);
  const base = `${hours ? `${hours}:` : ""}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return tenths ? `${base}.${Math.floor((total % 1000) / 100)}` : base;
}

// One countdown and one stopwatch shared by every mount of the widget, so
// they keep running if the widget is hidden or moved.
const state = {
  mode: "timer",
  timer: { duration: 5 * 60000, remaining: 5 * 60000, endsAt: 0, running: false, label: "" },
  watch: { elapsed: 0, startedAt: 0, running: false, laps: [] },
  pomo: { phase: "work", done: 0, duration: 0, remaining: 0, endsAt: 0, running: false }
};
const ALARM_ID = "edex-timer";
const POMO_ID = "edex-pomodoro";

// ── Pomodoro ────────────────────────────────────────────────────────────────
// Focus / short break cycles with a long break every N rounds. Breaks start
// on their own when a focus session ends; the next focus waits for the user.
const PHASES = { work: "Focus", break: "Short break", long: "Long break" };
const pomoMinutes = (phase) => Number(settings.get(phase === "work" ? "pomodoroWork" : phase === "long" ? "pomodoroLong" : "pomodoroBreak"))
  || { work: 25, break: 5, long: 15 }[phase];
const pomoRounds = () => Number(settings.get("pomodoroRounds")) || 4;

function pomoReset(phase = state.pomo.phase) {
  const p = state.pomo;
  p.phase = phase;
  p.duration = pomoMinutes(phase) * 60000;
  p.remaining = p.duration;
  p.running = false;
  api.alarm.clear(POMO_ID).catch(() => {});
}
function pomoStart() {
  const p = state.pomo;
  if (!p.duration || p.remaining <= 0) pomoReset();
  p.endsAt = Date.now() + p.remaining;
  p.running = true;
  api.alarm.set({ id: POMO_ID, inMs: p.remaining, label: PHASES[p.phase] }).catch(() => {});
}
function pomoPause() {
  const p = state.pomo;
  p.remaining = Math.max(0, p.endsAt - Date.now());
  p.running = false;
  api.alarm.clear(POMO_ID).catch(() => {});
}
function pomoNext(finished) {
  const p = state.pomo;
  if (p.phase === "work") {
    if (finished) p.done++;
    pomoReset(p.done > 0 && p.done % pomoRounds() === 0 ? "long" : "break");
    if (finished) pomoStart();
  } else {
    pomoReset("work");
  }
}
settings.watch(["pomodoroWork", "pomodoroBreak", "pomodoroLong"], () => {
  const p = state.pomo;
  if (!p.running && p.remaining === p.duration) { pomoReset(); emit("timer-changed"); }
});
settings.watch(["pomodoroRounds"], () => emit("timer-changed"));

// Module level so timers started from the launcher work (and ring) even when
// the Timer widget is hidden; a mounted widget re-renders on "timer-changed".
api.alarm.onFired(({ id }) => {
  if (id === POMO_ID) {
    const p = state.pomo;
    if (!p.running) return;
    const wasWork = p.phase === "work";
    pomoNext(true);
    sfx.play("alarm");
    if (wasWork) {
      toast(`Focus session done (${p.done} today) — ${PHASES[p.phase].toLowerCase()}, ${pomoMinutes(p.phase)} min`, { level: "ok", timeout: 8000 });
    } else {
      toast("Break over", { level: "ok", timeout: 15000, action: { label: "Start focus", run: () => { pomoStart(); emit("timer-changed"); } } });
    }
    emit("timer-changed");
    return;
  }
  if (id !== ALARM_ID) return;
  const t = state.timer;
  t.running = false;
  t.remaining = 0;
  sfx.play("alarm");
  toast(`${t.label || "Timer"} finished`, { level: "ok", timeout: 8000 });
  emit("timer-changed");
});
on("timer-start", ({ ms, label = "" } = {}) => {
  const t = state.timer;
  if (!(ms > 0)) return;
  t.duration = ms;
  t.remaining = ms;
  t.label = String(label).slice(0, 60);
  t.endsAt = Date.now() + ms;
  t.running = true;
  state.mode = "timer";
  api.alarm.set({ id: ALARM_ID, inMs: ms, label: t.label }).catch(() => {});
  toast(`Timer started: ${clockText(ms, false)}${t.label ? ` — ${t.label}` : ""}`, { level: "ok", timeout: 2200 });
  emit("timer-changed");
});
on("pomodoro-start", () => {
  const p = state.pomo;
  state.mode = "pomo";
  if (!p.running) {
    if (p.phase !== "work" || !p.duration || p.remaining <= 0) pomoReset("work");
    pomoStart();
  }
  toast(`Focus session: ${pomoMinutes("work")} min`, { level: "ok", timeout: 2200 });
  emit("timer-changed");
});
on("stopwatch-start", () => {
  const w = state.watch;
  if (!w.running) { w.startedAt = Date.now(); w.running = true; }
  state.mode = "watch";
  emit("timer-changed");
});

defineWidget({
  id: "timer",
  order: 8,
  title: "Timer",
  column: "left",
  create(panel) {
    const display = document.createTextNode("00:00");
    const face = h("div", { class: "timer-face" }, display);
    const progress = h("div", { class: "bar timer-bar" }, h("i"));
    const modeBtns = {
      timer: h("button", { class: "chip", type: "button", onclick: () => setMode("timer") }, "Timer"),
      watch: h("button", { class: "chip", type: "button", onclick: () => setMode("watch") }, "Stopwatch"),
      pomo: h("button", { class: "chip", type: "button", title: "Pomodoro focus cycles", onclick: () => setMode("pomo") }, "Focus")
    };
    const presets = h("div", { class: "timer-presets" },
      ...[1, 5, 10, 25].map((m) => h("button", { class: "chip", type: "button", onclick: () => setDuration(m * 60000) }, `${m}m`)),
      h("button", { class: "chip", type: "button", title: "Custom duration", onclick: () => custom() }, "…"));
    const startBtn = h("button", { class: "btn sm primary", type: "button", onclick: () => toggle() }, "Start");
    const secondBtn = h("button", { class: "btn sm", type: "button", onclick: () => second() }, "Reset");
    const laps = h("div", { class: "timer-laps" });
    const pomoPhase = h("span", { class: "pomo-phase" });
    const pomoDots = h("span", { class: "pomo-dots" });
    const pomoInfo = h("div", { class: "pomo-info", title: "Right-click to change lengths" }, pomoPhase, pomoDots);
    panel.body.append(
      h("div", { class: "timer-modes" }, modeBtns.timer, modeBtns.watch, modeBtns.pomo),
      face, progress, presets, pomoInfo,
      h("div", { class: "timer-actions" }, startBtn, secondBtn),
      laps);

    let frame = null;
    const now = () => Date.now();
    const timerLeft = () => (state.timer.running ? Math.max(0, state.timer.endsAt - now()) : state.timer.remaining);
    const watchElapsed = () => state.watch.elapsed + (state.watch.running ? now() - state.watch.startedAt : 0);

    const pomoLeft = () => (state.pomo.running ? Math.max(0, state.pomo.endsAt - now()) : state.pomo.remaining);

    function render() {
      const isTimer = state.mode === "timer";
      const isPomo = state.mode === "pomo";
      modeBtns.timer.classList.toggle("active", isTimer);
      modeBtns.watch.classList.toggle("active", state.mode === "watch");
      modeBtns.pomo.classList.toggle("active", isPomo);
      presets.hidden = !isTimer;
      progress.hidden = state.mode === "watch";
      laps.hidden = state.mode !== "watch";
      pomoInfo.hidden = !isPomo;
      panel.el.classList.toggle("pomo-break", isPomo && state.pomo.phase !== "work");
      const t = state.timer;
      const w = state.watch;
      if (isPomo) {
        const p = state.pomo;
        if (!p.duration) pomoReset("work");
        const left = pomoLeft();
        const text = clockText(left + (p.running ? 999 : 0), false);
        if (display.data !== text) display.data = text;
        progress.firstElementChild.style.width = `${p.duration ? (left / p.duration) * 100 : 0}%`;
        setText(startBtn, p.running ? "Pause" : (left > 0 && left < p.duration ? "Resume" : "Start"));
        setText(secondBtn, "Skip");
        face.classList.remove("done");
        const rounds = pomoRounds();
        const filled = p.phase === "long" ? rounds : p.done % rounds;
        setText(pomoPhase, p.phase === "work" ? `${PHASES.work} ${(p.done % rounds) + 1}/${rounds}` : PHASES[p.phase]);
        if (pomoDots.childElementCount !== rounds || pomoDots.dataset.filled !== String(filled)) {
          pomoDots.dataset.filled = String(filled);
          pomoDots.replaceChildren(...Array.from({ length: rounds }, (_, i) => h("i", { class: i < filled ? "on" : "" })));
        }
        panel.setSub(p.running ? `ENDS ${new Date(p.endsAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : (p.done ? `${p.done} DONE` : ""));
      } else if (isTimer) {
        const left = timerLeft();
        if (t.running && left <= 0) { t.running = false; t.remaining = 0; }
        const text = clockText(left + (t.running ? 999 : 0), false);
        if (display.data !== text) display.data = text;
        progress.firstElementChild.style.width = `${t.duration ? (left / t.duration) * 100 : 0}%`;
        setText(startBtn, t.running ? "Pause" : (left > 0 && left < t.duration ? "Resume" : "Start"));
        setText(secondBtn, "Reset");
        face.classList.toggle("done", !t.running && left === 0);
        panel.setSub(t.running ? `ENDS ${new Date(t.endsAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : (t.label || ""));
      } else {
        const text = clockText(watchElapsed(), true);
        if (display.data !== text) display.data = text;
        setText(startBtn, w.running ? "Pause" : (w.elapsed ? "Resume" : "Start"));
        setText(secondBtn, w.running ? "Lap" : "Reset");
        face.classList.remove("done");
        panel.setSub(w.laps.length ? `${w.laps.length} LAPS` : "");
      }
      schedule();
    }
    // Repaints only while something is counting and eDEX is on screen; the
    // stopwatch shows tenths, the countdown whole seconds.
    function schedule() {
      clearTimeout(frame);
      frame = null;
      const running = state.mode === "watch" ? state.watch.running : state.mode === "pomo" ? state.pomo.running : state.timer.running;
      if (!running || !appActive()) return;
      frame = setTimeout(render, state.mode === "watch" ? 100 : 250);
    }
    const wake = poll(render, 5000, { fixed: true });

    function renderLaps() {
      laps.replaceChildren(...state.watch.laps.slice(-6).reverse().map((lap) => h("div", { class: "timer-lap" },
        h("span", { class: "label" }, `LAP ${lap.n}`), h("span", null, clockText(lap.split, true)), h("span", { class: "muted" }, clockText(lap.total, true)))));
    }
    function setMode(mode) { state.mode = mode; render(); }
    function setDuration(ms) {
      const t = state.timer;
      t.duration = ms;
      t.remaining = ms;
      if (t.running) { t.endsAt = now() + ms; api.alarm.set({ id: ALARM_ID, inMs: ms, label: t.label }).catch(() => {}); }
      render();
    }
    async function custom() {
      const value = await prompt({ title: "Timer", message: "Duration: minutes, mm:ss or h:mm:ss. Add a label after a space, e.g. \"25 Focus\".", value: "" });
      if (!value) return;
      const [spec, ...rest] = value.trim().split(/\s+/);
      const parts = spec.split(":").map(Number);
      if (parts.some((n) => !Number.isFinite(n) || n < 0)) { toast("Could not read that duration", { level: "warn" }); return; }
      const ms = parts.length === 1 ? parts[0] * 60000 : parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
      if (ms <= 0 || ms > 7 * 86400000) { toast("Duration must be between 1 second and 7 days", { level: "warn" }); return; }
      state.timer.label = rest.join(" ").slice(0, 60);
      setDuration(ms);
    }
    async function pomoLengths() {
      const cur = ["pomodoroWork", "pomodoroBreak", "pomodoroLong", "pomodoroRounds"].map((k) => settings.get(k));
      const value = await prompt({ title: "Focus timer", message: "Focus / short break / long break minutes / rounds before a long break, e.g. \"25/5/15/4\".", value: cur.join("/") });
      if (!value) return;
      const n = value.split(/[\s/,]+/).map(Number);
      if (n.length < 3 || n.some((x) => !Number.isFinite(x) || x <= 0)) { toast("Could not read those lengths", { level: "warn" }); return; }
      settings.set({ pomodoroWork: n[0], pomodoroBreak: n[1], pomodoroLong: n[2], ...(n[3] ? { pomodoroRounds: n[3] } : {}) });
    }
    function toggle() {
      if (state.mode === "pomo") {
        if (state.pomo.running) pomoPause(); else pomoStart();
      } else if (state.mode === "timer") {
        const t = state.timer;
        if (t.running) {
          t.remaining = timerLeft();
          t.running = false;
          api.alarm.clear(ALARM_ID).catch(() => {});
        } else {
          if (t.remaining <= 0) t.remaining = t.duration;
          t.endsAt = now() + t.remaining;
          t.running = true;
          api.alarm.set({ id: ALARM_ID, inMs: t.remaining, label: t.label }).catch(() => {});
        }
      } else {
        const w = state.watch;
        if (w.running) { w.elapsed = watchElapsed(); w.running = false; } else { w.startedAt = now(); w.running = true; }
      }
      render();
    }
    function second() {
      if (state.mode === "pomo") {
        pomoNext(false);
      } else if (state.mode === "timer") {
        const t = state.timer;
        t.running = false;
        t.remaining = t.duration;
        api.alarm.clear(ALARM_ID).catch(() => {});
      } else {
        const w = state.watch;
        if (w.running) {
          const total = watchElapsed();
          const prev = w.laps.length ? w.laps[w.laps.length - 1].total : 0;
          w.laps.push({ n: w.laps.length + 1, split: total - prev, total });
          if (w.laps.length > 99) w.laps.shift();
        } else {
          w.elapsed = 0;
          w.laps = [];
        }
        renderLaps();
      }
      render();
    }
    panel.el.addEventListener("contextmenu", (e) => contextMenu(e, [
      { label: "Set timer…", icon: "timer", run: () => { setMode("timer"); custom(); } },
      { label: "Focus lengths…", icon: "tomato", run: () => { setMode("pomo"); pomoLengths(); } },
      state.mode === "pomo" && { label: "Reset focus cycle", icon: "refresh", run: () => { state.pomo.done = 0; pomoReset("work"); render(); } },
      state.mode === "watch" && state.watch.laps.length && { label: "Copy laps", icon: "copy", run: () => api.clip.copy(state.watch.laps.map((l) => `Lap ${l.n}\t${clockText(l.split, true)}\t${clockText(l.total, true)}`).join("\n")) }
    ]));
    renderLaps();
    render();
    const offChanged = on("timer-changed", () => { renderLaps(); render(); });
    return { destroy() { clearTimeout(frame); wake.stop(); offChanged(); } };
  }
});
