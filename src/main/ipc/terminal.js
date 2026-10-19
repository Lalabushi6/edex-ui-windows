// Pseudo-terminal sessions. The renderer chooses a shell by id from the list
// detected here; it never supplies an executable path or arguments.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const pty = require("node-pty");
const { handle, on } = require("./util");

const MAX_SESSIONS = 24;
const FLUSH_MS = 8;

function findOnPath(exe) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir.replace(/^"|"$/g, ""), exe);
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {}
  }
  return null;
}

function detectShells() {
  const sys32 = path.join(process.env.WINDIR || "C:\\Windows", "System32");
  const list = [
    { id: "powershell", name: "Windows PowerShell", file: path.join(sys32, "WindowsPowerShell", "v1.0", "powershell.exe"), args: ["-NoLogo"] }
  ];
  const pwsh = findOnPath("pwsh.exe") ||
    [path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe")].find((p) => fs.existsSync(p));
  if (pwsh) list.push({ id: "pwsh", name: "PowerShell 7", file: pwsh, args: ["-NoLogo"] });
  list.push({ id: "cmd", name: "Command Prompt", file: path.join(sys32, "cmd.exe"), args: [] });
  const wsl = path.join(sys32, "wsl.exe");
  if (fs.existsSync(wsl)) list.push({ id: "wsl", name: "WSL", file: wsl, args: [] });
  const gitBash = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "bin", "bash.exe")
  ].find((p) => fs.existsSync(p));
  if (gitBash) list.push({ id: "gitbash", name: "Git Bash", file: gitBash, args: ["--login", "-i"] });
  return list.filter((s) => s.id === "powershell" || fs.existsSync(s.file));
}

function registerTerminal({ settings }) {
  const shells = detectShells();
  const sessions = new Map(); // id -> { proc, wc, buffer, timer }
  let nextId = 1;

  const flush = (id) => {
    const s = sessions.get(id);
    if (!s) return;
    s.timer = null;
    if (!s.buffer) return;
    const data = s.buffer;
    s.buffer = "";
    if (!s.wc.isDestroyed()) s.wc.send("term:data", { id, data });
  };

  const kill = (id) => {
    const s = sessions.get(id);
    if (!s) return false;
    sessions.delete(id);
    clearTimeout(s.timer);
    try { s.proc.kill(); } catch (_) {}
    return true;
  };

  handle("term:shells", () => shells.map(({ id, name }) => ({ id, name })));

  handle("term:spawn", (event, opts = {}) => {
    if (sessions.size >= MAX_SESSIONS) throw new Error(`Session limit reached (${MAX_SESSIONS})`);
    const shell = shells.find((s) => s.id === opts.shell) ||
      shells.find((s) => s.id === settings.get("defaultShell")) || shells[0];
    let cwd = os.homedir();
    if (typeof opts.cwd === "string" && opts.cwd) {
      try { if (fs.statSync(opts.cwd).isDirectory()) cwd = opts.cwd; } catch (_) {}
    }
    const cols = Math.max(2, Math.min(1000, Number(opts.cols) || 80));
    const rows = Math.max(2, Math.min(500, Number(opts.rows) || 24));

    const proc = pty.spawn(shell.file, shell.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM_PROGRAM: "eDEX-UI", COLORTERM: "truecolor" }
    });
    const id = nextId++;
    const wc = event.sender;
    const session = { proc, wc, buffer: "", timer: null };
    sessions.set(id, session);

    // Coalesce bursts of output into one IPC message per few ms; a noisy
    // command can otherwise emit thousands of tiny messages per second.
    proc.onData((data) => {
      session.buffer += data;
      if (session.buffer.length > 262144) flush(id);
      else if (!session.timer) session.timer = setTimeout(() => flush(id), FLUSH_MS);
    });
    proc.onExit(({ exitCode, signal }) => {
      flush(id);
      sessions.delete(id);
      if (!wc.isDestroyed()) wc.send("term:exit", { id, exitCode, signal });
    });
    wc.once("destroyed", () => kill(id));

    return { id, shell: shell.id, shellName: shell.name, cwd };
  });

  handle("term:kill", (_event, id) => kill(Number(id)));

  on("term:write", (event, { id, data } = {}) => {
    const s = sessions.get(Number(id));
    if (s && s.wc === event.sender && typeof data === "string") s.proc.write(data);
  });

  on("term:resize", (event, { id, cols, rows } = {}) => {
    const s = sessions.get(Number(id));
    if (!s || s.wc !== event.sender) return;
    const c = Math.max(2, Math.min(1000, Number(cols) || 0));
    const r = Math.max(2, Math.min(500, Number(rows) || 0));
    try { s.proc.resize(c, r); } catch (_) {}
  });

  return {
    shells,
    killAll() { for (const id of [...sessions.keys()]) kill(id); }
  };
}

module.exports = { registerTerminal };
