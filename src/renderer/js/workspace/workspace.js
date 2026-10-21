// Tabbed center workspace. Tabs (terminals, explorers, process manager,
// browser pages, wallpapers, app windows …) are restored on the next launch.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { on } from "../core/bus.js";
import { poll } from "../core/poll.js";
import { contextMenu, prompt, toast, popover } from "../core/ui.js";
import { TerminalTab } from "./terminal.js";
import { ExplorerTab } from "./explorer.js";
import { ProcessesTab } from "./processes.js";
import { MediaTab, addPaths } from "./media.js";
import { DiskTab } from "./disk.js";
import { BrowserTab } from "./browser.js";
import { WallpaperTab } from "./wallpaper.js";
import { AppTab } from "./apptab.js";
import { editWallpaperArt } from "../shell/wallpaper.js";

const TYPES = { terminal: TerminalTab, files: ExplorerTab, processes: ProcessesTab, media: MediaTab, disk: DiskTab, browser: BrowserTab, ascii: WallpaperTab, app: AppTab };
const TYPE_ICON = { terminal: "terminal", files: "folder", processes: "process", media: "audio", disk: "disk", browser: "globe", ascii: "wallpaper", app: "apptab" };
const MAX_TABS = 16;     // eDEX's own tabs
const MAX_APP_TABS = 24; // app windows shown as tabs

export class Workspace {
  constructor(root) {
    this.root = root;
    this.tabs = [];
    this.active = null;
    this.shells = [];
    this.restoring = false;
    this.tabsEl = h("div", { class: "tabs", role: "tablist" });
    this.panes = h("div", { class: "panes" });
    const addBtn = h("button", { class: "icon-btn", type: "button", title: "New terminal (Ctrl+Shift+T)", onclick: () => this.add("terminal") }, icon("plus"));
    const menuBtn = h("button", { class: "icon-btn", type: "button", title: "New tab…", onclick: (e) => this.newTabMenu(e) }, icon("chevronDown"));
    root.append(h("div", { class: "tabbar" }, this.tabsEl, h("div", { class: "tab-actions" }, addBtn, menuBtn)), this.panes);
    this.tabsEl.addEventListener("wheel", (e) => { this.tabsEl.scrollLeft += e.deltaY; }, { passive: true });

    on("open-path", ({ path, newTab, select }) => this.openPath(path, { newTab, select }));
    on("open-browser", ({ url = "" } = {}) => this.openBrowser(url));
    on("open-app-tab", (w) => this.openApp(w));
    on("open-wallpaper", () => this.openWallpaper());
    on("idle-wallpaper", () => this.showIdleWallpaper());
    on("open-terminal", ({ cwd, shell } = {}) => this.add("terminal", { cwd, shell }));
    on("open-processes", (opts = {}) => this.openProcesses(opts));
    on("open-disk", (opts = {}) => this.openDisk(opts));
    // { paths?, play?, focus? } — queue files/folders in the media player.
    on("open-media", async ({ paths, play = true, focus = true } = {}) => {
      if (paths?.length) await addPaths(paths, { play });
      if (focus) await this.openMedia();
    });
    on("terminal-input", ({ text }) => {
      const tab = this.active?.type === "terminal" ? this.active : this.tabs.find((x) => x.type === "terminal");
      if (tab) { this.activate(tab); tab.focusedPane().input(text); }
    });
    // Run a command (launcher "$ …", an AI answer): the focused pane of the
    // active terminal, another live one, or a new tab once its shell started.
    on("terminal-run", async ({ command }) => {
      if (!command) return;
      const live = (tab) => tab?.type === "terminal" && tab.focusedPane().alive;
      let tab = live(this.active) ? this.active : this.tabs.find(live);
      if (!tab) tab = await this.add("terminal");
      if (!tab) return;
      this.activate(tab);
      const t = tab.focusedPane();
      for (let i = 0; i < 50 && !t.alive; i++) await new Promise((r) => setTimeout(r, 100));
      if (!t.alive) return;
      t.sendKeys(`${command}\r`);
      t.focus();
    });
  }

  async init() {
    this.shells = await window.edex.term.shells().catch(() => []);
    const saved = settings.get("workspace");
    this.restoring = true;
    const specs = saved?.tabs?.length ? saved.tabs : [{ type: "terminal", welcome: true }, { type: "files" }];
    for (const spec of specs) await this.add(spec.type, spec, { activate: false });
    this.restoring = false;
    const idx = Math.min(saved?.active ?? 0, this.tabs.length - 1);
    if (this.tabs[idx]) this.activate(this.tabs[idx], { silent: true });
    this.persist();
    // "Show every open window as a tab" (Settings → Web & apps).
    this.appSync = poll(() => this.syncAppTabs(), 2500, { immediate: false });
    settings.watch("appTabs", () => this.syncAppTabs());
    this.syncAppTabs();
  }

