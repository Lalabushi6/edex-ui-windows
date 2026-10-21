// File explorer tab: browse, open, preview, rename, copy/cut/paste, drag in
// and out of other apps, Recycle Bin deletes, pins and recents.
import { h, setText, debounce } from "../core/dom.js";
import { icon, iconSvg, fileKind } from "../core/icons.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { emit } from "../core/bus.js";
import { toast, contextMenu, prompt, confirm, copyText, cleanError } from "../core/ui.js";
import { openUrl } from "../core/links.js";
import { openViewer } from "../shell/viewer.js";
import { isMediaPath } from "../media/player.js";

const api = window.edex;
const shared = { clipboard: { mode: null, paths: [] }, places: null, drives: null, drivesAt: 0 };
const OPENABLE_ICON_EXTS = new Set(["exe", "lnk", "url", "msi", "appref-ms", "ico"]);
// Grid view shows real previews for these (Windows thumbnail cache).
const THUMB_EXTS = new Set(["jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "avif", "svg",
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "pdf"]);
const thumbCache = new Map(); // `${path}|${mtime}` -> data URL | null
const TYPE_LABEL = {
  folder: "Folder", image: "Image", audio: "Audio", video: "Video", archive: "Archive", pdf: "PDF document",
  code: "Source file", text: "Text document", app: "Application", shortcut: "Shortcut", file: "File"
};

function remember(key, path, max = 24) {
  const list = (settings.get(key) || []).filter((p) => !fmt.pathsEqual(p, path));
  settings.set({ [key]: [path, ...list].slice(0, max) });
}

async function getDrives(force = false) {
  if (!force && shared.drives && Date.now() - shared.drivesAt < 20000) return shared.drives;
  shared.drives = await api.sys.drives().catch(() => []);
  shared.drivesAt = Date.now();
  return shared.drives;
}

export class ExplorerTab {
  constructor(ws, { cwd } = {}) {
    this.ws = ws;
    this.type = "files";
    this.label = "Files";
    this.cwd = null;
    this.initialPath = cwd || null;
    this.entries = [];
    this.visible = [];
    this.rows = [];
    this.selection = new Set();
    this.cursor = -1;
    this.anchor = -1;
    this.history = [];
    this.hIndex = -1;
    this.filter = "";
    this.loadedAt = 0;
    this.typeahead = "";
    this.typeaheadTimer = null;
    this.el = h("div", { class: "pane" });
    this.unwatch = [];
  }

