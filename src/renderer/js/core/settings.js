// Renderer mirror of the main-process settings store.
let state = {};
const watchers = new Map(); // key -> Set<fn>

function notify(key, value) {
  for (const fn of watchers.get(key) || []) {
    try { fn(value, key); } catch (e) { console.error(`settings watcher for ${key} failed`, e); }
  }
}

export async function loadSettings() {
  state = await window.edex.settings.get();
  window.edex.settings.onChange((changed) => {
    for (const [key, value] of Object.entries(changed)) {
      if (JSON.stringify(state[key]) === JSON.stringify(value)) continue;
      state[key] = value;
      notify(key, value);
    }
  });
  return state;
}

export function get(key) {
  return state[key];
}

// Optimistic: local watchers fire immediately, main validates and persists.
export function set(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(state[key]) === JSON.stringify(value)) continue;
    state[key] = value;
    notify(key, value);
  }
  return window.edex.settings.set(patch).catch((e) => console.error("settings save failed", e));
}

export function watch(keys, fn) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    if (!watchers.has(key)) watchers.set(key, new Set());
    watchers.get(key).add(fn);
  }
  return () => list.forEach((key) => watchers.get(key)?.delete(fn));
}
