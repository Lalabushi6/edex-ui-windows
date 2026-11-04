"use strict";

const fs = require("fs");
const { safeStorage } = require("electron");

// A short secret kept in one file, encrypted with Windows DPAPI (Electron
// safeStorage). Reads, writes and removals run one at a time, so a read that
// rewrites the file can't bring back a value that was just replaced or removed.
class SecretFile {
  constructor(filePath) {
    this.filePath = filePath;
    this.tmpPath = `${filePath}.tmp`;
    this.queue = Promise.resolve();
  }

  get exists() {
    return fs.existsSync(this.filePath);
  }

  _next(job) {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  // Atomic (tmp + rename): a crash mid-write leaves the previous file intact.
  async _store(value) {
    await fs.promises.writeFile(this.tmpPath, await safeStorage.encryptStringAsync(value));
    await fs.promises.rename(this.tmpPath, this.filePath);
  }

  async available() {
    try { return await safeStorage.isAsyncEncryptionAvailable(); } catch (_) { return false; }
  }

  // The secret, or null when there is none or it can't be decrypted here.
  read() {
    return this._next(async () => {
      let stored;
      try {
        if (!(await this.available())) return null;
        stored = await safeStorage.decryptStringAsync(await fs.promises.readFile(this.filePath));
      } catch (_) { return null; }
      // The value is good either way; a failed rewrite waits for the next read.
      if (stored.shouldReEncrypt) await this._store(stored.result).catch(() => {});
      return stored.result;
    });
  }

  write(value) {
    return this._next(() => this._store(value));
  }

  remove() {
    return this._next(async () => {
      await fs.promises.rm(this.tmpPath, { force: true });
      await fs.promises.rm(this.filePath, { force: true });
    });
  }
}

module.exports = { SecretFile };
