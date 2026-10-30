// Media player engine (singleton). Owns one <video> element (it plays audio
// too) that lives in a hidden host so playback survives the player tab being
// closed; the tab borrows it to show video. Playlist, volume, shuffle/repeat
// and the resume position persist in settings.
import { debounce } from "../core/dom.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import { toast } from "../core/ui.js";

const api = window.edex;
export const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "opus", "flac", "aac", "m4a", "weba"]);
export const VIDEO_EXTS = new Set(["mp4", "m4v", "webm", "mkv", "mov", "ogv"]);

// 10-band graphic equaliser (Hz) and its presets (dB per band).
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  flat: { label: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: "Bass boost", gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
  treble: { label: "Treble boost", gains: [0, 0, 0, 0, 0, 1, 2.5, 4, 5.5, 6.5] },
  vocal: { label: "Vocal", gains: [-2, -2, -1, 1, 3, 4, 3.5, 2, 0, -1] },
  rock: { label: "Rock", gains: [5, 4, 2.5, 0, -1.5, -1, 1, 3, 4, 4.5] },
  electronic: { label: "Electronic", gains: [6, 5, 1.5, 0, -2, 1.5, 0.5, 1.5, 4.5, 5.5] },
  acoustic: { label: "Acoustic", gains: [4, 3.5, 2.5, 1, 1.5, 1.5, 2.5, 3, 2.5, 1.5] },
  loudness: { label: "Loudness", gains: [6, 4.5, 0, 0, -2, 0, -1, -4, 5, 1] },
  night: { label: "Late night", gains: [-4, -3, -1, 1, 2, 2, 1.5, 0, -2, -4] }
};

// Internet radio stations are playlist entries too: the station's URL, with
// its name in the fragment ("#edex-name=…", never sent to the station).
export const isStream = (p) => /^https?:\/\//i.test(String(p || ""));
export const streamEntry = (url, name) => `${String(url).split("#")[0]}#edex-name=${encodeURIComponent(String(name || "").slice(0, 80))}`;
export const streamBase = (p) => String(p).split("#")[0];
const streamName = (p) => {
  const m = /#edex-name=([^#]*)$/.exec(String(p));
  try { return m ? decodeURIComponent(m[1]) : ""; } catch (_) { return ""; }
};

