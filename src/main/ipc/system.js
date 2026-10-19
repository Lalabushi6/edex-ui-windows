// System telemetry. Every source is cached so several widgets polling the same
// metric share one underlying query; expensive WMI-backed calls get long TTLs.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const si = require("systeminformation");
const { app } = require("electron");
const { cached } = require("../lib/cache");
const { handle } = require("./util");

// Terminating any of these bug-checks Windows or kills the session.
const PROTECTED_PROCESSES = new Set([
  "system", "system idle process", "registry", "smss.exe", "csrss.exe", "wininit.exe",
  "winlogon.exe", "services.exe", "lsass.exe", "lsaiso.exe", "svchost.exe", "dwm.exe",
  "fontdrvhost.exe", "sihost.exe", "explorer.exe", "memory compression", "secure system"
]);

function registerSystem({ windows, bridge }) {
  const staticInfo = cached(async () => {
    const [cpu, system, chassis, osInfo] = await Promise.all([
      si.cpu().catch(() => ({})),
      si.system().catch(() => ({})),
      si.chassis().catch(() => ({})),
      si.osInfo().catch(() => ({}))
    ]);
    return {
      cpu: {
        manufacturer: cpu.manufacturer, brand: cpu.brand, cores: cpu.cores,
        physicalCores: cpu.physicalCores, speed: cpu.speed, speedMax: cpu.speedMax
      },
      system: { manufacturer: system.manufacturer, model: system.model },
      chassis: { type: chassis.type },
      os: { distro: osInfo.distro, release: osInfo.release, build: osInfo.build, arch: osInfo.arch },
      hostname: os.hostname(),
      user: os.userInfo().username,
      totalMem: os.totalmem()
    };
  }, 24 * 3600 * 1000);

  const cpuLoad = cached(() => si.currentLoad(), 1500);
  const cpuSpeed = cached(() => si.cpuCurrentSpeed(), 4000);
  const mem = cached(() => si.mem(), 2000);
  const battery = cached(() => si.battery(), 20000);
  const temp = cached(() => si.cpuTemperature(), 15000);
  const drives = cached(async () => {
    const list = await si.fsSize();
    return list
      .filter((d) => d.size > 0)
      .map((d) => ({ fs: d.fs, mount: d.mount, type: d.type, size: d.size, used: d.used, use: d.use }));
  }, 30000);
  const ifaces = cached(() => si.networkInterfaces(), 10000);
  const defaultIface = cached(() => si.networkInterfaceDefault(), 30000);
  const netStats = cached(async () => {
    const iface = await defaultIface().catch(() => undefined);
    return si.networkStats(iface || undefined);
  }, 1500);
  const graphics = cached(() => si.graphics(), 10 * 60 * 1000);
  const perf = cached(() => bridge.call("perf", {}, 8000), 1500);
  const processes = cached(() => si.processes(), 2500);

  handle("sys:static", () => staticInfo());

  handle("sys:cpu", async () => {
    const [load, speed] = await Promise.all([cpuLoad(), cpuSpeed().catch(() => null)]);
    return {
      load: load.currentLoad,
      cores: (load.cpus || []).map((c) => c.load),
      speed: speed?.avg || 0
    };
  });

  handle("sys:mem", async () => {
    const m = await mem();
    return { total: m.total, used: m.active, available: m.available, swapTotal: m.swaptotal, swapUsed: m.swapused };
  });

  handle("sys:battery", async () => {
    const b = await battery();
    return { hasBattery: b.hasBattery, percent: b.percent, charging: b.isCharging, ac: b.acConnected, timeRemaining: b.timeRemaining };
  });

  handle("sys:temp", async () => {
    const t = await temp().catch(() => null);
    return { main: t && t.main > 0 ? t.main : null, max: t && t.max > 0 ? t.max : null };
  });

  handle("sys:drives", () => drives());

  handle("sys:net", async () => {
    const [list, def] = await Promise.all([ifaces(), defaultIface().catch(() => "")]);
    const arr = Array.isArray(list) ? list : [list];
    const primary = arr.find((i) => i.iface === def) ||
      arr.find((i) => !i.internal && i.operstate === "up" && i.ip4) || null;
    return {
      online: !!(primary && primary.operstate !== "down" && primary.ip4),
      iface: primary?.iface || null,
      ip4: primary?.ip4 || null,
      mac: primary?.mac || null,
      type: primary?.type || null,
      speed: primary?.speed || null
    };
  });

  handle("sys:netStats", async () => {
    const stats = await netStats();
    const s = Array.isArray(stats) ? stats[0] : stats;
    return s ? { rxSec: Math.max(0, s.rx_sec || 0), txSec: Math.max(0, s.tx_sec || 0), rx: s.rx_bytes, tx: s.tx_bytes } : null;
  });

  handle("sys:gpu", async () => {
    const [g, p] = await Promise.all([graphics().catch(() => null), perf().catch(() => null)]);
    const ctrl = (g?.controllers || []).slice().sort((a, b) => (b.vram || 0) - (a.vram || 0))[0] || {};
    return {
      model: ctrl.model || ctrl.name || null,
      vendor: ctrl.vendor || null,
      vramTotal: ctrl.vram ? ctrl.vram * 1048576 : null,
      util: p?.gpu?.util ?? (typeof ctrl.utilizationGpu === "number" ? ctrl.utilizationGpu : null),
      dedicatedUsed: p?.gpu?.dedicated ?? null,
      sharedUsed: p?.gpu?.shared ?? null,
      temp: typeof ctrl.temperatureGpu === "number" ? ctrl.temperatureGpu : null
    };
  });

  handle("sys:diskIO", async () => {
    const p = await perf().catch(() => null);
    return p?.disk ? { read: p.disk.r, write: p.disk.w } : null;
  });

  handle("sys:processes", async () => {
    const data = await processes();
    return {
      all: data.all,
      running: data.running,
      list: data.list.map((p) => ({
        pid: p.pid,
        name: p.name,
        cpu: p.cpu,
        mem: p.mem,
        memRss: p.memRss,
        user: p.user,
        path: p.path,
        started: p.started
      }))
    };
  });

  handle("sys:uptime", () => os.uptime());

  handle("sys:kill", async (_event, pid) => {
    const target = Number(pid);
    if (!Number.isInteger(target) || target <= 4) throw new Error("Invalid PID");
    const ownPids = new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
    if (ownPids.has(target)) throw new Error("Refusing to terminate eDEX-UI itself");
    let name = null;
    try { name = (await processes()).list.find((p) => p.pid === target)?.name || null; } catch (_) {}
    if (name && PROTECTED_PROCESSES.has(name.toLowerCase())) {
      throw new Error(`${name} is a protected system process`);
    }
    const { response } = await windows.withDialog((win) => require("electron").dialog.showMessageBox(win, {
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
    processes.invalidate();
    return true;
  });

  handle("sys:snapshot", async () => {
    const [info, load, m, d, procs] = await Promise.all([
      staticInfo(), cpuLoad(), mem(), drives().catch(() => []), processes().catch(() => ({ list: [] }))
    ]);
    const dest = path.join(app.getPath("documents"), `edex-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const top = procs.list.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 25)
      .map(({ pid, name, cpu, mem: memPct }) => ({ pid, name, cpu, mem: memPct }));
    await fs.promises.writeFile(dest, JSON.stringify({
      timestamp: new Date().toISOString(),
      system: info,
      uptime: os.uptime(),
      cpu: { load: load.currentLoad, cores: load.cpus.map((c) => c.load) },
      memory: { total: m.total, used: m.active, swapUsed: m.swapused },
      drives: d,
      topProcesses: top
    }, null, 2), "utf8");
    return dest;
  });
}

module.exports = { registerSystem };
