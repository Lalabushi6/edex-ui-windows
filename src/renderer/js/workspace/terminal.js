// Terminal tab: xterm.js front-end for a node-pty session in the main process.
import { Terminal } from "../../vendor/xterm/lib/xterm.mjs";
import { FitAddon } from "../../vendor/xterm-fit/lib/addon-fit.mjs";
import { h, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { terminalTheme, terminalFont, terminalCursorStyle } from "../core/theme.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { on, emit } from "../core/bus.js";
import { toast, contextMenu, copyText, cleanError } from "../core/ui.js";

const api = window.edex;
const sessions = new Map(); // pty id -> TerminalTab
let wired = false;

function wireOnce() {
  if (wired) return;
  wired = true;
  api.term.onData(({ id, data }) => sessions.get(id)?.receive(data));
  api.term.onExit(({ id, exitCode }) => sessions.get(id)?.exited(exitCode));
  on("theme", () => { for (const t of sessions.values()) t.applyOptions(); });
  settings.watch(["termFontSize", "termFontFamily", "termCursorStyle", "termCursorBlink", "termScrollback"], () => {
    for (const t of sessions.values()) t.applyOptions();
  });
  settings.watch("termGpu", (on) => {
    for (const t of sessions.values()) {
      if (!on) t.disableGpu();
      else if (t.el.classList.contains("active")) t.enableGpu();
    }
  });
}

// GPU rendering: xterm's WebGL renderer draws the grid from a glyph atlas,
// which is many times cheaper than the DOM renderer for heavy output.
// Chromium caps live WebGL contexts, so only the visible terminal (and ones
// used in the last minute) keep one.
let webglModule = null;
const loadWebgl = () => (webglModule ||= import("../../vendor/xterm-webgl/lib/addon-webgl.mjs").catch((e) => {
  console.warn("xterm WebGL renderer unavailable", e);
  return null;
}));
const GPU_RELEASE_MS = 60000;

// Find in terminal (loaded the first time it is used).
let searchModule = null;
const loadSearch = () => (searchModule ||= import("../../vendor/xterm-search/lib/addon-search.mjs").catch((e) => {
  console.warn("xterm search unavailable", e);
  return null;
}));

const URL_RE = /\bhttps?:\/\/[^\s"'<>`)\]]+[^\s"'<>`)\].,;:!?]/g;

export class TerminalTab {
  constructor(ws, { shell, cwd, label, welcome } = {}) {
    wireOnce();
    this.ws = ws;
    this.welcome = !!welcome;
    this.type = "terminal";
    this.shell = shell || settings.get("defaultShell");
    this.cwd = cwd;
    this.customLabel = label || null;
    this.label = label || "Terminal";
    this.ptyId = null;
    this.alive = false;
    this.el = h("div", { class: "pane" });
    this.host = h("div", { class: "term-host" });
    this.el.append(this.host);
  }

  serialize() {
    return { type: "terminal", shell: this.shell, label: this.customLabel || undefined };
  }

  options() {
    const cursor = settings.get("termCursorStyle");
    return {
      fontFamily: terminalFont(),
      fontSize: settings.get("termFontSize"),
      lineHeight: 1.12,
      cursorStyle: cursor === "theme" ? (terminalCursorStyle() || "block") : cursor,
      cursorBlink: settings.get("termCursorBlink"),
      scrollback: settings.get("termScrollback"),
      theme: terminalTheme()
    };
  }

  applyOptions() {
    if (!this.term) return;
    Object.assign(this.term.options, this.options());
    this.fitSoon();
  }

  async mount() {
    await Promise.all(['14px "Fira Mono"', '14px "Fira Code"'].map((f) => document.fonts.load(f))).catch(() => {});
    this.term = new Terminal({ ...this.options(), allowProposedApi: false, macOptionIsMeta: false, rightClickSelectsWord: false });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.host);
    this.wireTerminal();
    this.resizeObserver = new ResizeObserver(() => this.fitSoon());
    this.resizeObserver.observe(this.host);
    await this.start();
  }

  async start() {
    this.fitNow();
    if (this.welcome) {
      this.welcome = false;
      const dim = (s) => `\x1b[2m${s}\x1b[0m`;
      this.term.writeln("\x1b[1mWelcome to eDEX-UI\x1b[0m");
      this.term.writeln(dim("  Ctrl+Shift+Space  launcher (works from any app)    Ctrl+`        show / hide eDEX"));
      this.term.writeln(dim("  Ctrl+Shift+T/E    new terminal / explorer tab      Ctrl+Shift+P  command palette"));
      this.term.writeln(dim("  Ctrl+,            settings                         F1            all shortcuts"));
      this.term.writeln("");
    }
    try {
      const info = await api.term.spawn({ shell: this.shell, cwd: this.cwd, cols: this.term.cols, rows: this.term.rows });
      this.ptyId = info.id;
      this.shell = info.shell;
      if (info.cwd) this.cwd = info.cwd;
      this.alive = true;
      sessions.set(info.id, this);
      if (!this.customLabel) this.setLabel(info.shellName);
      this.ws.markDead(this, false);
      this.ws.persist();
    } catch (e) {
      this.term.writeln(`\x1b[31mCould not start shell: ${cleanError(e)}\x1b[0m`);
      this.ws.markDead(this, true);
    }
  }

  wireTerminal() {
    const term = this.term;
    term.onData((data) => {
      if (this.alive) {
        api.term.write(this.ptyId, data);
        sfx.play("stdin");
      } else if (data === "\r") {
        this.restart();
      }
    });
    term.onTitleChange((title) => {
      if (!this.customLabel && title) this.setLabel(title.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "") || title);
    });
    term.onSelectionChange(() => {
      if (settings.get("termCopyOnSelect") && term.hasSelection()) api.clip.copy(term.getSelection()).catch(() => {});
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && e.shiftKey && key === "f") { e.preventDefault(); this.openFind(); return false; }
      if (e.ctrlKey && e.shiftKey && key === "c") { this.copy(); return false; }
      if (e.ctrlKey && e.shiftKey && key === "v") { this.paste(); return false; }
      if (e.ctrlKey && !e.shiftKey && key === "c" && term.hasSelection()) { this.copy(); term.clearSelection(); return false; }
      if (e.ctrlKey && !e.shiftKey && key === "v") { this.paste(); return false; }
      if (e.ctrlKey && (key === "=" || key === "+")) { this.zoom(1); return false; }
      if (e.ctrlKey && key === "-") { this.zoom(-1); return false; }
      if (e.ctrlKey && key === "0") { settings.set({ termFontSize: 14 }); return false; }
      // Let app-level shortcuts (tabs, launcher, settings) reach the document.
      if (e.ctrlKey && (e.key === "Tab" || /^[1-9]$/.test(e.key) || e.key === ",")) return false;
      if (e.ctrlKey && e.shiftKey && ["t", "e", "w", "p", "f", "s", "k", "m", "a"].includes(key)) return false;
      if (e.key === "F1") return false;
      return true;
    });

    // Windows Terminal convention: right-click copies a selection, else pastes.
    this.host.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (e.shiftKey) {
        contextMenu(e, [
          { label: "Copy", icon: "copy", hint: "Ctrl+Shift+C", disabled: !term.hasSelection(), run: () => this.copy() },
          { label: "Paste", icon: "paste", hint: "Ctrl+Shift+V", run: () => this.paste() },
          { label: "Select all", icon: "list", run: () => term.selectAll() },
          { label: "Find…", icon: "search", hint: "Ctrl+Shift+F", run: () => this.openFind() },
          { label: "Clear", icon: "trash", run: () => term.clear() },
          { separator: true },
          { label: "Restart shell", icon: "restart", run: () => this.restart() }
        ]);
        return;
      }
      if (term.hasSelection()) { this.copy(); term.clearSelection(); } else this.paste();
    });

    term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const line = term.buffer.active.getLine(y - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString(true);
        const links = [];
        for (const m of text.matchAll(URL_RE)) {
          links.push({
            text: m[0],
            range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } },
            activate: (event, uri) => {
              if (event.ctrlKey) api.shell.openExternal(uri).catch((err) => toast(cleanError(err), { level: "warn" }));
              else toast("Ctrl+click to open link", { timeout: 1600 });
            }
          });
        }
        callback(links.length ? links : undefined);
      }
    });
  }

  receive(data) {
    this.term?.write(data);
    this.watchPrompt(data);
  }

  // Tracks the shell's working directory (for the file browser panel):
  // OSC 7 / OSC 9;9 "current directory" sequences when the shell sends them,
  // otherwise the PowerShell or cmd prompt ("PS C:\path>" / "C:\path>") at
  // the end of the output. `atPrompt` is true while the shell waits for a
  // command, so the panel only types `cd` when it is safe to.
  watchPrompt(data) {
    let found = null;
    if (data.includes("\x1b]")) {
      const osc = /\x1b\](?:7;file:\/\/[^/\x07\x1b]*(\/[^\x07\x1b]*)|9;9;"?([^"\x07\x1b]+)"?)(?:\x07|\x1b\\)/g;
      for (const m of data.matchAll(osc)) {
        found = m[1] ? decodeURIComponent(m[1]).replace(/^\/([A-Za-z]:)/, "$1").replace(/\//g, "\\") : m[2];
      }
    }
    this.promptTail = ((this.promptTail || "") + data).slice(-600);
    const clean = this.promptTail
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b[()][0-9A-Za-z]|\x1b[=>78]/g, "");
    const prompt = /(?:^|[\r\n])(?:PS )?([A-Za-z]:\\[^\r\n<>|"*?]*?)> ?$/.exec(clean);
    this.atPrompt = !!prompt;
    const cwd = found || prompt?.[1];
    if (!cwd) return;
    const changed = cwd.toLowerCase() !== String(this.cwd || "").toLowerCase();
    this.cwd = cwd;
    emit("terminal-cwd", { tab: this, cwd, changed });
  }

  exited(code) {
    this.alive = false;
    sessions.delete(this.ptyId);
    this.term.writeln("");
    this.term.writeln(`\x1b[2m[process exited${code ? ` with code ${code}` : ""} — press Enter to restart]\x1b[0m`);
    this.ws.markDead(this, true);
  }

  async restart() {
    if (this.alive) {
      await api.term.kill(this.ptyId).catch(() => {});
      sessions.delete(this.ptyId);
      this.alive = false;
    }
    this.term.reset();
    await this.start();
  }

  copy() {
    const text = this.term.getSelection();
    if (text) copyText(text, "Selection copied");
  }

  async paste() {
    let text = "";
    try { text = await api.clip.read(); } catch (_) {}
    if (!text) return;
    this.input(text.replace(/\r?\n/g, "\r"));
  }

  input(text) {
    if (!this.alive || !text) return;
    this.term.paste(text);
  }

  // Find bar: Enter / Shift+Enter step through matches, Esc closes.
  async openFind() {
    if (!this.term) return;
    if (!this.search) {
      const mod = await loadSearch();
      if (!mod) { toast("Find is unavailable", { level: "warn" }); return; }
      this.search = new mod.SearchAddon();
      this.term.loadAddon(this.search);
      // When match highlighting is available the addon also reports the
      // current position; otherwise the counter shows the total only.
      this.search.onDidChangeResults?.(({ resultIndex, resultCount }) => {
        if (this.findCount && resultCount > 0 && resultIndex >= 0) this.findCount.textContent = `${resultIndex + 1}/${resultCount}`;
      });
    }
    if (!this.findBar) {
      this.findInput = h("input", { class: "input term-find-input", spellcheck: false, placeholder: "Find in terminal" });
      this.findCount = h("span", { class: "term-find-count" });
      const caseBtn = h("button", { class: "icon-btn sm term-find-case", type: "button", title: "Match case" }, "Aa");
      const step = (back) => this.findStep(back);
      this.findBar = h("div", { class: "term-find" }, this.findInput, this.findCount, caseBtn,
        h("button", { class: "icon-btn sm", type: "button", title: "Previous (Shift+Enter)", onclick: () => step(true) }, icon("up")),
        h("button", { class: "icon-btn sm", type: "button", title: "Next (Enter)", onclick: () => step(false) }, icon("chevronDown")),
        h("button", { class: "icon-btn sm", type: "button", title: "Close (Esc)", onclick: () => this.closeFind() }, icon("close")));
      caseBtn.addEventListener("click", () => { caseBtn.classList.toggle("active"); this.findCase = caseBtn.classList.contains("active"); step(false); });
      this.findInput.addEventListener("input", () => step(false));
      this.findInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.closeFind(); }
      });
      this.el.append(this.findBar);
    }
    this.findBar.hidden = false;
    const sel = this.term.getSelection();
    if (sel && !sel.includes("\n")) this.findInput.value = sel;
    this.findInput.focus();
    this.findInput.select();
    if (this.findInput.value) this.findStep(false);
  }

  // Matches in the whole buffer (wrapped lines joined), for the counter.
  countMatches(needle, caseSensitive) {
    const buf = this.term.buffer.active;
    const n = caseSensitive ? needle : needle.toLowerCase();
    let count = 0;
    let line = "";
    const flush = () => {
      const hay = caseSensitive ? line : line.toLowerCase();
      for (let i = hay.indexOf(n); i >= 0; i = hay.indexOf(n, i + n.length)) count++;
      line = "";
    };
    for (let y = 0; y < buf.length; y++) {
      const l = buf.getLine(y);
      if (!l) continue;
      if (!l.isWrapped && line) flush();
      line += l.translateToString(true);
    }
    flush();
    return count;
  }

  findStep(back) {
    const term = this.findInput?.value || "";
    if (!this.search) return;
    if (!term) { this.search.clearDecorations(); this.findCount.textContent = ""; return; }
    const total = this.countMatches(term, !!this.findCase);
    this.findCount.textContent = total ? `${total} match${total === 1 ? "" : "es"}` : "no match";
    this.findCount.classList.toggle("none", !total);
    const opts = {
      caseSensitive: !!this.findCase,
      decorations: { matchBackground: "#ffffff33", activeMatchBackground: "#ffb54788", matchOverviewRuler: "#ffffff66", activeMatchColorOverviewRuler: "#ffb547" }
    };
    try {
      if (back) this.search.findPrevious(term, opts); else this.search.findNext(term, opts);
    } catch (_) {
      // Decorations need a renderer that supports them; plain selection still works.
      delete opts.decorations;
      if (back) this.search.findPrevious(term, opts); else this.search.findNext(term, opts);
    }
  }

  closeFind() {
    if (!this.findBar) return;
    this.findBar.hidden = true;
    this.search?.clearDecorations();
    this.term?.focus();
  }

  // Key presses from the on-screen keyboard: sent exactly as if typed
  // (control and escape sequences intact), unlike paste().
  sendKeys(data) {
    if (!this.term || !data) return;
    this.term.input(data, true);
  }

  zoom(delta) {
    settings.set({ termFontSize: Math.max(8, Math.min(32, settings.get("termFontSize") + delta)) });
  }

  setLabel(label) {
    this.label = String(label).slice(0, 40);
    this.ws.updateTab(this);
  }

  fitNow() {
    try {
      this.fit.fit();
      if (this.alive) api.term.resize(this.ptyId, this.term.cols, this.term.rows);
    } catch (_) {}
  }

  fitSoon = debounce(() => {
    if (this.el.classList.contains("active")) this.fitNow();
  }, 60);

  activate() {
    clearTimeout(this.gpuReleaseTimer);
    if (this.cwd) emit("terminal-cwd", { tab: this, cwd: this.cwd, changed: true });
    requestAnimationFrame(() => {
      this.fitNow();
      this.term?.focus();
      this.enableGpu();
    });
  }

  deactivate() {
    clearTimeout(this.gpuReleaseTimer);
    this.gpuReleaseTimer = setTimeout(() => this.disableGpu(), GPU_RELEASE_MS);
  }

  async enableGpu() {
    if (!this.term || this.webgl || this.gpuLoading || !settings.get("termGpu") || this.gpuFailed) return;
    this.gpuLoading = true;
    try {
      const mod = await loadWebgl();
      if (!mod || !this.term || !settings.get("termGpu")) return;
      const addon = new mod.WebglAddon();
      addon.onContextLoss(() => {
        // The GPU process reset or the context was evicted; fall back to the
        // DOM renderer and try again the next time this tab is shown.
        this.disableGpu();
      });
      this.term.loadAddon(addon);
      this.webgl = addon;
    } catch (e) {
      console.warn("terminal GPU rendering failed; using the DOM renderer", e);
      this.gpuFailed = true;
    } finally {
      this.gpuLoading = false;
    }
  }

  disableGpu() {
    clearTimeout(this.gpuReleaseTimer);
    if (!this.webgl) return;
    const addon = this.webgl;
    this.webgl = null;
    try { addon.dispose(); } catch (_) {}
  }

  focus() {
    this.term?.focus();
  }

  dispose() {
    clearTimeout(this.gpuReleaseTimer);
    this.resizeObserver?.disconnect();
    if (this.alive) api.term.kill(this.ptyId).catch(() => {});
    sessions.delete(this.ptyId);
    this.disableGpu();
    this.term?.dispose();
  }
}

export function newTerminalIcon() {
  return icon("terminal");
}
