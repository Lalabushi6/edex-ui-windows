// App tab: an open app window shown as a workspace tab. Activating the tab
// moves the real window into the tab's area and brings it forward (see
// src/main/ipc/apptabs.js); switching away minimises it; closing the tab
// puts it back where it was. Behind the window the tab keeps a picture of it,
// so clicking eDEX doesn't leave a blank tab: click the picture to bring the
// window back. A card with buttons only shows when the window needs you
// (you moved it out of the tab, or minimised it).
import { h, setText, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import { toast, cleanError } from "../core/ui.js";
import { exeIcons } from "../shell/launcher.js";

const api = window.edex;
const CHECK_MS = 1500;
const STILL_FRESH_MS = 1500; // a picture this recent is reused when switching away
const shortTitle = (t) => {
  const s = String(t || "Window");
  // "Document - App" -> "Document" keeps tab labels short.
  const parts = s.split(/\s[-–—|]\s/);
  return (parts.length > 1 ? parts.slice(0, -1).join(" - ") : s).slice(0, 40) || s.slice(0, 40);
};

export class AppTab {
  constructor(ws, opts = {}) {
    this.ws = ws;
    this.type = "app";
    this.hwnd = Number(opts.hwnd) || null;
    this.exe = opts.exe || "";
    this.title = opts.title || "";
    this.auto = !!opts.auto;
    this.customLabel = opts.label;
    this.label = opts.label || shortTitle(this.title);
    this.el = h("div", { class: "pane app-pane" });
    this.active = false;
    this.state = "idle"; // idle | shown | moved | minimized
    this.checks = null;
    this.capturing = null;
    this.stillAt = 0;
  }

  // Tabs made by "show every open window as a tab" are rebuilt, not restored.
  serialize() {
    return this.auto ? null : { type: "app", exe: this.exe, title: this.title, label: this.customLabel };
  }

  get appName() {
    return this.exe ? this.exe.split(/[\\/]/).pop().replace(/\.exe$/i, "") : "App";
  }

  async mount() {
    if (!this.hwnd) {
      // Restored from the last session: find the same program's window.
      const list = await api.win.list().catch(() => []);
      const w = list.find((x) => x.exe === this.exe && x.title === this.title) || list.find((x) => this.exe && x.exe === this.exe);
      if (!w || this.ws.tabs.some((t) => t !== this && t.type === "app" && t.hwnd === w.hwnd)) {
        setTimeout(() => this.ws.close(this, { quiet: true }), 0);
        return;
      }
      this.hwnd = w.hwnd;
      this.title = w.title;
      if (!this.customLabel) { this.label = shortTitle(w.title); this.ws.updateTab(this); }
    }
    this.still = h("img", { class: "app-still", alt: "", hidden: true });
    this.iconEl = h("span", { class: "app-icon" }, icon("apptab"));
    this.titleEl = h("div", { class: "app-title" });
    this.stateEl = h("div", { class: "app-state muted" });
    this.card = h("div", { class: "app-card" },
      this.iconEl, this.titleEl, this.stateEl,
      h("div", { class: "app-actions" },
        h("button", { class: "btn primary", type: "button", onclick: () => this.show() }, icon("window"), "Show window"),
        h("button", { class: "btn", type: "button", title: "Put the window back where it was and close this tab", onclick: () => this.ws.close(this) }, icon("external"), "Put back"),
        h("button", { class: "btn danger", type: "button", onclick: () => this.closeWindow() }, icon("close"), "Close window")));
    // While the window is just behind eDEX: its picture, and on hover a
    // small reminder that a click brings it back.
    this.hint = h("div", { class: "app-hint" });
    this.host = h("div", { class: "app-host", dataset: { state: this.state } }, this.still, this.card, this.hint);
    this.host.addEventListener("click", (e) => { if (!e.target.closest("button")) this.show(); });
    this.el.append(this.host);
    this.ro = new ResizeObserver(debounce(() => { if (this.active && this.state === "shown") this.place(false); }, 250));
    this.ro.observe(this.host);
    // eDEX came forward (its window now covers this one): keep a picture.
    this.onFocus = () => { if (this.active && this.state === "shown") this.capture(); };
    window.addEventListener("focus", this.onFocus);
    exeIcons([this.exe].filter(Boolean)).then((icons) => {
      const src = icons?.[this.exe];
      if (src) { this.iconEl.replaceChildren(h("img", { src, alt: "" })); this.ws.setTabIcon(this, src); }
    }).catch(() => {});
    this.render();
  }

  render() {
    if (!this.titleEl) return;
    const name = this.title || this.appName;
    setText(this.titleEl, name);
    setText(this.stateEl, {
      idle: `${this.appName} · click to show it here`,
      shown: `${this.appName} · click to bring it back`,
      moved: `${this.appName} · moved out of the tab — click to put it back in`,
      minimized: `${this.appName} · minimised — click to show it`
    }[this.state] || this.appName);
    setText(this.hint, "Click to bring the window back");
    this.host.dataset.state = this.state;
    this.host.classList.toggle("has-still", !this.still.hidden);
  }

  rect() {
    const r = this.host.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  async place(focus) {
    if (!this.hwnd) return;
    try {
      const r = await api.appTabs.show(this.hwnd, this.rect(), { focus });
      if (r?.gone) return this.gone();
      if (r?.title && r.title !== this.title) this.retitle(r.title);
      if (this.active) this.state = "shown";
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
    }
    this.render();
  }

  show() {
    this.place(true);
    this.startChecks();
  }

  retitle(title) {
    this.title = title;
    if (!this.customLabel) { this.label = shortTitle(title); this.ws.updateTab(this); }
  }

  // A picture for the placeholder, taken while the window is still drawn.
  capture() {
    if (!this.hwnd) return Promise.resolve();
    if (!this.capturing) {
      this.capturing = api.appTabs.snapshot(this.hwnd).then((src) => {
        if (!src) return;
        this.still.src = src;
        this.still.hidden = false;
        this.stillAt = Date.now();
        this.render();
      }).catch(() => {}).finally(() => { this.capturing = null; });
    }
    return this.capturing;
  }

  // Checks run on the shared scheduler, so they pause while eDEX is hidden.
  startChecks() {
    this.checks?.stop();
    this.checks = poll(() => this.check(), CHECK_MS, { immediate: false, fixed: true });
  }

  stopChecks() {
    this.checks?.stop();
    this.checks = null;
  }

  async check() {
    if (!this.active || !this.hwnd) return;
    const r = await api.appTabs.check(this.hwnd).catch(() => null);
    if (!r || !this.active) return;
    if (r.gone) return this.gone();
    if (r.title && r.title !== this.title) { this.retitle(r.title); this.render(); }
    const next = r.moved ? "moved" : r.minimized ? "minimized" : "shown";
    if (next !== this.state) { this.state = next; this.render(); }
  }

  gone() {
    this.stopChecks();
    this.hwnd = null;
    toast(`${this.title || this.appName} closed`, { timeout: 1800 });
    this.ws.close(this, { quiet: true });
  }

  async closeWindow() {
    if (!this.hwnd) return;
    await api.win.close(this.hwnd).catch((e) => toast(cleanError(e), { level: "warn" }));
    setTimeout(() => this.check(), 700);
  }

  activate() {
    this.active = true;
    if (!this.host) { requestAnimationFrame(() => this.host && this.active && this.activate()); return; }
    requestAnimationFrame(() => { if (this.active) this.show(); });
  }

  async deactivate() {
    this.active = false;
    this.stopChecks();
    if (!this.hwnd || this.state === "moved") return;
    // The picture taken when eDEX came forward is reused (or a quick new one
    // taken), so the window steps aside at once instead of lingering over
    // the next tab.
    if (this.capturing) await this.capturing;
    else if (Date.now() - this.stillAt > STILL_FRESH_MS) await Promise.race([this.capture(), new Promise((r) => setTimeout(r, 700))]);
    // Switched straight back while that ran: leave the window where it is.
    if (this.active || !this.hwnd) return;
    api.appTabs.hide(this.hwnd).catch(() => {});
    this.state = "idle";
    this.render();
  }

  focus() {
    if (this.active) this.show();
  }

  dispose() {
    this.active = false;
    this.stopChecks();
    this.ro?.disconnect();
    window.removeEventListener("focus", this.onFocus);
    if (this.hwnd) api.appTabs.release(this.hwnd, { focus: false }).catch(() => {});
  }
}
