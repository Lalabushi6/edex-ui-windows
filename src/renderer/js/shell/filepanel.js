// eDEX-UI's filesystem module: a compact file browser docked in the bottom
// strip (beside the keyboard) or under the panel columns. It follows the
// active terminal's working directory, and clicking a folder `cd`s the
// shell there when it is waiting at a prompt (otherwise the panel just
// browses on its own).
import { h, setText } from "../core/dom.js";
import { icon, fileKind } from "../core/icons.js";
import * as settings from "../core/settings.js";
import * as fmt from "../core/format.js";
import { on, emit } from "../core/bus.js";
import { onDrives } from "../core/live.js";
import { toast, contextMenu, copyText, cleanError } from "../core/ui.js";
import { openViewer } from "./viewer.js";

const api = window.edex;
const KIND_LABEL = {
  folder: "Folder", image: "Image", audio: "Audio", video: "Video", archive: "Archive", pdf: "PDF document",
  app: "Program", shortcut: "Shortcut", code: "Source code", text: "Text document"
};
const PREVIEWABLE = new Set(["image", "audio", "video", "pdf", "text", "code"]);
const MAX_ROWS = 600;

// The command that changes directory in each shell, or null where the
// panel should not type into the shell (WSL / Git Bash use other paths).
function cdCommand(shell, path) {
  if (shell === "powershell" || shell === "pwsh") return `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'`;
  if (shell === "cmd") return `cd /d "${path}"`;
  return null;
}

