// System telemetry IPC. Data comes from ../lib/telemetry.js (native bridge),
// so polling widgets never launch processes.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, dialog } = require("electron");
const { handle } = require("./util");

// Terminating any of these bug-checks Windows or kills the session.
const PROTECTED_PROCESSES = new Set([
  "system", "system idle process", "registry", "smss.exe", "csrss.exe", "wininit.exe",
  "winlogon.exe", "services.exe", "lsass.exe", "lsaiso.exe", "svchost.exe", "dwm.exe",
  "fontdrvhost.exe", "sihost.exe", "explorer.exe", "memory compression", "secure system"
]);

function registerSystem({ windows, telemetry }) {
  handle("sys:static", () => telemetry.static());

  // Everything the side panels refresh frequently, in one round trip.
  handle("sys:live", () => telemetry.live());

  handle("sys:battery", () => telemetry.battery());

  handle("sys:temp", async () => {
    const t = await telemetry.temp().catch(() => null);
    return { main: t, max: t };
  });

  handle("sys:drives", () => telemetry.drives());

  handle("sys:processes", async (_e, opts = {}) => {
    const data = await (opts.paths ? telemetry.processesWithPaths() : telemetry.processes());
    return { all: data.all, threads: data.threads, list: data.list };
  });

  handle("sys:uptime", () => os.uptime());

  handle("sys:kill", async (_event, pid) => {
    const target = Number(pid);
    if (!Number.isInteger(target) || target <= 4) throw new Error("Invalid PID");
    const ownPids = new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
    if (ownPids.has(target)) throw new Error("Refusing to terminate eDEX-UI itself");
    let name = null;
    try { name = (await telemetry.processes()).list.find((p) => p.pid === target)?.name || null; } catch (_) {}
    if (name && PROTECTED_PROCESSES.has(name.toLowerCase())) {
      throw new Error(`${name} is a protected system process`);
    }
    const { response } = await windows.withDialog((win) => dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Cancel", "End process"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `End ${name || `PID ${target}`}?`,
      detail: "Unsaved work in this process will be lost."
    }));
    if (response !== 1) return false;
    process.kill(target);
    telemetry.processes.invalidate();
    telemetry.processesWithPaths.invalidate();
    return true;
  });

  // eDEX's own footprint, for Settings → Performance.
  handle("sys:appUsage", async () => {
    const metrics = app.getAppMetrics();
    let bridge = null;
    try {
      const pid = telemetry.bridge.proc?.pid;
      if (pid) bridge = (await telemetry.processes()).list.find((p) => p.pid === pid) || null;
    } catch (_) {}
    return {
      processes: metrics.map((m) => ({ type: m.type, pid: m.pid, cpu: m.cpu.percentCPUUsage, memory: m.memory.workingSetSize * 1024 })),
      bridge: bridge ? { pid: bridge.pid, cpu: bridge.cpu, memory: bridge.memBytes } : null
    };
  });

  // A file people attach to bug reports: no PC or user name, no addresses.
  handle("sys:snapshot", async () => {
    const [info, live, d, procs] = await Promise.all([
      telemetry.static(), telemetry.live(), telemetry.drives().catch(() => []), telemetry.processes().catch(() => ({ list: [] }))
    ]);
    const dest = path.join(app.getPath("documents"), `edex-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const top = procs.list.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 25)
      .map(({ pid, name, cpu, mem, memBytes }) => ({ pid, name, cpu, mem, memBytes }));
    const { hostname: _h, user: _u, ...system } = info;
    const { ip4: _ip, mac: _mac, ...network } = live.net;
    await fs.promises.writeFile(dest, JSON.stringify({
      timestamp: new Date().toISOString(),
      system,
      uptime: os.uptime(),
      cpu: live.cpu,
      memory: live.mem,
      network,
      drives: d,
      topProcesses: top
    }, null, 2), "utf8");
    return dest;
  });
}

module.exports = { registerSystem };