  async add(type, opts = {}, { activate = true } = {}) {
    const Ctor = TYPES[type];
    if (!Ctor) return null;
    const apps = this.tabs.filter((t) => t.type === "app").length;
    if (type === "app" ? apps >= MAX_APP_TABS : this.tabs.length - apps >= MAX_TABS) {
      toast(type === "app" ? `At most ${MAX_APP_TABS} app tabs` : `At most ${MAX_TABS} tabs — close one first`, { level: "warn" });
      return null;
    }
    const tab = new Ctor(this, opts);
    tab.iconEl = icon(TYPE_ICON[type]);
    tab.tabEl = h("button", { class: `tab tab-${type}`, type: "button", role: "tab" },
      tab.iconEl,
      tab.labelEl = h("span", { class: "t" }, tab.label),
      h("span", {
        class: "icon-btn sm x", role: "button", title: "Close tab (Ctrl+Shift+W)",
        onclick: (e) => { e.stopPropagation(); this.close(tab); }
      }, icon("close")));
    tab.tabEl.addEventListener("click", () => this.activate(tab));
    tab.tabEl.addEventListener("auxclick", (e) => { if (e.button === 1) this.close(tab); });
    tab.tabEl.addEventListener("dblclick", () => this.rename(tab));
    tab.tabEl.addEventListener("contextmenu", (e) => contextMenu(e, [
      { label: "Rename tab", icon: "edit", run: () => this.rename(tab) },
      tab.type === "terminal" && { label: "Restart shell", icon: "restart", run: () => tab.focusedPane().restart() },
      tab.type === "terminal" && { label: "Duplicate tab", icon: "copy", run: () => this.add("terminal", { shell: tab.shell }) },
      tab.type === "terminal" && { label: "Split right", icon: "layout", hint: "Alt+Shift+=", run: () => { this.activate(tab); tab.split("right"); } },
      tab.type === "terminal" && { label: "Split down", icon: "layout", hint: "Alt+Shift+-", run: () => { this.activate(tab); tab.split("down"); } },
      tab.type === "terminal" && tab.panes?.length > 1 && { label: "Close pane", icon: "close", run: () => tab.closePane() },
      tab.type === "files" && tab.cwd && { label: "Duplicate tab", icon: "copy", run: () => this.add("files", { cwd: tab.cwd }) },
      tab.type === "browser" && { label: "Reload", icon: "refresh", run: () => tab.action("reload") },
      tab.type === "browser" && { label: "Duplicate tab", icon: "copy", run: () => this.openBrowser(tab.page.url || tab.url) },
      tab.type === "browser" && { label: "Open in your browser", icon: "external", run: () => tab.action("external") },
      tab.type === "ascii" && { label: "Edit ASCII art…", icon: "edit", run: () => editWallpaperArt() },
      tab.type === "app" && { label: "Show window", icon: "window", run: () => { this.activate(tab); tab.show(); } },
      tab.type === "app" && { label: "Close window", icon: "close", danger: true, run: () => tab.closeWindow() },
      { separator: true },
      { label: tab.type === "app" ? "Close tab (put the window back)" : "Close tab", icon: "close", run: () => this.close(tab) },
      { label: "Close other tabs", icon: "close", disabled: this.tabs.length < 2, run: () => this.tabs.filter((t) => t !== tab).forEach((t) => this.close(t)) }
    ]));
    this.tabs.push(tab);
    this.tabsEl.append(tab.tabEl);
    this.panes.append(tab.el);
    if (activate) this.activate(tab);
    try {
      await tab.mount();
    } catch (e) {
      console.error(`tab ${type} failed to mount`, e);
    }
    if (activate && this.active === tab) tab.activate();
    this.persist();
    return tab;
  }

  activate(tab, { silent = false } = {}) {
    if (!tab) return;
    if (this.active && this.active !== tab) {
      this.active.tabEl.classList.remove("active");
      this.active.el.classList.remove("active");
      this.active.deactivate?.();
    }
    this.active = tab;
    tab.tabEl.classList.add("active");
    tab.el.classList.add("active");
    tab.tabEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.updateCaption();
    tab.activate();
    if (!silent) sfx.play("folder");
    this.persist();
  }

