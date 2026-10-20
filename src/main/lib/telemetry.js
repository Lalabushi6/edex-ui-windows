// System telemetry for the widgets.
//
// Everything comes from the long-lived native bridge (direct Win32/.NET calls
// in one helper process) plus Node's own `os` module. The previous approach,
// systeminformation, starts a fresh PowerShell for most readings on Windows,
// which at widget refresh rates meant one or two process launches per second
// and visible stutter. systeminformation is now only loaded as a fallback if
// the bridge is unavailable.
"use strict";

const os = require("os");
const { cached } = require("./cache");

let si = null;
const fallback = () => (si ||= require("systeminformation"));

const CHASSIS = {
  3: "Desktop", 4: "Low Profile Desktop", 5: "Pizza Box", 6: "Mini Tower", 7: "Tower", 8: "Portable", 9: "Laptop",
  10: "Notebook", 11: "Hand Held", 12: "Docking Station", 13: "All in One", 14: "Sub Notebook", 15: "Space-saving",
  16: "Lunch Box", 17: "Main System Chassis", 23: "Rack Mount", 24: "Sealed-case PC", 30: "Tablet", 31: "Convertible",
  32: "Detachable", 33: "IoT Gateway", 34: "Embedded PC", 35: "Mini PC", 36: "Stick PC"
};
const VIRTUAL_NIC = /virtual|vethernet|hyper-v|vmware|virtualbox|loopback|tap-|tunnel|wsl|bluetooth/i;

function cleanCpuName(name) {
  return String(name || "").replace(/\((R|TM|C)\)/gi, "").replace(/\s+CPU\s+@.*$/i, "").replace(/\s+/g, " ").trim();
}

class Telemetry {
  constructor({ bridge }) {
    this.bridge = bridge;
    this.prevCpu = null;
    this.prevNet = null;
    this.tempMisses = 0;

    this.live = cached(() => this._live(), 800);
    this.processes = cached(() => this._processes(false), 1200);
    this.processesWithPaths = cached(() => this._processes(true), 1200);
    this.drives = cached(() => this._drives(), 15000);
    this.battery = cached(() => this._battery(), 10000);
    this.static = cached(() => this._static(), 24 * 3600 * 1000);
    this.temp = cached(() => this._temp(), 30000);
  }

  // CPU load from os.cpus() tick deltas (no process launch, ~0.1 ms).
  _cpu() {
    const cpus = os.cpus();
    const now = cpus.map((c) => {
      const t = c.times;
      return { idle: t.idle, total: t.user + t.nice + t.sys + t.irq + t.idle };
    });
    const prev = this.prevCpu;
    this.prevCpu = now;
    const cores = now.map((c, i) => {
      const p = prev?.[i];
      if (!p) return 0;
      const total = c.total - p.total;
      return total > 0 ? Math.max(0, Math.min(100, (1 - (c.idle - p.idle) / total) * 100)) : 0;
    });
    const load = cores.length ? cores.reduce((a, b) => a + b, 0) / cores.length : 0;
    return { load, cores };
  }

  _pickNic(list) {
    const usable = list.filter((n) => n.up && n.ip4 && !n.ip4.startsWith("169.254."));
    return usable.find((n) => n.gw && !VIRTUAL_NIC.test(`${n.name} ${n.desc}`)) ||
      usable.find((n) => n.gw) || usable.find((n) => !VIRTUAL_NIC.test(`${n.name} ${n.desc}`)) || usable[0] || null;
  }

  async _live() {
    const cpu = this._cpu();
    let raw;
    try {
      raw = await this.bridge.call("live", {}, 8000);
    } catch (_) {
      return this._liveFallback(cpu);
    }
    const now = Date.now();
    const nic = this._pickNic(raw.net || []);
    let rxSec = 0, txSec = 0;
    if (nic && this.prevNet && this.prevNet.name === nic.name) {
      const dt = (now - this.prevNet.at) / 1000;
      if (dt > 0) {
        rxSec = Math.max(0, (nic.rx - this.prevNet.rx) / dt);
        txSec = Math.max(0, (nic.tx - this.prevNet.tx) / dt);
      }
    }
    if (nic) this.prevNet = { name: nic.name, rx: nic.rx, tx: nic.tx, at: now };
    const mem = raw.mem || { total: os.totalmem(), available: os.freemem(), swapTotal: 0, swapUsed: 0 };
    return {
      cpu: { load: cpu.load, cores: cpu.cores, mhz: raw.mhz || null },
      mem: { total: mem.total, used: mem.total - mem.available, available: mem.available, swapTotal: mem.swapTotal, swapUsed: mem.swapUsed },
      net: nic ? {
        online: true, iface: nic.name, ip4: nic.ip4, mac: nic.mac,
        type: /wireless/i.test(nic.type) ? "wireless" : "wired",
        speed: nic.speed > 0 ? Math.round(nic.speed / 1e6) : null,
        rxSec, txSec, rx: nic.rx, tx: nic.tx
      } : { online: false, iface: null, ip4: null, rxSec: 0, txSec: 0, rx: 0, tx: 0 },
      disk: raw.perf?.disk ? { read: raw.perf.disk.r, write: raw.perf.disk.w } : null,
      gpu: raw.perf?.gpu || null
    };
  }

