// Internet radio view of the media player: your favourite stations, search
// (by name or genre) in the Radio Browser directory, and stations added by
// URL. Playing one makes it a playlist entry, so the control bar, the
// visualizer and the equalizer all work with it.
import { h, setText, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { toast, contextMenu, prompt, copyText, cleanError } from "../core/ui.js";
import { player, isStream, streamBase } from "../media/player.js";

const api = window.edex;
const TAGS = ["lofi", "jazz", "rock", "pop", "electronic", "classical", "ambient", "news", "hiphop", "metal", "chillout", "80s"];
const iconCache = new Map();

function stationIcon(url) {
  if (!url) return Promise.resolve(null);
  if (!iconCache.has(url)) {
    const p = api.radio.icon(url).catch(() => null);
    iconCache.set(url, p);
    p.then((v) => iconCache.set(url, v));
    while (iconCache.size > 300) iconCache.delete(iconCache.keys().next().value);
  }
  return Promise.resolve(iconCache.get(url));
}

const favs = () => settings.get("radioStations") || [];
const isFav = (url) => favs().some((s) => s.url === url);

export class RadioView {
  constructor() {
    this.results = null; // null: not searched yet
    this.tag = "";
    this.started = false;
    this.search = h("input", { class: "input lib-search", placeholder: "Search stations by name", spellcheck: false });
    this.search.addEventListener("input", debounce(() => { this.tag = ""; this.find(); }, 450));
    this.search.addEventListener("keydown", (e) => { if (e.key === "Enter") { this.tag = ""; this.find(); } });
    this.tags = h("div", { class: "radio-tags" });
    this.now = h("div", { class: "radio-now", hidden: true });
    this.body = h("div", { class: "lib-body radio-body" });
    this.root = h("div", { class: "lib radio", hidden: true },
      h("div", { class: "lib-bar" }, this.search,
        h("button", { class: "btn sm", type: "button", title: "Add a station by its stream URL", onclick: () => this.addByUrl() }, icon("plus"), "Add URL…")),
      this.tags, this.now, this.body);
    const p = player();
    const update = () => { this.renderNow(); this.markPlaying(); };
    p.addEventListener("change", update);
    p.addEventListener("state", update);
    settings.watch("radioStations", () => this.render());
  }

  activate() {
    if (!this.started) {
      this.started = true;
      // The popular list loads by itself only while outbound lookups are on;
      // otherwise the directory is asked when you search or pick a genre.
      if (settings.get("allowNetworkGeolocation") !== false) this.find();
      else this.renderTags();
    }
    this.renderNow();
    this.render();
  }

  deactivate() {}

  async find() {
    const q = this.search.value.trim();
    this.renderTags();
    this.loading = true;
    this.render();
    try {
      this.results = await api.radio.search({ q, tag: this.tag });
      this.error = null;
    } catch (e) {
      this.results = [];
      this.error = cleanError(e);
    }
    this.loading = false;
    this.render();
  }

  renderTags() {
    this.tags.replaceChildren(
      h("button", { class: `chip${!this.tag && !this.search.value.trim() ? " active" : ""}`, type: "button", onclick: () => { this.tag = ""; this.search.value = ""; this.find(); } }, "Popular"),
      ...TAGS.map((t) => h("button", { class: `chip${this.tag === t ? " active" : ""}`, type: "button", onclick: () => { this.tag = t; this.search.value = ""; this.find(); } }, t)));
  }

  toggleFav(s) {
    const list = favs();
    if (isFav(s.url)) settings.set({ radioStations: list.filter((x) => x.url !== s.url) });
    else {
      settings.set({ radioStations: [...list, { name: s.name, url: s.url, favicon: s.favicon || "", tags: s.tags || "", country: s.country || "" }].slice(0, 100) });
      toast(`${s.name} added to favourites`, { level: "ok", timeout: 1400 });
    }
  }

  play(s) {
    player().playStream(s.url, s.name);
  }

  row(s) {
    const img = h("img", { class: "radio-ico", alt: "", hidden: true });
    stationIcon(s.favicon).then((src) => { if (src) { img.src = src; img.hidden = false; } });
    const fav = isFav(s.url);
    const playing = player().current?.stream && streamBase(player().current.path) === s.url;
    return h("div", {
      class: `mp-row radio-row${playing ? " current" : ""}`, title: s.url, dataset: { url: s.url },
      ondblclick: () => this.play(s),
      oncontextmenu: (e) => contextMenu(e, [
        { label: "Play", icon: "play", run: () => this.play(s) },
        { label: fav ? "Remove from favourites" : "Add to favourites", icon: "star", run: () => this.toggleFav(s) },
        { label: "Add to playlist", icon: "plus", run: () => player().add([`${s.url}#edex-name=${encodeURIComponent(s.name)}`]) },
        { label: "Copy stream address", icon: "link", run: () => copyText(s.url) }
      ])
    },
    h("span", { class: "mp-row-n radio-ico-box" }, icon("radio"), img),
    h("span", { class: "mp-row-t" }, h("span", { class: "ellipsis" }, s.name), h("small", null, [s.tags, s.country, s.codec && s.bitrate ? `${s.codec} ${s.bitrate} kbps` : s.codec].filter(Boolean).join(" · "))),
    h("span", { class: "mp-row-d radio-actions" },
      h("button", { class: `icon-btn sm${fav ? " on" : ""}`, type: "button", title: fav ? "Remove from favourites" : "Add to favourites", onclick: (e) => { e.stopPropagation(); this.toggleFav(s); } }, icon("star")),
      h("button", { class: "icon-btn sm", type: "button", title: "Play", onclick: (e) => { e.stopPropagation(); this.play(s); } }, icon("play"))));
  }

  render() {
    if (this.root.hidden && this.started) return;
    const sections = [];
    const f = favs();
    if (f.length) sections.push(h("div", { class: "launcher-group" }, "Favourites"), ...f.map((s) => this.row(s)));
    sections.push(h("div", { class: "launcher-group" }, this.tag ? `Stations: ${this.tag}` : this.search.value.trim() ? `Stations matching “${this.search.value.trim()}”` : this.results === null ? "Stations" : "Popular stations"));
    if (this.loading) sections.push(h("div", { class: "empty" }, "Searching the Radio Browser directory…"));
    else if (this.error) sections.push(h("div", { class: "empty" }, this.error));
    else if (this.results === null) sections.push(h("div", { class: "empty" }, "Search, or pick a genre, to look up stations in the Radio Browser directory"));
    else if (!this.results.length) sections.push(h("div", { class: "empty" }, "No stations found"));
    else sections.push(...this.results.filter((s) => !isFav(s.url)).map((s) => this.row(s)));
    this.body.replaceChildren(...sections);
  }

  markPlaying() {
    const cur = player().current;
    const url = cur?.stream ? streamBase(cur.path) : "";
    for (const row of this.body.querySelectorAll(".radio-row")) row.classList.toggle("current", row.dataset.url === url);
  }

  renderNow() {
    const cur = player().current;
    const on = !!cur?.stream;
    this.now.hidden = !on;
    if (!on) return;
    this.now.replaceChildren(icon(player().playing ? "radio" : "pause"),
      h("span", { class: "radio-now-station" }, cur.station || "Radio"),
      h("span", { class: "ellipsis muted" }, cur.title && cur.title !== cur.station ? cur.title : player().playing ? "Live" : "Paused"));
  }

  async addByUrl() {
    const url = await prompt({ title: "Add a radio station", message: "The station's stream address (http… — .pls and .m3u links work too; HLS / .m3u8 streams don't).", placeholder: "https://…" });
    if (!url) return;
    if (!isStream(url)) { toast("That isn't an http(s) address", { level: "warn" }); return; }
    const name = (await prompt({ title: "Station name", value: url.replace(/^https?:\/\//, "").split("/")[0] })) || url;
    this.toggleFav({ name: name.slice(0, 80), url: url.split("#")[0] });
    this.play({ name, url: url.split("#")[0] });
  }
}