export function isMediaPath(p) {
  const ext = fmt.extname(fmt.basename(p));
  return AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

export function isVideoPath(p) {
  return !isStream(p) && VIDEO_EXTS.has(fmt.extname(fmt.basename(p)));
}

function titleFromPath(p) {
  if (isStream(p)) return streamName(p) || streamBase(p).replace(/^https?:\/\//i, "").split("/")[0];
  return fmt.basename(p).replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
}

function itemFor(p) {
  return isStream(p) ? { path: p, title: titleFromPath(p), artist: "Internet radio", station: titleFromPath(p), stream: true } : { path: p, title: titleFromPath(p) };
}

class Player extends EventTarget {
  constructor() {
    super();
    this.el = document.createElement("video");
    this.el.className = "mp-media";
    this.el.preload = "metadata";
    this.el.crossOrigin = "anonymous";
    this.el.playsInline = true;
    document.getElementById("media-host").append(this.el);
    this.items = [];
    this.index = -1;
    this.order = [];
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.volume = 0.8;
    this.muted = false;
    this.failures = 0;
    this.restored = false;
    this.persist = debounce(() => this.save(), 600);
    this.wire();
    settings.watch(["mediaEqOn", "mediaEq"], () => this.applyEq());
    // "Now playing" titles stations send with the stream.
    api.radio.onMeta(({ url, title, station }) => {
      const item = this.current;
      if (!item?.stream || streamBase(item.path) !== url) return;
      if (station && !streamName(item.path)) item.station = station;
      if (title) { item.title = title; item.artist = item.station; }
      this.dispatchEvent(new Event("change"));
      this.updateSession();
    });
  }

  wire() {
    const el = this.el;
    const emit = (type) => this.dispatchEvent(new Event(type));
    // The audio graph is suspended a few seconds into a pause so an idle
    // player costs nothing, and resumed whenever playback starts.
    el.addEventListener("play", () => {
      clearTimeout(this.suspendTimer);
      if (this.ctx?.state === "suspended") this.ctx.resume().catch(() => {});
      emit("state");
      this.updateSession();
    });
    el.addEventListener("pause", () => {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = setTimeout(() => { if (el.paused) this.ctx?.suspend().catch(() => {}); }, 5000);
      emit("state");
      this.save();
      this.updateSession();
    });
    // A station that plays again has reconnected.
    el.addEventListener("playing", () => { this.reconnects = 0; });
    el.addEventListener("timeupdate", () => { emit("time"); if (!this.current?.stream && Math.floor(el.currentTime) % 10 === 0) this.persist(); });
    el.addEventListener("loadedmetadata", () => {
      const item = this.current;
      if (item) item.duration = el.duration;
      this.failures = 0;
      emit("change");
    });
    el.addEventListener("ended", () => this.onEnded());
    el.addEventListener("error", () => {
      const item = this.current;
      if (!item || !el.getAttribute("src")) return;
      toast(item.stream ? `${item.station || "The station"} isn't answering right now` : `Cannot play ${fmt.basename(item.path)} — unsupported format or missing file`, { level: "warn" });
      this.failures++;
      // A station that's down stops there (skipping to the next song would
      // be a surprise); a broken file moves on.
      if (!item.stream && this.failures < 4 && this.items.length > 1) this.next(true);
      else emit("state");
    });

    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => this.play());
      ms.setActionHandler("pause", () => this.pause());
      ms.setActionHandler("stop", () => this.stop());
      ms.setActionHandler("previoustrack", () => this.prev());
      ms.setActionHandler("nexttrack", () => this.next());
      ms.setActionHandler("seekto", (d) => this.seek(d.seekTime));
      ms.setActionHandler("seekbackward", (d) => this.seek(this.el.currentTime - (d.seekOffset || 10)));
      ms.setActionHandler("seekforward", (d) => this.seek(this.el.currentTime + (d.seekOffset || 10)));
    }
  }

  get current() {
    return this.items[this.index] || null;
  }

  get playing() {
    return !this.el.paused && !this.el.ended;
  }

  get isVideo() {
    return !!this.current && isVideoPath(this.current.path) && this.el.videoWidth > 0;
  }

  restore() {
    if (this.restored) return;
    this.restored = true;
    const list = settings.get("mediaPlaylist") || [];
    this.items = list.map(itemFor);
    this.volume = (settings.get("mediaVolume") ?? 80) / 100;
    this.applyVolume();
    this.rebuildOrder();
    const idx = Math.min(settings.get("mediaIndex") || 0, this.items.length - 1);
    // A station isn't connected until it's played.
    if (idx >= 0 && !this.items[idx].stream) this.load(idx, { autoplay: false, at: settings.get("mediaPosition") || 0 });
    else if (idx >= 0) { this.index = idx; this.dispatchEvent(new Event("change")); }
    this.dispatchEvent(new Event("list"));
  }

  save() {
    settings.set({
      mediaPlaylist: this.items.map((i) => i.path),
      mediaIndex: Math.max(0, this.index),
      mediaPosition: Math.floor(this.el.currentTime || 0),
      mediaVolume: Math.round(this.volume * 100)
    });
  }

  rebuildOrder() {
    this.order = this.items.map((_, i) => i);
    if (settings.get("mediaShuffle")) {
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
      }
    }
  }

  // Graph: element -> preamp -> 10 EQ bands -> analyser (full scale, for the
  //                                         visualizer)
  //                                      -> gain (volume / mute) -> speakers.
  // Created on first play; once routed through Web Audio the element must
  // stay connected. Chromium applies element.volume before the graph, so
  // the element stays at 1 and volume lives on the gain node instead.
  ensureAnalyser() {
    if (this.analyser || this.ctx) return this.analyser;
    try {
      this.ctx = new AudioContext();
      const source = this.ctx.createMediaElementSource(this.el);
      this.preamp = this.ctx.createGain();
      this.bands = EQ_BANDS.map((freq, i) => {
        const f = this.ctx.createBiquadFilter();
        f.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
        f.frequency.value = freq;
        f.Q.value = 1.1;
        return f;
      });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.gain = this.ctx.createGain();
      source.connect(this.preamp);
      const last = this.bands.reduce((prev, f) => { prev.connect(f); return f; }, this.preamp);
      last.connect(this.analyser);
      last.connect(this.gain);
      this.gain.connect(this.ctx.destination);
    } catch (e) {
      console.warn("media analyser unavailable", e);
    }
    this.applyVolume();
    this.applyEq();
    return this.analyser;
  }

  // Band gains come from settings; boosts are offset by a matching preamp
  // cut so a "bass boost" doesn't clip.
  applyEq() {
    if (!this.bands) return;
    const on = !!settings.get("mediaEqOn");
    const gains = on ? (settings.get("mediaEq") || []) : [];
    const t = this.ctx.currentTime;
    this.bands.forEach((f, i) => f.gain.setTargetAtTime(Number(gains[i]) || 0, t, 0.03));
    const peak = Math.max(0, ...gains.map(Number).filter(Number.isFinite));
    this.preamp.gain.setTargetAtTime(Math.pow(10, -peak * 0.75 / 20), t, 0.03);
  }

  applyVolume() {
    const level = this.muted ? 0 : this.volume;
    if (this.gain) {
      this.el.volume = 1;
      this.el.muted = false;
      this.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
    } else {
      this.el.volume = this.volume;
      this.el.muted = this.muted;
    }
    this.dispatchEvent(new Event("volume"));
  }

  load(index, { autoplay = true, at = 0 } = {}) {
    const item = this.items[index];
    if (!item) return;
    this.index = index;
    this.el.src = item.stream ? `edexradio://stream/${encodeURIComponent(streamBase(item.path))}` : fmt.fileUrl(item.path);
    if (at > 0 && !item.stream) this.el.addEventListener("loadedmetadata", () => { if (at < this.el.duration - 2) this.el.currentTime = at; }, { once: true });
    if (autoplay) this.play();
    this.dispatchEvent(new Event("change"));
    this.updateSession();
    this.persist();
    if (!item.tagsLoaded && !item.stream) {
      item.tagsLoaded = true;
      api.player.tags(item.path).then((tags) => {
        if (!tags) return;
        if (tags.title) item.title = tags.title;
        if (tags.artist) item.artist = tags.artist;
        if (tags.album) item.album = tags.album;
        if (tags.picture) item.art = tags.picture;
        this.dispatchEvent(new Event("change"));
        this.updateSession();
      }).catch(() => {});
    }
  }

  async play() {
    if (!this.current) {
      if (this.items.length) this.load(this.order[0] ?? 0, { autoplay: false });
      else return;
    } else if (!this.el.getAttribute("src")) {
      this.load(this.index, { autoplay: false });
    }
    this.ensureAnalyser();
    if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => {});
    try { await this.el.play(); } catch (_) { /* reported through the error event */ }
  }

  pause() { this.el.pause(); }
  toggle() { this.playing ? this.pause() : this.play(); }

  stop() {
    this.el.pause();
    if (this.current) this.el.currentTime = 0;
    this.dispatchEvent(new Event("state"));
  }

  seek(t) {
    if (!Number.isFinite(this.el.duration)) return;
    this.el.currentTime = Math.max(0, Math.min(this.el.duration - 0.1, t));
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.volume > 0) this.muted = false;
    this.applyVolume();
    this.persist();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolume();
  }

  step(delta, fromError = false) {
    if (!this.items.length) return;
    const pos = this.order.indexOf(this.index);
    let next = pos + delta;
    if (next >= this.order.length || next < 0) {
      if (settings.get("mediaRepeat") === "all" || fromError === false) next = (next + this.order.length) % this.order.length;
      else return;
    }
    this.load(this.order[next], { autoplay: true });
  }

  next(fromError = false) { this.step(1, fromError); }

  prev() {
    if (this.el.currentTime > 4) { this.el.currentTime = 0; return; }
    this.step(-1);
  }

  onEnded() {
    // A live station "ends" when its connection drops: reconnect (a few
    // times) rather than moving on to the next track.
    if (this.current?.stream) {
      if ((this.reconnects || 0) < 3) {
        this.reconnects = (this.reconnects || 0) + 1;
        const index = this.index;
        setTimeout(() => { if (this.index === index && this.el.paused) this.load(index, { autoplay: true }); }, 1500 * this.reconnects);
      } else this.dispatchEvent(new Event("state"));
      return;
    }
    const repeat = settings.get("mediaRepeat");
    if (repeat === "one") { this.el.currentTime = 0; this.play(); return; }
    const pos = this.order.indexOf(this.index);
    if (pos < this.order.length - 1 || repeat === "all") this.next();
    else this.dispatchEvent(new Event("state"));
  }

  // Adds files; `play` starts the first added item.
  add(paths, { play = false, replace = false, quiet = false } = {}) {
    const fresh = paths.filter((p) => isMediaPath(p) || isStream(p));
    if (!fresh.length) { toast("No playable audio or video files", { level: "warn" }); return; }
    if (replace) { this.items = []; this.index = -1; }
    const start = this.items.length;
    for (const p of fresh) this.items.push(itemFor(p));
    this.rebuildOrder();
    this.dispatchEvent(new Event("list"));
    if (play || this.index < 0) this.load(start, { autoplay: play });
    this.persist();
    if (!play && !quiet) toast(`Added ${fresh.length} item${fresh.length === 1 ? "" : "s"} to the playlist`, { level: "ok", timeout: 1600 });
  }

  // Plays a station now: reuses its playlist entry, or adds one.
  playStream(url, name) {
    const base = streamBase(url);
    const i = this.items.findIndex((it) => it.stream && streamBase(it.path) === base);
    if (i >= 0) { this.load(i, { autoplay: true }); return; }
    this.add([streamEntry(base, name)], { play: true, quiet: true });
  }

  remove(index) {
    if (!this.items[index]) return;
    const wasCurrent = index === this.index;
    this.items.splice(index, 1);
    if (index < this.index) this.index--;
    this.rebuildOrder();
    if (wasCurrent) {
      if (this.items.length) this.load(Math.min(index, this.items.length - 1), { autoplay: this.playing });
      else this.clear();
    }
    this.dispatchEvent(new Event("list"));
    this.persist();
  }

  move(from, to) {
    if (from === to || !this.items[from] || to < 0 || to >= this.items.length) return;
    const cur = this.current;
    const [item] = this.items.splice(from, 1);
    this.items.splice(to, 0, item);
    this.index = this.items.indexOf(cur);
    this.rebuildOrder();
    this.dispatchEvent(new Event("list"));
    this.persist();
  }

  clear() {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
    this.items = [];
    this.index = -1;
    this.order = [];
    this.dispatchEvent(new Event("list"));
    this.dispatchEvent(new Event("change"));
    this.dispatchEvent(new Event("state"));
    this.updateSession();
    this.persist();
  }

  updateSession() {
    if (!("mediaSession" in navigator)) return;
    const item = this.current;
    navigator.mediaSession.playbackState = !item ? "none" : (this.playing ? "playing" : "paused");
    if (!item) { navigator.mediaSession.metadata = null; return; }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title,
        artist: item.artist || "",
        album: item.stream ? "Internet radio" : item.album || "eDEX-UI",
        artwork: item.art ? [{ src: item.art, sizes: "512x512" }] : []
      });
    } catch (_) {}
  }

  // Video goes into the given container while it is shown; otherwise the
  // element waits (still playing) in the hidden host.
  attach(container) {
    if (this.el.parentElement !== container) container.append(this.el);
  }

  detach() {
    const host = document.getElementById("media-host");
    if (this.el.parentElement !== host) host.append(this.el);
  }
}

let instance = null;

export function player() {
  if (!instance) {
    instance = new Player();
    instance.restore();
  }
  return instance;
}

export function formatTime(t) {
  if (!Number.isFinite(t) || t < 0) return "--:--";
  const s = Math.floor(t % 60), m = Math.floor((t / 60) % 60), h = Math.floor(t / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
