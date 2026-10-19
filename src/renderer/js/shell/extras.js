// Help sheet, file search, on-screen keyboard and boot screen.
import { h, setText } from "../core/dom.js";
import { icon, fileKind } from "../core/icons.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import * as fmt from "../core/format.js";
import { emit } from "../core/bus.js";
import { allCommands } from "../core/commands.js";
import { openModal, toast, cleanError, contextMenu, copyText } from "../core/ui.js";

const api = window.edex;

// ── Help ────────────────────────────────────────────────────────────────────
const EXTRA_SHORTCUTS = [
  ["Ctrl+Shift+Space (anywhere)", "Open the launcher"],
  ["Ctrl+` (anywhere)", "Show / hide eDEX"],
  ["Terminal: Ctrl+C with selection / Ctrl+V", "Copy / paste"],
  ["Terminal: right-click", "Copy selection, or paste"],
  ["Terminal: Shift+right-click", "Terminal menu"],
  ["Terminal: Ctrl+= / Ctrl+- / Ctrl+0", "Font size"],
  ["Explorer: Enter / Space", "Open / quick preview"],
  ["Explorer: F2 / Del", "Rename / move to Recycle Bin"],
  ["Explorer: Ctrl+C / Ctrl+X / Ctrl+V", "Copy, cut, paste files"],
  ["Explorer: Backspace / Alt+\u2190 / Alt+\u2192", "Up / back / forward"],
  ["Explorer: Ctrl+L / Ctrl+F", "Type a path / filter"],
  ["Explorer: drag files", "Drag into other apps, or drop files in"],
  ["Launcher: >", "Command mode"],
  ["Launcher: = 2*(3+4)", "Calculator"],
  ["Launcher: C:\\path", "Browse paths (Tab completes)"],
  ["Viewer: \u2190 \u2192", "Previous / next file"]
];

export function openHelp() {
  openModal((close) => h("div", { style: { display: "contents" } },
    h("div", { class: "modal-head" }, icon("help"), h("span", { class: "modal-title grow" }, "Keyboard shortcuts"),
      h("button", { class: "icon-btn", type: "button", onclick: () => close() }, icon("close"))),
    h("div", { class: "help-body" },
      ...allCommands().filter((c) => c.keys).map((c) => h("div", { class: "help-row" }, h("span", null, c.title), h("span", { class: "kbd" }, [].concat(c.keys).join("  /  ")))),
      ...EXTRA_SHORTCUTS.map(([k, d]) => h("div", { class: "help-row" }, h("span", null, d), h("span", { class: "kbd" }, k))))), { className: "help", label: "Help" });
}

// ── File search ─────────────────────────────────────────────────────────────
export function openFileSearch(root) {
  let running = false;
  const rootInput = h("input", { class: "input", spellcheck: false, placeholder: "Folder to search" });
  const query = h("input", { class: "input", spellcheck: false, placeholder: "Name or wildcard, e.g. *.pdf or report", "data-autofocus": true });
  const status = h("div", { class: "muted", style: { fontSize: ".8rem" } }, "Searches file and folder names below the chosen folder.");
  const results = h("div", { class: "launcher-results", style: { maxHeight: "50vh" } });
  const go = h("button", { class: "btn primary", type: "button" }, "Search");
  api.fs.home().then((home) => { rootInput.value = root || home; });

  const search = async () => {
    if (running || !query.value.trim()) return;
    running = true;
    go.disabled = true;
    setText(status, "Searching\u2026");
    sfx.play("scan");
    try {
      const res = await api.fs.search({ root: rootInput.value.trim(), query: query.value.trim(), max: 300 });
      setText(status, `${res.results.length} result${res.results.length === 1 ? "" : "s"} \u00b7 ${res.scanned} folders scanned${res.truncated ? " (stopped early \u2014 narrow the folder for more)" : ""}`);
      results.replaceChildren(...res.results.map((r) => h("button", {
        class: "result", type: "button",
        onclick: () => { modal.close(); emit("open-path", { path: r.isDir ? r.path : fmt.dirname(r.path), select: r.isDir ? undefined : r.path }); },
        oncontextmenu: (e) => contextMenu(e, [
          { label: r.isDir ? "Open folder" : "Open", icon: "external", run: () => (r.isDir ? emit("open-path", { path: r.path }) : api.fs.open(r.path).catch((err) => toast(cleanError(err), { level: "warn" }))) },
          { label: "Show in explorer", icon: "folder", run: () => { modal.close(); emit("open-path", { path: fmt.dirname(r.path), select: r.path }); } },
          { label: "Copy path", icon: "copy", run: () => copyText(r.path, "Path copied") }
        ])
      }, h("span", { class: "result-icon" }, icon(fileKind(r.name, r.isDir))),
      h("span", { class: "result-text" }, h("div", { class: "result-title" }, r.name), h("div", { class: "result-sub" }, r.path)))));
      if (!res.results.length) results.replaceChildren(h("div", { class: "empty" }, "No matches"));
    } catch (e) {
      setText(status, cleanError(e));
    } finally {
      running = false;
      go.disabled = false;
    }
  };
  go.addEventListener("click", search);
  const onEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } };
  query.addEventListener("keydown", onEnter);
  rootInput.addEventListener("keydown", onEnter);
  const modal = openModal((close) => h("div", { class: "dialog", style: { width: "min(52rem, 92vw)" } },
    h("h2", { class: "dialog-title" }, "Find files"),
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: ".5rem" } }, query, rootInput, go),
    status, results,
    h("div", { class: "dialog-actions" }, h("button", { class: "btn", type: "button", onclick: () => close() }, "Close"))), { label: "Find files" });
  setTimeout(() => query.focus(), 0);
}

