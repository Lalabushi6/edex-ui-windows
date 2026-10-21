// Spotify view of the media player.
//
// Connected (Settings → Media, your own Spotify Client ID): what's playing on
// your account, your playlists, liked songs, recently played and search, a
// device picker, and full playback control (Premium). Not connected: the
// Spotify app on this PC through Windows' media controls (play / pause /
// skip / seek), plus the steps to connect.
import { h, setText, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { poll, appActive } from "../core/poll.js";
import { toast, cleanError, contextMenu, popover, copyText } from "../core/ui.js";
import { openUrl } from "../core/links.js";
import { formatTime } from "../media/player.js";
import { createLyricsView } from "../media/lyrics.js";

const api = window.edex;
const art = new Map(); // remote cover URL -> data URL (or a pending promise)

function artFor(url) {
  if (!url) return Promise.resolve(null);
  if (!art.has(url)) {
    const p = api.spotify.art(url).catch(() => null);
    art.set(url, p);
    p.then((v) => art.set(url, v));
  }
  return Promise.resolve(art.get(url));
}

function cover(url, cls = "sp-thumb") {
  const img = h("img", { class: cls, alt: "", hidden: true });
  artFor(url).then((src) => { if (src) { img.src = src; img.hidden = false; } });
  return img;
}

// "spotify:playlist:abc" -> https://open.spotify.com/playlist/abc
const webLink = (uri) => {
  const m = /^spotify:(\w+):(\w+)$/.exec(uri || "");
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : "https://open.spotify.com";
};

export class SpotifyView {
  constructor({ makeSwitch, toggleLyrics }) {
    this.toggleLyrics = toggleLyrics;
    try { this.lyricsOn = localStorage.getItem("edex.lyricsOn") === "1"; } catch (_) { this.lyricsOn = false; }
    this.active = false;
    this.status = null;     // spotify:status
    this.state = null;      // web player state (connected)
    this.local = null;      // Windows media session of the Spotify app
    this.tab = "playlists"; // playlists | liked | recent | search
    this.openPlaylist = null;
    this.premiumWarned = false;
    this.build(makeSwitch());
  }

  build(switchEl) {
    const btn = (name, title, onclick, cls = "") => h("button", { class: `mp-btn ${cls}`, type: "button", title, onclick }, icon(name));
    this.bg = h("img", { class: "sp-bg", alt: "", hidden: true });
    this.bigArt = h("img", { class: "sp-art", alt: "", hidden: true });
    this.titleEl = h("div", { class: "mp-title" });
    this.artistEl = h("div", { class: "mp-artist" });
    this.deviceEl = h("div", { class: "sp-device muted" });
    this.empty = h("div", { class: "mp-empty sp-empty" });
    this.lyrics = createLyricsView({ className: "ly-stage" });
    this.stage = h("div", { class: "mp-stage sp-stage" }, this.bg,
      h("div", { class: "sp-now" }, this.bigArt, h("div", { class: "mp-now-text" }, this.titleEl, this.artistEl, this.deviceEl)),
      this.lyrics.el,
      this.empty);

    this.playBtn = btn("play", "Play / pause (Space)", () => this.control("toggle"), "big");
    this.cur = h("span", { class: "mp-time" }, "--:--");
    this.dur = h("span", { class: "mp-time" }, "--:--");
    this.progressFill = h("i");
    this.progress = h("div", { class: "mp-progress", title: "Seek" }, this.progressFill);
    this.shuffleBtn = btn("shuffle", "Shuffle", () => this.control("shuffle"));
    this.repeatBtn = btn("repeat", "Repeat", () => this.control("repeat"));
    this.deviceBtn = btn("desktop", "Play on…", () => this.pickDevice());
    this.lyricsBtn = btn("lyrics", "Lyrics (L)", () => this.toggleLyrics?.());
    this.volFill = h("div", { class: "mp-vol-fill" }, h("i"));
    this.vol = h("div", { class: "mp-vol", title: "Spotify volume" }, h("i", { class: "mp-vol-bg" }), this.volFill);
    this.controls = h("div", { class: "mp-controls" },
      btn("prev", "Previous", () => this.control("prev")),
      this.playBtn,
      btn("next", "Next", () => this.control("next")),
      this.cur, this.progress, this.dur,
      this.shuffleBtn, this.repeatBtn, this.deviceBtn, this.lyricsBtn,
      h("span", { class: "mp-btn sp-vol-ico" }, icon("volume")), this.vol,
      btn("external", "Open in Spotify", () => openUrl(webLink(this.state?.item?.uri || this.state?.context), { external: true })));

    this.tabsEl = h("div", { class: "sp-tabs" });
    this.search = h("input", { class: "input sp-search", placeholder: "Search Spotify", spellcheck: false, hidden: true });
    this.search.addEventListener("input", debounce(() => this.loadList(), 400));
    this.search.addEventListener("keydown", (e) => { if (e.key === "Enter") this.loadList(); });
    this.list = h("div", { class: "mp-list sp-list", tabindex: 0 });
    this.side = h("aside", { class: "mp-side" }, switchEl, this.tabsEl, this.search, this.list);
    this.root = h("div", { class: "mp sp", tabindex: 0, hidden: true }, h("div", { class: "mp-main" }, this.stage, this.controls), this.side);

    this.wireSeek();
    this.wireVolume();
    this.root.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === " ") { e.preventDefault(); this.control("toggle"); }
      else if (e.key === "ArrowRight" && e.shiftKey) { e.preventDefault(); this.control("next"); }
      else if (e.key === "ArrowLeft" && e.shiftKey) { e.preventDefault(); this.control("prev"); }
      else if (e.key.toLowerCase() === "l" && !e.ctrlKey) { e.preventDefault(); this.toggleLyrics?.(); }
    });
    this.setLyrics(this.lyricsOn);
  }

  setLyrics(on) {
    this.lyricsOn = !!on;
    this.lyrics.el.hidden = !this.lyricsOn;
    this.stage.classList.toggle("with-lyrics", this.lyricsOn);
    this.lyricsBtn.classList.toggle("on", this.lyricsOn);
    if (this.lyricsOn) this.syncLyrics();
  }

  syncLyrics() {
    if (!this.lyricsOn) return;
    const n = this.now();
    if (!n) { this.lyrics.setTrack(null); return; }
    const [artist, album] = this.state?.item ? [this.state.item.artists, this.state.item.album] : [this.local?.artist, this.local?.album];
    this.lyrics.setTrack({ title: n.title, artist: artist || "", album: album || "", duration: n.duration || 0 });
    this.lyrics.tick(n.position);
  }

  get connected() {
    return !!this.status?.connected;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  async activate() {
    this.active = true;
    await this.refreshStatus();
    if (!this.active) return;
    this.renderTabs();
    if (this.connected) {
      this.loadList();
      if (!this.status.user) api.spotify.me().then((u) => { this.status.user = u; }).catch(() => {});
    }
    this.startPolling();
    requestAnimationFrame(() => this.root.focus({ preventScroll: true }));
  }

  deactivate() {
    this.active = false;
    this.poller?.stop();
    this.poller = null;
    clearInterval(this.tick);
    this.tick = null;
  }

  focus() {
    this.root.focus({ preventScroll: true });
  }

  dispose() {
    this.deactivate();
  }

  async refreshStatus() {
    this.status = await api.spotify.status().catch(() => ({ connected: false }));
    this.render();
  }

  startPolling() {
    this.poller?.stop();
    this.poller = poll(() => this.refreshPlayer(), this.connected ? 2500 : 1500, { fixed: true });
    clearInterval(this.tick);
    // Between readings the progress bar moves on its own.
    this.tick = setInterval(() => { if (appActive()) this.renderTime(); }, 500);
  }

  async refreshPlayer() {
    if (!this.active) return;
    if (this.connected) {
      try {
        this.state = await api.spotify.player();
      } catch (e) {
        if (/connect/i.test(cleanError(e))) { await this.refreshStatus(); this.renderTabs(); }
        this.state = null;
      }
      // Without an active device the Spotify app on this PC may still be
      // playing (e.g. a free account): show it through Windows instead.
      this.local = this.state ? null : await api.nowPlaying.get("spotify").catch(() => null);
    } else {
      this.local = await api.nowPlaying.get("spotify").catch(() => null);
    }
    this.render();
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  now() {
    if (this.state?.item) {
      const s = this.state;
      const elapsed = s.playing ? Date.now() - s.at : 0;
      return {
        title: s.item.name, artist: [s.item.artists, s.item.album].filter(Boolean).join(" — "),
        art: s.item.artLarge, playing: s.playing, position: Math.min(s.item.duration, s.progress + elapsed) / 1000,
        duration: s.item.duration / 1000, device: s.device, shuffle: s.shuffle, repeat: s.repeat, web: true
      };
    }
    if (this.local) {
      const l = this.local;
      return {
        title: l.title, artist: [l.artist, l.album].filter(Boolean).join(" — "), localArt: l.artKey,
        playing: l.status === "Playing", position: l.position + (l.status === "Playing" && this.localAt ? (Date.now() - this.localAt) / 1000 : 0),
        duration: l.duration, web: false, canSeek: l.canSeek
      };
    }
    return null;
  }

  render() {
    if (this.local && this.local !== this.lastLocal) { this.lastLocal = this.local; this.localAt = Date.now(); }
    const n = this.now();
    this.root.classList.toggle("sp-off", !this.connected);
    this.empty.hidden = !!n;
    if (!n) this.renderEmpty();
    setText(this.titleEl, n?.title || "");
    setText(this.artistEl, n?.artist || "");
    setText(this.deviceEl, n?.web && n.device ? `PLAYING ON ${String(n.device.name).toUpperCase()}` : n && !n.web ? "SPOTIFY APP ON THIS PC" : "");
    this.playBtn.replaceChildren(icon(n?.playing ? "pause" : "play"));
    this.shuffleBtn.classList.toggle("on", !!n?.shuffle);
    this.repeatBtn.classList.toggle("on", !!n?.repeat && n.repeat !== "off");
    this.repeatBtn.dataset.mode = n?.repeat === "track" ? "1" : "";
    this.deviceBtn.hidden = !this.connected;
    this.vol.hidden = !(n?.web && n.device?.canVolume);
    this.controls.querySelector(".sp-vol-ico").hidden = this.vol.hidden;
    if (n?.web && n.device) this.volFill.style.width = `${n.device.volume ?? 0}%`;
    this.renderArt(n);
    this.renderTime();
    this.syncLyrics();
  }

  renderArt(n) {
    const show = (src) => {
      this.bigArt.hidden = !src;
      this.bg.hidden = !src;
      if (src) { this.bigArt.src = src; this.bg.src = src; }
    };
    if (n?.art) {
      if (this.artKey === n.art) return;
      this.artKey = n.art;
      artFor(n.art).then((src) => { if (this.artKey === n.art) show(src); });
    } else if (n?.localArt) {
      if (this.artKey === n.localArt) return;
      this.artKey = n.localArt;
      api.nowPlaying.art(n.localArt, "spotify").then((src) => { if (this.artKey === n.localArt) show(src); }).catch(() => {});
    } else if (this.artKey !== null) {
      this.artKey = null;
      show(null);
    }
  }

  renderTime() {
    const n = this.now();
    if (this.lyricsOn && n) this.lyrics.tick(n.position);
    setText(this.cur, n ? formatTime(n.position) : "--:--");
    setText(this.dur, n ? formatTime(n.duration) : "--:--");
    this.progressFill.style.width = `${n?.duration ? Math.min(100, (n.position / n.duration) * 100) : 0}%`;
  }

  renderEmpty() {
    if (this.connected) {
      this.empty.replaceChildren(icon("spotify"),
        h("div", null, "Nothing is playing on your Spotify account."),
        h("div", { class: "muted" }, "Pick a playlist or song, or choose a device to play on."),
        h("div", { class: "mp-empty-actions" }, h("button", { class: "btn", type: "button", onclick: () => this.pickDevice() }, icon("desktop"), "Devices")));
    } else {
      this.empty.replaceChildren(icon("spotify"),
        h("div", null, "Play something in the Spotify app and it shows here."),
        h("div", { class: "muted" }, "Connect your account (right) to browse playlists and pick devices."));
    }
  }

  renderTabs() {
    if (!this.connected) {
      this.tabsEl.replaceChildren();
      this.search.hidden = true;
      this.list.replaceChildren(this.setupPanel());
      return;
    }
    const mk = (id, label) => h("button", { class: `sp-tab${this.tab === id ? " on" : ""}`, type: "button", onclick: () => { this.tab = id; this.openPlaylist = null; this.renderTabs(); this.loadList(); } }, label);
    this.tabsEl.replaceChildren(mk("playlists", "Playlists"), mk("liked", "Liked"), mk("recent", "Recent"), mk("search", "Search"),
      h("span", { class: "grow" }),
      h("button", { class: "icon-btn sm", type: "button", title: `${this.status.user?.name || "Spotify"} — account`, onclick: (e) => this.accountMenu(e) }, icon("more")));
    this.search.hidden = this.tab !== "search";
    if (this.tab === "search") requestAnimationFrame(() => this.search.focus());
  }

  // The steps to connect an account, with the Client ID field.
  setupPanel() {
    const s = this.status || {};
    const id = h("input", { class: "input", placeholder: "Client ID (32 characters)", spellcheck: false, autocomplete: "off" });
    id.value = s.clientId || settings.get("spotifyClientId") || "";
    const go = h("button", { class: "btn primary", type: "button" }, icon("spotify"), "Connect");
    const connect = async () => {
      const v = id.value.trim().toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(v)) { toast("A Client ID is 32 letters and digits (0–9, a–f)", { level: "warn" }); return; }
      await settings.set({ spotifyClientId: v });
      go.disabled = true;
      setText(go, "Waiting for Spotify…");
      try {
        const me = await api.spotify.connect();
        toast(`Connected to Spotify as ${me.name}${me.product && me.product !== "premium" ? " — playback control needs Premium" : ""}`, { level: "ok", timeout: 5000 });
        await this.refreshStatus();
        this.renderTabs();
        this.loadList();
        this.startPolling();
      } catch (e) {
        toast(cleanError(e), { level: "warn", timeout: 6000 });
        go.disabled = false;
        go.replaceChildren(icon("spotify"), "Connect");
      }
    };
    go.addEventListener("click", connect);
    id.addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
    const step = (n, ...body) => h("li", { class: "sp-step" }, h("span", { class: "sp-step-n" }, String(n)), h("div", null, ...body));
    return h("div", { class: "sp-setup" },
      h("div", { class: "panel-title" }, "Connect Spotify"),
      h("p", { class: "muted" }, "Browse your playlists, liked songs and search, choose where it plays, and control it from here. Spotify asks for a free developer app of your own (it takes a minute):"),
      h("ol", { class: "sp-steps" },
        step(1, "Open ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); openUrl("https://developer.spotify.com/dashboard", { external: true }); } }, "developer.spotify.com/dashboard"), ", sign in and choose Create app."),
        step(2, "Add this Redirect URI and tick Web API:", h("div", { class: "sp-copy" },
          h("code", null, s.redirectUri || "http://127.0.0.1:43821/callback"),
          h("button", { class: "icon-btn sm", type: "button", title: "Copy", onclick: () => copyText(s.redirectUri || "http://127.0.0.1:43821/callback") }, icon("copy")))),
        step(3, "Save, open the app's settings and paste its Client ID:", h("div", { class: "sp-connect" }, id, go))),
      h("p", { class: "muted sp-note" }, "Spotify's rules: the developer app's owner needs Premium, and playback control needs Premium. Your sign-in is encrypted with your Windows account; eDEX never sees your password."));
  }

  accountMenu(e) {
    const u = this.status?.user;
    contextMenu(e, [
      { label: u ? `Signed in as ${u.name}${u.product ? ` (${u.product})` : ""}` : "Spotify account", icon: "spotify", disabled: true },
      { label: "Refresh", icon: "refresh", run: () => this.loadList() },
      { label: "Open Spotify on the web", icon: "external", run: () => openUrl("https://open.spotify.com", { external: true }) },
      { separator: true },
      { label: "Disconnect", icon: "signout", danger: true, run: async () => {
        await api.spotify.disconnect().catch(() => {});
        this.state = null;
        await this.refreshStatus();
        this.renderTabs();
        this.startPolling();
        toast("Spotify disconnected", { level: "ok" });
      } }
    ]);
  }

  // ── Lists ────────────────────────────────────────────────────────────────
  async loadList() {
    if (!this.connected) return;
    const token = Symbol("list");
    this.listToken = token;
    this.list.replaceChildren(h("div", { class: "empty" }, "Loading…"));
    try {
      let rows = [];
      if (this.openPlaylist) {
        const p = this.openPlaylist;
        const d = await api.spotify.playlistTracks(p.id);
        rows = [this.backRow(p.name), ...d.items.map((t, i) => this.trackRow(t, () => this.start({ context: p.uri, offset: t.uri }), i))];
      } else if (this.tab === "playlists") {
        const d = await api.spotify.playlists(0);
        rows = d.items.map((p) => this.playlistRow(p));
        if (!rows.length) rows = [h("div", { class: "empty" }, "No playlists yet")];
      } else if (this.tab === "liked") {
        const d = await api.spotify.liked(0);
        rows = d.items.map((t, i) => this.trackRow(t, () => this.start({ uris: d.items.slice(i, i + 50).map((x) => x.uri) }), i));
        if (!rows.length) rows = [h("div", { class: "empty" }, "No liked songs")];
      } else if (this.tab === "recent") {
        const items = await api.spotify.recent();
        rows = items.map((t, i) => this.trackRow(t, () => this.start({ uris: [t.uri] }), i));
        if (!rows.length) rows = [h("div", { class: "empty" }, "Nothing played recently")];
      } else if (this.tab === "search") {
        const q = this.search.value.trim();
        if (!q) rows = [h("div", { class: "empty" }, "Type to search songs, albums and playlists")];
        else {
          const d = await api.spotify.search(q);
          rows = [
            d.tracks.length && h("div", { class: "launcher-group" }, "Songs"), ...d.tracks.map((t, i) => this.trackRow(t, () => this.start({ uris: [t.uri] }), i)),
            d.albums?.length && h("div", { class: "launcher-group" }, "Albums"), ...(d.albums || []).map((a) => this.playlistRow({ ...a, owner: a.artists, listable: false })),
            d.playlists.length && h("div", { class: "launcher-group" }, "Playlists"), ...d.playlists.map((p) => this.playlistRow(p))
          ].filter(Boolean);
          if (!rows.length) rows = [h("div", { class: "empty" }, "No results")];
        }
      }
      if (this.listToken === token) this.list.replaceChildren(...rows);
    } catch (e) {
      if (this.listToken === token) this.list.replaceChildren(h("div", { class: "empty" }, cleanError(e)));
    }
  }

  backRow(name) {
    return h("div", { class: "mp-row sp-back", onclick: () => { this.openPlaylist = null; this.loadList(); } },
      h("span", { class: "mp-row-n" }, icon("back")), h("span", { class: "mp-row-t" }, h("span", { class: "ellipsis" }, name)), h("span", { class: "mp-row-d" }));
  }

  playlistRow(p) {
    const row = h("div", {
      class: "mp-row sp-row", title: p.listable ? "Click to see the songs · double-click to play" : "Double-click to play",
      onclick: () => { if (p.listable) { this.openPlaylist = p; this.loadList(); } },
      ondblclick: () => this.start({ context: p.uri }),
      oncontextmenu: (e) => contextMenu(e, [
        { label: "Play", icon: "play", run: () => this.start({ context: p.uri }) },
        p.listable && { label: "Show songs", icon: "list", run: () => { this.openPlaylist = p; this.loadList(); } },
        { label: "Open in Spotify", icon: "external", run: () => openUrl(webLink(p.uri), { external: true }) }
      ])
    },
    h("span", { class: "mp-row-n sp-art-cell" }, cover(p.art), icon(p.uri?.includes(":album:") ? "audio" : "list")),
    h("span", { class: "mp-row-t" }, h("span", { class: "ellipsis" }, p.name), p.owner && h("small", null, p.owner)),
    h("span", { class: "mp-row-d" }, p.count != null ? String(p.count) : ""));
    return row;
  }

  trackRow(t, play) {
    const playing = this.state?.item?.uri === t.uri;
    return h("div", {
      class: `mp-row sp-row${playing ? " current" : ""}`, title: "Double-click to play",
      ondblclick: play,
      oncontextmenu: (e) => contextMenu(e, [
        { label: "Play", icon: "play", run: play },
        { label: "Open in Spotify", icon: "external", run: () => openUrl(webLink(t.uri), { external: true }) },
        { label: "Copy song link", icon: "link", run: () => copyText(webLink(t.uri)) }
      ])
    },
    h("span", { class: "mp-row-n sp-art-cell" }, cover(t.art), icon("audio")),
    h("span", { class: "mp-row-t" }, h("span", { class: "ellipsis" }, t.name), t.artists && h("small", null, t.artists)),
    h("span", { class: "mp-row-d" }, t.duration ? formatTime(t.duration / 1000) : ""));
  }

  // ── Control ──────────────────────────────────────────────────────────────
  async start(what) {
    try {
      await api.spotify.control("start", what);
    } catch (e) {
      if (/device/i.test(cleanError(e))) {
        // No active device: wake the first one Spotify knows about.
        const devices = await api.spotify.devices().catch(() => []);
        const d = devices.find((x) => x.type === "Computer" && !x.restricted) || devices.find((x) => !x.restricted);
        if (d) {
          try { await api.spotify.control("start", { ...what, device: d.id }); } catch (e2) { return this.fail(e2); }
        } else {
          return toast("Open Spotify on this PC or your phone first — no device is available", { level: "warn", timeout: 5000 });
        }
      } else return this.fail(e);
    }
    setTimeout(() => this.poller?.kick(), 700);
  }

  fail(e) {
    const msg = cleanError(e);
    if (/premium/i.test(msg)) {
      if (!this.premiumWarned) toast(msg, { level: "warn", timeout: 5000 });
      this.premiumWarned = true;
    } else toast(msg, { level: "warn" });
  }

  async control(action) {
    const n = this.now();
    if (!n) return;
    if (!n.web) {
      // The Spotify app through Windows' media controls.
      const map = { toggle: "toggle", next: "next", prev: "prev" };
      if (!map[action]) return;
      await api.nowPlaying.control(map[action], { source: "spotify" }).catch((e) => this.fail(e));
      setTimeout(() => this.poller?.kick(), 400);
      return;
    }
    try {
      if (action === "toggle") {
        await api.spotify.control(n.playing ? "pause" : "play");
        this.state.playing = !n.playing;
        this.state.progress = n.position * 1000;
        this.state.at = Date.now();
      } else if (action === "shuffle") {
        await api.spotify.control("shuffle", { state: !n.shuffle });
        this.state.shuffle = !n.shuffle;
      } else if (action === "repeat") {
        const next = { off: "context", context: "track", track: "off" }[n.repeat] || "off";
        await api.spotify.control("repeat", { state: next });
        this.state.repeat = next;
      } else {
        await api.spotify.control(action);
      }
      this.render();
    } catch (e) { this.fail(e); }
    setTimeout(() => this.poller?.kick(), 600);
  }

  async pickDevice() {
    const devices = await api.spotify.devices().catch((e) => { this.fail(e); return null; });
    if (!devices) return;
    popover(this.deviceBtn, (close) => h("div", { class: "sp-devices" },
      h("div", { class: "panel-title" }, "Play on"),
      devices.length ? h("div", { class: "app-picker-list" }, ...devices.map((d) => h("button", {
        class: `app-picker-item${d.active ? " on" : ""}`, type: "button", disabled: d.restricted,
        onclick: async () => {
          close();
          try { await api.spotify.control("transfer", { device: d.id, play: true }); setTimeout(() => this.poller?.kick(), 800); } catch (e) { this.fail(e); }
        }
      }, icon(d.type === "Smartphone" ? "phone" : d.type === "Speaker" ? "volume" : "desktop"),
      h("span", { class: "ellipsis grow" }, d.name), h("span", { class: "muted" }, d.active ? "playing" : d.type)))) : h("div", { class: "muted" }, "No devices — open Spotify on this PC, your phone or a speaker.")), { className: "app-picker-pop" });
  }

  wireSeek() {
    this.progress.addEventListener("mousedown", async (e) => {
      const n = this.now();
      if (!n?.duration) return;
      const r = this.progress.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * n.duration;
      try {
        if (n.web) {
          await api.spotify.control("seek", { position: pos * 1000 });
          this.state.progress = pos * 1000;
          this.state.at = Date.now();
        } else if (n.canSeek) {
          await api.nowPlaying.control("seek", { source: "spotify", position: pos });
        }
        this.renderTime();
      } catch (err) { this.fail(err); }
    });
  }

  wireVolume() {
    const send = debounce((v) => api.spotify.control("volume", { volume: v }).catch((e) => this.fail(e)), 250);
    const set = (e) => {
      if (!this.state?.device) return;
      const r = this.vol.getBoundingClientRect();
      const v = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100);
      this.state.device.volume = v;
      this.volFill.style.width = `${v}%`;
      send(v);
    };
    this.vol.addEventListener("mousedown", (e) => {
      set(e);
      const move = (ev) => set(ev);
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }
}
