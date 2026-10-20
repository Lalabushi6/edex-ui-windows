// Tabbed center workspace. Tabs (terminals, explorers, process manager) are
// restored on the next launch.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { on } from "../core/bus.js";
import { contextMenu, prompt } from "../core/ui.js";
import { TerminalTab } from "./terminal.js";
import { ExplorerTab } from "./explorer.js";
import { ProcessesTab } from "./processes.js";
import { MediaTab, addPaths } from "./media.js";
import { DiskTab } from "./disk.js";

const TYPES = { terminal: TerminalTab, files: ExplorerTab, processes: ProcessesTab, media: MediaTab, disk: DiskTab };
const TYPE_ICON = { terminal: "terminal", files: "folder", processes: "process", media: "audio", disk: "disk" };
const MAX_TABS = 16;

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
  }

  async add(type, opts = {}, { activate = true } = {}) {
    const Ctor = TYPES[type];
    if (!Ctor) return null;
    if (this.tabs.length >= MAX_TABS) return null;
    const tab = new Ctor(this, opts);
    tab.tabEl = h("button", { class: "tab", type: "button", role: "tab" },
      icon(TYPE_ICON[type]),
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
      { separator: true },
      { label: "Close tab", icon: "close", run: () => this.close(tab) },
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

  // The eDEX-style caption above the frame: "TERMINAL ...... MAIN SHELL".
  updateCaption() {
    const tab = this.active;
    if (!tab) return;
    const kind = { terminal: "TERMINAL", files: "FILESYSTEM", processes: "PROCESSES", media: "MEDIA", disk: "DISK USAGE" }[tab.type] || "WORKSPACE";
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
      settings.set({ workspace: { tabs: this.tabs.map((t) => t.serialize()), active: Math.max(0, this.tabs.indexOf(this.active)) } });
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

  newTabMenu(e) {
    contextMenu(e, [
      ...this.shells.map((s) => ({ label: s.name, icon: "terminal", hint: s.id === settings.get("defaultShell") ? "default" : "", run: () => this.add("terminal", { shell: s.id }) })),
      { separator: true },
      { label: "File explorer", icon: "folder", hint: "Ctrl+Shift+E", run: () => this.add("files") },
      { label: "Process manager", icon: "process", run: () => this.openProcesses() },
      { label: "Media player", icon: "audio", hint: "Ctrl+Shift+M", run: () => this.openMedia() },
      { label: "Disk usage", icon: "disk", run: () => this.openDisk() }
    ]);
  }

  focus() {
    this.active?.focus?.();
  }
}
