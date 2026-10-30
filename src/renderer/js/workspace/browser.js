// Browser tab: a real web page (src/main/ipc/browser.js draws it over this
// tab's area) with an eDEX toolbar: back / forward / reload, an address bar
// that takes addresses or searches, zoom, find in page and "open in your
// browser". While an eDEX menu or dialog is open the page steps aside and a
// still of it stays in place.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { toast, cleanError, onCoverChange, isCovered, contextMenu, confirm } from "../core/ui.js";
import { toUrl, openUrl } from "../core/links.js";
import { isQuiet } from "../shell/notices.js";

const api = window.edex;
const tabs = new Map(); // id -> BrowserTab
let seq = 0;
let wired = false;

// Event callbacks return nothing: the context bridge copies a callback's
// return value back to the preload, and a promise of a tab can't be copied.
function wireEvents(ws) {
  if (wired) return;
  wired = true;
  api.browser.onState((s) => { tabs.get(s.id)?.onState(s); });
  api.browser.onOpen(({ url, background }) => { ws.openBrowser(url, { activate: !background }); });
  api.browser.onKey((k) => { tabs.get(k.id)?.onKey(k); });
  api.browser.onDownload(({ state, name, file }) => {
    if (isQuiet()) return; // the notification centre has it
    if (state === "started") toast(`Downloading ${name}…`, { timeout: 2000 });
    else if (state === "completed") toast(`Downloaded ${name}`, { level: "ok", timeout: 5000, action: file ? { label: "Show", run: () => api.fs.reveal(file) } : undefined });
    else if (state === "interrupted") toast(`Download of ${name} failed`, { level: "warn" });
  });
}

export async function clearBrowsingData() {
  if (!(await confirm({ title: "Clear browsing data", message: "Sign-ins, cookies, site storage and the cache of eDEX's browser tabs are deleted. Open tabs stay open.", confirmLabel: "Clear", danger: true }))) return;
  try { await api.browser.clearData(); toast("Browsing data cleared", { level: "ok" }); } catch (e) { toast(cleanError(e), { level: "warn" }); }
}

export class BrowserTab {
  constructor(ws, opts = {}) {
    this.ws = ws;
    this.type = "browser";
    this.id = `b${Date.now().toString(36)}${(seq++).toString(36)}`;
    this.url = opts.url || "";
    this.customLabel = opts.label;
    this.label = opts.label || "New tab";
    this.el = h("div", { class: "pane browser-pane" });
    this.page = { url: "", title: "", loading: false, canBack: false, canForward: false, zoom: 100 };
    this.created = false;
    this.active = false;
    this.covered = false;
    this.problem = null; // { kind: "error" | "crashed", text }
    this.off = [];
    tabs.set(this.id, this);
    wireEvents(ws);
  }

  serialize() {
    const url = /^https?:\/\//i.test(this.page.url) ? this.page.url : this.url;
    return { type: "browser", url: url || undefined, label: this.customLabel };
  }

