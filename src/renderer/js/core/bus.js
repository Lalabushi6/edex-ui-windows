// App-wide event bus for loosely coupled modules (theme changes, navigation
// requests, "open this path in the explorer", etc.).
const target = new EventTarget();

export function emit(name, detail) {
  target.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, fn) {
  const listener = (event) => fn(event.detail);
  target.addEventListener(name, listener);
  return () => target.removeEventListener(name, listener);
}

// Resolves once the boot sequence has finished and the shell is on screen;
// heavy, non-essential work (the globe, the app index) waits for it.
let markBootedFn;
export const booted = new Promise((resolve) => { markBootedFn = resolve; });
export function markBooted() {
  markBootedFn();
}
