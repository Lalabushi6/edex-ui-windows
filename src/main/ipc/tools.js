// Assorted tools: custom command widgets, Git status for the terminal's
// folder, battery health, tasks and calendar events, and exporting /
// importing every setting, custom theme and keyboard layout as one file.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { app, dialog } = require("electron");
const { handle, asString } = require("./util");
const { JsonStore } = require("../lib/store");
const { cached } = require("../lib/cache");
const paths = require("../lib/paths");
const { normalizeTheme } = require("./extras");
const { normalizeLayout, LAYOUT_ID } = require("../lib/kb-layout");

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(file, args, { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: "utf8", ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || ""), code: err ? (typeof err.code === "number" ? err.code : -1) : 0, ms: Date.now() - started });
    });
  });
}

function registerTools({ settings, windows }) {
  const userData = app.getPath("userData");

  // ── Command widgets ──────────────────────────────────────────────────────
  // Only commands saved in settings run, at most every few seconds each.
  const lastRun = new Map();
  handle("cmdw:run", async (_e, id) => {
    const def = (settings.get("commandWidgets") || []).find((w) => w.id === id);
    if (!def) throw new Error("Unknown command widget");
    const prev = lastRun.get(id);
    if (prev && Date.now() - prev.at < 3000) return prev.result;
    const r = def.shell === "cmd"
      ? await run("cmd.exe", ["/d", "/s", "/c", `"chcp 65001>nul & ${def.command}"`], { windowsVerbatimArguments: true, cwd: os.homedir() })
      : await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
        `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; ${def.command}`], { cwd: os.homedir() });
    const clean = (s) => s.replace(ANSI, "").replace(/\r/g, "").split("\n").slice(-200).join("\n").trimEnd();
    const result = {
      stdout: clean(r.stdout), stderr: clean(r.stderr), code: r.code, ms: r.ms, at: Date.now(),
      timedOut: !!(r.err && r.err.killed)
    };
    lastRun.set(id, { at: Date.now(), result });
    return result;
  });

  // ── Git status ───────────────────────────────────────────────────────────
  // This runs on its own for whatever folder the terminal enters, so a
  // repository whose own config would make git start programs (fsmonitor,
  // clean/smudge filters, includes that could add either) is not inspected:
  // a downloaded folder must never be able to run code just by being opened.
  const UNSAFE_REPO_CONFIG = /^\s*(fsmonitor|clean|smudge|process|textconv|hookspath|sshcommand|askpass|pager|editor)\s*=|^\s*\[\s*(include|includeif)\b/im;
  handle("git:status", async (_e, cwd) => {
    let dir;
    try { dir = await paths.forRead(asString(cwd, "folder")); } catch (_) { return { repo: false }; }
    if (paths.isUncPath(dir)) return { repo: false };
    const git = (args) => run("git", ["-c", "core.quotepath=off", "-c", "core.fsmonitor=false", "-C", dir, ...args], { timeout: 8000 });
    const where = await git(["rev-parse", "--show-toplevel", "--absolute-git-dir"]);
    if (where.err && where.err.code === "ENOENT") return { repo: false, error: "nogit" };
    if (where.code !== 0) return { repo: false };
    const [topLine, gitDir] = where.stdout.trim().split(/\r?\n/);
    const root = (topLine || dir).replace(/\//g, "\\");
    let config = "";
    try { config = await fs.promises.readFile(path.join(gitDir.replace(/\//g, "\\"), "config"), "utf8"); } catch (_) {}
    if (UNSAFE_REPO_CONFIG.test(config)) return { repo: true, unsafe: true, root };
    const [status, log] = await Promise.all([
      git(["--no-optional-locks", "status", "--porcelain=v2", "--branch", "--untracked-files=normal"]),
      git(["log", "-1", "--format=%h%x09%s%x09%cr"])
    ]);
    if (status.code !== 0) return { repo: false };
    const out = { repo: true, root, branch: "", upstream: "", ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0, files: [] };
    for (const line of status.stdout.split("\n")) {
      if (line.startsWith("# branch.head ")) out.branch = line.slice(14);
      else if (line.startsWith("# branch.upstream ")) out.upstream = line.slice(18);
      else if (line.startsWith("# branch.ab ")) {
        const m = /\+(\d+) -(\d+)/.exec(line);
        if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]); }
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const parts = line.split(" ");
        const xy = parts[1];
        const file = line.startsWith("1 ") ? parts.slice(8).join(" ") : parts.slice(9).join(" ").split("\t")[0];
        if (xy[0] !== ".") out.staged++;
        if (xy[1] !== ".") out.modified++;
        out.files.push({ path: file, state: xy[0] !== "." && xy[1] === "." ? "staged" : xy.includes("D") ? "deleted" : line.startsWith("2 ") ? "renamed" : "modified" });
      } else if (line.startsWith("u ")) {
        out.conflicts++;
        out.files.push({ path: line.split(" ").slice(10).join(" "), state: "conflict" });
      } else if (line.startsWith("? ")) {
        out.untracked++;
        out.files.push({ path: line.slice(2), state: "untracked" });
      }
    }
    out.files = out.files.slice(0, 200);
    const [hash, subject, when] = log.stdout.trim().split("\t");
    out.last = hash ? { hash, subject: subject || "", when: when || "" } : null;
    return out;
  });

  // ── Battery health (Windows' battery report) ─────────────────────────────
  const batteryHealth = cached(async () => {
    const file = path.join(os.tmpdir(), `edex-battery-${process.pid}.xml`);
    const r = await run("powercfg.exe", ["/batteryreport", "/xml", "/output", file], { timeout: 15000 });
    let xml = "";
    try { xml = await fs.promises.readFile(file, "utf8"); } catch (_) {}
    fs.promises.unlink(file).catch(() => {});
    if (r.code !== 0 || !xml) return { present: false };
    const block = (/<Battery>([\s\S]*?)<\/Battery>/.exec(xml) || [])[1];
    if (!block) return { present: false };
    const tag = (name) => ((new RegExp(`<${name}>([^<]*)<`)).exec(block) || [])[1]?.trim() || "";
    const design = Number(tag("DesignCapacity")) || 0;
    const full = Number(tag("FullChargeCapacity")) || 0;
    return {
      present: true, design, full, cycles: Number(tag("CycleCount")) || null,
      health: design > 0 && full > 0 ? Math.round((full / design) * 1000) / 10 : null,
      manufacturer: tag("Manufacturer"), chemistry: tag("Chemistry"), name: tag("Id")
    };
  }, 6 * 3600 * 1000);
  handle("battery:health", () => batteryHealth());

  // ── Tasks and calendar events ────────────────────────────────────────────
  const tasks = new JsonStore(path.join(userData, "tasks.json"), { fallback: { tasks: [], events: [] } });
  handle("tasks:load", () => ({ tasks: tasks.data.tasks || [], events: tasks.data.events || [] }));
  handle("tasks:save", (_e, data) => {
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.events)) throw new Error("Invalid tasks payload");
    const id = (v, i) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : `t${Date.now()}${i}`);
    const due = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    tasks.data = {
      tasks: data.tasks.slice(0, 500).map((t, i) => ({
        id: id(t.id, i), text: String(t.text || "").slice(0, 300), done: !!t.done, due: due(t.due),
        created: Number(t.created) || Date.now(), reminded: !!t.reminded
      })).filter((t) => t.text),
      events: data.events.slice(0, 2000).map((ev, i) => ({
        id: id(ev.id, i), title: String(ev.title || "").slice(0, 200),
        date: /^\d{4}-\d{2}-\d{2}$/.test(ev.date) ? ev.date : null,
        time: /^\d{2}:\d{2}$/.test(ev.time || "") ? ev.time : null,
        remind: Number.isFinite(Number(ev.remind)) && ev.remind !== null && ev.remind !== "" ? Math.max(0, Math.min(10080, Number(ev.remind))) : null,
        reminded: !!ev.reminded
      })).filter((ev) => ev.title && ev.date)
    };
    tasks.save();
    return true;
  });

  // ── Export / import everything ───────────────────────────────────────────
  const customFiles = async (dir) => {
    const out = [];
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch (_) { return out; }
    for (const name of names.filter((n) => n.toLowerCase().endsWith(".json")).slice(0, 200)) {
      try {
        const text = await fs.promises.readFile(path.join(dir, name), "utf8");
        if (text.length < 512 * 1024) out.push({ file: name, content: JSON.parse(text.replace(/^\uFEFF/, "")) });
      } catch (_) {}
    }
    return out;
  };

  handle("settings:export", async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await windows.withDialog((win) => dialog.showSaveDialog(win, {
      title: "Export eDEX settings",
      defaultPath: path.join(app.getPath("documents"), `edex-settings-${stamp}.json`),
      filters: [{ name: "eDEX settings", extensions: ["json"] }]
    }));
    if (canceled || !filePath) return null;
    const bundle = {
      format: "edex-ui-settings", version: 1, exported: new Date().toISOString(),
      settings: settings.all(),
      themes: await customFiles(path.join(userData, "themes")),
      keyboards: await customFiles(path.join(userData, "keyboards"))
    };
    await fs.promises.writeFile(filePath, JSON.stringify(bundle, null, 2), "utf8");
    return { file: filePath, themes: bundle.themes.length, keyboards: bundle.keyboards.length };
  });

  handle("settings:import", async () => {
    const { canceled, filePaths } = await windows.withDialog((win) => dialog.showOpenDialog(win, {
      title: "Import eDEX settings",
      filters: [{ name: "eDEX settings", extensions: ["json"] }],
      properties: ["openFile"]
    }));
    if (canceled || !filePaths.length) return null;
    const st = await fs.promises.stat(filePaths[0]);
    if (st.size > 20 * 1024 * 1024) throw new Error("That file is too large");
    let bundle;
    try { bundle = JSON.parse((await fs.promises.readFile(filePaths[0], "utf8")).replace(/^\uFEFF/, "")); } catch (_) { throw new Error("Not a valid settings file"); }
    if (!bundle || bundle.format !== "edex-ui-settings" || typeof bundle.settings !== "object") throw new Error("Not an eDEX settings export");
    const safeName = (n) => String(n || "").replace(/[^\w .-]/g, "").replace(/^\.+/, "").slice(0, 64);
    let themes = 0;
    let keyboards = 0;
    const themeDir = path.join(userData, "themes");
    for (const t of Array.isArray(bundle.themes) ? bundle.themes.slice(0, 200) : []) {
      const name = safeName(t.file);
      const raw = t.content;
      if (!name.toLowerCase().endsWith(".json") || !raw || typeof raw !== "object" || (!raw.colors && !raw.styles)) continue;
      try {
        normalizeTheme(name.replace(/\.json$/i, ""), raw);
        await fs.promises.mkdir(themeDir, { recursive: true });
        await fs.promises.writeFile(path.join(themeDir, name), JSON.stringify(raw, null, 2), "utf8");
        themes++;
      } catch (_) {}
    }
    const kbDir = path.join(userData, "keyboards");
    // Same checks as kb:import: a usable file name and a valid layout.
    for (const k of Array.isArray(bundle.keyboards) ? bundle.keyboards.slice(0, 100) : []) {
      const name = safeName(k.file);
      const c = k.content;
      if (!/\.json$/i.test(name) || !LAYOUT_ID.test(name.slice(0, -5)) || !c || typeof c !== "object") continue;
      try { normalizeLayout(c); } catch (_) { continue; }
      await fs.promises.mkdir(kbDir, { recursive: true });
      await fs.promises.writeFile(path.join(kbDir, name), JSON.stringify(c, null, 2), "utf8");
      keyboards++;
    }
    // Command widgets run commands on a schedule; a shared settings file must
    // not be able to start them without the user seeing what they are.
    const incoming = { ...bundle.settings };
    const cmds = Array.isArray(incoming.commandWidgets) ? incoming.commandWidgets.filter((w) => w && typeof w.command === "string" && w.command.trim()) : [];
    let skippedCommands = 0;
    if (cmds.length) {
      const list = cmds.slice(0, 8).map((w) => `• ${String(w.title || "Command").slice(0, 40)}: ${w.command.slice(0, 160)}`).join("\n");
      const { response } = await windows.withDialog((win) => dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Import without them", "Import and allow them"],
        defaultId: 0,
        cancelId: 0,
        title: "Command widgets in this file",
        message: `This settings file contains ${cmds.length} command widget${cmds.length === 1 ? "" : "s"}, which run commands on your PC automatically.`,
        detail: `${list}${cmds.length > 8 ? `\n… and ${cmds.length - 8} more` : ""}\n\nOnly allow them if you trust where this file came from.`
      }));
      if (response !== 1) { delete incoming.commandWidgets; skippedCommands = cmds.length; }
    }
    const applied = settings.set(incoming);
    return { settings: Object.keys(applied || {}).length, themes, keyboards, skippedCommands };
  });

  return { flush: () => tasks.flushSync() };
}

module.exports = { registerTools };