// ── On-screen keyboard ──────────────────────────────────────────────────────
const LAYOUT = [
  [["Esc", "\x1b", "Escape"], ["`", "`", null, "~"], ["1", "1", null, "!"], ["2", "2", null, "@"], ["3", "3", null, "#"], ["4", "4", null, "$"], ["5", "5", null, "%"], ["6", "6", null, "^"], ["7", "7", null, "&"], ["8", "8", null, "*"], ["9", "9", null, "("], ["0", "0", null, ")"], ["-", "-", null, "_"], ["=", "=", null, "+"], ["Back", "\x7f", "Backspace", null, "wide"]],
  [["Tab", "\t", "Tab", null, "wide"], ..."qwertyuiop".split("").map((c) => [c.toUpperCase(), c, null, c.toUpperCase()]), ["[", "[", null, "{"], ["]", "]", null, "}"], ["\\", "\\", null, "|"]],
  [["Caps", "caps", "CapsLock", null, "wide"], ..."asdfghjkl".split("").map((c) => [c.toUpperCase(), c, null, c.toUpperCase()]), [";", ";", null, ":"], ["'", "'", null, "\""], ["Enter", "\r", "Enter", null, "wide"]],
  [["Shift", "shift", "ShiftLeft", null, "wide"], ..."zxcvbnm".split("").map((c) => [c.toUpperCase(), c, null, c.toUpperCase()]), [",", ",", null, "<"], [".", ".", null, ">"], ["/", "/", null, "?"], ["\u25B2", "\x1b[A", "ArrowUp"], ["Shift", "shift", "ShiftRight", null, "wide"]],
  [["Ctrl", "ctrl", "ControlLeft", null, "wide"], ["Alt", "alt", "AltLeft", null, "wide"], ["", " ", "Space", null, "space"], ["\u25C0", "\x1b[D", "ArrowLeft"], ["\u25BC", "\x1b[B", "ArrowDown"], ["\u25B6", "\x1b[C", "ArrowRight"], ["Ctrl", "ctrl", "ControlRight", null, "wide"]]
];

export function initKeyboard(root, getTerminal) {
  const state = { shift: false, caps: false, ctrl: false, alt: false };
  const byCode = new Map();
  const byChar = new Map();
  const modKeys = { shift: [], ctrl: [], alt: [], caps: [] };

  const press = (def) => {
    const [, seq, , shifted] = def;
    if (seq in modKeys) {
      if (seq === "caps") state.caps = !state.caps;
      else state[seq] = !state[seq];
      paintMods();
      return;
    }
    const term = getTerminal();
    if (!term) { toast("Open a terminal tab to type into", { timeout: 1500 }); return; }
    let out = seq;
    if (shifted) {
      // Caps Lock only affects letters; Shift inverts it for letters.
      const useShift = /^[a-z]$/.test(seq) ? state.shift !== state.caps : state.shift;
      if (useShift) out = shifted;
    }
    if (state.ctrl && out.length === 1) {
      const c = out.toLowerCase().charCodeAt(0);
      if (c >= 97 && c <= 122) out = String.fromCharCode(c - 96);
    }
    if (state.alt && out.length === 1) out = `\x1b${out}`;
    term.input(out);
    term.focus();
    sfx.play("stdin");
    state.shift = false;
    state.ctrl = false;
    state.alt = false;
    paintMods();
  };
  const paintMods = () => {
    for (const [mod, els] of Object.entries(modKeys)) els.forEach((el) => el.classList.toggle("latched", !!state[mod]));
  };

  for (const rowDef of LAYOUT) {
    const rowEl = h("div", { class: "kb-row" });
    for (const def of rowDef) {
      const [label, seq, code, shifted, size] = def;
      const key = h("button", { class: `kb-key${size ? ` ${size}` : ""}${label === "Enter" ? " enter" : ""}`, type: "button", tabindex: -1 },
        shifted && !/^[A-Z]$/.test(label) ? h("small", null, shifted) : null, label);
      key.addEventListener("mousedown", (e) => { e.preventDefault(); press(def); });
      if (seq in modKeys) modKeys[seq].push(key);
      if (code) byCode.set(code, key);
      byChar.set(seq, key);
      if (shifted) byChar.set(shifted, key);
      rowEl.append(key);
    }
    root.append(rowEl);
  }

  const find = (e) => byCode.get(e.code) || byChar.get(e.key) || byChar.get(e.key?.toLowerCase());
  document.addEventListener("keydown", (e) => { if (root.classList.contains("show")) find(e)?.classList.add("down"); });
  document.addEventListener("keyup", (e) => { if (root.classList.contains("show")) find(e)?.classList.remove("down"); });
  window.addEventListener("blur", () => root.querySelectorAll(".down").forEach((k) => k.classList.remove("down")));

  const apply = () => root.classList.toggle("show", !!settings.get("showKeyboard"));
  settings.watch("showKeyboard", apply);
  apply();
}

