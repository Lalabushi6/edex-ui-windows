// Benchmark (main-process side): how well this PC runs eDEX. The interface
// drives the run (src/renderer/js/shell/benchmark.js); this side reports the
// hardware, startup timings, every eDEX process's CPU and memory, the main
// process's responsiveness and the native helper's round trip, and saves the
// report to Documents\eDEX benchmarks.
//
// Reports carry no personal data: no PC or user name, no paths, no network
// addresses, no window titles.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, screen } = require("electron");
const { handle } = require("./util");

const SETTINGS_IN_REPORT = [
  "perfProfile", "throttleUnfocused", "termGpu", "theme", "layoutPreset", "uiScale", "showKeyboard", "filesPanel",
  "backgroundFx", "bootAnimation", "hudDisplays", "liveWallpaper", "screensaver", "idleScreen", "gameMode",
  "openAppsInside", "appTabs", "mode", "takeover", "allowNetworkGeolocation"
];

const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const slug = (s) => String(s || "").replace(/\((R|TM|C)\)/gi, "").replace(/\b(CPU|Processor|with Radeon Graphics)\b/gi, "")
  .replace(/@.*$/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "pc";

function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function registerBenchmark({ settings, telemetry, bridge, aux, portable, startup }) {
  // CPU time per process at the previous sample (pid -> { cpu, at }), so
  // percentages don't depend on who else called getAppMetrics().
  let last = new Map();
  let lag = null;
  // The native helpers' numbers come from the full process list, which can
  // be slow while the helper is busy (the process manager open, say), so
  // they're refreshed in the background at most every few seconds and a
  // sample never waits for them.
  let helpers = { at: 0, list: [], pending: null };
  const refreshHelpers = () => {
    if (helpers.pending) return;
    helpers.pending = (async () => {
      const pids = new Set([bridge?.proc?.pid, aux?.proc?.pid].filter(Boolean));
      const list = pids.size ? (await telemetry.processes()).list : [];
      // The process list gives % of the whole CPU; the rest of the report
      // uses % of one logical core.
      const cores = os.cpus().length || 1;
      helpers.list = list.filter((p) => pids.has(p.pid)).map((p) => ({ type: "Helper", cpu: round((p.cpu || 0) * cores, 1), wsMB: round((p.memBytes || 0) / 1048576, 1) }));
      helpers.at = Date.now();
    })().catch(() => {}).finally(() => { helpers.pending = null; });
  };

  // Startup marks from the interface: navigation start, when it became
  // usable, and when the boot animation finished.
  handle("bench:mark", (_e, marks = {}) => {
    for (const k of ["navStart", "uiReady", "booted"]) {
      const v = Number(marks[k]);
      if (Number.isFinite(v) && v > 0 && startup[k] === undefined) startup[k] = v;
    }
    return true;
  });

  handle("bench:info", async () => {
    const [info, battery, disks] = await Promise.all([
      telemetry.static().catch(() => ({})),
      telemetry.battery().catch(() => null),
      // The physical disks' kind (SSD / HDD), which matters a lot on old PCs.
      Promise.race([
        require("systeminformation").diskLayout().catch(() => []),
        new Promise((r) => setTimeout(() => r([]), 10000))
      ])
    ]);
    const primary = screen.getPrimaryDisplay();
    const since = (k) => (startup[k] && startup.processStart ? Math.round(startup[k] - startup.processStart) : null);
    return {
      app: {
        version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
        packaged: app.isPackaged, portable: !!portable?.state?.().portable
      },
      os: { ...(info.os || {}), arch: process.arch, windowsRelease: os.release() },
      hardware: {
        cpu: { brand: info.cpu?.brand || os.cpus()[0]?.model || null, logicalCores: os.cpus().length, physicalCores: info.cpu?.physicalCores || null, speedGHz: info.cpu?.speed || null },
        ramGB: round(os.totalmem() / 1073741824, 1),
        gpu: info.gpu ? { model: info.gpu.model || null, vendor: info.gpu.vendor || null, vramMB: info.gpu.vram ? Math.round(info.gpu.vram / 1048576) : null } : null,
        gpuFeatures: app.getGPUFeatureStatus(),
        system: { manufacturer: info.system?.manufacturer || null, model: info.system?.model || null, chassis: info.chassis?.type || null },
        disks: (Array.isArray(disks) ? disks : []).slice(0, 6).map((d) => ({ type: d.type || null, interface: d.interfaceType || null, sizeGB: d.size ? Math.round(d.size / 1e9) : null })),
        displays: { count: screen.getAllDisplays().length, primary: { width: primary.size.width, height: primary.size.height, scale: primary.scaleFactor, hz: primary.displayFrequency || null } },
        battery: battery ? { present: !!battery.hasBattery, onAC: battery.ac ?? null, percent: battery.percent ?? null, saver: battery.saver ?? null } : null
      },
      settings: Object.fromEntries(SETTINGS_IN_REPORT.map((k) => [k, settings.get(k)])),
      startup: {
        launchToWindowMs: since("readyToShow"),
        launchToUsableMs: since("uiReady"),
        launchToBootedMs: since("booted"),
        appReadyMs: since("appReady"),
        startedSecondsAgo: startup.processStart ? Math.round((Date.now() - startup.processStart) / 1000) : null
      },
      systemUptimeHours: round(os.uptime() / 3600, 1)
    };
  });

  // A measuring session: CPU baselines and a main-process lag monitor.
  handle("bench:begin", () => {
    last = new Map();
    helpers = { at: 0, list: [], pending: null };
    refreshHelpers();
    for (const m of app.getAppMetrics()) last.set(m.pid, { cpu: m.cpu.cumulativeCPUUsage, at: Date.now() });
    clearInterval(lag?.timer);
    const step = 50;
    lag = { values: [], expected: Date.now() + step, timer: null };
    lag.timer = setInterval(() => {
      const now = Date.now();
      lag.values.push(Math.max(0, now - lag.expected));
      lag.expected = now + step;
      if (lag.values.length > 20000) lag.values.shift();
    }, step);
    return true;
  });

  handle("bench:end", () => {
    clearInterval(lag?.timer);
    const v = lag?.values || [];
    lag = null;
    return { mainLagP50Ms: percentile(v, 50), mainLagP95Ms: percentile(v, 95), mainLagMaxMs: v.length ? Math.max(...v) : null };
  });

  // One sample: every eDEX process (CPU as % of one logical core since the
  // last sample; memory in MB) plus the native helpers.
  handle("bench:sample", async () => {
    const now = Date.now();
    const procs = app.getAppMetrics().map((m) => {
      const prev = last.get(m.pid);
      const cum = m.cpu.cumulativeCPUUsage;
      let cpu = m.cpu.percentCPUUsage;
      if (Number.isFinite(cum) && prev && Number.isFinite(prev.cpu) && now > prev.at) cpu = ((cum - prev.cpu) / ((now - prev.at) / 1000)) * 100;
      last.set(m.pid, { cpu: cum, at: now });
      return { type: m.type, name: m.name || m.serviceName || null, cpu: round(Math.max(0, cpu), 1), wsMB: round((m.memory.workingSetSize || 0) / 1024, 1), privMB: round((m.memory.privateBytes || 0) / 1024, 1) };
    });
    if (now - helpers.at > 3000) refreshHelpers();
    let system = null;
    try {
      const l = await Promise.race([telemetry.live(), new Promise((r) => setTimeout(() => r(null), 800))]);
      if (l) system = { cpuLoadPct: round(l.cpu?.load, 0), memUsedPct: l.mem?.total ? round((l.mem.used / l.mem.total) * 100, 0) : null };
    } catch (_) {}
    return { t: now, procs, helpers: helpers.list, system };
  });

  // The native helper's round trip, n times.
  handle("bench:helper", async (_e, n = 25) => {
    const times = [];
    const count = Math.max(1, Math.min(100, Number(n) || 25));
    for (let i = 0; i < count; i++) {
      const t0 = process.hrtime.bigint();
      try { await bridge.call("foreground", {}, 3000); } catch (_) { continue; }
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return { calls: times.length, medianMs: round(percentile(times, 50), 2), p95Ms: round(percentile(times, 95), 2), maxMs: round(times.length ? Math.max(...times) : null, 2) };
  });

  // Saves the report; the file name is built here, never from the interface.
  handle("bench:save", async (_e, report) => {
    if (!report || typeof report !== "object") throw new Error("Nothing to save");
    const text = JSON.stringify(report, null, 2);
    if (text.length > 4 * 1024 * 1024) throw new Error("The report is too large");
    const info = await telemetry.static().catch(() => ({}));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    const ram = Math.round(os.totalmem() / 1073741824);
    const dir = path.join(app.getPath("documents"), "eDEX benchmarks");
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `edex-benchmark-${app.getVersion()}-${slug(info.cpu?.brand || os.cpus()[0]?.model)}-${ram}gb-${stamp}.json`);
    await fs.promises.writeFile(file, text, "utf8");
    return file;
  });
}

module.exports = { registerBenchmark, percentile };
