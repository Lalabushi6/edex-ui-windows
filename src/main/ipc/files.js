// Filesystem access for the explorer, viewer, launcher and notes.
// Path policy (what may be read/written) lives in ../lib/paths.js.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, shell, dialog, nativeImage } = require("electron");
const { spawn } = require("child_process");
const paths = require("../lib/paths");
const { cached } = require("../lib/cache");
const { handle, on, asString, asStringList } = require("./util");

const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const PEEK_BYTES = 256 * 1024;

const EXECUTABLE_EXTS = new Set([
  ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse",
  ".wsf", ".wsh", ".jar", ".hta", ".cpl", ".msc", ".reg", ".lnk", ".url", ".pif", ".application", ".appref-ms"
]);
const ICON_EXTS = new Set([".exe", ".lnk", ".url", ".msi", ".appref-ms", ".ico", ".cpl", ".msc"]);
const HIDDEN_NAMES = new Set([
  "desktop.ini", "thumbs.db", "ntuser.dat", "ntuser.ini", "ntuser.pol", "pagefile.sys", "hiberfil.sys",
  "swapfile.sys", "dumpstack.log", "dumpstack.log.tmp", "system volume information", "config.msi",
  "recovery", "$recycle.bin", "$windows.~bt", "$windows.~ws", "$winreagent", "msocache", "bootmgr", "bootnxt"
]);

function isHiddenName(name) {
  const lower = name.toLowerCase();
  return lower.startsWith(".") || lower.startsWith("$") || lower.startsWith("ntuser.dat") || HIDDEN_NAMES.has(lower);
}

function trustedShortcutDirs() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const programData = process.env.ProgramData || "C:\\ProgramData";
  const publicDir = process.env.PUBLIC || "C:\\Users\\Public";
  const dirs = [
    path.join(appData, "Microsoft", "Windows", "Start Menu"),
    path.join(programData, "Microsoft", "Windows", "Start Menu"),
    path.join(appData, "Microsoft", "Internet Explorer", "Quick Launch"),
    path.join(publicDir, "Desktop")
  ];
  try { dirs.push(app.getPath("desktop")); } catch (_) {}
  return dirs;
}

