// Git status for the terminal's folder, and custom command widgets (any
// command's output, refreshed on an interval).
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import { on, emit } from "../core/bus.js";
import { openModal, toast, contextMenu, confirm, copyText, cleanError } from "../core/ui.js";
import { defineWidget, undefineWidget, refreshWidgets } from "./registry.js";

const api = window.edex;

// ── Git ─────────────────────────────────────────────────────────────────────
const STATE_MARK = { staged: "S", modified: "M", deleted: "D", renamed: "R", untracked: "?", conflict: "!" };

defineWidget({
  id: "git",
  order: 6.5,
  title: "Git",
  column: "right",
  create(panel) {
    const head = h("div", { class: "git-head" });
    const counts = h("div", { class: "git-counts" });
    const last = h("div", { class: "git-last muted ellipsis" });
    const files = h("div", { class: "git-files" });
    const empty = h("div", { class: "empty" }, "Open a terminal in a Git repository");
    panel.body.append(empty, head, counts, last, files);
    let cwd = null;
    let state = null;

    const render = (s) => {
      state = s;
      if (s?.unsafe) {
        for (const el of [head, counts, last, files]) el.hidden = true;
        empty.hidden = false;
        setText(empty, "This repository's own settings can run external programs or reach other computers, so eDEX doesn't inspect it. Use git in the terminal.");
        panel.setSub(fmt.basename(s.root).toUpperCase());
        return;
      }
      const repo = !!s?.repo;
      for (const el of [head, counts, last, files]) el.hidden = !repo;
      empty.hidden = repo;
      if (!repo) {
        setText(empty, s?.error === "nogit" ? "Git isn't installed (or not on PATH)" : cwd ? "Not a Git repository" : "Open a terminal in a Git repository");
        panel.setSub("");
        return;
      }
      panel.setSub(fmt.basename(s.root).toUpperCase());
      // (Native replaceChildren would print null as text; filter first.)
      head.replaceChildren(...[icon("git"), h("b", { class: "ellipsis" }, s.branch || "(detached)"),
        s.upstream && h("span", { class: "muted ellipsis" }, `→ ${s.upstream}`),
        h("span", { class: "grow" }),
        s.ahead && h("span", { class: "git-ab", title: "Commits to push" }, `↑${s.ahead}`),
        s.behind && h("span", { class: "git-ab", title: "Commits to pull" }, `↓${s.behind}`)].filter(Boolean));
      const chip = (n, label, cls) => h("span", { class: `git-chip ${cls}${n ? "" : " zero"}` }, h("b", null, String(n)), ` ${label}`);
      counts.replaceChildren(...[chip(s.staged, "staged", "st"), chip(s.modified, "changed", "md"), chip(s.untracked, "new", "un"),
        s.conflicts && chip(s.conflicts, "conflicts", "cf")].filter(Boolean));
      setText(last, s.last ? `${s.last.hash} · ${s.last.subject} · ${s.last.when}` : "No commits yet");
      last.title = s.last ? s.last.subject : "";
      files.replaceChildren(...[...s.files.slice(0, 8).map((f) => h("button", {
        class: `git-file ${f.state}`, type: "button", title: `${f.state}: ${f.path}`,
        onclick: () => {
          const full = `${s.root}\\${f.path.replace(/\//g, "\\")}`;
          emit("open-path", { path: fmt.dirname(full), select: full });
        }
      }, h("span", { class: "git-mark" }, STATE_MARK[f.state] || "·"), h("span", { class: "ellipsis" }, f.path))),
      s.files.length > 8 && h("div", { class: "muted git-more" }, `+${s.files.length - 8} more`)].filter(Boolean));
    };

    const refresh = async () => {
      if (!cwd) { render(null); return; }
      try { render(await api.tools.gitStatus(cwd)); } catch (_) { render(null); }
    };
    const p = poll(refresh, 20000);
    const off = on("terminal-cwd", ({ cwd: next }) => {
      if (!next || (cwd && next.toLowerCase() === cwd.toLowerCase())) return;
      cwd = next;
      p.kick();
    });
    panel.tools.append(h("button", { class: "icon-btn sm", type: "button", title: "Refresh", onclick: () => p.kick() }, icon("refresh")));
    panel.el.addEventListener("contextmenu", (e) => {
      if (!state?.repo || state.unsafe) return;
      contextMenu(e, [
        { label: "Open repository in explorer", icon: "folder", run: () => emit("open-path", { path: state.root }) },
        { label: "Terminal here", icon: "terminal", run: () => emit("open-terminal", { cwd: state.root }) },
        { label: "Copy branch name", icon: "copy", run: () => copyText(state.branch, "Branch copied") }
      ]);
    });
    return { destroy() { p.stop(); off(); } };
  }
});

