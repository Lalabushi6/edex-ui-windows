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