  async mount() {
    const btn = (name, title, onclick) => h("button", { class: "icon-btn", type: "button", title, onclick }, icon(name));
    this.backBtn = btn("back", "Back (Alt+←)", () => this.action("back"));
    this.fwdBtn = btn("forward", "Forward (Alt+→)", () => this.action("forward"));
    this.reloadBtn = btn("refresh", "Reload (F5)", () => this.action(this.page.loading ? "stop" : "reload"));
    this.address = h("input", { class: "input br-address", spellcheck: false, placeholder: "Search or type an address", autocomplete: "off" });
    this.address.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.go(this.address.value); }
      else if (e.key === "Escape") { this.address.value = this.page.url || this.url; this.address.blur(); this.focusPage(); }
    });
    this.address.addEventListener("focus", () => this.address.select());
    this.zoomBadge = h("button", { class: "br-zoom", type: "button", title: "Reset zoom (Ctrl+0)", hidden: true, onclick: () => this.action("zoomReset") });
    this.spinner = h("span", { class: "br-spin", hidden: true });
    const tools = h("div", { class: "br-bar" },
      this.backBtn, this.fwdBtn, this.reloadBtn,
      h("div", { class: "br-address-wrap" }, this.spinner, this.address, this.zoomBadge),
      btn("search", "Find in page (Ctrl+F)", () => this.openFind()),
      btn("external", "Open in your browser", () => this.action("external")),
      btn("more", "More", (e) => this.menu(e)));

    this.findInput = h("input", { class: "input br-find-input", spellcheck: false, placeholder: "Find in page" });
    this.findCount = h("span", { class: "muted br-find-count" });
    this.findBar = h("div", { class: "br-find", hidden: true },
      this.findInput, this.findCount,
      btn("up", "Previous (Shift+Enter)", () => this.find(false)),
      btn("chevronDown", "Next (Enter)", () => this.find(true)),
      btn("close", "Close (Esc)", () => this.closeFind()));
    this.findInput.addEventListener("input", () => this.find(true, false));
    this.findInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.find(!e.shiftKey); }
      else if (e.key === "Escape") { e.preventDefault(); this.closeFind(); }
    });

    this.still = h("img", { class: "br-still", alt: "", hidden: true });
    this.notice = h("div", { class: "br-notice", hidden: true });
    this.start = this.buildStart();
    this.host = h("div", { class: "br-host" }, this.start, this.still, this.notice);
    this.el.append(tools, this.findBar, this.host);

    // Local shortcuts while the toolbar has focus (the page reports its own).
    this.el.addEventListener("keydown", (e) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "l") { e.preventDefault(); this.focusAddress(); }
      else if (k === "t") { e.preventDefault(); this.ws.openBrowser(""); }
      else if (k === "w") { e.preventDefault(); this.ws.close(this); }
      else if (k === "f") { e.preventDefault(); this.openFind(); }
    });

    const relayout = () => this.layout();
    this.ro = new ResizeObserver(relayout);
    this.ro.observe(this.host);
    window.addEventListener("resize", relayout);
    this.off.push(() => window.removeEventListener("resize", relayout));
    this.off.push(onCoverChange((c) => this.setCovered(c)));
    this.covered = isCovered();
    this.render();
    if (this.url) await this.ensureView(this.url);
  }

  buildStart() {
    const links = (settings.get("quickLinks") || []).filter((l) => /^https?:\/\//i.test(l.target)).slice(0, 12);
    return h("div", { class: "br-start" },
      h("div", { class: "br-start-title" }, icon("globe"), "eDEX BROWSER"),
      h("div", { class: "br-start-sub muted" }, "Type an address or a search above. Pages here have their own sign-ins, separate from your usual browser."),
      links.length ? h("div", { class: "br-links" }, ...links.map((l) => h("button", { class: "br-link", type: "button", title: l.target, onclick: () => this.go(l.target) },
        h("span", { class: "br-link-letter" }, (l.name || "?")[0].toUpperCase()), h("span", { class: "ellipsis" }, l.name)))) : null,
      h("div", { class: "br-start-hint muted" }, "Web addresses in the Quick links widget appear here."));
  }

  async ensureView(url) {
    if (!this.created) {
      this.created = true;
      try { await api.browser.create(this.id, url); }
      catch (e) { this.created = false; toast(cleanError(e), { level: "warn" }); return; }
      this.layout();
    } else {
      await api.browser.go(this.id, url).catch((e) => toast(cleanError(e), { level: "warn" }));
    }
  }

  go(text) {
    const url = toUrl(text);
    if (!url) return;
    this.url = url;
    this.problem = null;
    this.page.url = url;
    this.address.value = url;
    this.address.blur();
    this.render();
    this.ensureView(url).then(() => this.focusPage());
    this.ws.persist();
  }

  action(name) {
    if (!this.created) return;
    if (name === "reload" && this.problem) this.problem = null;
    api.browser.action(this.id, name).catch(() => {});
    if (name === "reload") this.render();
  }

  onState(s) {
    if (s.blocked) { toast(`Blocked a link to ${s.blocked}:`, { level: "warn" }); return; }
    if (s.favicon) { this.ws.setTabIcon(this, s.favicon); return; }
    if (s.find) {
      setText(this.findCount, s.find.matches ? `${s.find.active} / ${s.find.matches}` : "no matches");
      return;
    }
    const wasUrl = this.page.url;
    Object.assign(this.page, s);
    // Unloaded in the background to save memory: dimmed until it's back.
    if (s.unloaded !== undefined) {
      this.tabEl?.classList.toggle("unloaded", !!s.unloaded);
      if (this.tabEl) this.tabEl.title = s.unloaded ? `${this.label} — unloaded to save memory; opens again when you switch to it` : this.label;
    }
    if (s.error) this.problem = { kind: "error", text: s.error, url: s.failedUrl };
    else if (s.crashed) this.problem = { kind: "crashed", text: "This page stopped working." };
    else if (s.loading && this.problem?.kind === "error") this.problem = null;
    if (s.url && s.url !== wasUrl) {
      this.url = s.url;
      this.ws.persist();
      if (!s.loading) this.ws.setTabIcon(this, null);
    }
    if (!this.customLabel) {
      this.label = (s.title && s.title !== s.url ? s.title : s.url?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) || "New tab";
      this.ws.updateTab(this);
    }
    this.render();
  }

  render() {
    const p = this.page;
    this.backBtn.disabled = !p.canBack;
    this.fwdBtn.disabled = !p.canForward;
    this.reloadBtn.replaceChildren(icon(p.loading ? "close" : "refresh"));
    this.reloadBtn.title = p.loading ? "Stop" : "Reload (F5)";
    this.spinner.hidden = !p.loading;
    if (document.activeElement !== this.address) this.address.value = p.url || this.url || "";
    this.zoomBadge.hidden = !p.zoom || p.zoom === 100;
    setText(this.zoomBadge, `${p.zoom}%`);
    this.start.hidden = !!(this.url || p.url);
    const pr = this.problem;
    this.notice.hidden = !pr;
    if (pr) {
      this.notice.replaceChildren(
        icon(pr.kind === "crashed" ? "info" : "offline"),
        h("div", { class: "br-notice-title" }, pr.kind === "crashed" ? "Page crashed" : "Can't open this page"),
        h("div", { class: "muted" }, pr.text),
        pr.url ? h("div", { class: "muted mono br-notice-url" }, pr.url) : null,
        h("div", { class: "br-notice-actions" },
          h("button", { class: "btn primary", type: "button", onclick: () => { this.problem = null; this.action("reload"); } }, icon("refresh"), "Try again"),
          h("button", { class: "btn", type: "button", onclick: () => this.action("external") }, icon("external"), "Open in your browser")));
    }
    this.layout();
  }

  // The page shows only while this tab is in front, nothing covers it and
  // there is a page to show.
  layout() {
    if (!this.created || !this.host) return;
    const visible = this.active && !this.covered && !this.problem && !!(this.url || this.page.url);
    const r = this.host.getBoundingClientRect();
    // active: the current tab, even while a menu covers it (it isn't a
    // background tab to unload).
    api.browser.layout(this.id, { x: r.left, y: r.top, width: r.width, height: r.height }, visible, !!this.active).catch(() => {});
  }

  async setCovered(covered) {
    if (covered === this.covered) return;
    if (covered && this.active && this.created && !this.problem) {
      // Freeze: a still of the page goes in its place, then the page hides.
      const still = await api.browser.snapshot(this.id).catch(() => null);
      if (still && isCovered()) { this.still.src = still; this.still.hidden = false; }
    }
    this.covered = isCovered();
    if (!this.covered) {
      this.still.hidden = true;
      this.still.removeAttribute("src");
    }
    this.layout();
  }

  onKey(k) {
    const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
    if (k.ctrl && !k.shift && !k.alt) {
      if (key === "l") return this.focusAddress();
      if (key === "t") return this.ws.openBrowser("");
      if (key === "w") return this.ws.close(this);
      if (key === "f") return this.openFind();
    }
    // Everything else is an eDEX shortcut; replay it to the hotkey handler.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k.key, code: k.code, ctrlKey: k.ctrl, shiftKey: k.shift, altKey: k.alt, bubbles: true, cancelable: true }));
  }

  focusAddress() {
    this.address.focus();
    this.address.select();
  }

  focusPage() {
    if (this.created && this.active && !this.covered && (this.url || this.page.url)) api.browser.focus(this.id).catch(() => {});
  }

  openFind() {
    this.findBar.hidden = false;
    this.findInput.focus();
    this.findInput.select();
    if (this.findInput.value) this.find(true, false);
  }

  find(forward = true, next = true) {
    if (!this.created) return;
    api.browser.find(this.id, this.findInput.value, { forward, findNext: next && !!this.findInput.value }).catch(() => {});
    if (!this.findInput.value) setText(this.findCount, "");
  }

  closeFind() {
    this.findBar.hidden = true;
    if (this.created) api.browser.find(this.id, "").catch(() => {});
    setText(this.findCount, "");
    this.focusPage();
  }

  menu(e) {
    contextMenu(e, [
      { label: "Zoom in", icon: "plus", hint: "Ctrl+=", run: () => this.action("zoomIn") },
      { label: "Zoom out", icon: "minimize", hint: "Ctrl+-", run: () => this.action("zoomOut") },
      { label: "Reset zoom", icon: "refresh", hint: "Ctrl+0", run: () => this.action("zoomReset") },
      { separator: true },
      { label: "New browser tab", icon: "globe", hint: "Ctrl+T", run: () => this.ws.openBrowser("") },
      { label: "Duplicate tab", icon: "copy", run: () => this.ws.openBrowser(this.page.url || this.url) },
      { label: "Copy address", icon: "link", disabled: !(this.page.url || this.url), run: () => api.clip.copy(this.page.url || this.url) },
      { label: "Open in your browser", icon: "external", run: () => openUrl(this.page.url || this.url, { external: true }) },
      { separator: true },
      { label: "Inspect page", icon: "code", disabled: !this.created, run: () => this.action("inspect") },
      { label: "Clear browsing data…", icon: "trash", run: () => clearBrowsingData() }
    ]);
  }

  activate() {
    this.active = true;
    if (!this.host) { requestAnimationFrame(() => this.host && this.activate()); return; }
    this.covered = isCovered();
    this.layout();
    requestAnimationFrame(() => {
      if (this.url || this.page.url) this.focusPage();
      else this.focusAddress();
    });
  }

  deactivate() {
    this.active = false;
    this.layout();
  }

  focus() {
    if (this.url || this.page.url) this.focusPage();
    else this.focusAddress();
  }

  dispose() {
    this.active = false;
    tabs.delete(this.id);
    this.ro?.disconnect();
    this.off.forEach((fn) => fn());
    if (this.created) api.browser.close(this.id).catch(() => {});
  }
}
