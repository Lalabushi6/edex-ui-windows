// Game mode: while a game is in front, eDEX goes quiet. Animations and
// refreshes pause, the HUD on other displays hides, the screen saver and the
// live wallpaper hold back, and (optionally) notifications wait in the
// notification centre.
//
// "A game" is a program running from a game in the library (Steam, Epic,
// Xbox) or anything Windows reports as running full-screen Direct3D.
// Setting gameMode: "auto" (detect), "on" (always), "off".
"use strict";

const { EventEmitter } = require("events");

const CHECK_MS = 4000;
const EXIT_AFTER = 2; // checks without a game before game mode ends

class GameMode extends EventEmitter {
  constructor({ settings, bridge, games, ownPids }) {
    super();
    this.settings = settings;
    this.bridge = bridge;
    this.games = games;
    this.ownPids = ownPids;
    this.active = false;
    this.name = "";
    this.misses = 0;
    this.timer = setInterval(() => this.check(), CHECK_MS);
    settings.on("change", (c) => { if ("gameMode" in c) this.check(); });
  }

  async check() {
    if (this.checking) return;
    this.checking = true;
    try {
      const mode = this.settings.get("gameMode");
      if (mode === "off") return this.set(false, "");
      if (mode === "on") return this.set(true, "");
      let name = "";
      let found = false;
      const fg = await this.bridge.call("foreground", {}, 3000).catch(() => null);
      if (fg && !this.ownPids().includes(fg.pid)) {
        const g = this.games.match(fg.exe);
        if (g) { found = true; name = g.name; }
        else {
          const st = await this.bridge.call("saverBlocked", { exclude: this.ownPids() }, 3000).catch(() => null);
          if (st?.state === 3) { found = true; name = fg.desc || ""; } // QUNS_RUNNING_D3D_FULL_SCREEN
        }
      }
      if (found) { this.misses = 0; this.set(true, name); }
      else if (this.active && ++this.misses >= EXIT_AFTER) this.set(false, "");
    } finally {
      this.checking = false;
    }
  }

  set(active, name) {
    if (active === this.active && (!active || name === this.name)) return;
    this.active = active;
    this.name = active ? name : "";
    this.misses = 0;
    this.emit("change", { active: this.active, name: this.name });
  }

  dispose() {
    clearInterval(this.timer);
  }
}

module.exports = { GameMode };
