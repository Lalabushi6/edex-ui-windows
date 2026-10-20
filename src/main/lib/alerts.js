// Low battery and low disk space alerts. Runs in the main process so they
// fire while eDEX is hidden: a toast inside eDEX plus a Windows notification
// when the window isn't on screen. Each alert fires once per crossing (and
// re-arms only after the level recovers past a margin), never repeatedly.
"use strict";

const { Notification } = require("electron");

const BATTERY_EVERY_MS = 60 * 1000;
const DISK_EVERY_MS = 10 * 60 * 1000;
const FIRST_CHECK_MS = 45 * 1000;
const GB = 1024 ** 3;

class Alerts {
  constructor({ telemetry, settings, windows }) {
    this.telemetry = telemetry;
    this.settings = settings;
    this.windows = windows;
    this.batteryFired = null; // null | "low" | "critical"
    this.diskFired = new Set(); // mounts currently below the limit
    this.timers = [];
  }

  start() {
    this.stop();
    this.timers.push(setTimeout(() => {
      this.checkBattery();
      this.checkDisks();
      this.timers.push(setInterval(() => this.checkBattery(), BATTERY_EVERY_MS));
      this.timers.push(setInterval(() => this.checkDisks(), DISK_EVERY_MS));
    }, FIRST_CHECK_MS));
  }

  stop() {
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.timers = [];
  }

  async checkBattery() {
    if (!this.settings.get("alertBattery")) return;
    let b;
    try { b = await this.telemetry.battery(); } catch (_) { return; }
    if (!b?.hasBattery || !Number.isFinite(b.percent)) return;
    const low = this.settings.get("alertBatteryLevel");
    const critical = Math.min(low, Math.max(3, Math.round(low / 2)));
    if (b.charging || b.ac) {
      this.batteryFired = null;
      return;
    }
    // Hysteresis: re-arm only once the charge is clearly back above the line.
    if (this.batteryFired && b.percent > low + 3) this.batteryFired = null;
    const left = b.timeRemaining ? ` (about ${fmtMinutes(b.timeRemaining)} left)` : "";
    if (b.percent <= critical && this.batteryFired !== "critical") {
      this.batteryFired = "critical";
      this.notify("error", "Battery critically low", `${Math.round(b.percent)}% remaining${left}. Plug in now.`);
    } else if (b.percent <= low && !this.batteryFired) {
      this.batteryFired = "low";
      this.notify("warn", "Battery low", `${Math.round(b.percent)}% remaining${left}.${b.saver ? "" : " Consider Battery saver."}`);
    }
  }

  async checkDisks() {
    if (!this.settings.get("alertDisk")) return;
    let drives;
    try { drives = await this.telemetry.drives(); } catch (_) { return; }
    const limitGb = this.settings.get("alertDiskGb");
    const seen = new Set();
    for (const d of Array.isArray(drives) ? drives : []) {
      if (d.removable || !(d.size > 0)) continue;
      const free = d.size - d.used;
      // Small drives use a percentage instead so a 32 GB disk isn't always "low".
      const limit = Math.min(limitGb * GB, d.size * 0.1);
      seen.add(d.mount);
      if (free < limit) {
        if (this.diskFired.has(d.mount)) continue;
        this.diskFired.add(d.mount);
        this.notify("warn", `Low disk space on ${d.mount}`, `${fmtBytes(free)} free of ${fmtBytes(d.size)}. Storage settings can free up space.`);
      } else if (free > limit * 1.2) {
        this.diskFired.delete(d.mount);
      }
    }
    for (const m of [...this.diskFired]) if (!seen.has(m)) this.diskFired.delete(m);
  }

  notify(level, title, body) {
    this.windows.send("app:notice", { level, message: `${title} — ${body}` });
    const win = this.windows.win;
    const onScreen = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    if (onScreen) return;
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: `eDEX-UI — ${title}`, body, silent: level !== "error" });
      n.on("click", () => this.windows.show());
      n.show();
    } catch (_) {}
  }
}

function fmtMinutes(m) {
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function fmtBytes(n) {
  if (n >= 1024 * GB) return `${(n / (1024 * GB)).toFixed(1)} TB`;
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

module.exports = { Alerts };
