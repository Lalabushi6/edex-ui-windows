// Media player tab: video / visualizer stage, eDEX-style control bar and a
// playlist. Playback itself lives in ../media/player.js and keeps going when
// this tab is closed.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { accent } from "../core/theme.js";
import { appActive } from "../core/poll.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import { emit } from "../core/bus.js";
import { toast, contextMenu, confirm, cleanError } from "../core/ui.js";
import { player, formatTime, isMediaPath } from "../media/player.js";

const api = window.edex;

export async function addPaths(paths, opts = {}) {
  const files = [];
  for (const p of paths) {
    if (isMediaPath(p)) { files.push(p); continue; }
    try {
      const st = await api.fs.stat(p);
      if (st.isDir) files.push(...(await api.player.scan(st.path)));
    } catch (_) {}
  }
  player().add(files, opts);
}

export class MediaTab {
  constructor(ws) {
    this.ws = ws;
    this.type = "media";
    this.label = "Media";
    this.el = h("div", { class: "pane" });
    this.off = [];
    this.vizTimer = null;
    this.selected = -1;
    this.p = player();
    this.root = null;
  }

  serialize() {
    return { type: "media" };
  }

  async mount() {
    const p = this.p;
    const btn = (name, title, onclick, cls = "") => h("button", { class: `mp-btn ${cls}`, type: "button", title, onclick }, icon(name));

    this.viz = h("canvas", { class: "mp-viz" });
    this.art = h("img", { class: "mp-art", alt: "", hidden: true });
    this.titleEl = h("div", { class: "mp-title" });
    this.artistEl = h("div", { class: "mp-artist" });
    this.empty = h("div", { class: "mp-empty" },
      icon("audio"),
      h("div", null, "Drop audio or video files here, or"),
      h("div", { class: "mp-empty-actions" },
        h("button", { class: "btn", type: "button", onclick: () => this.pickFiles() }, icon("plus"), "Add files"),
        h("button", { class: "btn", type: "button", onclick: () => this.pickFolder() }, icon("folder"), "Add folder")));
    this.videoBox = h("div", { class: "mp-video" });
    this.stage = h("div", { class: "mp-stage" }, this.viz, this.videoBox,
      h("div", { class: "mp-now" }, this.art, h("div", { class: "mp-now-text" }, this.titleEl, this.artistEl)),
      this.empty);
    this.stage.addEventListener("dblclick", () => this.fullscreen());

    this.playBtn = btn("play", "Play / pause (Space)", () => p.toggle(), "big");
    this.cur = h("span", { class: "mp-time" }, "00:00");
    this.dur = h("span", { class: "mp-time" }, "00:00");
    this.progressFill = h("i");
    this.progress = h("div", { class: "mp-progress", title: "Seek" }, this.progressFill);
    this.shuffleBtn = btn("shuffle", "Shuffle", () => settings.set({ mediaShuffle: !settings.get("mediaShuffle") }));
    this.repeatBtn = btn("repeat", "Repeat", () => {
      const order = ["off", "all", "one"];
      settings.set({ mediaRepeat: order[(order.indexOf(settings.get("mediaRepeat")) + 1) % 3] });
    });
    this.volIcon = btn("volume", "Mute (M)", () => p.toggleMute());
    this.volFill = h("div", { class: "mp-vol-fill" }, h("i"));
    this.vol = h("div", { class: "mp-vol", title: "Volume (↑ ↓)" }, h("i", { class: "mp-vol-bg" }), this.volFill);
    const controls = h("div", { class: "mp-controls" },
      btn("prev", "Previous (Shift+←)", () => p.prev()),
      this.playBtn,
      btn("next", "Next (Shift+→)", () => p.next()),
      btn("stop", "Stop", () => p.stop()),
      this.cur, this.progress, this.dur,
      this.shuffleBtn, this.repeatBtn,
      this.volIcon, this.vol,
      btn("maximize", "Fullscreen (F)", () => this.fullscreen()));

    this.count = h("span", { class: "muted" });
    this.list = h("div", { class: "mp-list", tabindex: 0 });
    const side = h("aside", { class: "mp-side" },
      h("div", { class: "mp-side-head" }, h("span", { class: "panel-title" }, "Playlist"), this.count,
        h("span", { class: "grow" }),
        btn("plus", "Add files", () => this.pickFiles()),
        btn("folder", "Add folder", () => this.pickFolder()),
        btn("trash", "Clear playlist", () => this.clear())),
      this.list);
    this.root = h("div", { class: "mp", tabindex: 0 }, h("div", { class: "mp-main" }, this.stage, controls), side);
    this.el.append(this.root);

    this.wireSeek();
    this.wireVolume();
    this.wireDrop();
    this.wireKeys();
    const on = (type, fn) => { p.addEventListener(type, fn); this.off.push(() => p.removeEventListener(type, fn)); };
    on("change", () => { this.renderNow(); this.renderList(); });
    on("list", () => this.renderList());
    on("state", () => { this.renderState(); this.kickViz(); });
    on("time", () => this.renderTime());
    on("volume", () => this.renderVolume());
    this.off.push(settings.watch(["mediaShuffle", "mediaRepeat"], () => { this.renderModes(); p.rebuildOrder(); }));

    this.renderNow();
    this.renderList();
    this.renderState();
    this.renderTime();
    this.renderVolume();
    this.renderModes();
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  renderNow() {
    const item = this.p.current;
    this.empty.hidden = this.p.items.length > 0;
    setText(this.titleEl, item ? item.title : "");
    setText(this.artistEl, item ? [item.artist, item.album].filter(Boolean).join(" — ") || fmt.basename(fmt.dirname(item.path)) : "");
    this.art.hidden = !item?.art;
    if (item?.art) this.art.src = item.art;
    this.label = item ? item.title : "Media";
    this.ws.updateTab(this);
    this.updateVideo();
  }

  updateVideo() {
    const video = this.p.isVideo;
    this.stage.classList.toggle("is-video", video);
    if (this.el.classList.contains("active")) this.p.attach(this.videoBox);
  }

  renderState() {
    this.playBtn.replaceChildren(icon(this.p.playing ? "pause" : "play"));
    this.stage.classList.toggle("playing", this.p.playing);
    this.updateVideo();
  }

  renderTime() {
    const el = this.p.el;
    setText(this.cur, formatTime(el.currentTime));
    setText(this.dur, formatTime(el.duration));
    this.progressFill.style.width = `${el.duration ? (el.currentTime / el.duration) * 100 : 0}%`;
  }

  renderVolume() {
    const p = this.p;
    this.volFill.style.width = `${(p.muted ? 0 : p.volume) * 100}%`;
    this.volIcon.replaceChildren(icon(p.muted || p.volume === 0 ? "mute" : "volume"));
  }

  renderModes() {
    this.shuffleBtn.classList.toggle("on", !!settings.get("mediaShuffle"));
    const repeat = settings.get("mediaRepeat");
    this.repeatBtn.classList.toggle("on", repeat !== "off");
    this.repeatBtn.dataset.mode = repeat === "one" ? "1" : "";
    this.repeatBtn.title = `Repeat: ${repeat}`;
  }

  renderList() {
    const p = this.p;
    setText(this.count, p.items.length ? `${p.items.length} ITEM${p.items.length === 1 ? "" : "S"}` : "");
    if (!p.items.length) {
      this.list.replaceChildren(h("div", { class: "empty" }, "Playlist is empty"));
      this.renderNow();
      return;
    }
    this.list.replaceChildren(...p.items.map((item, i) => {
      const row = h("div", {
        class: `mp-row${i === p.index ? " current" : ""}${i === this.selected ? " sel" : ""}`,
        draggable: true,
        title: item.path,
        onclick: () => { this.selected = i; this.paintSelection(); },
        ondblclick: () => p.load(i),
        oncontextmenu: (e) => {
          this.selected = i;
          this.paintSelection();
          contextMenu(e, [
            { label: "Play", icon: "play", run: () => p.load(i) },
            { label: "Move up", icon: "up", disabled: i === 0, run: () => p.move(i, i - 1) },
            { label: "Move down", icon: "chevronDown", disabled: i === p.items.length - 1, run: () => p.move(i, i + 1) },
            { label: "Show in explorer", icon: "folder", run: () => emit("open-path", { path: fmt.dirname(item.path), select: item.path }) },
            { separator: true },
            { label: "Remove from playlist", icon: "trash", hint: "Del", run: () => p.remove(i) }
          ]);
        }
      },
      h("span", { class: "mp-row-n" }, i === p.index && p.playing ? icon("play") : String(i + 1).padStart(2, "0")),
      h("span", { class: "mp-row-t" }, h("span", { class: "ellipsis" }, item.title), item.artist && h("small", null, item.artist)),
      h("span", { class: "mp-row-d" }, item.duration ? formatTime(item.duration) : ""));
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-edex-track", String(i)); e.dataTransfer.effectAllowed = "move"; });
      row.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("application/x-edex-track")) { e.preventDefault(); row.classList.add("drop"); } });
      row.addEventListener("dragleave", () => row.classList.remove("drop"));
      row.addEventListener("drop", (e) => {
        const from = e.dataTransfer.getData("application/x-edex-track");
        row.classList.remove("drop");
        if (from === "") return;
        e.preventDefault();
        e.stopPropagation();
        p.move(Number(from), i);
      });
      return row;
    }));
    this.list.querySelector(".mp-row.current")?.scrollIntoView({ block: "nearest" });
  }

  paintSelection() {
    [...this.list.children].forEach((r, i) => r.classList.toggle("sel", i === this.selected));
  }

  // ── Interaction ──────────────────────────────────────────────────────────
  wireSeek() {
    const seekTo = (e) => {
      const r = this.progress.getBoundingClientRect();
      this.p.seek(((e.clientX - r.left) / r.width) * (this.p.el.duration || 0));
    };
    this.progress.addEventListener("mousedown", (e) => {
      seekTo(e);
      const move = (ev) => seekTo(ev);
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  wireVolume() {
    const set = (e) => {
      const r = this.vol.getBoundingClientRect();
      this.p.setVolume((e.clientX - r.left) / r.width);
    };
    this.vol.addEventListener("mousedown", (e) => {
      set(e);
      const move = (ev) => set(ev);
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    this.vol.addEventListener("wheel", (e) => { e.preventDefault(); this.p.setVolume(this.p.volume + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
  }

  wireDrop() {
    this.root.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      this.root.classList.add("dropping");
    });
    this.root.addEventListener("dragleave", (e) => { if (!this.root.contains(e.relatedTarget)) this.root.classList.remove("dropping"); });
    this.root.addEventListener("drop", (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      this.root.classList.remove("dropping");
      const paths = [...e.dataTransfer.files].map((f) => api.fs.pathForFile(f)).filter(Boolean);
      addPaths(paths, { play: !this.p.playing });
    });
  }

  wireKeys() {
    this.root.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea")) return;
      const p = this.p;
      const done = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === " ") { done(); p.toggle(); }
      else if (e.key === "ArrowRight" && e.shiftKey) { done(); p.next(); }
      else if (e.key === "ArrowLeft" && e.shiftKey) { done(); p.prev(); }
      else if (e.key === "ArrowRight") { done(); p.seek(p.el.currentTime + 5); }
      else if (e.key === "ArrowLeft") { done(); p.seek(p.el.currentTime - 5); }
      else if (e.key === "ArrowUp") { done(); p.setVolume(p.volume + 0.05); }
      else if (e.key === "ArrowDown") { done(); p.setVolume(p.volume - 0.05); }
      else if (e.key.toLowerCase() === "m" && !e.ctrlKey) { done(); p.toggleMute(); }
      else if (e.key.toLowerCase() === "f" && !e.ctrlKey) { done(); this.fullscreen(); }
      else if (e.key === "Delete" && this.selected >= 0) { done(); p.remove(this.selected); this.selected = Math.min(this.selected, p.items.length - 1); this.paintSelection(); }
      else if (e.key === "Enter" && this.selected >= 0) { done(); p.load(this.selected); }
    });
  }

  async pickFiles() {
    try { addPaths(await api.player.pickFiles(), { play: !this.p.playing }); }
    catch (e) { toast(cleanError(e), { level: "warn" }); }
  }

  async pickFolder() {
    try {
      const files = await api.player.pickFolder();
      if (files.length) this.p.add(files, { play: !this.p.playing });
    } catch (e) { toast(cleanError(e), { level: "warn" }); }
  }

  async clear() {
    if (!this.p.items.length) return;
    if (await confirm({ title: "Clear playlist", message: `Remove all ${this.p.items.length} items from the playlist? Files on disk are not touched.`, confirmLabel: "Clear" })) this.p.clear();
  }

  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.stage.requestFullscreen().catch(() => {});
  }

  // ── Visualizer ───────────────────────────────────────────────────────────
  kickViz() {
    if (this.vizTimer || !this.el.classList.contains("active")) return;
    const ctx = this.viz.getContext("2d");
    let bins = null;
    const frame = () => {
      this.vizTimer = null;
      if (!this.el.classList.contains("active") || !appActive()) return;
      const dpr = window.devicePixelRatio || 1;
      const r = this.viz.getBoundingClientRect();
      if (this.viz.width !== Math.round(r.width * dpr)) { this.viz.width = Math.round(r.width * dpr); this.viz.height = Math.round(r.height * dpr); }
      const W = this.viz.width, H = this.viz.height;
      ctx.clearRect(0, 0, W, H);
      const analyser = this.p.analyser;
      const playing = this.p.playing && !this.p.isVideo;
      if (analyser && playing) {
        bins ||= new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);
      }
      const count = 64;
      const gap = 3 * dpr;
      const bw = (W - gap * (count - 1)) / count;
      const base = H * 0.72;
      // Bars are spaced logarithmically (~40 Hz to ~16 kHz) so the spectrum
      // reads like a graphic equaliser instead of piling up in the bass.
      const lo = 2, hi = bins ? Math.min(bins.length - 1, Math.round(bins.length * 0.72)) : 1;
      for (let i = 0; i < count; i++) {
        let v = 0.02;
        if (playing && bins) {
          const a = Math.floor(lo * Math.pow(hi / lo, i / count));
          const b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / count)));
          let peak = 0;
          for (let k = a; k < b; k++) peak = Math.max(peak, bins[k]);
          v = peak / 255;
        }
        const bh = Math.max(2 * dpr, v * base * 0.9);
        const x = i * (bw + gap);
        ctx.fillStyle = accent(0.25 + v * 0.75);
        ctx.fillRect(x, base - bh, bw, bh);
        ctx.fillStyle = accent(0.12 * v + 0.03);
        ctx.fillRect(x, base + 2 * dpr, bw, bh * 0.35);
      }
      ctx.fillStyle = accent(0.35);
      ctx.fillRect(0, base, W, dpr);
      if (playing) this.vizTimer = setTimeout(() => requestAnimationFrame(frame), 1000 / 30);
    };
    frame();
  }

  // ── Tab lifecycle ────────────────────────────────────────────────────────
  // The workspace may activate a tab before mount() has built it.
  activate() {
    if (!this.root) { requestAnimationFrame(() => this.root && this.activate()); return; }
    this.p.attach(this.videoBox);
    this.updateVideo();
    this.kickViz();
    requestAnimationFrame(() => this.root.focus({ preventScroll: true }));
  }

  deactivate() {
    this.p.detach();
    clearTimeout(this.vizTimer);
    this.vizTimer = null;
  }

  focus() {
    this.root?.focus();
  }

  dispose() {
    this.deactivate();
    this.off.forEach((fn) => fn());
  }
}
