// App tab: an open app window shown as a workspace tab. Activating the tab
// moves the real window into the tab's area and brings it forward (see
// src/main/ipc/apptabs.js); switching away minimises it; closing the tab
// puts it back where it was. Behind the window the tab keeps a picture of it,
// so clicking eDEX doesn't leave a blank tab: click the picture to bring the
// window back.
import { h, setText, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { toast, cleanError } from "../core/ui.js";
import { exeIcons } from "../shell/launcher.js";

const api = window.edex;
const CHECK_MS = 1500;
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
    this.timer = null;
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
    this.host = h("div", { class: "app-host" }, this.still, this.card);
    this.host.addEventListener("click", (e) => { if (!e.target.closest("button")) this.show(); });
    this.el.append(this.host);
    this.ro = new ResizeObserver(debounce(() => { if (this.active && this.state === "shown") this.place(false); }, 250));
    this.ro.observe(this.host);
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
    setText(this.titleEl, this.title || this.appName);
    setText(this.stateEl, {
      idle: `${this.appName} · click to show it here`,
      shown: `${this.appName} · shown in this tab — click here if it went behind eDEX`,
      moved: `${this.appName} · moved out of the tab — click to put it back in`,
      minimized: `${this.appName} · minimised — click to show it`
    }[this.state] || this.appName);
    this.card.classList.toggle("dim", this.state === "shown" && !this.still.hidden);
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
      this.state = "shown";
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
  async capture() {
    if (!this.hwnd) return;
    const src = await api.appTabs.snapshot(this.hwnd).catch(() => null);
    if (src) { this.still.src = src; this.still.hidden = false; this.render(); }
  }

  startChecks() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.check(), CHECK_MS);
  }

  async check() {
    if (!this.active || !this.hwnd) return;
    const r = await api.appTabs.check(this.hwnd).catch(() => null);
    if (!r) return;
    if (r.gone) return this.gone();
    if (r.title && r.title !== this.title) { this.retitle(r.title); this.render(); }
    const next = r.moved ? "moved" : r.minimized ? "minimized" : "shown";
    if (next !== this.state) { this.state = next; this.render(); }
  }

  gone() {
    clearInterval(this.timer);
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
    if (!this.host) { requestAnimationFrame(() => this.host && this.activate()); return; }
    requestAnimationFrame(() => this.show());
  }

  async deactivate() {
    this.active = false;
    clearInterval(this.timer);
    if (!this.hwnd || this.state === "moved") return;
    await this.capture();
    api.appTabs.hide(this.hwnd).catch(() => {});
    this.state = "idle";
    this.render();
  }

  focus() {
    if (this.active) this.show();
  }

  dispose() {
    this.active = false;
    clearInterval(this.timer);
    this.ro?.disconnect();
    window.removeEventListener("focus", this.onFocus);
    if (this.hwnd) api.appTabs.release(this.hwnd, { focus: false }).catch(() => {});
  }
}
