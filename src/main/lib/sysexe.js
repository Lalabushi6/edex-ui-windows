// Windows' own programs, by full path. A bare name like "powershell.exe" is
// looked up in the current folder first, so a program planted there (the
// Downloads folder a portable copy was started from, say) would run instead.
"use strict";

const path = require("path");
const { spawn } = require("child_process");

const WINDOWS = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
const SYSTEM32 = path.join(WINDOWS, "System32");

const CMD = path.join(SYSTEM32, "cmd.exe");
const EXPLORER = path.join(WINDOWS, "explorer.exe");
const POWERSHELL = path.join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe");
const system32 = (name) => path.join(SYSTEM32, name);

// Starts a program that outlives this call. A failed start is only logged:
// without an error listener it would be an uncaught exception.
function spawnDetached(file, args = [], opts = {}) {
  const child = spawn(file, args, { detached: true, stdio: "ignore", ...opts });
  child.on("error", (e) => console.warn(`[spawn] ${path.basename(file)}: ${e.message}`));
  child.unref();
  return child;
}

// A PowerShell single-quoted string. PowerShell also ends one at the curly
// quotes, which file names can contain.
function psQuote(s) {
  return `'${String(s).replace(/['\u2018\u2019\u201a\u201b]/g, "$&$&")}'`;
}

module.exports = { SYSTEM32, CMD, EXPLORER, POWERSHELL, system32, spawnDetached, psQuote };