// ── Boot screen ─────────────────────────────────────────────────────────────
// The original eDEX-UI sequence: a fast-scrolling kernel log, then the title
// card that fills, boxes and "derezzes" before the UI appears.
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function runBoot() {
  const screen = document.getElementById("boot");
  if (!screen) return Promise.resolve();
  const titleBox = document.getElementById("boot-title");
  const logo = document.getElementById("boot-logo");
  const sub = document.getElementById("boot-sub");
  const log = document.getElementById("boot-log");
  const custom = settings.get("bootLogo");
  if (custom) {
    logo.textContent = custom;
    logo.dataset.text = custom;
    logo.classList.toggle("multiline", custom.includes("\n"));
  }
  if (settings.get("bootSubtitle")) sub.textContent = settings.get("bootSubtitle");

  const finish = () => {
    screen.classList.add("done");
    setTimeout(() => screen.remove(), 600);
  };
  if (!settings.get("bootAnimation")) { finish(); return Promise.resolve(); }

  return new Promise((resolve) => {
    let skipped = false;
    const end = () => {
      if (skipped) return;
      skipped = true;
      document.removeEventListener("keydown", end, true);
      screen.removeEventListener("mousedown", end);
      finish();
      resolve();
    };
    document.addEventListener("keydown", end, true);
    screen.addEventListener("mousedown", end);

    (async () => {
      const [text, info] = await Promise.all([
        fetch("assets/misc/boot_log.txt").then((r) => r.text()).catch(() => ""),
        window.edex.app.info().catch(() => ({}))
      ]);
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && !skipped; i++) {
        log.append(lines[i], "\n");
        if (i === 0) log.append(`eDEX-UI Kernel version ${info.version || "2"} boot at ${new Date().toString()}; root:xnu-1699.22.73~1/RELEASE_X86_64\n`);
        sfx.play(lines[i] === "Boot Complete" ? "granted" : "stdout");
        const wait = i < 3 ? 250 : i === 24 ? 200 : i === 41 ? 150 : i >= lines.length - 3 ? 150 : Math.max(4, Math.pow(1 - i / 1000, 3) * 12);
        await delay(wait);
      }
      if (skipped) return;
      await delay(150);
      log.remove();
      screen.classList.add("titling");
      sfx.play("theme");
      await delay(300);
      titleBox.hidden = false;
      await delay(200);
      logo.classList.add("fill");
      await delay(280);
      logo.classList.replace("fill", "boxed");
      await delay(100);
      logo.classList.replace("boxed", "glitch");
      await delay(450);
      logo.classList.replace("glitch", "boxed");
      await delay(800);
      end();
    })();
  });
}

// "Welcome back, <user>" in the shell frame, as the original showed after boot.
export async function showGreeting(host) {
  if (!host || !settings.get("bootAnimation")) return;
  let user = "";
  try { user = (await window.edex.sys.static()).user || ""; } catch (_) {}
  const el = h("div", { class: "greeting" }, "Welcome back", user ? h("em", null, user) : null);
  host.append(el);
  sfx.play("keyboard");
  requestAnimationFrame(() => el.classList.add("show"));
  await delay(1300);
  el.classList.remove("show");
  await delay(500);
  el.remove();
}