  close(tab) {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    if (this.idle?.tab === tab) this.idle = null;
    tab.dispose();
    tab.tabEl.remove();
    tab.el.remove();
    this.tabs.splice(i, 1);
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (next) this.activate(next);
    }
    if (!this.tabs.length) this.add("terminal");
    this.persist();
  }

  // Ctrl+Shift+W: the focused pane of a split terminal, else the tab.
  closeActive() {
    if (!this.active) return;
    if (this.active.type === "terminal" && this.active.panes?.length > 1) this.active.closePane();
    else this.close(this.active);
  }

  cycle(delta) {
    if (!this.tabs.length) return;
    const i = this.tabs.indexOf(this.active);
    this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length]);
  }

  byIndex(i) {
    if (this.tabs[i]) this.activate(this.tabs[i]);
  }

  async rename(tab) {
    const label = await prompt({ title: "Rename tab", value: tab.label });
    if (!label) return;
    tab.customLabel = label.slice(0, 40);
    tab.label = tab.customLabel;
    this.updateTab(tab);
    this.persist();
  }

  updateTab(tab) {
    if (tab.labelEl) setText(tab.labelEl, tab.label);
    if (tab.tabEl) tab.tabEl.title = tab.label;
    if (tab === this.active) this.updateCaption();
  }

  // A picture for the tab (site favicon, app icon); null puts the type's
  // icon back.
  setTabIcon(tab, src) {
    if (!tab.tabEl || !tab.iconEl) return;
    const next = src ? h("img", { class: "tab-favicon", src, alt: "" }) : icon(TYPE_ICON[tab.type]);
    tab.iconEl.replaceWith(next);
    tab.iconEl = next;
  }

  // The eDEX-style caption above the frame: "TERMINAL ...... MAIN SHELL".
  updateCaption() {
    const tab = this.active;
    if (!tab) return;
    const kind = { terminal: "TERMINAL", files: "FILESYSTEM", processes: "PROCESSES", media: "MEDIA", disk: "DISK USAGE", browser: "BROWSER", ascii: "WALLPAPER", app: "APPLICATION" }[tab.type] || "WORKSPACE";
    const first = this.tabs.find((t) => t.type === "terminal");
    setText(document.getElementById("work-title-a"), kind);
    setText(document.getElementById("work-title-b"), tab === first && !tab.customLabel ? "MAIN SHELL" : String(tab.label).toUpperCase());
  }

  markDead(tab, dead) {
    tab.tabEl?.classList.toggle("dead", dead);
  }

  persist() {
    if (this.restoring) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      // Some tabs aren't restored (the idle pane, auto app tabs).
      const kept = this.tabs.map((t) => [t, t.serialize()]).filter(([, s]) => s);
      const active = kept.findIndex(([t]) => t === this.active);
      settings.set({ workspace: { tabs: kept.map(([, s]) => s), active: Math.max(0, active) } });
    }, 400);
  }

  async openPath(path, { newTab = false, select } = {}) {
    let tab = !newTab && (this.active?.type === "files" ? this.active : this.tabs.find((t) => t.type === "files"));
    if (!tab) {
      tab = await this.add("files", { cwd: path });
      if (select) tab?.selectPath(select);
      return;
    }
    this.activate(tab);
    await tab.navigate(path, { select });
  }

  async openProcesses({ pid, sort } = {}) {
    let tab = this.tabs.find((t) => t.type === "processes");
    if (!tab) tab = await this.add("processes");
    else this.activate(tab);
    if (!tab) return;
    if (sort) tab.sortBy(sort);
    if (pid) tab.select(pid);
  }

  // { path? } — the disk usage map, scanning `path` when given.
  async openDisk({ path } = {}) {
    const tab = this.tabs.find((t) => t.type === "disk");
    if (tab) {
      this.activate(tab);
      if (path) tab.scan(path);
      return tab;
    }
    return this.add("disk", { cwd: path });
  }

  async openMedia() {
    const tab = this.tabs.find((t) => t.type === "media");
    if (tab) { this.activate(tab); return tab; }
    return this.add("media");
  }

  activeTerminal() {
    return this.active?.type === "terminal" ? this.active.focusedPane() : null;
  }

  // A new browser tab (empty: the start page with the address bar).
  async openBrowser(url = "", { activate = true } = {}) {
    return this.add("browser", { url }, { activate });
  }

  async openWallpaper() {
    const tab = this.tabs.find((t) => t.type === "ascii" && !t.idle);
    if (tab) { this.activate(tab); return tab; }
    return this.add("ascii");
  }

  // An open window as a tab: { hwnd, title, exe }.
  async openApp(w, { activate = true, auto = false } = {}) {
    if (!w?.hwnd) return null;
    const existing = this.tabs.find((t) => t.type === "app" && t.hwnd === w.hwnd);
    if (existing) { if (activate) this.activate(existing); return existing; }
    return this.add("app", { hwnd: w.hwnd, title: w.title, exe: w.exe, auto }, { activate });
  }

  // Picker of open windows for "App window…".
  async pickApp(anchor) {
    const list = (await window.edex.win.list().catch(() => [])).filter((w) => !this.tabs.some((t) => t.type === "app" && t.hwnd === w.hwnd));
    popover(anchor, (close) => h("div", { class: "app-picker" },
      h("div", { class: "panel-title" }, "Show a window as a tab"),
      list.length ? h("div", { class: "app-picker-list" }, ...list.map((w) => h("button", {
        class: "app-picker-item", type: "button", title: w.title,
        onclick: () => { close(); this.openApp(w); }
      }, icon("window"), h("span", { class: "ellipsis grow" }, w.title), h("span", { class: "muted" }, w.app)))) : h("div", { class: "muted" }, "No other open windows")), { className: "app-picker-pop" });
  }

  // Keeps one tab per open window while appTabs is "all"; turning it off
  // closes those tabs (their windows go back where they were).
  async syncAppTabs() {
    const all = settings.get("appTabs") === "all";
    if (!all) for (const t of this.tabs.filter((x) => x.type === "app" && x.auto)) this.close(t);
    const appTabs = this.tabs.filter((t) => t.type === "app" && t.hwnd);
    if (!all && !appTabs.length) return;
    const list = await window.edex.win.list().catch(() => null);
    if (!list) return;
    // Windows that closed take their tabs with them.
    const open = new Set(list.map((w) => w.hwnd));
    for (const t of appTabs) if (!open.has(t.hwnd) && this.tabs.includes(t)) this.close(t);
    if (!all) return;
    for (const w of list) {
      if (!this.tabs.some((t) => t.type === "app" && t.hwnd === w.hwnd)) await this.openApp(w, { activate: false, auto: true });
    }
  }

  // Idle style "wallpaper": the ASCII wallpaper pane takes the active tab's
  // place until the next key press or mouse move.
  async showIdleWallpaper() {
    if (this.idle || this.active?.type === "ascii") return;
    const prev = this.active;
    let tab = this.tabs.find((t) => t.type === "ascii");
    const temp = !tab;
    if (temp) tab = await this.add("ascii", { idle: true }, { activate: false });
    if (!tab) return;
    this.activate(tab, { silent: true });
    this.idle = { tab, prev, temp };
    const start = { x: null, y: null };
    const back = (e) => {
      if (e.type === "mousemove") {
        if (start.x === null) { start.x = e.clientX; start.y = e.clientY; return; }
        if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) < 12) return;
      }
      // The key or click that wakes eDEX isn't passed on (to the terminal).
      if (e.type === "keydown" || e.type === "mousedown") { e.preventDefault(); e.stopPropagation(); }
      for (const t of ["mousemove", "mousedown", "keydown", "wheel"]) window.removeEventListener(t, back, true);
      this.hideIdleWallpaper();
    };
    setTimeout(() => {
      for (const t of ["mousemove", "mousedown", "keydown", "wheel"]) window.addEventListener(t, back, { capture: true, passive: false });
    }, 400);
  }

  hideIdleWallpaper() {
    const idle = this.idle;
    this.idle = null;
    if (!idle) return;
    if (idle.prev && this.tabs.includes(idle.prev)) this.activate(idle.prev, { silent: true });
    if (idle.temp) this.close(idle.tab);
  }

  newTabMenu(e) {
    const anchor = e.currentTarget;
    contextMenu(e, [
      ...this.shells.map((s) => ({ label: s.name, icon: "terminal", hint: s.id === settings.get("defaultShell") ? "default" : "", run: () => this.add("terminal", { shell: s.id }) })),
      { separator: true },
      { label: "File explorer", icon: "folder", hint: "Ctrl+Shift+E", run: () => this.add("files") },
      { label: "Browser", icon: "globe", hint: "Ctrl+Shift+B", run: () => this.openBrowser("") },
      { label: "App window…", icon: "apptab", run: () => this.pickApp(anchor) },
      { label: "Process manager", icon: "process", run: () => this.openProcesses() },
      { label: "Media player", icon: "audio", hint: "Ctrl+Shift+M", run: () => this.openMedia() },
      { label: "Disk usage", icon: "disk", run: () => this.openDisk() },
      { label: "ASCII wallpaper", icon: "wallpaper", run: () => this.openWallpaper() }
    ]);
  }

  focus() {
    this.active?.focus?.();
  }
}
