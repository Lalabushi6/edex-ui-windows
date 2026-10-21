// Lyrics widget: synced lyrics for whatever is playing — eDEX's own player,
// or another app's (Spotify, a browser …) through Windows' Now playing.
// Off by default (Settings → Layout → Widgets).
import { emit } from "../core/bus.js";
import { poll } from "../core/poll.js";
import { player } from "../media/player.js";
import { createLyricsView } from "../media/lyrics.js";
import { onNowPlaying, livePosition, appName } from "../shell/nowplaying.js";
import { defineWidget } from "./registry.js";

defineWidget({
  id: "lyrics",
  order: 2.6,
  title: "Lyrics",
  column: "right",
  defaultHidden: true,
  create(panel) {
    const p = player();
    const view = createLyricsView({ className: "ly-widget" });
    view.el.addEventListener("dblclick", () => emit("open-media"));
    panel.body.append(view.el);
    let sys = null;
    const source = () => {
      if (p.current && (p.playing || !sys)) {
        const it = p.current;
        return { kind: "player", track: { title: it.title, artist: it.artist || "", album: it.album || "", duration: Number.isFinite(p.el.duration) ? p.el.duration : 0, path: it.path }, pos: p.el.currentTime };
      }
      if (sys) return { kind: "system", track: { title: sys.title, artist: sys.artist, album: sys.album, duration: sys.duration }, pos: livePosition(sys) };
      return null;
    };
    const refresh = () => {
      const s = source();
      view.setTrack(s?.track || null);
      panel.setSub(s ? (s.kind === "player" ? "EDEX PLAYER" : appName(sys.app).toUpperCase()) : "");
      if (s) view.tick(s.pos);
    };
    const offSys = onNowPlaying((s) => { sys = s; refresh(); });
    for (const t of ["change", "state"]) p.addEventListener(t, refresh);
    const ticker = poll(() => { const s = source(); if (s) view.tick(s.pos); }, 300, { fixed: true });
    refresh();
    return {
      destroy() {
        offSys();
        ticker.stop();
        for (const t of ["change", "state"]) p.removeEventListener(t, refresh);
      }
    };
  }
});
