// Static checks: syntax of every main-process (CommonJS) and renderer (ES
// module) file, that relative imports resolve, valid theme JSON, and an
// ASCII-only native bridge script (Windows PowerShell 5.1 misreads UTF-8).
//   npm run check
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const failures = [];
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, pred, out);
    else if (pred(full)) out.push(full);
  }
  return out;
}

function nodeCheck(file, label) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0) failures.push(`Syntax error in ${label}\n${(r.stderr || "").trim()}`);
}

const mainFiles = walk(path.join(root, "src", "main"), (f) => f.endsWith(".js"));
mainFiles.forEach((f) => nodeCheck(f, rel(f)));

const rendererDir = path.join(root, "src", "renderer", "js");
const rendererFiles = walk(rendererDir, (f) => f.endsWith(".js"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edex-check-"));
for (const f of rendererFiles) {
  const copy = path.join(tmp, `${rel(f).replace(/[\\/]/g, "__")}.mjs`);
  fs.copyFileSync(f, copy);
  nodeCheck(copy, rel(f));

  // Relative imports must point at real files (vendor/ is served from node_modules).
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']|\bimport\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const spec = m[1] || m[2];
    let target = path.resolve(path.dirname(f), spec);
    const vendor = /[\\/]renderer[\\/]vendor[\\/]([^\\/]+)[\\/](.+)$/.exec(target);
    if (vendor) {
      const pkg = { xterm: "@xterm/xterm", "xterm-fit": "@xterm/addon-fit" }[vendor[1]];
      target = pkg ? path.join(root, "node_modules", pkg, vendor[2]) : target;
    }
    if (!fs.existsSync(target)) failures.push(`Unresolved import "${spec}" in ${rel(f)}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

const themes = walk(path.join(root, "themes"), (f) => f.endsWith(".json"));
for (const f of themes) {
  try { JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); }
  catch (e) { failures.push(`Invalid theme JSON ${rel(f)}: ${e.message}`); }
}

const bridge = path.join(root, "src", "main", "native", "bridge.ps1");
const bytes = fs.readFileSync(bridge);
const bad = bytes.findIndex((b) => b > 127);
if (bad >= 0) failures.push(`Non-ASCII byte at offset ${bad} in ${rel(bridge)}`);

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log(`OK: ${mainFiles.length} main files, ${rendererFiles.length} renderer modules, ${themes.length} themes.`);
