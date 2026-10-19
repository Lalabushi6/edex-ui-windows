// Visibility-aware polling. Nothing polls while the window is hidden or
// minimised (the common state for an overlay), and everything refreshes
// immediately when it comes back.
const pollers = new Set();
let windowVisible = true;

const isActive = () => windowVisible && !document.hidden;

export function setWindowVisible(visible) {
  const was = isActive();
  windowVisible = visible;
  if (!was && isActive()) for (const p of pollers) p.kick();
}

document.addEventListener("visibilitychange", () => {
  if (isActive()) for (const p of pollers) p.kick();
});

export function poll(fn, intervalMs, { immediate = true, runHidden = false } = {}) {
  let timer = null;
  let busy = false;
  let stopped = false;
  let interval = intervalMs;

  const schedule = () => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(run, interval);
  };
  async function run() {
    if (stopped) return;
    if (busy || (!runHidden && !isActive())) { schedule(); return; }
    busy = true;
    try { await fn(); } catch (_) { /* individual widgets render their own error state */ }
    busy = false;
    schedule();
  }
  const p = {
    kick: () => { clearTimeout(timer); run(); },
    stop: () => { stopped = true; clearTimeout(timer); pollers.delete(p); },
    setInterval: (ms) => { interval = ms; schedule(); }
  };
  pollers.add(p);
  if (immediate) run();
  else schedule();
  return p;
}

export function appActive() {
  return isActive();
}
