// Node side of the PowerShell native bridge (see ../native/bridge.ps1).
//
// The helper is started lazily on first use and restarted if it dies. Calls
// made before it is ready are queued behind the ready promise; each call has
// its own timeout so a wedged request can never hang an IPC handler forever.
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const SCRIPT_SOURCE = path.join(__dirname, "..", "native", "bridge.ps1");
const MAX_RESTARTS_PER_MINUTE = 3;

class NativeBridge {
  // waitFor: optional async gate before the first start. A second helper
  // waits for the first so only one of them compiles the interop types.
  // idleMs: stop the helper after this long without calls (it starts again
  // on the next one); hold(reason) keeps it running meanwhile.
  constructor({ workDir, log = console, waitFor = null, idleMs = 0 }) {
    this.workDir = workDir;
    this.log = log;
    this.waitFor = waitFor;
    this.idleMs = idleMs;
    this.idleTimer = null;
    this.idleStopped = null;
    this.holds = new Set();
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
    this.restarts = [];
    this.disabledReason = process.platform === "win32" ? null : "Native bridge is Windows-only";
    this.stopping = false;
  }

  // Keeps the helper running while something lives in it (a disk scan's
  // results), however long nobody calls it.
  hold(reason, on) {
    if (on) this.holds.add(reason); else this.holds.delete(reason);
    this._armIdle();
  }

  _armIdle() {
    clearTimeout(this.idleTimer);
    if (!this.idleMs || !this.proc) return;
    this.idleTimer = setTimeout(() => {
      if (!this.proc || this.pending.size || this.holds.size) { this._armIdle(); return; }
      // Closing its input ends the helper cleanly. It is detached first, so a
      // call arriving while it shuts down starts a fresh one instead of
      // writing to the closed pipe.
      const proc = this.proc;
      this.proc = null;
      this.ready = null;
      this.idleStopped = proc;
      try { proc.stdin.end(); } catch (_) {}
      setTimeout(() => { try { if (proc.exitCode === null) proc.kill(); } catch (_) {} }, 3000);
    }, this.idleMs);
  }

  // Packaged builds keep the script inside app.asar, which powershell.exe
  // cannot read, so a copy is materialised in userData before launch. The BOM
  // makes Windows PowerShell 5.1 decode it as UTF-8 rather than the ANSI page.
  _materializeScript() {
    fs.mkdirSync(this.workDir, { recursive: true });
    const target = path.join(this.workDir, "edex-bridge.ps1");
    const source = `\uFEFF${fs.readFileSync(SCRIPT_SOURCE, "utf8").replace(/^\uFEFF/, "")}`;
    let current = null;
    try { current = fs.readFileSync(target, "utf8"); } catch (_) {}
    if (current !== source) fs.writeFileSync(target, source, "utf8");
    return target;
  }

  _start() {
    if (this.disabledReason) return Promise.reject(new Error(this.disabledReason));
    if (this.ready) return this.ready;

    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 60000);
    if (this.restarts.length >= MAX_RESTARTS_PER_MINUTE) {
      this.disabledReason = "Native bridge crashed repeatedly and was disabled";
      return Promise.reject(new Error(this.disabledReason));
    }
    this.restarts.push(now);

    this.ready = new Promise((resolve, reject) => {
      let script;
      try { script = this._materializeScript(); }
      catch (e) { reject(e); return; }

      // Not `detached`: a detached PowerShell has no console and exits at
      // once. Ctrl+C in eDEX's console is ignored inside the helper instead
      // (see GuardConsole in bridge.ps1), so it outlives eDEX long enough to
      // put the taskbar back when its input closes.
      const proc = spawn("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", script, "-CacheDir", this.workDir
      ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.proc = proc;
      // A helper that dies mid-write raises EPIPE on its input; without a
      // listener that would be an uncaught exception in the main process.
      proc.stdin.on("error", () => {});

      const startTimer = setTimeout(() => {
        reject(new Error("Native bridge start timed out"));
        try { proc.kill(); } catch (_) {}
      }, 20000);
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch (_) { return; }
        if (msg.ready) { clearTimeout(startTimer); resolve(); this._armIdle(); return; }
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.ok) entry.resolve(msg.data);
        else entry.reject(new Error(msg.error || "Native call failed"));
      });

      let stderr = "";
      proc.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
      proc.on("error", (err) => { clearTimeout(startTimer); reject(err); });
      proc.on("exit", (code) => {
        clearTimeout(startTimer);
        rl.close();
        // Only the current helper's calls are failed; a detached (idle-stopped)
        // one has none, and the replacement's must be left alone.
        if (this.proc === proc) {
          this.proc = null;
          this.ready = null;
          for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new Error("Native bridge exited"));
          }
          this.pending.clear();
        }
        if (!this.stopping && this.idleStopped !== proc && code !== 0 && stderr.trim()) {
          this.log.warn(`[native-bridge] exited with code ${code}: ${stderr.trim().slice(0, 600)}`);
        }
        reject(new Error(`Native bridge exited (${code})`));
      });
    });

    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  async call(cmd, args = {}, timeoutMs = 6000) {
    if (this.waitFor) {
      const gate = this.waitFor;
      this.waitFor = null;
      this.gate = Promise.resolve().then(gate).catch(() => {});
    }
    if (this.gate) await this.gate;
    await this._start();
    const proc = this.proc;
    if (!proc) throw new Error("Native bridge is not running");
    const id = this.nextId++;
    clearTimeout(this.idleTimer);
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native call "${cmd}" timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
    result.then(() => this._armIdle(), () => this._armIdle());
    return result;
  }

  warmUp() {
    this._start().catch((e) => this.log.warn(`[native-bridge] unavailable: ${e.message}`));
  }

  stop() {
    this.stopping = true;
    if (this.proc) {
      try { this.proc.stdin.end(); } catch (_) {}
      try { this.proc.kill(); } catch (_) {}
    }
  }
}

module.exports = { NativeBridge };
