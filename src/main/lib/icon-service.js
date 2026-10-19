// Shell icons for files, shortcuts and apps.
//
// Icons are extracted in the native bridge (the shell image list, as
// Explorer does it) so the main process never blocks on COM shortcut
// resolution or image decoding. Results are cached in memory and on disk,
// keyed by file modification time, so later launches need no extraction.
"use strict";

const fs = require("fs");
const { JsonStore } = require("./store");
const { iconFor } = require("./icons");

const BATCH = 8;
const MAX_ENTRIES = 1500;

class IconService {
  constructor({ bridge, cacheFile }) {
    this.bridge = bridge;
    this.store = new JsonStore(cacheFile, { fallback: {}, delayMs: 3000 });
    this.cache = this.store.data; // path -> { m: mtimeMs, u: dataUrl|null }
    this.pending = new Map();
  }

  async _mtime(p) {
    try { return Math.round((await fs.promises.stat(p)).mtimeMs); } catch (_) { return null; }
  }

  _remember(p, m, u) {
    if (!(p in this.cache)) {
      const keys = Object.keys(this.cache);
      if (keys.length >= MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES + 1)) delete this.cache[k];
    }
    this.cache[p] = { m, u };
    this.store.save();
  }

  async _extract(paths) {
    const out = {};
    for (let i = 0; i < paths.length; i += BATCH) {
      const chunk = paths.slice(i, i + BATCH);
      try {
        Object.assign(out, await this.bridge.call("icons", { paths: chunk }, 30000));
      } catch (_) {
        // Bridge unavailable: Electron's own extraction (on this thread).
        for (const p of chunk) out[p] = await iconFor(p).catch(() => null);
      }
    }
    return out;
  }

  async get(paths) {
    const unique = [...new Set(paths.filter((p) => typeof p === "string" && p))];
    const result = {};
    const misses = [];
    await Promise.all(unique.map(async (p) => {
      // Shell parse names (Store apps) have no file to stat; cache them as-is.
      const m = p.startsWith("shell:") ? 0 : await this._mtime(p);
      const hit = this.cache[p];
      if (hit && hit.m === m) { result[p] = hit.u; return; }
      if (this.pending.has(p)) { result[p] = await this.pending.get(p); return; }
      misses.push({ p, m });
    }));
    if (misses.length) {
      const job = this._extract(misses.map((x) => x.p));
      for (const { p } of misses) this.pending.set(p, job.then((r) => r[p] ?? null));
      const extracted = await job;
      for (const { p, m } of misses) {
        const u = extracted[p] ?? null;
        result[p] = u;
        if (m !== null) this._remember(p, m, u);
        this.pending.delete(p);
      }
    }
    return result;
  }

  flush() {
    this.store.flushSync();
  }
}

module.exports = { IconService };
