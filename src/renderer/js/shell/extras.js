// Help sheet, file search, on-screen keyboard and boot screen.
import { h, setText } from "../core/dom.js";
import { icon, fileKind } from "../core/icons.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import * as fmt from "../core/format.js";
import { emit } from "../core/bus.js";
import { allCommands } from "../core/commands.js";
import { openModal, toast, cleanError, contextMenu, copyText } from "../core/ui.js";
import { applyLogo, fitLogoToScreen } from "./boot-art.js";

const api = window.edex;

// ── Help ────────────────────────────────────────────────────────────────────
const EXTRA_SHORTCUTS = [
  ["Ctrl+Shift+Space (anywhere)", "Open the launcher"],
  ["Ctrl+` (anywhere)", "Show / hide eDEX"],
  ["Terminal: Ctrl+C with selection / Ctrl+V", "Copy / paste"],
  ["Terminal: right-click", "Copy selection, or paste"],
  ["Terminal: Shift+right-click", "Terminal menu"],
  ["Terminal: Ctrl+= / Ctrl+- / Ctrl+0", "Font size"],
  ["Terminal: Ctrl+Shift+F", "Find in terminal (Enter / Shift+Enter, Esc)"],
  ["Terminal: Alt+Shift+= / Alt+Shift+- / Ctrl+Shift+D", "Split pane right / down"],
  ["Terminal: Alt+arrows · Ctrl+Shift+W", "Move between panes · close pane"],
  ["Launcher: \"budget 2026\"", "Search inside documents (Windows index)"],
  ["Launcher: ? question · Ctrl+Shift+J", "Ask Claude (AI assistant)"],
  ["Tasks: call mum at 6pm · report in 2h", "Task with a reminder"],
  ["Launcher: 10 km to mi · 72 f in c", "Unit conversion"],
  ["Launcher: timer 5m tea · stopwatch", "Start a timer"],
  ["Launcher: pomodoro", "Start a focus session"],
  ["E (media player)", "Equalizer"],
  ["Launcher: $ ipconfig", "Run a command in the terminal"],
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
  applyLogo(logo, settings.get("bootLogo"));
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
      fitLogoToScreen(logo);
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