function registerFiles({ windows, bridge, icons }) {
  const listCache = new Map();
  const LIST_TTL = 1500;

  const invalidate = (...dirs) => {
    for (const d of dirs) if (d) listCache.delete(d.toLowerCase());
  };

  const confirm = (options) => windows.withDialog((win) => dialog.showMessageBox(win, {
    type: "warning", defaultId: 0, cancelId: 0, noLink: true, ...options
  }));

  async function listDir(dirPath, fresh = false) {
    const dir = await paths.forRead(dirPath);
    const key = dir.toLowerCase();
    const hit = listCache.get(key);
    if (!fresh && hit && Date.now() - hit.at < LIST_TTL) return hit.value;

    let dirents;
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      throw new Error(e.code === "EPERM" || e.code === "EACCES" ? "Access denied" : `Cannot open folder: ${e.message}`);
    }

    const entries = await Promise.all(dirents.map(async (d) => {
      const full = path.join(dir, d.name);
      let isDir = d.isDirectory();
      let isFile = d.isFile();
      const isLink = d.isSymbolicLink();
      let stat = null;
      try {
        stat = await fs.promises.stat(full);
        isDir = stat.isDirectory();
        isFile = stat.isFile();
      } catch (_) {
        // Legacy junctions like "My Documents" deny traversal; hide them.
        if (isLink) return null;
      }
      if (!isDir && !isFile) return null;
      const ext = isDir ? "" : path.extname(d.name).toLowerCase();
      return {
        name: d.name,
        path: full,
        isDir,
        isLink,
        ext,
        size: isDir ? 0 : (stat?.size ?? 0),
        mtime: stat?.mtimeMs ?? null,
        hidden: isHiddenName(d.name)
      };
    }));

    const value = { dir, entries: entries.filter(Boolean) };
    if (listCache.size > 64) listCache.delete(listCache.keys().next().value);
    listCache.set(key, { at: Date.now(), value });
    return value;
  }

  handle("fs:home", () => paths.canonicalHomePromise);

  handle("fs:places", () => {
    const out = [{ id: "home", label: "Home", path: os.homedir() }];
    for (const [id, label] of [
      ["desktop", "Desktop"], ["documents", "Documents"], ["downloads", "Downloads"],
      ["pictures", "Pictures"], ["music", "Music"], ["videos", "Videos"]
    ]) {
      try { out.push({ id, label, path: app.getPath(id) }); } catch (_) {}
    }
    return out.filter((p) => fs.existsSync(p.path));
  });

  // `fresh` skips the short listing cache (the file panel re-reads a folder
  // right after a shell command that may have changed it).
  handle("fs:list", (_e, dir, opts) => listDir(asString(dir, "path"), !!opts?.fresh));

  handle("fs:stat", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    const s = await fs.promises.stat(p);
    return {
      path: p, name: path.basename(p) || p, isDir: s.isDirectory(), size: s.size,
      mtime: s.mtimeMs, ctime: s.birthtimeMs, atime: s.atimeMs, readonly: !(s.mode & 0o200)
    };
  });

  handle("fs:peek", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    const { size } = await fs.promises.stat(p);
    const fd = await fs.promises.open(p, "r");
    try {
      const buf = Buffer.alloc(Math.min(PEEK_BYTES, size));
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      const slice = buf.subarray(0, bytesRead);
      let nonText = 0;
      for (let i = 0; i < Math.min(slice.length, 8192); i++) {
        const c = slice[i];
        if (c === 0) { nonText = Infinity; break; }
        if (c < 9 || (c > 13 && c < 32)) nonText++;
      }
      const binary = nonText > Math.min(slice.length, 8192) * 0.1;
      const text = binary ? "" : slice.toString("utf8").replace(/^\uFEFF/, "");
      return { text, binary, size, truncated: size > bytesRead };
    } finally {
      await fd.close();
    }
  });

  handle("fs:read", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    const { size } = await fs.promises.stat(p);
    if (size > MAX_TEXT_BYTES) throw new Error("File is too large to edit here (limit 16 MB)");
    return (await fs.promises.readFile(p, "utf8")).replace(/^\uFEFF/, "");
  });

  handle("fs:write", async (_e, target, content) => {
    const text = String(content ?? "");
    if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) throw new Error("Content too large (limit 16 MB)");
    const p = await paths.forWrite(asString(target, "path"));
    await fs.promises.writeFile(p, text, "utf8");
    invalidate(path.dirname(p));
    return true;
  });

  handle("fs:create", async (_e, dirPath, name, kind) => {
    const dir = await paths.forWrite(asString(dirPath, "folder"), { allowRoot: true });
    const target = path.join(dir, paths.validateEntryName(name));
    if (kind === "folder") await fs.promises.mkdir(target);
    else await fs.promises.writeFile(target, "", { flag: "wx" });
    invalidate(dir);
    return target;
  });

  handle("fs:rename", async (_e, target, nextName) => {
    const p = await paths.forWrite(asString(target, "path"));
    const dest = path.join(path.dirname(p), paths.validateEntryName(nextName));
    if (dest.toLowerCase() !== p.toLowerCase() && fs.existsSync(dest)) {
      throw new Error("An item with that name already exists");
    }
    await fs.promises.rename(p, dest);
    invalidate(path.dirname(p));
    return dest;
  });

  async function transfer(sources, destDir, mode) {
    const dest = await paths.forWrite(asString(destDir, "destination"), { allowRoot: true });
    const destStat = await fs.promises.stat(dest);
    if (!destStat.isDirectory()) throw new Error("Destination is not a folder");
    const results = [];
    for (const raw of asStringList(sources, "sources")) {
      const src = mode === "move" ? await paths.forWrite(raw) : await paths.forRead(raw);
      const stat = await fs.promises.stat(src);
      if (stat.isDirectory() && paths.isPathInside(src, dest)) {
        throw new Error(`Cannot ${mode} "${path.basename(src)}" into itself`);
      }
      const sameDir = path.dirname(src).toLowerCase() === dest.toLowerCase();
      if (mode === "move" && sameDir) continue;
      const target = await paths.uniqueDestination(dest, path.basename(src), { copySuffix: mode === "copy" && sameDir });
      if (mode === "move") {
        try {
          await fs.promises.rename(src, target);
        } catch (e) {
          if (e.code !== "EXDEV") throw e;
          await fs.promises.cp(src, target, { recursive: true, errorOnExist: true, force: false });
          await fs.promises.rm(src, { recursive: true, force: false });
        }
        invalidate(path.dirname(src));
      } else {
        await fs.promises.cp(src, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      }
      results.push({ from: src, to: target });
    }
    invalidate(dest);
    return results;
  }

  handle("fs:copy", (_e, sources, destDir) => transfer(sources, destDir, "copy"));
  handle("fs:move", (_e, sources, destDir) => transfer(sources, destDir, "move"));

  // Deleting goes to the Recycle Bin so every removal is recoverable.
  handle("fs:trash", async (_e, targets) => {
    const done = [];
    for (const raw of asStringList(targets, "paths")) {
      const p = await paths.forWrite(raw);
      await shell.trashItem(p);
      invalidate(path.dirname(p));
      done.push(p);
    }
    return done;
  });

  handle("fs:open", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    if (paths.isUncPath(p)) throw new Error("Refusing to open items from network paths");
    const stat = await fs.promises.stat(p);
    const ext = path.extname(p).toLowerCase();
    const trusted = trustedShortcutDirs().some((d) => paths.isPathInside(d, p));
    if (!stat.isDirectory() && EXECUTABLE_EXTS.has(ext) && !trusted) {
      const { response } = await confirm({ buttons: ["Cancel", "Run"], message: "Run this program?", detail: p });
      if (response !== 1) return false;
    }
    windows.yieldFocus();
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return true;
  });

  handle("fs:openWith", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    windows.yieldFocus();
    spawn("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", p], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return true;
  });

  handle("fs:reveal", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    windows.yieldFocus();
    shell.showItemInFolder(p);
    return true;
  });

  handle("fs:icons", async (_e, targets) => {
    const out = {};
    const wanted = [];
    for (const raw of (Array.isArray(targets) ? targets.slice(0, 200) : [])) {
      if (typeof raw !== "string" || !raw) continue;
      const usable = ICON_EXTS.has(path.extname(raw).toLowerCase()) && !paths.isSensitive(raw) && !paths.isUncPath(raw);
      if (usable) wanted.push(raw);
      else out[raw] = null;
    }
    return Object.assign(out, await icons.get(wanted));
  });

  // Drag files out of eDEX into other applications.
  on("fs:startDrag", async (event, targets) => {
    try {
      const files = [];
      for (const raw of asStringList(targets, "paths", 100)) files.push(await paths.forRead(raw));
      let icon;
      try { icon = await app.getFileIcon(files[0], { size: "normal" }); } catch (_) { icon = nativeImage.createEmpty(); }
      event.sender.startDrag({ file: files[0], files, icon });
    } catch (_) {}
  });

  handle("fs:search", async (_e, opts = {}) => {
    const root = await paths.forRead(asString(opts.root, "root"));
    const query = String(opts.query || "").trim().toLowerCase();
    if (!query) return { results: [], truncated: false };
    const max = Math.min(500, Math.max(1, Number(opts.max) || 200));
    const deadline = Date.now() + 10000;
    const wildcard = /[*?]/.test(query)
      ? new RegExp(`^${query.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)
      : null;
    const matches = (name) => (wildcard ? wildcard.test(name.toLowerCase()) : name.toLowerCase().includes(query));
    const results = [];
    const queue = [root];
    let scanned = 0;
    while (queue.length && results.length < max && Date.now() < deadline) {
      const dir = queue.shift();
      if (paths.isSensitive(dir)) continue;
      let dirents;
      try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
      scanned++;
      for (const d of dirents) {
        const full = path.join(dir, d.name);
        if (d.isDirectory() && !d.isSymbolicLink()) {
          if (!isHiddenName(d.name) && d.name !== "node_modules") queue.push(full);
        }
        if (matches(d.name)) {
          results.push({ name: d.name, path: full, isDir: d.isDirectory() });
          if (results.length >= max) break;
        }
      }
    }
    return { results, truncated: queue.length > 0, scanned };
  });

  // A shallow index of the user's main folders for launcher file search.
  const quickIndex = cached(async () => {
    const roots = [];
    for (const id of ["desktop", "documents", "downloads", "pictures", "music", "videos"]) {
      try { roots.push(app.getPath(id)); } catch (_) {}
    }
    const out = [];
    const seen = new Set();
    const LIMIT = 12000;
    const walk = async (dir, depth) => {
      if (out.length >= LIMIT || depth > 3 || seen.has(dir.toLowerCase())) return;
      seen.add(dir.toLowerCase());
      let dirents;
      try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const d of dirents) {
        if (out.length >= LIMIT) return;
        if (isHiddenName(d.name) || d.name === "node_modules") continue;
        const full = path.join(dir, d.name);
        out.push({ name: d.name, path: full, isDir: d.isDirectory() });
        if (d.isDirectory() && !d.isSymbolicLink()) await walk(full, depth + 1);
      }
    };
    for (const r of roots) if (fs.existsSync(r)) await walk(r, 0);
    return out;
  }, 3 * 60 * 1000);

  handle("fs:quickIndex", () => quickIndex());

  handle("fs:properties", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    windows.yieldFocus();
    return bridge.call("properties", { path: p });
  });

  return { invalidate };
}

module.exports = { registerFiles, EXECUTABLE_EXTS };
