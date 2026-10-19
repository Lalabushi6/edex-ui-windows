// Shared, visibility- and power-aware scheduler for everything that refreshes.
//
//  - One timer drives every poller; due times snap to a 250 ms grid so
//    updates from different widgets land in the same frame instead of
//    waking the page dozens of times a second.
//  - Nothing runs while the window is hidden, minimised or fully covered.
//  - Intervals scale with the performance profile (Performance / Balanced /
//    Eco, or Auto: Eco on battery) and stretch further while eDEX is not the
//    focused window.
const GRID = 250;
const PROFILES = {
  performance: { interval: 0.75, fps: 30 },
  balanced: { interval: 1, fps: 24 },
  eco: { interval: 2.5, fps: 10 }
};

const pollers = new Set();
const listeners = new Set();
let windowVisible = true;
let windowFocused = true;
let onBattery = false;
let profileSetting = "auto";
let throttleUnfocused = true;
let timer = null;
let nextAt = Infinity;

const isActive = () => windowVisible && !document.hidden;

export function profile() {
  const name = profileSetting === "auto" ? (onBattery ? "eco" : "balanced") : profileSetting;
  return { name, ...(PROFILES[name] || PROFILES.balanced) };
}

function factor() {
  return profile().interval * (throttleUnfocused && !windowFocused ? 2 : 1);
}

// Frames per second for animations (globe, visualizer) under the current
// profile; quartered while eDEX is in the background.
export function animationFps(max = 30) {
  const fps = Math.min(max, profile().fps);
  return throttleUnfocused && !windowFocused ? Math.max(4, Math.round(fps / 3)) : fps;
}

export function onSchedulingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const p of pollers) p.reschedule();
  arm();
  for (const fn of listeners) { try { fn(); } catch (_) {} }
}

export function configure({ profile: name, throttle, battery } = {}) {
  if (name !== undefined) profileSetting = name;
  if (throttle !== undefined) throttleUnfocused = throttle;
  if (battery !== undefined) onBattery = battery;
  changed();
}

export function setWindowVisible(visible, focused = visible) {
  const was = isActive();
  windowVisible = visible;
  const focusChanged = focused !== windowFocused;
  windowFocused = focused;
  if (!was && isActive()) { for (const p of pollers) p.due = 0; }
  if (focusChanged || was !== isActive()) changed();
  else arm();
}

document.addEventListener("visibilitychange", () => {
  if (isActive()) for (const p of pollers) p.due = 0;
  arm();
  for (const fn of listeners) { try { fn(); } catch (_) {} }
});

function arm() {
  let earliest = Infinity;
  const active = isActive();
  for (const p of pollers) {
    if (p.busy || (!active && !p.runHidden)) continue;
    if (p.due < earliest) earliest = p.due;
  }
  if (earliest === Infinity) { clearTimeout(timer); timer = null; nextAt = Infinity; return; }
  const at = Math.max(Date.now(), Math.ceil(earliest / GRID) * GRID);
  if (timer && at >= nextAt) return;
  clearTimeout(timer);
  nextAt = at;
  timer = setTimeout(tick, Math.max(0, at - Date.now()));
}

function tick() {
  timer = null;
  nextAt = Infinity;
  const now = Date.now() + 5;
  const active = isActive();
  for (const p of pollers) {
    if (p.busy || p.due > now) continue;
    if (!active && !p.runHidden) continue;
    p.run();
  }
  arm();
}

export function poll(fn, intervalMs, { immediate = true, runHidden = false, fixed = false } = {}) {
  const p = {
    busy: false,
    due: immediate ? 0 : Date.now() + intervalMs,
    runHidden,
    interval: intervalMs,
    effective() { return fixed ? this.interval : this.interval * factor(); },
    reschedule() { if (!this.busy && this.due) this.due = Math.min(this.due, Date.now() + this.effective()); },
    async run() {
      this.busy = true;
      try { await fn(); } catch (_) { /* widgets render their own error state */ }
      this.busy = false;
      this.due = Date.now() + this.effective();
      arm();
    },
    kick() { this.due = 0; arm(); },
    stop() { pollers.delete(p); arm(); },
    setInterval(ms) { this.interval = ms; this.due = Date.now() + this.effective(); arm(); }
  };
  pollers.add(p);
  arm();
  return p;
}

export function appActive() {
  return isActive();
}

export function appFocused() {
  return windowFocused;
}