  async _liveFallback(cpu) {
    const s = fallback();
    const [mem, stats, ifaces] = await Promise.all([
      s.mem().catch(() => null), s.networkStats().catch(() => []), s.networkInterfaces().catch(() => [])
    ]);
    const st = Array.isArray(stats) ? stats[0] : null;
    const iface = (Array.isArray(ifaces) ? ifaces : []).find((i) => i.iface === st?.iface) || null;
    return {
      cpu: { load: cpu.load, cores: cpu.cores, mhz: null },
      mem: mem ? { total: mem.total, used: mem.active, available: mem.available, swapTotal: mem.swaptotal, swapUsed: mem.swapused }
        : { total: os.totalmem(), used: os.totalmem() - os.freemem(), available: os.freemem(), swapTotal: 0, swapUsed: 0 },
      net: st ? { online: true, iface: st.iface, ip4: iface?.ip4 || null, type: iface?.type || null, speed: iface?.speed || null, rxSec: st.rx_sec || 0, txSec: st.tx_sec || 0, rx: st.rx_bytes, tx: st.tx_bytes }
        : { online: false, rxSec: 0, txSec: 0, rx: 0, tx: 0 },
      disk: null,
      gpu: null
    };
  }

  async _processes(withPaths) {
    let raw;
    try {
      raw = await this.bridge.call("processes", { paths: withPaths }, 8000);
    } catch (_) {
      const data = await fallback().processes();
      return {
        all: data.all,
        threads: null,
        list: data.list.map((p) => ({ pid: p.pid, ppid: p.parentPid, name: p.name, cpu: p.cpu, mem: p.mem, memBytes: (p.memRss || 0) * 1024, threads: null, path: p.path }))
      };
    }
    const total = os.totalmem();
    return {
      all: raw.count - 1,
      threads: raw.threads,
      list: raw.list.map((p) => ({
        pid: p.pid, ppid: p.ppid, name: p.name, cpu: p.cpu,
        mem: (p.ws / total) * 100, memBytes: p.ws, privateBytes: p.priv,
        threads: p.threads, handles: p.handles, path: p.path || ""
      }))
    };
  }

  async _drives() {
    try {
      return await this.bridge.call("drives", {}, 8000);
    } catch (_) {
      const list = await fallback().fsSize();
      return list.filter((d) => d.size > 0).map((d) => ({ fs: d.fs, mount: d.mount, type: d.type, size: d.size, used: d.used, use: d.use }));
    }
  }

  async _battery() {
    try {
      const b = await this.bridge.call("battery", {}, 5000);
      return {
        hasBattery: b.hasBattery, percent: b.percent, charging: b.charging, ac: b.ac, saver: b.saver,
        timeRemaining: b.secondsLeft ? Math.round(b.secondsLeft / 60) : null
      };
    } catch (_) {
      const b = await fallback().battery();
      // The fallback can report slightly over 100% on worn batteries.
      return { hasBattery: b.hasBattery, percent: Math.min(100, b.percent), charging: b.isCharging, ac: b.acConnected, timeRemaining: b.timeRemaining };
    }
  }

  async _static() {
    const base = { hostname: os.hostname(), user: os.userInfo().username, totalMem: os.totalmem() };
    let raw = null;
    try { raw = await this.bridge.call("static", {}, 20000); } catch (_) {}
    if (raw) {
      const gpus = (raw.gpus || []).slice().sort((a, b) => (b.vram || 0) - (a.vram || 0));
      const cpuName = cleanCpuName(raw.cpu?.Name);
      return {
        ...base,
        cpu: {
          manufacturer: null, brand: cpuName,
          cores: raw.cpu?.NumberOfLogicalProcessors || os.cpus().length,
          physicalCores: raw.cpu?.NumberOfCores || null,
          speed: raw.cpu?.MaxClockSpeed ? raw.cpu.MaxClockSpeed / 1000 : null
        },
        system: { manufacturer: raw.system?.Manufacturer || null, model: raw.system?.Model || null },
        chassis: { type: CHASSIS[raw.chassis?.ChassisTypes] || null },
        os: {
          distro: raw.os?.Caption || "Windows",
          release: raw.os?.Version || os.release(),
          build: raw.os?.BuildNumber || null,
          arch: /64/.test(raw.os?.OSArchitecture || "") ? (process.arch === "arm64" ? "arm64" : "x64") : process.arch
        },
        gpu: gpus[0] ? { model: gpus[0].model, vendor: gpus[0].vendor, vram: gpus[0].vram } : null
      };
    }
    const s = fallback();
    const [cpu, system, chassis, osInfo, graphics] = await Promise.all([
      s.cpu().catch(() => ({})), s.system().catch(() => ({})), s.chassis().catch(() => ({})),
      s.osInfo().catch(() => ({})), s.graphics().catch(() => ({}))
    ]);
    const ctrl = (graphics.controllers || []).slice().sort((a, b) => (b.vram || 0) - (a.vram || 0))[0];
    return {
      ...base,
      cpu: { manufacturer: cpu.manufacturer, brand: cpu.brand, cores: cpu.cores, physicalCores: cpu.physicalCores, speed: cpu.speed },
      system: { manufacturer: system.manufacturer, model: system.model },
      chassis: { type: chassis.type },
      os: { distro: osInfo.distro, release: osInfo.release, build: osInfo.build, arch: osInfo.arch },
      gpu: ctrl ? { model: ctrl.model, vendor: ctrl.vendor, vram: ctrl.vram ? ctrl.vram * 1048576 : null } : null
    };
  }

  // Thermal zones usually need elevation; after repeated misses the reading
  // is only retried every ten minutes.
  async _temp() {
    if (this.tempMisses >= 2 && Date.now() - this.tempMissAt < 600000) return null;
    let t = null;
    try { t = await this.bridge.call("temp", {}, 10000); } catch (_) {}
    if (t === null) { this.tempMisses++; this.tempMissAt = Date.now(); } else this.tempMisses = 0;
    return t;
  }

  // Primes the deltas (CPU ticks, process times, network counters) so the
  // first values the widgets show are real rates rather than zeros.
  warm() {
    this._cpu();
    this.live().catch(() => {});
    this.processes().catch(() => {});
  }
}

module.exports = { Telemetry };
