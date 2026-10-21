// System-wide "Now playing": whatever app reports to Windows' media controls
// (Spotify, browsers, VLC …), read through the secondary native helper.
// eDEX's own player is left out; it has its own UI. A source narrows it to
// one kind of player (the media player's Spotify view uses "spotify").
"use strict";

const { handle } = require("./util");
const { cached } = require("../lib/cache");

const SKIP = "edex|electron";
const SOURCES = { spotify: "spotify" };
const ACTIONS = new Set(["toggle", "play", "pause", "next", "prev", "seek"]);

function registerNowPlaying({ aux }) {
  let art = { key: "", url: null };
  const artKey = (s) => (s ? `${s.app}|${s.title}|${s.artist}|${s.album}` : "");
  const args = (source) => (SOURCES[source] ? { skip: SKIP, match: SOURCES[source], only: true } : { skip: SKIP });

  const reader = (source) => cached(async () => {
    let s = null;
    try { s = await aux.call("nowPlaying", args(source), 6000); } catch (_) { return null; }
    if (!s || (!s.title && !s.artist)) return null;
    return { ...s, artKey: s.hasArt ? artKey(s) : "" };
  }, 900);
  const readers = { "": reader(""), spotify: reader("spotify") };
  const current = (source) => (readers[source] || readers[""])();

  handle("nowplaying:get", (_e, source) => current(typeof source === "string" ? source : ""));

  // Album art is fetched once per track and kept until the track changes.
  handle("nowplaying:art", async (_e, key, source) => {
    if (typeof key !== "string" || !key) return null;
    if (art.key === key) return art.url;
    let s = null;
    try { s = await aux.call("nowPlaying", { ...args(source), art: true }, 8000); } catch (_) { return null; }
    if (!s || artKey(s) !== key) return null;
    art = { key, url: typeof s.art === "string" ? s.art : null };
    return art.url;
  });

  handle("nowplaying:control", async (_e, action, opts = {}) => {
    if (!ACTIONS.has(action)) throw new Error("Unknown media action");
    const a = { ...args(opts.source), action, app: typeof opts.app === "string" ? opts.app.slice(0, 256) : "" };
    if (action === "seek") a.position = Math.max(0, Number(opts.position) || 0);
    const ok = await aux.call("mediaControl", a, 6000);
    for (const r of Object.values(readers)) r.invalidate();
    return ok;
  });
}

module.exports = { registerNowPlaying };
