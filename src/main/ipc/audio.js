// Per-app volume mixer and output device switching (Core Audio through the
// native helper).
"use strict";

const { handle, asString } = require("./util");

function registerAudio({ bridge, ownPids }) {
  // eDEX's own audio plays from a Chromium utility process; label it.
  const label = (list) => {
    const mine = new Set(ownPids());
    return list.map((s) => (mine.has(s.pid) ? { ...s, name: "eDEX-UI", own: true } : s));
  };

  handle("mixer:list", async () => label(await bridge.call("audioSessions", {}, 5000)));
  handle("mixer:set", async (_e, pid, opts = {}) => {
    const id = Math.round(Number(pid));
    if (!Number.isFinite(id) || id < -1) throw new Error("Invalid session");
    const level = opts.level === undefined ? -1 : Math.max(0, Math.min(100, Number(opts.level) || 0));
    const mute = opts.muted === undefined ? -1 : (opts.muted ? 1 : 0);
    return label(await bridge.call("audioSetSession", { pid: id, level, mute }, 5000));
  });
  handle("audio:devices", () => bridge.call("audioDevices", {}, 5000));
  handle("audio:setDefault", (_e, id) => bridge.call("audioSetDefault", { id: asString(id, "device id", 512) }, 5000));
}

module.exports = { registerAudio };
