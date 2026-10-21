// Music library view of the media player: your music folders (the Music
// folder unless you add others) by album, artist or song, with album covers.
// Play replaces the playlist with the album (or song list); "Add to
// playlist" appends.
import { h, setText, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as fmt from "../core/format.js";
import { toast, contextMenu, popover, cleanError } from "../core/ui.js";
import { emit } from "../core/bus.js";
import { player } from "../media/player.js";

const api = window.edex;
const artCache = new Map(); // first track path -> url | null | Promise

function albumArt(path) {
  if (!artCache.has(path)) {
    const p = api.library.art(path).then((f) => (f ? fmt.fileUrl(f) : null)).catch(() => null);
    artCache.set(path, p);
    p.then((v) => artCache.set(path, v));
  }
  return Promise.resolve(artCache.get(path));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function groupAlbums(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const artist = t.albumArtist || t.artist || "";
    // Songs without an album tag are grouped by their folder.
    const key = t.album ? `${artist.toLowerCase()}|${t.album.toLowerCase()}` : `dir|${fmt.dirname(t.path).toLowerCase()}`;
    let a = map.get(key);
    if (!a) {
      a = { key, album: t.album || fmt.basename(fmt.dirname(t.path)) || "Unknown album", artist: artist || "Unknown artist", year: t.year || 0, tracks: [] };
      map.set(key, a);
    }
    a.tracks.push(t);
    if (!a.year && t.year) a.year = t.year;
  }
  const out = [...map.values()];
  for (const a of out) a.tracks.sort((x, y) => (x.disc || 0) - (y.disc || 0) || (x.track || 0) - (y.track || 0) || collator.compare(x.title, y.title));
  return out.sort((x, y) => collator.compare(x.artist, y.artist) || (x.year || 0) - (y.year || 0) || collator.compare(x.album, y.album));
}

export class LibraryView {
  constructor() {
    this.tracks = [];
    this.albums = [];
    this.mode = "albums";
    this.album = null;
    this.artist = null;
    this.loaded = false;
    this.search = h("input", { class: "input lib-search", placeholder: "Search your music", spellcheck: false });
    this.search.addEventListener("input", debounce(() => this.render(), 150));
    this.modes = h("div", { class: "lib-modes" });
    this.status = h("span", { class: "muted lib-status" });
    this.foldersBtn = h("button", { class: "btn sm", type: "button", title: "Music folders" }, icon("folder"), "Folders");
    this.foldersBtn.addEventListener("click", () => this.openFolders());
    const rescan = h("button", { class: "icon-btn", type: "button", title: "Read the folders again", onclick: () => this.rescan() }, icon("refresh"));
    this.body = h("div", { class: "lib-body" });
    this.root = h("div", { class: "lib", hidden: true },
      h("div", { class: "lib-bar" }, this.search, this.modes, h("span", { class: "grow" }), this.status, this.foldersBtn, rescan),
      this.body);
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        this.io.unobserve(img);
        albumArt(img.dataset.track).then((url) => { if (url) { img.src = url; img.classList.add("ok"); } });
      }
    }, { root: this.body, rootMargin: "300px" });
    api.library.onProgress(({ done, total, final }) => {
      if (final) { this.load(); return; }
      setText(this.status, `READING ${done.toLocaleString()} / ${total.toLocaleString()}…`);
    });
  }

  async load() {
    const d = await api.library.list().catch(() => ({ tracks: [], folders: [] }));
    this.tracks = d.tracks || [];
    this.folders = d.folders || [];
    this.albums = groupAlbums(this.tracks);
    this.loaded = true;
    setText(this.status, d.scanning ? "READING…" : `${this.albums.length.toLocaleString()} ALBUMS · ${this.tracks.length.toLocaleString()} SONGS`);
    this.render();
  }

  async rescan() {
    setText(this.status, "READING…");
    try { await api.library.scan(); } catch (e) { toast(cleanError(e), { level: "warn" }); }
    this.load();
  }

  activate() {
    if (!this.loaded) this.load();
  }

  deactivate() {}

  play(tracks, start = 0) {
    if (!tracks.length) return;
    const p = player();
    p.add(tracks.map((t) => t.path), { replace: true, play: false, quiet: true });
    p.load(Math.min(start, p.items.length - 1), { autoplay: true });
    toast(`Playing ${tracks.length === 1 ? tracks[0].title : `${tracks.length} songs`}`, { timeout: 1500 });
  }

  queue(tracks) {
    if (!tracks.length) return;
    player().add(tracks.map((t) => t.path), { play: false });
  }

  trackMenu(e, t, list, i) {
    contextMenu(e, [
      { label: "Play", icon: "play", run: () => this.play(list, i) },
      { label: "Add to playlist", icon: "plus", run: () => this.queue([t]) },
      { label: "Show in explorer", icon: "folder", run: () => emit("open-path", { path: fmt.dirname(t.path), select: t.path }) }
    ]);
  }

  renderModes() {
    this.modes.replaceChildren(...[["albums", "Albums"], ["artists", "Artists"], ["songs", "Songs"]].map(([id, label]) => h("button", {
      class: `chip${this.mode === id && !this.album ? " active" : ""}`, type: "button",
      onclick: () => { this.mode = id; this.album = null; this.artist = null; this.render(); }
    }, label)));
  }

  render() {
    this.renderModes();
    this.io.disconnect();
    if (!this.loaded) { this.body.replaceChildren(h("div", { class: "empty" }, "Loading your music…")); return; }
    if (!this.tracks.length) {
      this.body.replaceChildren(h("div", { class: "mp-empty lib-empty" }, icon("album"),
        h("div", null, "No music found in your music folders yet."),
        h("div", { class: "muted" }, (this.folders || []).join(" · ")),
        h("div", { class: "mp-empty-actions" },
          h("button", { class: "btn", type: "button", onclick: () => this.addFolder() }, icon("plus"), "Add a folder"),
          h("button", { class: "btn", type: "button", onclick: () => this.rescan() }, icon("refresh"), "Read again"))));
      return;
    }
    const q = this.search.value.trim().toLowerCase();
    const match = (t) => !q || `${t.title} ${t.artist} ${t.album} ${t.albumArtist}`.toLowerCase().includes(q);
    if (this.album) return this.renderAlbum(this.album);
    if (this.mode === "songs") return this.renderSongs(this.tracks.filter(match).sort((a, b) => collator.compare(a.title, b.title)));
    if (this.mode === "artists" && !this.artist) return this.renderArtists(q);
    let albums = this.albums.filter((a) => a.tracks.some(match) || (q && `${a.album} ${a.artist}`.toLowerCase().includes(q)));
    if (this.artist) albums = albums.filter((a) => a.artist === this.artist || a.tracks.some((t) => t.artist === this.artist));
    const head = this.artist ? h("div", { class: "lib-crumb" },
      h("button", { class: "btn sm", type: "button", onclick: () => { this.artist = null; this.render(); } }, icon("back"), "All artists"),
      h("span", { class: "lib-crumb-title" }, this.artist)) : null;
    const grid = h("div", { class: "lib-grid" }, ...albums.slice(0, 1500).map((a) => {
      const img = h("img", { class: "lib-cover", alt: "", dataset: { track: a.tracks[0].path } });
      this.io.observe(img);
      return h("button", {
        class: "lib-tile", type: "button", title: `${a.album} — ${a.artist}`,
        onclick: () => { this.album = a; this.render(); },
        ondblclick: () => this.play(a.tracks),
        oncontextmenu: (e) => contextMenu(e, [
          { label: "Play album", icon: "play", run: () => this.play(a.tracks) },
          { label: "Add to playlist", icon: "plus", run: () => this.queue(a.tracks) },
          { label: "Show in explorer", icon: "folder", run: () => emit("open-path", { path: fmt.dirname(a.tracks[0].path) }) }
        ])
      }, h("span", { class: "lib-cover-box" }, icon("album"), img), h("span", { class: "lib-tile-title ellipsis" }, a.album), h("span", { class: "lib-tile-sub ellipsis" }, a.artist));
    }));
    this.body.replaceChildren(...[head, albums.length ? grid : h("div", { class: "empty" }, "No matches")].filter(Boolean));
  }

  renderAlbum(a) {
    const img = h("img", { class: "lib-cover big", alt: "" });
    albumArt(a.tracks[0].path).then((url) => { if (url) { img.src = url; img.classList.add("ok"); } });
    this.body.replaceChildren(
      h("div", { class: "lib-crumb" }, h("button", { class: "btn sm", type: "button", onclick: () => { this.album = null; this.render(); } }, icon("back"), this.artist ? this.artist : "Albums")),
      h("div", { class: "lib-album" },
        h("span", { class: "lib-cover-box big" }, icon("album"), img),
        h("div", { class: "lib-album-info" },
          h("div", { class: "lib-album-title" }, a.album),
          h("div", { class: "muted" }, [a.artist, a.year || "", `${a.tracks.length} song${a.tracks.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")),
          h("div", { class: "mp-empty-actions" },
            h("button", { class: "btn primary", type: "button", onclick: () => this.play(a.tracks) }, icon("play"), "Play"),
            h("button", { class: "btn", type: "button", onclick: () => { const s = [...a.tracks].sort(() => Math.random() - 0.5); this.play(s); } }, icon("shuffle"), "Shuffle"),
            h("button", { class: "btn", type: "button", onclick: () => this.queue(a.tracks) }, icon("plus"), "Add to playlist")))),
      h("div", { class: "lib-tracks" }, ...a.tracks.map((t, i) => h("div", {
        class: "mp-row", title: t.path, ondblclick: () => this.play(a.tracks, i), oncontextmenu: (e) => this.trackMenu(e, t, a.tracks, i)
      }, h("span", { class: "mp-row-n" }, String(t.track || i + 1).padStart(2, "0")),
      h("span", { class: "mp-row-t" }, h("span", { class: "ellipsis" }, t.title), t.artist && t.artist !== a.artist ? h("small", null, t.artist) : null),
      h("span", { class: "mp-row-d" }, t.disc > 1 ? `CD ${t.disc}` : "")))));
  }

  renderArtists(q) {
    const counts = new Map();
    for (const a of this.albums) {
      const c = counts.get(a.artist) || { albums: 0, songs: 0 };
      c.albums++;
      c.songs += a.tracks.length;
      counts.set(a.artist, c);
    }
    const list = [...counts.entries()].filter(([name]) => !q || name.toLowerCase().includes(q)).sort((x, y) => collator.compare(x[0], y[0]));
    this.body.replaceChildren(h("div", { class: "lib-artists" }, ...list.map(([name, c]) => h("button", {
      class: "lib-artist", type: "button", onclick: () => { this.artist = name; this.mode = "albums"; this.render(); }
    }, icon("audio"), h("span", { class: "ellipsis grow" }, name), h("span", { class: "muted" }, `${c.albums} album${c.albums === 1 ? "" : "s"} · ${c.songs} song${c.songs === 1 ? "" : "s"}`)))));
  }

  renderSongs(list) {
    const shown = list.slice(0, 800);
    this.body.replaceChildren(
      h("div", { class: "lib-crumb muted" }, `${list.length.toLocaleString()} song${list.length === 1 ? "" : "s"}${list.length > shown.length ? ` — showing the first ${shown.length}, search to narrow it down` : ""}`),
      h("div", { class: "lib-tracks" }, ...shown.map((t, i) => h("div", {
        class: "mp-row", title: t.path, ondblclick: () => this.play(shown, i), oncontextmenu: (e) => this.trackMenu(e, t, shown, i)
      }, h("span", { class: "mp-row-n" }, icon("audio")),
      h("span", { class: "mp-row-t" }, h("span", { class: "ellipsis" }, t.title), h("small", null, [t.artist, t.album].filter(Boolean).join(" — "))),
      h("span", { class: "mp-row-d" }, t.year || "")))));
  }

  async addFolder() {
    try { this.folders = await api.library.addFolder(); setText(this.status, "READING…"); } catch (e) { toast(cleanError(e), { level: "warn" }); }
  }

  openFolders() {
    popover(this.foldersBtn, (close) => h("div", { class: "lib-folders" },
      h("div", { class: "panel-title" }, "Music folders"),
      ...(this.folders || []).map((f) => h("div", { class: "lib-folder" }, icon("folder"), h("span", { class: "ellipsis grow", title: f }, f),
        h("button", { class: "icon-btn sm", type: "button", title: "Remove (files aren't touched)", onclick: async () => { close(); this.folders = await api.library.removeFolder(f).catch(() => this.folders); setText(this.status, "READING…"); } }, icon("close")))),
      h("button", { class: "btn sm", type: "button", onclick: () => { close(); this.addFolder(); } }, icon("plus"), "Add a folder…")), { className: "lib-folders-pop" });
  }
}
