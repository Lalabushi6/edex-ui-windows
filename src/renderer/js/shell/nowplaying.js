// System-wide "Now playing" (Spotify, browsers, VLC … anything that reports
// to Windows' media controls). One shared poller feeds every subscriber
// (the Media widget and the top bar); album art is fetched once per track.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import { popover, toast, cleanError } from "../core/ui.js";
import { formatTime } from "../media/player.js";

const api = window.edex;
const subscribers = new Set();
let state = null; // latest session, with fetchedAt
let poller = null;
const artCache = new Map(); // artKey -> data URL | null

// "Spotify.exe" → Spotify; "TheBrowserCompany.Arc_…!Arc" → Arc;
// "Microsoft.ZuneMusic_…!Microsoft.ZuneMusic" → Media Player.
const KNOWN = { zunemusic: "Media Player", zunevideo: "Films & TV", msedge: "Edge", chrome: "Chrome", firefox: "Firefox", spotify: "Spotify", vlc: "VLC", brave: "Brave", opera: "Opera" };
export function appName(id) {
  if (!id) return "";
  let s = String(id);
  if (s.includes("!")) s = s.split("!").pop();
  s = s.replace(/\.exe$/i, "").split(/[\\/]/).pop();
  if (s.includes(".")) s = s.split(".").pop();
  const known = KNOWN[s.toLowerCase().replace(/^microsoft/, "")];
  return known || (s.charAt(0).toUpperCase() + s.slice(1));
}

async function refresh() {
  let s = null;
  try { s = await api.nowPlaying.get(); } catch (_) {}
  state = s ? { ...s, fetchedAt: performance.now() } : null;
  for (const fn of subscribers) { try { fn(state); } catch (e) { console.error(e); } }
}

export function onNowPlaying(fn) {
  subscribers.add(fn);
  if (!poller) poller = poll(refresh, 2000);
  else fn(state);
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && poller) { poller.stop(); poller = null; }
  };
}

// Position now, extrapolated between polls while playing.
export function livePosition(s) {
  if (!s) return 0;
  let p = s.position || 0;
  if (s.status === "Playing") p += (performance.now() - s.fetchedAt) / 1000;
  return s.duration ? Math.min(p, s.duration) : p;
}

export async function artFor(key) {
  if (!key) return null;
  if (artCache.has(key)) return artCache.get(key);
  let url = null;
  try { url = await api.nowPlaying.art(key); } catch (_) {}
  if (artCache.size > 30) artCache.delete(artCache.keys().next().value);
  artCache.set(key, url);
  return url;
}

export async function control(action, opts = {}) {
  try {
    await api.nowPlaying.control(action, { app: state?.app, ...opts });
  } catch (e) {
    toast(cleanError(e), { level: "warn" });
  }
  setTimeout(() => poller?.kick(), 250);
}

// The transport block (art, titles, progress, controls) used by the widget
// and the top-bar popover. Returns { el, update(state), tick() }.
export function buildTransport({ compact = false } = {}) {
  const art = h("div", { class: "np-art" }, icon("audio"));
  const title = h("div", { class: "np-title ellipsis" });
  const artist = h("div", { class: "np-artist ellipsis" });
  const source = h("span", { class: "np-source" });
  const fill = h("i");
  const progress = h("div", { class: "np-progress", title: "Seek" }, fill);
  const cur = h("span");
  const dur = h("span");
  const btn = (name, label, onclick) => h("button", { class: "icon-btn", type: "button", title: label, onclick }, icon(name));
  const prev = btn("prev", "Previous", () => control("prev"));
  const play = btn("play", "Play / pause", () => control("toggle"));
  const next = btn("next", "Next", () => control("next"));
  const el = h("div", { class: `np np-system${compact ? " compact" : ""}` },
    h("div", { class: "np-top" }, art, h("div", { class: "np-text" }, title, artist)),
    progress,
    h("div", { class: "np-times" }, cur, dur),
    h("div", { class: "np-controls" }, prev, play, next, h("span", { class: "grow" }), source));
  let s = null;
  let artKey = "";

  progress.addEventListener("mousedown", (e) => {
    if (!s?.canSeek || !s.duration) return;
    const r = progress.getBoundingClientRect();
    control("seek", { position: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * s.duration });
  });

  const tick = () => {
    if (!s) return;
    const p = livePosition(s);
    setText(cur, s.duration ? formatTime(p) : "");
    setText(dur, s.duration ? formatTime(s.duration) : "");
    fill.style.width = `${s.duration ? (p / s.duration) * 100 : 0}%`;
  };

  const update = (next) => {
    s = next;
    if (!s) return;
    setText(title, s.title || "Unknown title");
    setText(artist, [s.artist, s.album].filter(Boolean).join(" — "));
    setText(source, appName(s.app).toUpperCase());
    play.replaceChildren(icon(s.status === "Playing" ? "pause" : "play"));
    prev.disabled = !s.canPrev;
    next.disabled = !s.canNext;
    play.disabled = !(s.canPlay || s.canPause);
    progress.classList.toggle("disabled", !s.canSeek);
    progress.hidden = !s.duration;
    if (s.artKey !== artKey) {
      artKey = s.artKey;
      art.replaceChildren(icon("audio"));
      if (artKey) {
        const want = artKey;
        artFor(want).then((url) => { if (url && artKey === want) art.replaceChildren(h("img", { src: url, alt: "" })); });
      }
    }
    tick();
  };
  return { el, update, tick };
}

// Top-bar popover with the full transport.
export function openNowPlayingPopover(anchor) {
  if (anchor.classList.contains("open")) return;
  anchor.classList.add("open");
  let off = null;
  let timer = null;
  popover(anchor, () => {
    const t = buildTransport();
    const empty = h("div", { class: "empty" }, "Nothing is playing in other apps");
    off = onNowPlaying((s) => { t.el.hidden = !s; empty.hidden = !!s; t.update(s); });
    timer = setInterval(() => t.tick(), 500);
    return h("div", { class: "np-pop" }, h("div", { class: "np-pop-title" }, icon("audio"), h("span", null, "NOW PLAYING")), t.el, empty);
  }, { className: "np-popover", onClose: () => { anchor.classList.remove("open"); off?.(); clearInterval(timer); } });
}
