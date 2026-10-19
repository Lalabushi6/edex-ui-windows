// Interface sound effects via Web Audio. Buffers are decoded lazily and
// cached; playback is skipped entirely while audio is disabled.
import * as settings from "./settings.js";

const SOUNDS = ["alarm", "denied", "error", "expand", "folder", "granted", "info", "keyboard", "panels", "scan", "stdin", "stdout", "theme"];
const GAIN = { stdin: 0.35, stdout: 0.3, keyboard: 0.6, scan: 0.5, theme: 0.6 };

let ctx = null;
const buffers = new Map();
const loading = new Map();
const lastPlayed = new Map();

function load(name) {
  if (buffers.has(name)) return Promise.resolve(buffers.get(name));
  if (loading.has(name)) return loading.get(name);
  const p = fetch(`assets/audio/${name}.wav`)
    .then((r) => r.arrayBuffer())
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => { buffers.set(name, buf); return buf; })
    .catch(() => null)
    .finally(() => loading.delete(name));
  loading.set(name, p);
  return p;
}

export async function play(name) {
  if (!settings.get("audioEnabled") || !SOUNDS.includes(name)) return;
  if ((name === "stdin" || name === "stdout") && !settings.get("audioFeedback")) return;
  // Rapid repeats (e.g. key-repeat) would stack into noise.
  const now = performance.now();
  if (now - (lastPlayed.get(name) || 0) < 45) return;
  lastPlayed.set(name, now);
  try {
    ctx = ctx || new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const buffer = await load(name);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = (settings.get("audioVolume") / 100) * (GAIN[name] ?? 0.8);
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    source.start();
  } catch (_) { /* audio is decorative */ }
}