export function initFilePanel(root, getTerminal) {
  let path = "";
  let entries = [];
  let disks = false;
  let loaded = false;
  let loading = 0;
  let drives = [];
  let offDrives = null;
  let special = { themes: "", keyboards: "" };

  const status = h("span", { class: "fp-status" });
  const list = h("div", { class: "fp-list", tabindex: 0 });
  const mountLabel = h("span", { class: "fp-mount" });
  const mountBar = h("div", { class: "fp-bar" }, h("i"));
  const viewBtn = h("button", { class: "icon-btn sm", type: "button", title: "List / icon view" }, icon("list"));
  const hiddenBtn = h("button", { class: "icon-btn sm", type: "button", title: "Show hidden files" }, icon("eye"));
  const followBtn = h("button", { class: "icon-btn sm", type: "button", title: "Follow the terminal's folder" }, icon("terminal"));
  root.replaceChildren(
    h("div", { class: "col-title fp-title" }, h("span", null, "FILESYSTEM"), status),
    list,
    h("div", { class: "fp-foot" }, mountLabel, mountBar, viewBtn, hiddenBtn, followBtn));

  const typeOf = (e) => {
    if (e.isDir) return "Folder";
    const dir = fmt.dirname(e.path).toLowerCase();
    if (e.ext === ".json" && special.themes && dir === special.themes) return "eDEX-UI theme";
    if (e.ext === ".json" && special.keyboards && dir === special.keyboards) return "eDEX-UI keyboard layout";
    const kind = fileKind(e.name, false);
    if (KIND_LABEL[kind]) return KIND_LABEL[kind];
    return e.ext ? `${e.ext.slice(1).toUpperCase()} file` : "File";
  };

  // ── Rendering ────────────────────────────────────────────────────────────
  function row({ ico, name, type = "", size = "", date = "", title, onOpen, onMenu, cls = "" }) {
    const el = h("div", { class: `fp-item ${cls}`, title: title || name, role: "button" },
      h("span", { class: "fp-ico" }, icon(ico)),
      h("span", { class: "fp-name" }, name),
      h("span", { class: "fp-type" }, type),
      h("span", { class: "fp-size" }, size),
      h("span", { class: "fp-date" }, date));
    el.addEventListener("click", onOpen);
    if (onMenu) el.addEventListener("contextmenu", onMenu);
    return el;
  }

  function render() {
    const grid = settings.get("filesView") === "grid";
    list.classList.toggle("grid", grid);
    viewBtn.replaceChildren(icon(grid ? "grid" : "list"));
    hiddenBtn.classList.toggle("active", !!settings.get("showHidden"));
    followBtn.classList.toggle("active", settings.get("filesFollowTerminal") !== false);
    const frag = document.createDocumentFragment();
    if (disks) {
      setText(status, "Showing available drives");
      for (const d of drives) {
        const mount = fmt.normPath(d.mount || d.fs);
        frag.append(row({
          ico: "drive", name: `${mount.replace(/\\$/, "")} ${d.type || ""}`.trim(), type: "Drive",
          size: d.size ? `${fmt.bytes(d.size - d.used, 1)} free` : "", cls: "disk",
          onOpen: () => go(mount), onMenu: (e) => menu(e, { path: mount, isDir: true })
        }));
      }
    } else {
      const hidden = !settings.get("showHidden");
      setText(status, `${hidden ? "hidden files off" : "hidden files shown"} · ${path}`);
      status.title = path;
      frag.append(row({ ico: "grid", name: "Show drives", cls: "special", onOpen: () => showDisks() }));
      const parent = fmt.dirname(path);
      if (parent && fmt.normPath(parent).toLowerCase() !== fmt.normPath(path).toLowerCase()) {
        frag.append(row({ ico: "up", name: "Go up", cls: "special", onOpen: () => go(parent) }));
      }
      const shown = entries.filter((e) => !hidden || !e.hidden);
      for (const e of shown.slice(0, MAX_ROWS)) {
        frag.append(row({
          ico: fileKind(e.name, e.isDir), name: e.name, type: typeOf(e),
          size: e.isDir ? "" : fmt.bytes(e.size, 2),
          date: e.mtime ? new Date(e.mtime).toLocaleString() : "",
          title: e.path, cls: e.hidden ? "dim" : "",
          onOpen: () => open(e), onMenu: (ev) => menu(ev, e)
        }));
      }
      if (shown.length > MAX_ROWS) frag.append(h("div", { class: "fp-more" }, `${shown.length - MAX_ROWS} more — open in the explorer to see everything`));
      if (!shown.length) frag.append(h("div", { class: "fp-more" }, "Empty folder"));
    }
    list.replaceChildren(frag);
    paintMount();
  }

  function paintMount() {
    const rootDrive = (disks ? "" : path.slice(0, 2)).toUpperCase();
    const d = drives.find((x) => fmt.normPath(x.mount || x.fs).slice(0, 2).toUpperCase() === rootDrive);
    if (!d) { setText(mountLabel, disks ? `${drives.length} drives` : ""); mountBar.hidden = true; return; }
    mountBar.hidden = false;
    setText(mountLabel, `Mount ${rootDrive} used ${Math.round(d.use)}%`);
    mountBar.firstElementChild.style.width = `${Math.max(0, Math.min(100, d.use))}%`;
    mountBar.title = `${fmt.bytes(d.used)} of ${fmt.bytes(d.size)}`;
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  async function load(target, { fresh = false } = {}) {
    const ticket = ++loading;
    try {
      const res = await api.fs.list(target, { fresh });
      if (ticket !== loading) return;
      path = res.dir;
      disks = false;
      entries = res.entries.slice().sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      render();
      list.scrollTop = 0;
    } catch (e) {
      if (ticket === loading) toast(cleanError(e), { level: "warn" });
    }
  }

  function showDisks() {
    disks = true;
    render();
  }

  // Folders: `cd` the shell when it is idle at a prompt, so the terminal and
  // the panel stay in step (as in eDEX-UI); otherwise browse locally.
  function go(target) {
    const term = getTerminal();
    const cmd = term && term.alive && term.atPrompt && settings.get("filesFollowTerminal") !== false ? cdCommand(term.shell, target) : null;
    if (cmd) {
      term.sendKeys(`${cmd}\r`);
      term.focus();
    }
    load(target);
  }

  function open(e) {
    if (e.isDir) { go(e.path); return; }
    const kind = fileKind(e.name, false);
    if (PREVIEWABLE.has(kind)) {
      const siblings = entries.filter((x) => !x.isDir && PREVIEWABLE.has(fileKind(x.name, false))).map((x) => x.path);
      openViewer(e.path, { siblings });
    } else {
      api.fs.open(e.path).catch((err) => toast(cleanError(err), { level: "warn" }));
    }
  }

  function menu(ev, e) {
    const term = getTerminal();
    contextMenu(ev, [
      { label: e.isDir ? "Open folder" : "Open", icon: "external", run: () => (e.isDir ? go(e.path) : api.fs.open(e.path).catch((err) => toast(cleanError(err), { level: "warn" }))) },
      !e.isDir && PREVIEWABLE.has(fileKind(e.name, false)) && { label: "Preview", icon: "eye", run: () => openViewer(e.path) },
      { label: "Open in explorer tab", icon: "folder", run: () => emit("open-path", e.isDir ? { path: e.path, newTab: true } : { path: fmt.dirname(e.path), select: e.path, newTab: true }) },
      { label: "Show in Windows Explorer", icon: "window", run: () => api.fs.reveal(e.path) },
      { label: "Copy path", icon: "copy", run: () => copyText(e.path, "Path copied") },
      term?.alive && { label: "Insert path in terminal", icon: "terminal", run: () => { term.sendKeys(/\s/.test(e.path) ? `"${e.path}"` : e.path); term.focus(); } },
      { separator: true },
      ...viewItems()
    ]);
  }

  function viewItems() {
    const grid = settings.get("filesView") === "grid";
    return [
      { label: grid ? "List view" : "Icon view", icon: grid ? "list" : "grid", run: () => settings.set({ filesView: grid ? "list" : "grid" }) },
      { label: settings.get("showHidden") ? "Hide hidden files" : "Show hidden files", icon: "eye", run: () => settings.set({ showHidden: !settings.get("showHidden") }) },
      { label: settings.get("filesFollowTerminal") !== false ? "Stop following the terminal" : "Follow the terminal", icon: "terminal", run: () => settings.set({ filesFollowTerminal: settings.get("filesFollowTerminal") === false }) },
      { label: "Refresh", icon: "refresh", run: () => (disks ? showDisks() : load(path, { fresh: true })) }
    ];
  }

  list.addEventListener("contextmenu", (ev) => {
    if (ev.target.closest(".fp-item")) return;
    contextMenu(ev, viewItems());
  });
  viewBtn.addEventListener("click", () => settings.set({ filesView: settings.get("filesView") === "grid" ? "list" : "grid" }));
  hiddenBtn.addEventListener("click", () => settings.set({ showHidden: !settings.get("showHidden") }));
  followBtn.addEventListener("click", () => settings.set({ filesFollowTerminal: settings.get("filesFollowTerminal") === false }));

  // ── Wiring ───────────────────────────────────────────────────────────────
  let refreshTimer = null;
  on("terminal-cwd", ({ tab, cwd, changed }) => {
    if (root.hidden || settings.get("filesFollowTerminal") === false || tab !== getTerminal()) return;
    clearTimeout(refreshTimer);
    // A prompt after a command: the folder may have changed contents too.
    refreshTimer = setTimeout(() => load(cwd, { fresh: !changed || fmt.pathsEqual(cwd, path) }), 200);
  });
  settings.watch(["filesView", "showHidden", "filesFollowTerminal"], () => { if (loaded) render(); });

  // Loads the first time the panel is shown; drive usage only while visible.
  async function start() {
    if (root.hidden) {
      offDrives?.();
      offDrives = null;
      return;
    }
    offDrives ||= onDrives((ds) => { drives = ds; if (loaded) (disks ? render() : paintMount()); });
    if (loaded) return;
    loaded = true;
    try {
      const [home, kb, themes] = await Promise.all([
        api.fs.home(), api.kb.list().catch(() => null), api.themes.folder?.().catch(() => "") ?? ""
      ]);
      special = { keyboards: (kb?.folder || "").toLowerCase(), themes: String(themes || "").toLowerCase() };
      const term = getTerminal();
      await load(term?.cwd || home);
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
    }
  }
  on("layout", () => start());
  start();
}
