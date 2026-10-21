// Synced lyrics for whatever is playing.
//
// A .lrc file next to a song wins; otherwise LRCLIB (lrclib.net, a free,
// community lyrics database) is asked by title, artist, album and duration.
// Lookups only happen while outbound lookups are on and lyrics are turned
// on, and answers (including "not found") are cached in lyrics-cache.json.
"use strict";

const fs = require("fs");
const path = require("path");
const { app, net } = require("electron");
const paths = require("../lib/paths");
const { handle } = require("./util");
const { JsonStore } = require("../lib/store");

const API = "https://lrclib.net/api";
const MAX_CACHE = 400;
const RETRY_MISS_MS = 7 * 86400000;

// "[01:02.34]line" (several stamps per line allowed) -> [{ t, text }].
function parseLrc(text) {
  const lines = [];
  let offset = 0;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) lines.push({ t: Number(s[1]) * 60 + Number(s[2].replace(":", ".")), text: words });
  }
  return lines.map((l) => ({ t: Math.max(0, l.t - offset), text: l.text })).sort((a, b) => a.t - b.t);
}

// Video-style titles ("Artist - Song (Official Video) [4K]") -> clean parts.
function tidy(title, artist) {
  let t = String(title || "").replace(/\s*[([][^)\]]*\b(official|lyrics?|audio|video|visuali[sz]er|hd|4k|remaster(ed)?|explicit|clean)\b[^)\]]*[)\]]/gi, "").trim();
  let a = String(artist || "").replace(/\s*-\s*topic$/i, "").trim();
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (dash && (!a || dash[1].toLowerCase().includes(a.toLowerCase()) || /vevo|records|music|official/i.test(a))) { a = dash[1]; t = dash[2]; }
  t = t.replace(/\s*[([]?\s*(feat\.?|ft\.?|featuring)\s.+$/i, "").replace(/\s*-\s*(\d{4}\s*)?remaster(ed)?.*$/i, "").trim();
  return { title: t, artist: a };
}

function registerLyrics({ settings }) {
  const cache = new JsonStore(path.join(app.getPath("userData"), "lyrics-cache.json"), { fallback: { entries: {} } });
  const entries = () => cache.data.entries || (cache.data.entries = {});
  const userAgent = `eDEX-UI/${app.getVersion()} (https://github.com/Lalabushi6/edex-ui-windows)`;

  async function get(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await net.fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: ctrl.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`LRCLIB answered ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  const shape = (r, source) => r && {
    synced: r.syncedLyrics ? parseLrc(r.syncedLyrics) : null,
    plain: r.plainLyrics || null,
    instrumental: !!r.instrumental,
    source
  };

  async function lookup({ title, artist, album, duration }) {
    const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
    const d = duration > 0 ? Math.round(duration) : undefined;
    if (title && artist) {
      const exact = await get(`${API}/get?${q({ track_name: title, artist_name: artist, album_name: album, duration: d })}`);
      if (exact) return exact;
    }
    const hits = await get(`${API}/search?${q(artist ? { track_name: title, artist_name: artist } : { q: title })}`);
    if (!Array.isArray(hits) || !hits.length) return null;
    // Prefer synced lyrics with a matching length.
    const near = (h) => (d && h.duration ? Math.abs(h.duration - d) : 0);
    return hits.filter((h) => !d || !h.duration || near(h) <= 6)
      .sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics) || near(a) - near(b))[0] || null;
  }

  // track: { title, artist, album, duration, path? }
  handle("lyrics:get", async (_e, track = {}) => {
    if (settings.get("lyrics") === false) return { off: true };
    // A sidecar .lrc next to a local file.
    if (typeof track.path === "string" && track.path && !/^https?:/i.test(track.path)) {
      try {
        const audio = await paths.forRead(track.path);
        const lrc = audio.replace(/\.[^.\\/]+$/, ".lrc");
        const text = await fs.promises.readFile(lrc, "utf8");
        const synced = parseLrc(text);
        return { synced: synced.length ? synced : null, plain: synced.length ? null : text.slice(0, 20000), instrumental: false, source: "file" };
      } catch (_) {}
    }
    if (settings.get("allowNetworkGeolocation") === false) return { offline: true };
    const clean = tidy(track.title, track.artist);
    if (!clean.title) return null;
    const album = typeof track.album === "string" ? track.album.slice(0, 200) : "";
    const duration = Number(track.duration) || 0;
    const key = `${clean.artist}|${clean.title}|${Math.round(duration / 5)}`.toLowerCase();
    const hit = entries()[key];
    if (hit && (hit.found || Date.now() - hit.at < RETRY_MISS_MS)) return hit.found ? hit.data : null;
    let r = null;
    try { r = await lookup({ title: clean.title.slice(0, 200), artist: clean.artist.slice(0, 200), album, duration }); } catch (e) { return { error: e.message || "Lyrics lookup failed" }; }
    const data = shape(r, "lrclib");
    entries()[key] = { at: Date.now(), found: !!data, data: data || null };
    const keys = Object.keys(entries());
    if (keys.length > MAX_CACHE) for (const k of keys.slice(0, keys.length - MAX_CACHE)) delete entries()[k];
    cache.save();
    return data;
  });

  return { flush: () => cache.flushSync() };
}

module.exports = { registerLyrics, parseLrc, tidy };
