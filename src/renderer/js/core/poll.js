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

// Calm when idle: after a minute without keyboard or mouse input in eDEX,
// animations (globe, effects, visualizer) and panel refreshes slow to the
// Eco pace until the next input, which brings everything back at once.
// Something that should stay smooth while you just watch (music playing, the
// idle screen) holds it off. Only the main window turns this on (initCalm).
const CALM_AFTER_MS = 60000;
let calm = false;
let calmOn = false;
let calmTimer = null;
let lastInputAt = 0;
const calmHolds = new Set();

function armCalm() {
  clearTimeout(calmTimer);
  if (!calmOn) return;
  calmTimer = setTimeout(() => {
    if (!calmOn || calmHolds.size) return;
    calm = true;
    changed();
  }, CALM_AFTER_MS);
}

function wake() {
  const now = Date.now();
  if (!calm && now - lastInputAt < 1000) return; // pointer moves come fast
  lastInputAt = now;
  if (calm) { calm = false; changed(); }
  armCalm();
}

export function initCalm(enabled = true) {
  if (!calmOn && enabled) {
    for (const t of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]) window.addEventListener(t, wake, { capture: true, passive: true });
  }
  setCalmEnabled(enabled);
}

export function setCalmEnabled(on) {
  calmOn = !!on;
  if (!calmOn && calm) { calm = false; changed(); }
  armCalm();
}

// reason: e.g. "media" while music plays; on: hold calm off, off: release.
export function holdCalm(reason, on) {
  if (on) {
    calmHolds.add(reason);
    if (calm) { calm = false; changed(); }
    clearTimeout(calmTimer);
  } else if (calmHolds.delete(reason) && !calmHolds.size) {
    armCalm();
  }
}

// The benchmark measures the calm state on purpose.
export function forceCalm(on) {
  if (calm === !!on) return;
  calm = !!on;
  changed();
}

// Game mode: while a game is in front (and eDEX isn't focused) nothing
// refreshes or animates.
let gameMode = false;
const isActive = () => windowVisible && !document.hidden && !(gameMode && !windowFocused);

export function setGameMode(on) {
  const was = isActive();
  gameMode = !!on;
  if (!was && isActive()) for (const p of pollers) p.due = 0;
  if (was !== isActive()) changed();
}

export function profile() {
  const name = profileSetting === "auto" ? (onBattery ? "eco" : "balanced") : profileSetting;
  return { name, ...(PROFILES[name] || PROFILES.balanced) };
}

function factor() {
  const base = calm ? Math.max(profile().interval, PROFILES.eco.interval) : profile().interval;
  return base * (throttleUnfocused && !windowFocused ? 2 : 1);
}

// Frames per second for animations (globe, visualizer) under the current
// profile; the Eco rate while calm (idle); a third while eDEX is in the
// background.
export function animationFps(max = 30) {
  let fps = Math.min(max, profile().fps);
  if (calm) fps = Math.min(fps, PROFILES.eco.fps);
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
