// Synced lyrics view: finds lyrics for a track (a .lrc file beside it, or
// LRCLIB through the main process) and scrolls them line by line with the
// playback position. Used by the media player, the Spotify view and the
// Lyrics widget.
import { h, setText } from "../core/dom.js";
import { cleanError } from "../core/ui.js";

const api = window.edex;

const trackKey = (t) => (t?.title ? `${t.title}|${t.artist || ""}|${Math.round((t.duration || 0) / 5)}|${t.path || ""}` : "");

export function createLyricsView({ className = "" } = {}) {
  const lines = h("div", { class: "ly-lines" });
  const status = h("div", { class: "ly-status" });
  const scroller = h("div", { class: "ly-scroll" }, lines);
  const source = h("div", { class: "ly-source" });
  const el = h("div", { class: `lyrics ${className}` }, scroller, status, source);
  let data = null;
  let key = "";
  let cur = -1;
  let token = 0;

  const show = (msg) => {
    setText(status, msg || "");
    status.hidden = !msg;
  };

  const render = (r) => {
    lines.replaceChildren();
    lines.style.transform = "";
    cur = -1;
    data = null;
    setText(source, "");
    if (!r) return show("No lyrics found for this song");
    if (r.off) return show("Lyrics are off — Settings → Media");
    if (r.offline) return show("Lyrics need Outbound lookups — Settings → Privacy");
    if (r.error) return show(r.error);
    if (r.instrumental) return show("♪ Instrumental ♪");
    data = r;
    show("");
    if (r.synced?.length) {
      lines.append(...r.synced.map((l) => h("div", { class: "ly-line" }, l.text || "♪")));
      el.classList.add("synced");
    } else if (r.plain) {
      lines.append(...r.plain.split(/\r?\n/).map((l) => h("div", { class: "ly-line plain" }, l || " ")));
      el.classList.remove("synced");
    } else return show("No lyrics found for this song");
    setText(source, r.source === "file" ? "LYRICS · .LRC FILE" : "LYRICS · LRCLIB.NET");
  };

  return {
    el,
    // track: { title, artist, album, duration, path } | null
    async setTrack(track) {
      const k = trackKey(track);
      if (k === key) return;
      key = k;
      token++;
      lines.replaceChildren();
      data = null;
      setText(source, "");
      if (!k) { show("Nothing playing"); return; }
      show("Looking for lyrics…");
      const mine = token;
      let r;
      try { r = await api.lyrics.get({ title: track.title, artist: track.artist || "", album: track.album || "", duration: track.duration || 0, path: track.path || "" }); }
      catch (e) { r = { error: cleanError(e) }; }
      if (mine === token) render(r);
    },
    // Highlights the line being sung and keeps it centred.
    tick(position) {
      if (!data?.synced?.length || !Number.isFinite(position)) return;
      const s = data.synced;
      let i = -1;
      for (let lo = 0, hi = s.length - 1; lo <= hi;) {
        const mid = (lo + hi) >> 1;
        if (s[mid].t <= position + 0.25) { i = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (i === cur) return;
      lines.children[cur]?.classList.remove("on");
      cur = i;
      const line = lines.children[i];
      if (!line) { lines.style.transform = ""; return; }
      line.classList.add("on");
      const target = line.offsetTop + line.offsetHeight / 2 - scroller.clientHeight / 2;
      lines.style.transform = `translateY(${-Math.max(0, target)}px)`;
    },
    reset() { key = ""; }
  };
}
