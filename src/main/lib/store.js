"use strict";

const fs = require("fs");
const path = require("path");

// Small JSON document persisted with debounced, atomic (tmp + rename) writes.
class JsonStore {
  constructor(filePath, { fallback = {}, delayMs = 300 } = {}) {
    this.filePath = filePath;
    this.delayMs = delayMs;
    this.timer = null;
    this.writing = Promise.resolve();
    this.data = this._read(fallback);
  }

  _read(fallback) {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : structuredClone(fallback);
    } catch (e) {
      if (e.code !== "ENOENT") {
        // Keep the unreadable file for inspection instead of overwriting it.
        try { fs.copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`); } catch (_) {}
      }
      return structuredClone(fallback);
    }
  }

  get exists() {
    return fs.existsSync(this.filePath);
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const payload = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.catch(() => {}).then(async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await fs.promises.writeFile(tmp, payload, "utf8");
      await fs.promises.rename(tmp, this.filePath);
    });
    return this.writing;
  }

  // On quit. Atomic like flush() (a separate temp name, so an async write
  // still in flight can't collide with it): a crash mid-write leaves the
  // previous file intact instead of a truncated one.
  flushSync() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.sync.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tmp, this.filePath);
    } catch (_) {}
  }
}

module.exports = { JsonStore };
