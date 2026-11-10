// Start menu and desktop shortcuts: where they live, and reading .url files.
// (.lnk files are read by the native helper, which uses the shell's own reader
// without resolving the link; see EdexGames.Links in ../native/bridge.ps1.)
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

function startMenuDirs() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const programData = process.env.ProgramData || "C:\\ProgramData";
  return [
    path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs")
  ];
}

function desktopDirs() {
  const dirs = [path.join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop")];
  try { dirs.unshift(app.getPath("desktop")); } catch (_) {}
  return dirs;
}

async function collectShortcuts(dir, depth = 0, out = [], re = /\.(lnk|url|appref-ms)$/i) {
  if (depth > 4) return out;
  let dirents;
  try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of dirents) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) await collectShortcuts(full, depth + 1, out, re);
    else if (re.test(d.name)) out.push(full);
  }
  return out;
}

const expandEnv = (p) => String(p || "").replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);

// An internet shortcut's address and the icon it names (IconFile, IconIndex).
async function readUrlShortcut(file) {
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile() || st.size > 64 * 1024) return null;
    const buf = await fs.promises.readFile(file);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le", 2) : buf.toString("utf8");
    let section = "";
    const out = { url: "", icon: "", index: 0, m: Math.round(st.mtimeMs), s: st.size };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const head = /^\[(.+)\]$/.exec(line);
      if (head) { section = head[1].trim().toLowerCase(); continue; }
      if (section !== "internetshortcut") continue;
      const kv = /^([^=]+)=(.*)$/.exec(line);
      if (!kv) continue;
      const key = kv[1].trim().toLowerCase();
      const value = kv[2].trim();
      if (key === "url") out.url = value;
      else if (key === "iconfile") out.icon = expandEnv(value);
      else if (key === "iconindex") out.index = Number.parseInt(value, 10) || 0;
    }
    return out;
  } catch (_) {
    return null;
  }
}

module.exports = { startMenuDirs, desktopDirs, collectShortcuts, readUrlShortcut, expandEnv };
