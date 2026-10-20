// "Now playing" widget: compact transport for the built-in media player, or
// for whatever another app is playing (Spotify, a browser …) when the
// built-in player is idle.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as fmt from "../core/format.js";
import { emit } from "../core/bus.js";
import { player, formatTime } from "../media/player.js";
import { onNowPlaying, buildTransport, appName } from "../shell/nowplaying.js";
import { defineWidget } from "./registry.js";

defineWidget({
  id: "media",
  order: 2.5,
  title: "Media",
  column: "right",
  create(panel) {
    const p = player();
    const art = h("div", { class: "np-art" });
    const title = h("div", { class: "np-title ellipsis" });
    const artist = h("div", { class: "np-artist ellipsis" });
    const fill = h("i");
    const progress = h("div", { class: "np-progress", title: "Seek" }, fill);
    const cur = h("span");
    const dur = h("span");
    const btn = (name, label, onclick) => h("button", { class: "icon-btn", type: "button", title: label, onclick }, icon(name));
    const playBtn = btn("play", "Play / pause", () => p.toggle());
    const openPlayer = () => emit("open-media");
    const body = h("div", { class: "np" },
      h("div", { class: "np-top", onclick: openPlayer, title: "Open the media player" }, art, h("div", { class: "np-text" }, title, artist)),
      progress,
      h("div", { class: "np-times" }, cur, dur),
      h("div", { class: "np-controls" }, btn("prev", "Previous", () => p.prev()), playBtn, btn("next", "Next", () => p.next()),
        h("span", { class: "grow" }), btn("external", "Open player", openPlayer)));
    const system = buildTransport();
    const idle = h("div", { class: "empty" }, "Nothing playing — ",
      h("button", { class: "btn", type: "button", onclick: openPlayer }, "Open player"));
    panel.body.append(body, system.el, idle);

    let sys = null;
    // The built-in player wins while it has something loaded and is playing
    // (or nothing else is); otherwise another app's session is shown.
    const mode = () => (p.current && (p.playing || !sys) ? "internal" : sys ? "system" : "idle");
    const renderMode = () => {
      const m = mode();
      body.hidden = m !== "internal";
      system.el.hidden = m !== "system";
      idle.hidden = m !== "idle";
      if (m === "system") {
        system.update(sys);
        panel.setSub(`${appName(sys.app).toUpperCase()} · ${sys.status === "Playing" ? "PLAYING" : "PAUSED"}`);
      } else if (m === "idle") panel.setSub("IDLE");
      else panel.setSub(p.playing ? "NOW PLAYING" : "PAUSED");
    };
    const renderNow = () => {
      const item = p.current;
      if (item) {
        setText(title, item.title);
        setText(artist, item.artist || fmt.basename(fmt.dirname(item.path)));
        art.replaceChildren(item.art ? h("img", { src: item.art, alt: "" }) : icon(p.isVideo ? "video" : "audio"));
      }
      renderMode();
    };
    const renderState = () => {
      playBtn.replaceChildren(icon(p.playing ? "pause" : "play"));
      renderMode();
    };
    const renderTime = () => {
      setText(cur, formatTime(p.el.currentTime));
      setText(dur, formatTime(p.el.duration));
      fill.style.width = `${p.el.duration ? (p.el.currentTime / p.el.duration) * 100 : 0}%`;
    };
    progress.addEventListener("mousedown", (e) => {
      const r = progress.getBoundingClientRect();
      p.seek(((e.clientX - r.left) / r.width) * (p.el.duration || 0));
    });

    const handlers = { change: () => { renderNow(); renderState(); }, list: renderNow, state: renderState, time: renderTime };
    for (const [type, fn] of Object.entries(handlers)) p.addEventListener(type, fn);
    const offSys = onNowPlaying((s) => { sys = s; renderMode(); });
    const ticker = setInterval(() => { if (!system.el.hidden) system.tick(); }, 1000);
    renderNow();
    renderState();
    renderTime();
    return {
      destroy() {
        for (const [type, fn] of Object.entries(handlers)) p.removeEventListener(type, fn);
        offSys();
        clearInterval(ticker);
      }
    };
  }
});
