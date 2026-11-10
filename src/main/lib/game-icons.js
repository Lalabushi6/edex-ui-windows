// Square game icons, made once by the native helper and kept on disk.
//
// A game's icon comes from, in order: the icon its shortcut names (a .lnk's
// icon location and index, a .url's IconFile and IconIndex, or a Store game's
// Start menu entry), then the icon of the program itself. With neither, the
// interface draws a plain game icon. The helper decodes the chosen image at its
// real size and centres it on a transparent square, so nothing is stretched or
// cropped (see EdexGames.Extract in ../native/bridge.ps1).
//
// Each PNG is named after a hash of everything it was made from: the paths,
// the icon index, and the size and time of the shortcut and of every file it
// could come from. Editing a shortcut or updating a game gives a new name and
// one new extraction; an unchanged game is never extracted again. Work happens
// only when the interface asks for icons it is showing. There's no timer.
//
// Network paths, mapped network drives and drives that aren't there are never
// touched: looking at a network path would send this PC's sign-in hash to the
// server it names, and a shortcut can name any server.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

const ALGO = 1; // bump when the helper's output changes
const SIZE = 256; // pixels; sharp at the library's size on a 250% display
// Icons per helper call. The panels' telemetry shares the helper and waits
// behind each call, so calls stay short (about 20 ms per icon here).
const BATCH = 2;

const DRIVE_REMOTE = 4;

// Whether following links along a local path reaches a network share. Path
// components are lstat'ed once per probe round; only a path that really holds
// a link gets the full check.
async function reachesNetwork(p, seen) {
  const { root } = path.parse(p);
  let current = root;
  for (const part of p.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const key = current.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, fs.promises.lstat(current).then((st) => st.isSymbolicLink(), () => null));
    }
    const link = await seen.get(key);
    if (link === null) return false; // missing: nothing further to follow
    if (link) return paths.linksToNetwork(p);
  }
  return false;
}

// The drive letters and their types, asked at most every few seconds.
let drivesSeen = { at: 0, value: null };
async function driveTypes(bridge) {
  if (Date.now() - drivesSeen.at < 3000) return drivesSeen.value;
  let value = null;
  try { value = await bridge.call("driveTypes", {}, 5000); } catch (_) {}
  drivesSeen = { at: value ? Date.now() : 0, value };
  return value;
}