// ── Custom command widgets ──────────────────────────────────────────────────
const defined = new Map(); // widget id -> config signature

function defineCommandWidget(cfg) {
  const id = `cmd-${cfg.id}`;
  defineWidget({
    id,
    order: 20,
    title: cfg.title,
    column: cfg.column,
    create(panel) {
      if (cfg.enabled === false) {
        panel.setSub("OFF");
        panel.body.append(h("div", { class: "empty" }, "Imported from a settings file. This command doesn't run until you've reviewed it."),
          h("button", { class: "btn sm", type: "button", onclick: () => reviewCommandWidget(cfg) }, "Review…"));
        panel.el.addEventListener("contextmenu", (e) => contextMenu(e, [
          { label: "Review command…", icon: "edit", run: () => reviewCommandWidget(cfg) },
          { separator: true },
          { label: "Remove widget", icon: "trash", danger: true, run: () => removeCommandWidget(cfg) }
        ]));
        return { destroy() {} };
      }
      const out = h("pre", { class: "cmdw-out" }, "…");
      const meta = h("div", { class: "cmdw-meta muted" });
      panel.body.append(out, meta);
      const run = async () => {
        try {
          const r = await api.tools.runCommandWidget(cfg.id);
          const text = r.stdout || r.stderr || (r.code ? `(exit code ${r.code})` : "(no output)");
          out.textContent = text;
          out.classList.toggle("err", !!r.code && !r.stdout);
          setText(meta, `${r.timedOut ? "timed out · " : ""}${r.code ? `exit ${r.code} · ` : ""}${r.ms} ms · ${new Date(r.at).toLocaleTimeString()}`);
          panel.setSub(r.code ? "ERROR" : "");
        } catch (e) {
          out.textContent = cleanError(e);
          out.classList.add("err");
        }
      };
      const p = poll(run, cfg.interval * 1000, { fixed: true });
      panel.tools.append(h("button", { class: "icon-btn sm", type: "button", title: "Run now", onclick: () => p.kick() }, icon("refresh")));
      panel.el.addEventListener("contextmenu", (e) => contextMenu(e, [
        { label: "Run now", icon: "refresh", run: () => p.kick() },
        { label: "Copy output", icon: "copy", run: () => copyText(out.textContent, "Output copied") },
        { label: "Edit command widget…", icon: "edit", run: () => editCommandWidget(cfg) },
        { separator: true },
        { label: "Remove widget", icon: "trash", danger: true, run: () => removeCommandWidget(cfg) }
      ]));
      return { destroy() { p.stop(); } };
    }
  });
}

function syncCommandWidgets() {
  const list = settings.get("commandWidgets") || [];
  const want = new Map(list.map((c) => [`cmd-${c.id}`, c]));
  for (const id of [...defined.keys()]) {
    const cfg = want.get(id);
    if (!cfg || JSON.stringify(cfg) !== defined.get(id)) { undefineWidget(id); defined.delete(id); }
  }
  for (const [id, cfg] of want) {
    if (defined.has(id)) continue;
    defineCommandWidget(cfg);
    defined.set(id, JSON.stringify(cfg));
  }
  refreshWidgets();
}

export function initCommandWidgets() {
  syncCommandWidgets();
  settings.watch("commandWidgets", syncCommandWidgets);
}

async function removeCommandWidget(cfg) {
  if (!(await confirm({ title: "Remove widget", message: `Remove the “${cfg.title}” widget?`, confirmLabel: "Remove" }))) return;
  settings.set({ commandWidgets: (settings.get("commandWidgets") || []).filter((c) => c.id !== cfg.id) });
}

// A command exactly as it would run: blank space that could push the rest out
// of sight is counted, and characters that don't show are named.
function revealCommand(text) {
  return text
    .replace(/(?:[\t\p{Zs}]*\n){2,}/gu, (m) => `\n⟦${m.split("\n").length - 1} line breaks⟧\n`)
    .replace(/[\t\p{Zs}]{4,}/gu, (m) => ` ⟦${m.length} blanks⟧ `)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" || c === "\t" ? c : `⟦U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}⟧`));
}

