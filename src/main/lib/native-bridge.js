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
  constructor({ workDir, log = console }) {
    this.workDir = workDir;
    this.log = log;
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
    this.restarts = [];
    this.disabledReason = process.platform === "win32" ? null : "Native bridge is Windows-only";
    this.stopping = false;
  }

  // Packaged builds keep the script inside app.asar, which powershell.exe
  // cannot read, so a copy is materialised in userData before launch. The BOM
  // makes Windows PowerShell 5.1 decode it as UTF-8 rather than the ANSI page.
  _materializeScript() {
    fs.mkdirSync(this.workDir, { recursive: true });
    const target = path.join(this.workDir, "edex-bridge.ps1");
    const source = `﻿${fs.readFileSync(SCRIPT_SOURCE, "utf8").replace(/^﻿/, "")}`;
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

      const startTimer = setTimeout(() => reject(new Error("Native bridge start timed out")), 20000);
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch (_) { return; }
        if (msg.ready) { clearTimeout(startTimer); resolve(); return; }
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
        if (this.proc === proc) { this.proc = null; this.ready = null; }
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(new Error("Native bridge exited"));
        }
        this.pending.clear();
        if (!this.stopping && code !== 0 && stderr.trim()) {
          this.log.warn(`[native-bridge] exited with code ${code}: ${stderr.trim().slice(0, 600)}`);
        }
        reject(new Error(`Native bridge exited (${code})`));
      });
    });

    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  async call(cmd, args = {}, timeoutMs = 6000) {
    await this._start();
    const proc = this.proc;
    if (!proc) throw new Error("Native bridge is not running");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native call "${cmd}" timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
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
