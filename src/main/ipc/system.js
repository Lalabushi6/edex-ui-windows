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

  handle("sys:cpu", async () => {
    const l = await telemetry.live();
    return { load: l.cpu.load, cores: l.cpu.cores, speed: l.cpu.mhz ? l.cpu.mhz / 1000 : 0 };
  });

  handle("sys:mem", async () => (await telemetry.live()).mem);

  handle("sys:battery", () => telemetry.battery());

  handle("sys:temp", async () => {
    const t = await telemetry.temp().catch(() => null);
    return { main: t, max: t };
  });

  handle("sys:drives", () => telemetry.drives());

  handle("sys:net", async () => {
    const n = (await telemetry.live()).net;
    return { online: n.online, iface: n.iface, ip4: n.ip4, mac: n.mac || null, type: n.type, speed: n.speed };
  });

  handle("sys:netStats", async () => {
    const n = (await telemetry.live()).net;
    return n.online ? { rxSec: n.rxSec, txSec: n.txSec, rx: n.rx, tx: n.tx } : null;
  });

  handle("sys:gpu", async () => {
    const [s, l] = await Promise.all([telemetry.static(), telemetry.live()]);
    return {
      model: s.gpu?.model || null,
      vendor: s.gpu?.vendor || null,
      vramTotal: s.gpu?.vram || null,
      util: l.gpu?.util ?? null,
      dedicatedUsed: l.gpu?.dedicated ?? null,
      sharedUsed: l.gpu?.shared ?? null,
      temp: null
    };
  });

  handle("sys:diskIO", async () => (await telemetry.live()).disk);

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

  handle("sys:snapshot", async () => {
    const [info, live, d, procs] = await Promise.all([
      telemetry.static(), telemetry.live(), telemetry.drives().catch(() => []), telemetry.processes().catch(() => ({ list: [] }))
    ]);
    const dest = path.join(app.getPath("documents"), `edex-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const top = procs.list.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 25)
      .map(({ pid, name, cpu, mem, memBytes }) => ({ pid, name, cpu, mem, memBytes }));
    await fs.promises.writeFile(dest, JSON.stringify({
      timestamp: new Date().toISOString(),
      system: info,
      uptime: os.uptime(),
      cpu: live.cpu,
      memory: live.mem,
      network: live.net,
      drives: d,
      topProcesses: top
    }, null, 2), "utf8");
    return dest;
  });
}

module.exports = { registerSystem };