// One state per path: ok (with size and time), missing, drive (its drive
// isn't there), network, or other (unusable, never read).
async function probe(list, bridge) {
  const drives = await driveTypes(bridge);
  const seen = new Map();
  const out = new Map();
  await Promise.all([...new Set(list.filter((p) => typeof p === "string" && p))].map(async (p) => {
    let state;
    const letter = /^([A-Za-z]):[\\/]/.exec(p)?.[1]?.toUpperCase();
    if (paths.isUncPath(p)) state = { state: "network" };
    else if (!letter || /[<>"|?*\u0000-\u001F]/.test(p.slice(3))) state = { state: "other" };
    else if (drives && !(letter in drives)) state = { state: "drive", drive: letter };
    else if (drives && drives[letter] === DRIVE_REMOTE) state = { state: "network" };
    else if (paths.isSensitive(p)) state = { state: "other" };
    else if (await reachesNetwork(path.resolve(p), seen)) state = { state: "network" };
    else {
      try {
        const st = await fs.promises.stat(p);
        state = { state: "ok", m: Math.round(st.mtimeMs), s: st.size, dir: st.isDirectory() };
      } catch (e) {
        state = { state: e.code === "ENOENT" || e.code === "ENOTDIR" ? "missing" : "other" };
      }
    }
    out.set(p, state);
  }));
  return out;
}

class GameIcons {
  // store: the library's JsonStore; icons live in store.data.icons as
  // id -> { key, file, via, w, h } or { key, none: true }.
  constructor({ bridge, dir, store }) {
    this.bridge = bridge;
    this.dir = dir;
    this.store = store;
    this.pending = new Map(); // id -> promise of its entry
  }

  get entries() {
    return this.store.data.icons || (this.store.data.icons = {});
  }

  // The icon file last made for a game, if it's still current as far as is
  // known without looking at the disk (used for lists).
  known(id) {
    const e = this.entries[id];
    return e && !e.none && e.file ? { icon: e.file, via: e.via } : { icon: null, via: null };
  }

  forget(id) {
    delete this.entries[id];
  }

  // items: [{ id, sources: [{ via, file, index } | { via, shell, stamp }], stamps: [path], targets: [path] }]
  // Returns id -> { icon, via, missing }: missing is "drive" or "file" for the
  // first target that isn't there, else null.
  async resolve(items) {
    const filePaths = [];
    for (const it of items) {
      for (const s of it.sources) if (s.file) filePaths.push(s.file);
      for (const p of it.stamps || []) filePaths.push(p);
      for (const p of it.targets || []) filePaths.push(p);
    }
    const states = await probe(filePaths, this.bridge);
    const result = {};
    const misses = [];
    await Promise.all(items.map(async (it) => {
      let missing = null;
      for (const p of it.targets || []) {
        const st = states.get(p)?.state;
        if (st === "drive" || st === "missing") { missing = st === "drive" ? "drive" : "file"; break; }
      }
      const usable = it.sources.filter((s) => s.shell || states.get(s.file)?.state === "ok");
      const key = this.keyFor(it, states);
      // Being made for another request: wait for that one.
      if (this.pending.has(it.id)) {
        const e = await this.pending.get(it.id);
        result[it.id] = { icon: e?.file || null, via: e?.via || null, missing };
        return;
      }
      const have = this.entries[it.id];
      const hit = have?.key === key && (have.none || await fs.promises.access(have.file).then(() => true, () => false));
      if (hit) {
        result[it.id] = { icon: have.none ? null : have.file, via: have.none ? null : have.via, missing };
        return;
      }
      // Marked at once, so a request arriving meanwhile waits instead of
      // making the same icon again.
      if (this.pending.has(it.id)) {
        const e = await this.pending.get(it.id);
        result[it.id] = { icon: e?.file || null, via: e?.via || null, missing };
        return;
      }
      let settle;
      this.pending.set(it.id, new Promise((r) => { settle = r; }));
      misses.push({ it, key, usable, missing, settle });
    }));
    for (let i = 0; i < misses.length; i += BATCH) {
      const batch = misses.slice(i, i + BATCH);
      let done = new Map();
      try {
        done = await this.extract(batch);
      } finally {
        for (const m of batch) {
          const e = done.get(m.it.id) || null;
          this.pending.delete(m.it.id);
          m.settle(e);
          result[m.it.id] = { icon: e?.file || null, via: e?.via || null, missing: m.missing };
        }
      }
    }
    if (misses.length) {
      this.store.save();
      this.prune().catch(() => {});
    }
    return result;
  }

  keyFor(it, states) {
    const h = crypto.createHash("sha1").update(`${ALGO}|${SIZE}`);
    const stamp = (p) => {
      const st = states.get(p);
      return `${p.toLowerCase()}|${st?.state}|${st?.m ?? ""}|${st?.s ?? ""}`;
    };
    for (const s of it.sources) h.update(s.shell ? `|shell|${s.shell}|${s.stamp || ""}` : `|${s.via}|${s.index | 0}|${stamp(s.file)}`);
    for (const p of it.stamps || []) h.update(`|stamp|${stamp(p)}`);
    return h.digest("hex").slice(0, 24);
  }

  // Returns id -> entry. A helper that can't be reached records nothing, so
  // the next look tries again.
  async extract(batch) {
    const out = new Map();
    const work = batch.filter((m) => m.usable.length);
    for (const m of batch) {
      if (!m.usable.length) {
        this.entries[m.it.id] = { key: m.key, none: true };
        out.set(m.it.id, this.entries[m.it.id]);
      }
    }
    if (!work.length) return out;
    await fs.promises.mkdir(this.dir, { recursive: true });
    const items = work.map((m) => ({
      out: path.join(this.dir, `${m.key}.png`),
      files: m.usable.map((s) => s.shell || s.file),
      indexes: m.usable.map((s) => s.index | 0)
    }));
    let res;
    try {
      res = await this.bridge.call("gameIcons", { size: SIZE, items }, 30000);
    } catch (_) {
      return out;
    }
    work.forEach((m, i) => {
      const r = Array.isArray(res) ? res[i] : null;
      if (!r || typeof r.used !== "number") return;
      const src = m.usable[r.used];
      this.entries[m.it.id] = src
        ? { key: m.key, file: items[i].out, via: src.via, w: r.w, h: r.h }
        : { key: m.key, none: true };
      out.set(m.it.id, this.entries[m.it.id]);
    });
    return out;
  }

  // Deletes PNGs no game points at any more (never while one is being made),
  // and temporary files an interrupted run left behind.
  async prune() {
    if (this.pending.size) return;
    const keep = new Set(Object.values(this.entries).filter((e) => e?.file).map((e) => path.basename(e.file).toLowerCase()));
    let names = [];
    try { names = await fs.promises.readdir(this.dir); } catch (_) { return; }
    await Promise.all(names.map(async (n) => {
      const full = path.join(this.dir, n);
      if (/\.png$/i.test(n) && !keep.has(n.toLowerCase())) await fs.promises.unlink(full).catch(() => {});
      else if (/\.tmp$/i.test(n)) {
        const st = await fs.promises.stat(full).catch(() => null);
        if (st && Date.now() - st.mtimeMs > 10 * 60 * 1000) await fs.promises.unlink(full).catch(() => {});
      }
    }));
  }
}

module.exports = { GameIcons, probe, ICON_SIZE: SIZE };
