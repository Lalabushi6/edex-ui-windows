// Weather forecast and timer / stopwatch widgets.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll, appActive } from "../core/poll.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { toast, prompt, contextMenu } from "../core/ui.js";
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
  watch: { elapsed: 0, startedAt: 0, running: false, laps: [] }
};
const ALARM_ID = "edex-timer";
let alarmWired = false;

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
      watch: h("button", { class: "chip", type: "button", onclick: () => setMode("watch") }, "Stopwatch")
    };
    const presets = h("div", { class: "timer-presets" },
      ...[1, 5, 10, 25].map((m) => h("button", { class: "chip", type: "button", onclick: () => setDuration(m * 60000) }, `${m}m`)),
      h("button", { class: "chip", type: "button", title: "Custom duration", onclick: () => custom() }, "…"));
    const startBtn = h("button", { class: "btn sm primary", type: "button", onclick: () => toggle() }, "Start");
    const secondBtn = h("button", { class: "btn sm", type: "button", onclick: () => second() }, "Reset");
    const laps = h("div", { class: "timer-laps" });
    panel.body.append(
      h("div", { class: "timer-modes" }, modeBtns.timer, modeBtns.watch),
      face, progress, presets,
      h("div", { class: "timer-actions" }, startBtn, secondBtn),
      laps);

    if (!alarmWired) {
      alarmWired = true;
      api.alarm.onFired(({ id }) => {
        if (id !== ALARM_ID) return;
        const t = state.timer;
        t.running = false;
        t.remaining = 0;
        sfx.play("alarm");
        toast(`${t.label || "Timer"} finished`, { level: "ok", timeout: 8000 });
      });
    }

    let frame = null;
    const now = () => Date.now();
    const timerLeft = () => (state.timer.running ? Math.max(0, state.timer.endsAt - now()) : state.timer.remaining);
    const watchElapsed = () => state.watch.elapsed + (state.watch.running ? now() - state.watch.startedAt : 0);

    function render() {
      const isTimer = state.mode === "timer";
      modeBtns.timer.classList.toggle("active", isTimer);
      modeBtns.watch.classList.toggle("active", !isTimer);
      presets.hidden = !isTimer;
      progress.hidden = !isTimer;
      laps.hidden = isTimer;
      const t = state.timer;
      const w = state.watch;
      if (isTimer) {
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
      const running = state.mode === "timer" ? state.timer.running : state.watch.running;
      if (!running || !appActive()) return;
      frame = setTimeout(render, state.mode === "timer" ? 250 : 100);
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
    function toggle() {
      if (state.mode === "timer") {
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
      if (state.mode === "timer") {
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
      state.mode === "watch" && state.watch.laps.length && { label: "Copy laps", icon: "copy", run: () => api.clip.copy(state.watch.laps.map((l) => `Lap ${l.n}\t${clockText(l.split, true)}\t${clockText(l.total, true)}`).join("\n")) }
    ]));
    renderLaps();
    render();
    return { destroy() { clearTimeout(frame); wake.stop(); } };
  }
});
