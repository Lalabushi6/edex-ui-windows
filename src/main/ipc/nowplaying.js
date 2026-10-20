// System-wide "Now playing": whatever app reports to Windows' media controls
// (Spotify, browsers, VLC …), read through the secondary native helper.
// eDEX's own player is left out; it has its own UI.
"use strict";

const { handle } = require("./util");
const { cached } = require("../lib/cache");

const SKIP = "edex|electron";
const ACTIONS = new Set(["toggle", "play", "pause", "next", "prev", "seek"]);

function registerNowPlaying({ aux }) {
  let art = { key: "", url: null };
  const artKey = (s) => (s ? `${s.app}|${s.title}|${s.artist}|${s.album}` : "");

  const current = cached(async () => {
    let s = null;
    try { s = await aux.call("nowPlaying", { skip: SKIP }, 6000); } catch (_) { return null; }
    if (!s || (!s.title && !s.artist)) return null;
    return { ...s, artKey: s.hasArt ? artKey(s) : "" };
  }, 900);

  handle("nowplaying:get", () => current());

  // Album art is fetched once per track and kept until the track changes.
  handle("nowplaying:art", async (_e, key) => {
    if (typeof key !== "string" || !key) return null;
    if (art.key === key) return art.url;
    let s = null;
    try { s = await aux.call("nowPlaying", { skip: SKIP, art: true }, 8000); } catch (_) { return null; }
    if (!s || artKey(s) !== key) return null;
    art = { key, url: typeof s.art === "string" ? s.art : null };
    return art.url;
  });

  handle("nowplaying:control", async (_e, action, opts = {}) => {
    if (!ACTIONS.has(action)) throw new Error("Unknown media action");
    const args = { skip: SKIP, action, app: typeof opts.app === "string" ? opts.app.slice(0, 256) : "" };
    if (action === "seek") args.position = Math.max(0, Number(opts.position) || 0);
    const ok = await aux.call("mediaControl", args, 6000);
    current.invalidate();
    return ok;
  });
}

module.exports = { registerNowPlaying };