  serialize() {
    return { type: "files", cwd: this.cwd || "" };
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  build() {
    const btn = (name, title, onclick) => h("button", { class: "icon-btn", type: "button", title, onclick }, icon(name));
    this.btnBack = btn("back", "Back (Alt+Left)", () => this.go(-1));
    this.btnFwd = btn("forward", "Forward (Alt+Right)", () => this.go(1));
    this.btnUp = btn("up", "Up (Backspace)", () => this.up());
    this.crumbs = h("div", { class: "fx-crumbs", title: "Click empty space to type a path (Ctrl+L)" });
    this.address = h("input", { class: "input fx-address", spellcheck: false, hidden: true, placeholder: "Type a path and press Enter" });
    this.filterInput = h("input", { class: "input fx-filter", spellcheck: false, placeholder: "Filter (Ctrl+F)" });
    this.btnView = btn("list", "Toggle grid / list", () => settings.set({ explorerView: settings.get("explorerView") === "grid" ? "list" : "grid" }));
    this.btnHidden = btn("eye", "Show hidden items", () => settings.set({ showHidden: !settings.get("showHidden") }));
    const toolbar = h("div", { class: "fx-toolbar" },
      this.btnBack, this.btnFwd, this.btnUp, btn("refresh", "Refresh (F5)", () => this.refresh()),
      this.crumbs, this.address, this.filterInput,
      btn("plus", "New folder (Ctrl+Shift+N)", () => this.create("folder")),
      this.btnView, this.btnHidden,
      btn("more", "More", (e) => this.backgroundMenu(e)));

    this.side = h("nav", { class: "fx-side" });
    this.head = h("div", { class: "fx-head" });
    this.list = h("div", { class: "fx-list" });
    this.main = h("div", { class: "fx-main", tabindex: 0 }, this.head, this.list);
    this.statusLeft = h("span", { class: "grow" });
    this.statusRight = h("span");
    const status = h("div", { class: "fx-status" }, this.statusLeft, this.statusRight);
    this.root = h("div", { class: "fx" }, toolbar, this.side, this.main, status);
    this.el.append(this.root);
    this.buildHead();
    this.wire();
  }

  buildHead() {
    const sort = settings.get("explorerSort");
    const desc = settings.get("explorerSortDesc");
    const col = (key, label, num) => h("button", {
      class: num ? "num" : "", type: "button",
      onclick: () => settings.set(sort === key ? { explorerSortDesc: !desc } : { explorerSort: key, explorerSortDesc: false })
    }, label, sort === key ? (desc ? " ▼" : " ▲") : "");
    this.head.replaceChildren(col("name", "Name"), col("modified", "Modified"), col("type", "Type"), col("size", "Size", true));
  }

  wire() {
    this.crumbs.addEventListener("click", (e) => { if (e.target === this.crumbs || e.target.classList.contains("spacer")) this.editAddress(); });
    this.address.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.submitAddress(); }
      if (e.key === "Escape") { e.preventDefault(); this.closeAddress(); this.main.focus(); }
    });
    this.address.addEventListener("blur", () => setTimeout(() => this.closeAddress(), 120));
    this.filterInput.addEventListener("input", debounce(() => { this.filter = this.filterInput.value.trim().toLowerCase(); this.render(); }, 80));
    this.filterInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { this.filterInput.value = ""; this.filter = ""; this.render(); this.main.focus(); }
      if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); this.main.focus(); if (this.cursor < 0) this.moveCursor(0, false); }
    });

    this.list.addEventListener("click", (e) => {
      const row = e.target.closest(".fx-row");
      if (!row) return;
      const i = Number(row.dataset.i);
      if (e.shiftKey && this.anchor >= 0) this.selectRange(this.anchor, i, e.ctrlKey);
      else if (e.ctrlKey) this.toggle(i);
      else this.selectOnly(i);
    });
    this.list.addEventListener("dblclick", (e) => {
      const row = e.target.closest(".fx-row");
      if (row) this.open(this.visible[Number(row.dataset.i)]);
    });
    this.main.addEventListener("mousedown", (e) => {
      if (e.button === 0 && !e.target.closest(".fx-row") && !e.target.closest(".fx-head")) this.clearSelection();
    });
    this.main.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".fx-row");
      if (!row) { this.backgroundMenu(e); return; }
      const i = Number(row.dataset.i);
      if (!this.selection.has(this.visible[i].path)) this.selectOnly(i);
      this.itemMenu(e);
    });
    this.main.addEventListener("keydown", (e) => this.onKey(e));

    // Drag out to other apps (OS-level drag) …
    this.list.addEventListener("dragstart", (e) => {
      const row = e.target.closest(".fx-row");
      e.preventDefault();
      if (!row || !this.cwd) return;
      const item = this.visible[Number(row.dataset.i)];
      if (!this.selection.has(item.path)) this.selectOnly(Number(row.dataset.i));
      api.fs.startDrag(this.selectedItems().map((x) => x.path));
    });
    // … and drop files in, from eDEX itself or any other app.
    const dropTarget = (e) => {
      const row = e.target.closest(".fx-row");
      const item = row ? this.visible[Number(row.dataset.i)] : null;
      if (item?.isDir) return { dir: item.path, row };
      return this.cwd ? { dir: this.cwd, row: null } : null;
    };
    this.main.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      const t = dropTarget(e);
      if (!t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : (e.shiftKey ? "move" : "copy");
      this.list.querySelectorAll(".fx-row.drop").forEach((r) => r !== t.row && r.classList.remove("drop"));
      t.row?.classList.add("drop");
      this.main.classList.toggle("drop-target", !t.row);
    });
    this.main.addEventListener("dragleave", (e) => {
      if (!this.main.contains(e.relatedTarget)) {
        this.main.classList.remove("drop-target");
        this.list.querySelectorAll(".fx-row.drop").forEach((r) => r.classList.remove("drop"));
      }
    });
    this.main.addEventListener("drop", async (e) => {
      e.preventDefault();
      this.main.classList.remove("drop-target");
      this.list.querySelectorAll(".fx-row.drop").forEach((r) => r.classList.remove("drop"));
      const t = dropTarget(e);
      if (!t) return;
      const paths = [...e.dataTransfer.files].map((f) => api.fs.pathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      const sameDrive = paths.every((p) => fmt.pathKey(p).slice(0, 2) === fmt.pathKey(t.dir).slice(0, 2));
      const mode = e.ctrlKey ? "copy" : e.shiftKey ? "move" : (sameDrive ? "move" : "copy");
      await this.transfer(mode, paths, t.dir);
    });

    this.unwatch.push(
      settings.watch(["explorerSort", "explorerSortDesc"], () => { this.buildHead(); this.render(); }),
      settings.watch(["explorerView"], () => { this.applyView(); this.render(); }),
      settings.watch(["showHidden"], () => { this.applyView(); this.render(); }),
      settings.watch(["pinnedPaths", "recentFolders"], () => this.renderSide())
    );
    this.applyView();
  }

  applyView() {
    const grid = settings.get("explorerView") === "grid";
    this.root.classList.toggle("grid", grid);
    this.btnView.replaceChildren(icon(grid ? "list" : "grid"));
    this.btnHidden.classList.toggle("active", !!settings.get("showHidden"));
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────
  async renderSide() {
    if (!shared.places) shared.places = await api.fs.places().catch(() => []);
    const drives = await getDrives();
    const item = (ico, label, path, extra) => h("button", {
      class: `fx-side-item${this.cwd !== null && path !== null && (path === "" ? this.cwd === "" : fmt.pathsEqual(this.cwd, path)) ? " active" : ""}`,
      type: "button", title: path || label,
      onclick: () => this.navigate(path),
      oncontextmenu: (e) => path && contextMenu(e, [
        { label: "Open in new tab", icon: "plus", run: () => emit("open-path", { path, newTab: true }) },
        { label: "Open terminal here", icon: "terminal", run: () => emit("open-terminal", { cwd: path }) },
        { label: this.isPinned(path) ? "Unpin" : "Pin", icon: "pin", run: () => this.togglePin(path) },
        { label: "Copy path", icon: "copy", run: () => copyText(path, "Path copied") }
      ])
    }, icon(ico), h("span", { class: "t" }, label), extra);
    const placeIcon = { home: "home", desktop: "desktop", documents: "text", downloads: "download", pictures: "image", music: "audio", videos: "video" };
    const pins = settings.get("pinnedPaths") || [];
    const recents = (settings.get("recentFolders") || []).slice(0, 8);
    this.side.replaceChildren(...[
      h("h4", null, "Quick access"),
      ...shared.places.map((p) => item(placeIcon[p.id] || "folder", p.label, p.path)),
      pins.length && h("h4", null, "Pinned"),
      ...pins.map((p) => item("star", fmt.basename(p) || p, p)),
      h("h4", null, "This PC"),
      item("desktop", "This PC", ""),
      ...drives.map((d) => {
        const b = h("div", { class: "bar" }, h("i", { style: { width: `${d.use}%` } }));
        return item("drive", `${d.mount} ${d.type ? `(${d.type})` : ""}`, d.mount.endsWith("\\") ? d.mount : `${d.mount}\\`, b);
      }),
      recents.length && h("h4", null, "Recent"),
      ...recents.map((p) => item("clock", fmt.basename(p) || p, p))
    ].filter(Boolean));
  }

  isPinned(path) {
    return (settings.get("pinnedPaths") || []).some((p) => fmt.pathsEqual(p, path));
  }

  togglePin(path) {
    const pins = settings.get("pinnedPaths") || [];
    if (this.isPinned(path)) settings.set({ pinnedPaths: pins.filter((p) => !fmt.pathsEqual(p, path)) });
    else settings.set({ pinnedPaths: [...pins, path].slice(0, 32) });
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  async mount() {
    this.build();
    let start = this.initialPath;
    if (start === null || start === undefined) start = await api.fs.home();
    await this.navigate(start);
  }

  async navigate(path, { push = true, select } = {}) {
    const target = path === "" ? "" : fmt.normPath(path);
    try {
      let entries;
      let dir = "";
      if (target === "") {
        const drives = await getDrives(true);
        entries = drives.map((d) => ({
          name: d.mount, path: d.mount.endsWith("\\") ? d.mount : `${d.mount}\\`, isDir: true, drive: d,
          size: d.size - d.used, mtime: null, ext: "", hidden: false
        }));
      } else {
        const res = await api.fs.list(target);
        dir = res.dir;
        entries = res.entries;
      }
      const changed = this.cwd === null || !fmt.pathsEqual(this.cwd, dir) || (dir === "" && this.cwd !== "");
      this.cwd = dir;
      this.entries = entries;
      this.loadedAt = Date.now();
      if (changed) {
        this.selection.clear();
        this.cursor = -1;
        this.anchor = -1;
        if (this.filter) { this.filter = ""; this.filterInput.value = ""; }
        if (push) {
          this.history = this.history.slice(0, this.hIndex + 1);
          this.history.push(dir);
          this.hIndex = this.history.length - 1;
        }
        if (dir) remember("recentFolders", dir);
        sfx.play("folder");
      }
      this.label = dir ? (fmt.basename(dir) || dir) : "This PC";
      this.ws.updateTab(this);
      this.ws.persist();
      this.renderCrumbs();
      this.renderSide();
      this.render();
      if (select) this.selectPath(select);
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
      if (this.cwd === null) await this.navigate("", { push });
    }
  }

  refresh() {
    return this.navigate(this.cwd ?? "", { push: false });
  }

  go(delta) {
    const i = this.hIndex + delta;
    if (i < 0 || i >= this.history.length) return;
    this.hIndex = i;
    this.navigate(this.history[i], { push: false });
  }

  up() {
    if (!this.cwd) return;
    const parent = fmt.dirname(this.cwd);
    const from = this.cwd;
    this.navigate(fmt.pathsEqual(parent, this.cwd) ? "" : parent, { select: from });
  }

  renderCrumbs() {
    this.btnBack.disabled = this.hIndex <= 0;
    this.btnFwd.disabled = this.hIndex >= this.history.length - 1;
    this.btnUp.disabled = !this.cwd;
    const parts = [h("button", { type: "button", onclick: () => this.navigate("") }, "This PC")];
    for (const seg of fmt.pathSegments(this.cwd || "")) {
      parts.push(h("span", { class: "sep", svg: iconSvg("chevron") }));
      parts.push(h("button", { type: "button", onclick: () => this.navigate(seg.path) }, seg.label));
    }
    parts.push(h("span", { class: "spacer" }));
    this.crumbs.replaceChildren(...parts);
  }

  editAddress() {
    this.crumbs.hidden = true;
    this.address.hidden = false;
    this.address.value = this.cwd || "";
    this.address.focus();
    this.address.select();
  }

  closeAddress() {
    this.address.hidden = true;
    this.crumbs.hidden = false;
  }

  async submitAddress() {
    let value = this.address.value.trim().replace(/^"|"$/g, "");
    if (!value) return;
    if (value === "~" || value.startsWith("~\\") || value.startsWith("~/")) value = (await api.fs.home()) + value.slice(1);
    if (/^this pc$/i.test(value)) { this.closeAddress(); this.navigate(""); return; }
    if (/^https?:\/\//i.test(value)) { openUrl(value); this.closeAddress(); return; }
    try {
      const st = await api.fs.stat(value);
      this.closeAddress();
      if (st.isDir) await this.navigate(st.path);
      else await this.navigate(fmt.dirname(st.path), { select: st.path });
      this.main.focus();
    } catch (e) {
      toast(`Cannot find "${value}"`, { level: "warn" });
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  computeVisible() {
    const showHidden = settings.get("showHidden");
    const sort = settings.get("explorerSort");
    const desc = settings.get("explorerSortDesc") ? -1 : 1;
    const f = this.filter;
    const list = this.entries.filter((e) => (showHidden || !e.hidden) && (!f || e.name.toLowerCase().includes(f)));
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let r = 0;
      if (sort === "size") r = (a.size || 0) - (b.size || 0);
      else if (sort === "modified") r = (a.mtime || 0) - (b.mtime || 0);
      else if (sort === "type") r = collator.compare(a.ext || "", b.ext || "");
      if (r !== 0) return r * desc;
      const byName = collator.compare(a.name, b.name);
      return sort === "name" ? byName * desc : byName;
    });
    return list;
  }

  render() {
    if (!this.list) return;
    const keepSelected = new Set(this.selection);
    this.visible = this.computeVisible();
    const cut = shared.clipboard.mode === "cut" ? new Set(shared.clipboard.paths.map(fmt.pathKey)) : null;
    const iconWanted = [];
    const thumbWanted = [];
    const grid = settings.get("explorerView") === "grid";
    this.rows = this.visible.map((e, i) => {
      const kind = e.drive ? "drive" : fileKind(e.name, e.isDir);
      let iconEl = icon(kind === "drive" ? "drive" : kind);
      const ext = e.ext.replace(".", "").toLowerCase();
      if (!e.isDir && OPENABLE_ICON_EXTS.has(ext)) iconWanted.push({ path: e.path, slot: iconEl });
      else if (grid && !e.isDir && THUMB_EXTS.has(ext)) {
        const cached = thumbCache.get(`${e.path}|${e.mtime}`);
        if (cached) iconEl = h("img", { class: "fx-thumb", src: cached, alt: "" });
        else if (cached === undefined) thumbWanted.push({ path: e.path, mtime: e.mtime, slot: iconEl });
      }
      const typeLabel = e.drive ? `${e.drive.type || "Drive"}` : (TYPE_LABEL[kind] || "File") + (e.ext && !e.isDir ? ` (${e.ext.replace(".", "").toUpperCase()})` : "");
      const sizeLabel = e.drive ? `${fmt.bytes(e.size)} free` : (e.isDir ? "" : fmt.bytes(e.size));
      const modLabel = e.drive ? `${Math.round(e.drive.use)}% used` : fmt.dateTime(e.mtime);
      const row = h("div", {
        class: `fx-row${e.hidden ? " hiddenf" : ""}${e.drive ? " drive" : ""}${cut?.has(fmt.pathKey(e.path)) ? " cut" : ""}${keepSelected.has(e.path) ? " sel" : ""}`,
        dataset: { i },
        draggable: !!this.cwd,
        title: e.path
      },
      h("div", { class: "fx-name" }, iconEl, h("span", { class: "t" }, e.drive ? `${e.name} ${e.drive.type ? `(${e.drive.type})` : ""}` : e.name)),
      h("div", { class: "c" }, modLabel),
      h("div", { class: "c" }, typeLabel),
      h("div", { class: "c num" }, sizeLabel));
      return row;
    });
    this.selection = new Set(this.visible.filter((e) => keepSelected.has(e.path)).map((e) => e.path));
    if (!this.rows.length) {
      this.list.replaceChildren(h("div", { class: "fx-empty" }, this.filter ? "No items match the filter" : "This folder is empty"));
    } else {
      this.list.replaceChildren(...this.rows);
    }
    if (this.cursor >= this.visible.length) this.cursor = this.visible.length - 1;
    this.updateStatus();
    this.loadIcons(iconWanted);
    this.loadThumbs(thumbWanted);
  }

  // Thumbnails load as their tiles scroll into view, a few at a time.
  loadThumbs(wanted) {
    this.thumbObserver?.disconnect();
    if (!wanted.length) return;
    const bySlot = new Map(wanted.map((w) => [w.slot, w]));
    let queue = [];
    let running = false;
    const pump = async () => {
      if (running || !queue.length) return;
      running = true;
      const batch = queue.splice(0, 12);
      const res = await api.fs.thumbnails(batch.map((w) => w.path), 192).catch(() => ({}));
      for (const w of batch) {
        const url = res[w.path] ?? null;
        if (thumbCache.size > 600) thumbCache.delete(thumbCache.keys().next().value);
        thumbCache.set(`${w.path}|${w.mtime}`, url);
        if (url && w.slot.isConnected) w.slot.replaceWith(h("img", { class: "fx-thumb", src: url, alt: "" }));
      }
      running = false;
      pump();
    };
    this.thumbObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        this.thumbObserver.unobserve(en.target);
        const w = bySlot.get(en.target);
        if (w) queue.push(w);
      }
      pump();
    }, { root: this.main, rootMargin: "200px" });
    for (const w of wanted) this.thumbObserver.observe(w.slot);
  }

  async loadIcons(wanted) {
    if (!wanted.length) return;
    const batch = wanted.slice(0, 150);
    const result = await api.fs.icons(batch.map((w) => w.path)).catch(() => ({}));
    for (const w of batch) {
      const url = result[w.path];
      if (url && w.slot.isConnected) w.slot.replaceWith(h("img", { src: url, alt: "" }));
    }
  }

  updateStatus() {
    const n = this.visible.length;
    const sel = this.selectedItems();
    let text = `${n} item${n === 1 ? "" : "s"}`;
    if (sel.length) {
      const size = sel.filter((x) => !x.isDir).reduce((a, x) => a + (x.size || 0), 0);
      text += `  ·  ${sel.length} selected${size ? ` (${fmt.bytes(size)})` : ""}`;
    }
    if (this.filter) text += `  ·  filtered from ${this.entries.length}`;
    setText(this.statusLeft, text);
    const drive = (shared.drives || []).find((d) => this.cwd && fmt.pathKey(this.cwd).startsWith(fmt.pathKey(d.mount)));
    setText(this.statusRight, drive ? `${drive.mount} ${fmt.bytes(drive.size - drive.used)} free` : "");
  }

  // ── Selection ────────────────────────────────────────────────────────────
  selectedItems() {
    return this.visible.filter((e) => this.selection.has(e.path));
  }

  paintSelection() {
    this.rows.forEach((row, i) => row.classList.toggle("sel", this.selection.has(this.visible[i].path)));
    this.updateStatus();
  }

  selectOnly(i) {
    if (!this.visible[i]) return;
    this.selection = new Set([this.visible[i].path]);
    this.cursor = i;
    this.anchor = i;
    this.paintSelection();
  }

  toggle(i) {
    const p = this.visible[i]?.path;
    if (!p) return;
    if (this.selection.has(p)) this.selection.delete(p);
    else this.selection.add(p);
    this.cursor = i;
    this.anchor = i;
    this.paintSelection();
  }

  selectRange(a, b, additive) {
    if (!additive) this.selection.clear();
    const [lo, hi] = a < b ? [a, b] : [b, a];
    for (let i = lo; i <= hi; i++) this.selection.add(this.visible[i].path);
    this.cursor = b;
    this.paintSelection();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.paintSelection();
  }

  selectPath(path) {
    const i = this.visible.findIndex((e) => fmt.pathsEqual(e.path, path));
    if (i >= 0) {
      this.selectOnly(i);
      this.rows[i]?.scrollIntoView({ block: "nearest" });
    }
  }

  columns() {
    if (!this.root.classList.contains("grid") || this.rows.length < 2) return 1;
    const top = this.rows[0].offsetTop;
    let n = 1;
    while (n < this.rows.length && this.rows[n].offsetTop === top) n++;
    return n;
  }

  moveCursor(index, extend) {
    if (!this.visible.length) return;
    const i = Math.max(0, Math.min(this.visible.length - 1, index));
    if (extend && this.anchor >= 0) this.selectRange(this.anchor, i, false);
    else this.selectOnly(i);
    this.rows[i]?.scrollIntoView({ block: "nearest" });
  }

  onKey(e) {
    if (e.target !== this.main) return;
    const key = e.key;
    const ctrl = e.ctrlKey;
    const cols = this.columns();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (key === "ArrowDown") { handled(); this.moveCursor(this.cursor < 0 ? 0 : this.cursor + cols, e.shiftKey); return; }
    if (key === "ArrowUp") { handled(); this.moveCursor(this.cursor < 0 ? 0 : this.cursor - cols, e.shiftKey); return; }
    if (key === "ArrowRight" && cols > 1 && !e.altKey) { handled(); this.moveCursor(this.cursor + 1, e.shiftKey); return; }
    if (key === "ArrowLeft" && cols > 1 && !e.altKey) { handled(); this.moveCursor(this.cursor - 1, e.shiftKey); return; }
    if (key === "Home") { handled(); this.moveCursor(0, e.shiftKey); return; }
    if (key === "End") { handled(); this.moveCursor(this.visible.length - 1, e.shiftKey); return; }
    if (key === "PageDown") { handled(); this.moveCursor(this.cursor + 15 * cols, e.shiftKey); return; }
    if (key === "PageUp") { handled(); this.moveCursor(this.cursor - 15 * cols, e.shiftKey); return; }
    if (key === "Enter") { handled(); this.openSelection(); return; }
    if (key === " " ) { handled(); const it = this.visible[this.cursor] || this.selectedItems()[0]; if (it) this.preview(it); return; }
    if (key === "Backspace" || (e.altKey && key === "ArrowUp")) { handled(); this.up(); return; }
    if (e.altKey && key === "ArrowLeft") { handled(); this.go(-1); return; }
    if (e.altKey && key === "ArrowRight") { handled(); this.go(1); return; }
    if (key === "F2") { handled(); this.renameInline(); return; }
    if (key === "F5" || (ctrl && key.toLowerCase() === "r")) { handled(); this.refresh(); return; }
    if (key === "Delete") { handled(); this.trash(); return; }
    if (key === "Escape") { handled(); this.clearSelection(); return; }
    if ((ctrl && key.toLowerCase() === "l") || key === "F4") { handled(); this.editAddress(); return; }
    if ((ctrl && key.toLowerCase() === "f") || key === "/") { handled(); this.filterInput.focus(); this.filterInput.select(); return; }
    if (ctrl && key.toLowerCase() === "a") { handled(); this.selection = new Set(this.visible.map((x) => x.path)); this.paintSelection(); return; }
    if (ctrl && !e.shiftKey && key.toLowerCase() === "c") { handled(); this.setClipboard("copy"); return; }
    if (ctrl && !e.shiftKey && key.toLowerCase() === "x") { handled(); this.setClipboard("cut"); return; }
    if (ctrl && !e.shiftKey && key.toLowerCase() === "v") { handled(); this.paste(); return; }
    if (ctrl && e.shiftKey && key.toLowerCase() === "n") { handled(); this.create("folder"); return; }
    if (ctrl && e.shiftKey && key.toLowerCase() === "c") { handled(); const s = this.selectedItems(); if (s.length) copyText(s.map((x) => x.path).join("\r\n"), "Path copied"); return; }
    // Type-ahead: jump to the first item starting with the typed letters.
    if (!ctrl && !e.altKey && key.length === 1 && key !== " ") {
      clearTimeout(this.typeaheadTimer);
      this.typeahead += key.toLowerCase();
      this.typeaheadTimer = setTimeout(() => { this.typeahead = ""; }, 700);
      const start = this.typeahead.length === 1 ? this.cursor + 1 : this.cursor;
      const n = this.visible.length;
      for (let k = 0; k < n; k++) {
        const i = (Math.max(0, start) + k) % n;
        if (this.visible[i].name.toLowerCase().startsWith(this.typeahead)) { this.moveCursor(i, false); break; }
      }
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async open(item) {
    if (!item) return;
    if (item.isDir) { await this.navigate(item.path); return; }
    try {
      const ok = await api.fs.open(item.path);
      if (ok) {
        remember("recentFiles", item.path);
        sfx.play("granted");
      }
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
    }
  }

  openSelection() {
    const items = this.selectedItems();
    if (!items.length && this.visible[this.cursor]) items.push(this.visible[this.cursor]);
    if (items.length === 1) { this.open(items[0]); return; }
    const files = items.filter((x) => !x.isDir).slice(0, 10);
    files.forEach((f) => this.open(f));
    items.filter((x) => x.isDir).slice(0, 5).forEach((d) => emit("open-path", { path: d.path, newTab: true }));
  }

  preview(item) {
    if (item.isDir) { this.navigate(item.path); return; }
    const siblings = this.visible.filter((x) => !x.isDir).map((x) => x.path);
    openViewer(item.path, { siblings, onNavigate: (p) => this.selectPath(p) });
    remember("recentFiles", item.path);
  }

  setClipboard(mode) {
    const paths = this.selectedItems().map((x) => x.path);
    if (!paths.length) return;
    shared.clipboard = { mode, paths };
    this.render();
    toast(`${paths.length} item${paths.length === 1 ? "" : "s"} ${mode === "cut" ? "cut" : "copied"} — paste with Ctrl+V`, { timeout: 1800 });
  }

  async paste(destDir = this.cwd) {
    const { mode, paths } = shared.clipboard;
    if (!mode || !paths.length || !destDir) return;
    await this.transfer(mode === "cut" ? "move" : "copy", paths, destDir);
    if (mode === "cut") shared.clipboard = { mode: null, paths: [] };
  }

  async transfer(mode, paths, destDir) {
    try {
      toast(`${mode === "move" ? "Moving" : "Copying"} ${paths.length} item${paths.length === 1 ? "" : "s"}…`, { timeout: 1400 });
      const results = await (mode === "move" ? api.fs.move(paths, destDir) : api.fs.copy(paths, destDir));
      await this.refresh();
      if (results.length) {
        if (fmt.pathsEqual(destDir, this.cwd)) {
          this.selection = new Set(results.map((r) => r.to));
          this.paintSelection();
        }
        toast(`${mode === "move" ? "Moved" : "Copied"} ${results.length} item${results.length === 1 ? "" : "s"} to ${fmt.basename(destDir) || destDir}`, { level: "ok" });
      }
    } catch (e) {
      toast(cleanError(e), { level: "warn", timeout: 5000 });
      this.refresh();
    }
  }

  async create(kind) {
    if (!this.cwd) return;
    const name = await prompt({
      title: kind === "folder" ? "New folder" : "New file",
      message: `Create in ${this.cwd}`,
      value: kind === "folder" ? "New folder" : "New file.txt",
      confirmLabel: "Create"
    });
    if (!name) return;
    try {
      const created = await api.fs.create(this.cwd, name, kind);
      await this.refresh();
      this.selectPath(created);
      this.main.focus();
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
    }
  }

  renameInline() {
    const items = this.selectedItems();
    if (items.length !== 1 || !this.cwd) return;
    const item = items[0];
    const i = this.visible.indexOf(item);
    const nameEl = this.rows[i]?.querySelector(".t");
    if (!nameEl) return;
    const input = h("input", { class: "input rename", spellcheck: false });
    input.value = item.name;
    nameEl.replaceWith(input);
    input.focus();
    const dot = item.isDir ? -1 : item.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : item.name.length);
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (commit && next && next !== item.name) {
        try {
          const dest = await api.fs.rename(item.path, next);
          if (this.isPinned(item.path)) {
            settings.set({ pinnedPaths: (settings.get("pinnedPaths") || []).map((p) => (fmt.pathsEqual(p, item.path) ? dest : p)) });
          }
          await this.refresh();
          this.selectPath(dest);
        } catch (e) {
          toast(cleanError(e), { level: "warn" });
          this.render();
        }
      } else {
        this.render();
      }
      this.main.focus();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  async trash() {
    const items = this.selectedItems().filter((x) => !x.drive);
    if (!items.length) return;
    if (settings.get("confirmDelete")) {
      const ok = await confirm({
        title: "Move to Recycle Bin",
        message: items.length === 1 ? `Move "${items[0].name}" to the Recycle Bin?` : `Move ${items.length} items to the Recycle Bin?`,
        confirmLabel: "Delete",
        danger: true
      });
      if (!ok) return;
    }
    try {
      await api.fs.trash(items.map((x) => x.path));
      const nextCursor = Math.min(this.cursor, this.visible.length - items.length - 1);
      await this.refresh();
      if (nextCursor >= 0) this.moveCursor(nextCursor, false);
      toast(`${items.length} item${items.length === 1 ? "" : "s"} moved to the Recycle Bin`, { level: "ok" });
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
    }
    this.main.focus();
  }

  itemMenu(e) {
    const items = this.selectedItems();
    if (!items.length) return;
    const one = items.length === 1 ? items[0] : null;
    const paths = items.map((x) => x.path);
    const hasClip = !!shared.clipboard.mode;
    const media = items.filter((x) => !x.isDir && isMediaPath(x.path)).map((x) => x.path);
    contextMenu(e, [
      { label: one?.isDir ? "Open" : "Open", icon: "external", hint: "Enter", run: () => this.openSelection() },
      one && !one.isDir && { label: "Preview", icon: "eye", hint: "Space", run: () => this.preview(one) },
      media.length && { label: "Play in media player", icon: "play", run: () => emit("open-media", { paths: media, play: true }) },
      media.length && { label: "Add to playlist", icon: "plus", run: () => emit("open-media", { paths: media, play: false, focus: false }) },
      one?.isDir && !one.drive && { label: "Play folder in media player", icon: "audio", run: () => emit("open-media", { paths: [one.path], play: true }) },
      one && !one.isDir && { label: "Open with…", icon: "app", run: () => api.fs.openWith(one.path).catch((err) => toast(cleanError(err), { level: "warn" })) },
      one?.isDir && { label: "Open in new tab", icon: "plus", run: () => emit("open-path", { path: one.path, newTab: true }) },
      one?.isDir && { label: "Open terminal here", icon: "terminal", run: () => emit("open-terminal", { cwd: one.path }) },
      one?.isDir && { label: "Analyse disk usage", icon: "disk", run: () => emit("open-disk", { path: one.path }) },
      { separator: true },
      !one?.drive && { label: "Cut", icon: "cut", hint: "Ctrl+X", run: () => this.setClipboard("cut") },
      { label: "Copy", icon: "copy", hint: "Ctrl+C", run: () => this.setClipboard("copy") },
      one?.isDir && hasClip && { label: "Paste into folder", icon: "paste", run: () => this.paste(one.path) },
      { label: "Copy path", icon: "link", hint: "Ctrl+Shift+C", run: () => copyText(paths.join("\r\n"), "Path copied") },
      { separator: true },
      one && !one.drive && { label: "Rename", icon: "edit", hint: "F2", run: () => this.renameInline() },
      !one?.drive && this.cwd && { label: "Duplicate", icon: "copy", run: () => this.transfer("copy", paths, this.cwd) },
      one && { label: this.isPinned(one.path) ? "Unpin from sidebar" : "Pin to sidebar", icon: "pin", run: () => this.togglePin(one.path) },
      one?.isDir && { label: "Add to quick links", icon: "bookmark", run: () => settings.set({ quickLinks: [...(settings.get("quickLinks") || []), { name: one.name, target: one.path }] }) },
      { label: "Show in Windows Explorer", icon: "folder", run: () => api.fs.reveal(paths[0]) },
      one && { label: "Properties", icon: "info", run: () => api.fs.properties(one.path).catch((err) => toast(cleanError(err), { level: "warn" })) },
      !one?.drive && { separator: true },
      !one?.drive && { label: "Delete", icon: "trash", hint: "Del", danger: true, run: () => this.trash() }
    ]);
  }

  backgroundMenu(e) {
    const hasClip = !!shared.clipboard.mode && !!this.cwd;
    contextMenu(e, [
      this.cwd && { label: "New folder", icon: "folder", hint: "Ctrl+Shift+N", run: () => this.create("folder") },
      this.cwd && { label: "New file", icon: "file", run: () => this.create("file") },
      hasClip && { label: `Paste ${shared.clipboard.paths.length} item${shared.clipboard.paths.length === 1 ? "" : "s"}`, icon: "paste", hint: "Ctrl+V", run: () => this.paste() },
      this.cwd && { separator: true },
      this.cwd && { label: "Open terminal here", icon: "terminal", run: () => emit("open-terminal", { cwd: this.cwd }) },
      this.cwd && { label: "Analyse disk usage", icon: "disk", run: () => emit("open-disk", { path: this.cwd }) },
      this.cwd && { label: "Search in this folder…", icon: "search", run: () => emit("file-search", { root: this.cwd }) },
      { label: "Refresh", icon: "refresh", hint: "F5", run: () => this.refresh() },
      { separator: true },
      { label: settings.get("explorerView") === "grid" ? "List view" : "Grid view", icon: settings.get("explorerView") === "grid" ? "list" : "grid", run: () => settings.set({ explorerView: settings.get("explorerView") === "grid" ? "list" : "grid" }) },
      { label: settings.get("showHidden") ? "Hide hidden items" : "Show hidden items", icon: "eye", run: () => settings.set({ showHidden: !settings.get("showHidden") }) },
      this.cwd && { label: this.isPinned(this.cwd) ? "Unpin this folder" : "Pin this folder", icon: "pin", run: () => this.togglePin(this.cwd) },
      this.cwd && { label: "Open in Windows Explorer", icon: "external", run: () => api.fs.open(this.cwd).catch((err) => toast(cleanError(err), { level: "warn" })) },
      this.cwd && { label: "Copy folder path", icon: "link", run: () => copyText(this.cwd, "Path copied") }
    ]);
  }

  activate() {
    if (this.cwd !== null && Date.now() - this.loadedAt > 4000) this.refresh();
    requestAnimationFrame(() => this.main?.focus({ preventScroll: true }));
  }

  focus() {
    this.main?.focus();
  }

  dispose() {
    this.unwatch.forEach((fn) => fn());
    this.thumbObserver?.disconnect();
    clearTimeout(this.typeaheadTimer);
  }
}