export function reviewCommandWidget(cfg, onTurnedOn) {
  const shown = revealCommand(cfg.command);
  openModal((close) => {
    const turnOn = () => {
      settings.set({ commandWidgets: (settings.get("commandWidgets") || []).map((c) => (c.id === cfg.id && c.command === cfg.command ? { ...c, enabled: true } : c)) });
      close();
      toast(`“${cfg.title}” is on`, { level: "ok", timeout: 1600 });
      onTurnedOn?.();
    };
    return h("div", { class: "dialog cmdw-dialog" },
      h("h2", { class: "dialog-title" }, `Review “${cfg.title}”`),
      h("p", { class: "dialog-msg" }, `This command came from a settings file. Once on, it runs as you, in ${cfg.shell === "cmd" ? "Command Prompt" : "PowerShell"}, every ${cfg.interval} seconds while eDEX is on screen. Only turn it on if you understand all of it.`),
      h("pre", { class: "cmdw-out cmdw-review" }, shown),
      shown !== cfg.command && h("p", { class: "dialog-msg warn-text" }, "This command has long blank stretches or invisible characters, marked ⟦like this⟧. That's unusual, and can be a way of hiding part of a command."),
      h("div", { class: "dialog-actions" },
        h("button", { class: "btn", type: "button", "data-autofocus": true, onclick: () => close() }, "Keep it off"),
        h("button", { class: "btn primary", type: "button", onclick: turnOn }, "Turn on")));
  }, { label: "Review command widget" });
}

const EXAMPLES = [
  ["Disk free", "Get-PSDrive -PSProvider FileSystem | Format-Table Name, @{n='Free GB';e={[math]::Round($_.Free/1GB,1)}}, @{n='Used GB';e={[math]::Round($_.Used/1GB,1)}} -AutoSize | Out-String -Width 60"],
  ["Uptime", "$u = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime; '{0}d {1}h {2}m' -f $u.Days, $u.Hours, $u.Minutes"],
  ["Public IP", "(Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5)"],
  ["Top memory", "Get-Process | Sort-Object WS -Descending | Select-Object -First 5 Name, @{n='MB';e={[int]($_.WS/1MB)}} | Format-Table -AutoSize | Out-String -Width 50"]
];

export function editCommandWidget(existing = null) {
  openModal((close) => {
    const title = h("input", { class: "input", placeholder: "Title", value: existing?.title || "" });
    const command = h("textarea", { class: "input mono cmdw-command", rows: 5, spellcheck: false, placeholder: "Get-Date" });
    command.value = existing?.command || "";
    const shell = h("select", { class: "input" }, h("option", { value: "powershell" }, "PowerShell"), h("option", { value: "cmd" }, "Command Prompt"));
    shell.value = existing?.shell || "powershell";
    const interval = h("input", { class: "input", type: "number", min: 5, max: 86400, value: String(existing?.interval || 60) });
    const column = h("select", { class: "input" }, h("option", { value: "right" }, "Right column"), h("option", { value: "left" }, "Left column"));
    column.value = existing?.column || "right";
    const examples = h("div", { class: "cmdw-examples" }, h("span", { class: "muted" }, "Examples:"),
      ...EXAMPLES.map(([t, c]) => h("button", { class: "chip", type: "button", onclick: () => { title.value = t; command.value = c; shell.value = "powershell"; } }, t)));
    const save = () => {
      const cmd = command.value.trim();
      if (!cmd) { toast("Enter a command", { level: "warn" }); return; }
      const cfg = {
        id: existing?.id || `w${Date.now().toString(36)}`,
        title: title.value.trim() || "Command",
        command: cmd, shell: shell.value,
        interval: Math.max(5, Math.min(86400, Math.round(Number(interval.value) || 60))),
        column: column.value,
        enabled: existing?.enabled !== false
      };
      const list = (settings.get("commandWidgets") || []).filter((c) => c.id !== cfg.id);
      if (!existing && list.length >= 12) { toast("At most 12 command widgets", { level: "warn" }); return; }
      settings.set({ commandWidgets: existing ? (settings.get("commandWidgets") || []).map((c) => (c.id === cfg.id ? cfg : c)) : [...list, cfg] });
      const hidden = settings.get("hiddenWidgets") || [];
      if (hidden.includes(`cmd-${cfg.id}`)) settings.set({ hiddenWidgets: hidden.filter((x) => x !== `cmd-${cfg.id}`) });
      close();
      toast(existing ? "Widget updated" : `Added “${cfg.title}”`, { level: "ok", timeout: 1600 });
    };
    const field = (label, el) => h("label", { class: "cmdw-field" }, h("span", { class: "muted" }, label), el);
    setTimeout(() => (existing ? command : title).focus(), 0);
    return h("div", { class: "dialog cmdw-dialog" },
      h("h2", { class: "dialog-title" }, existing ? "Edit command widget" : "New command widget"),
      h("p", { class: "dialog-msg" }, "Runs the command on a schedule (while eDEX is on screen) and shows its output as a panel. Commands run as you, in your home folder, with a 20-second limit."),
      field("Title", title), field("Command", command), examples,
      h("div", { class: "cmdw-row" }, field("Shell", shell), field("Refresh every (seconds)", interval), field("Column", column)),
      h("div", { class: "dialog-actions" },
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"),
        h("button", { class: "btn primary", type: "button", onclick: save }, existing ? "Save" : "Add widget")));
  }, { label: "Command widget" });
}
