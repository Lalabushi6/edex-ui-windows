// Everything that lets eDEX stand in for the Windows shell: the installed-app
// index and launcher, the running-window list for the dock, media and volume
// keys, and power actions.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, dialog, shell } = require("electron");
const { cached } = require("../lib/cache");
const { iconFor } = require("../lib/icons");
const { handle, asString } = require("./util");

function startMenuDirs() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const programData = process.env.ProgramData || "C:\\ProgramData";
  return [
    path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs")
  ];
}

function desktopDirs() {
  const dirs = [path.join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop")];
  try { dirs.unshift(app.getPath("desktop")); } catch (_) {}
  return dirs;
}

async function collectShortcuts(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  let dirents;
  try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of dirents) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) await collectShortcuts(full, depth + 1, out);
    else if (/\.(lnk|url|appref-ms)$/i.test(d.name)) out.push(full);
  }
  return out;
}

const UNINSTALL_RE = /\b(uninstall|remove|readme|help|documentation|license|release notes|website)\b/i;

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function registerDesktop({ windows, bridge }) {
  const apps = new Map(); // id -> { id, name, kind, target, iconPath }

  // Installed applications: Get-StartApps sees everything in the Start menu,
  // Store apps included; shortcut files supply icons and work without it.
  const index = cached(async () => {
    const shortcuts = [];
    for (const dir of startMenuDirs()) await collectShortcuts(dir, 0, shortcuts);
    const byName = new Map();
    for (const lnk of shortcuts) {
      const name = path.basename(lnk).replace(/\.(lnk|url|appref-ms)$/i, "");
      if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), lnk);
    }

    const next = new Map();
    let startApps = [];
    try { startApps = await bridge.call("startApps", {}, 20000); } catch (_) {}

    for (const entry of startApps) {
      if (!entry?.name || !entry?.appId || UNINSTALL_RE.test(entry.name)) continue;
      const id = `app:${entry.appId}`;
      const looksLikePath = /^[A-Za-z]:\\/.test(entry.appId) && fs.existsSync(entry.appId);
      next.set(id, {
        id,
        name: entry.name,
        kind: "appsfolder",
        target: entry.appId,
        iconPath: looksLikePath ? entry.appId : byName.get(entry.name.toLowerCase()) || null,
        source: /!/.test(entry.appId) ? "store" : "start"
      });
    }
    if (!startApps.length) {
      for (const [lower, lnk] of byName) {
        if (UNINSTALL_RE.test(lower)) continue;
        const id = `lnk:${lnk}`;
        next.set(id, { id, name: path.basename(lnk).replace(/\.(lnk|url|appref-ms)$/i, ""), kind: "path", target: lnk, iconPath: lnk, source: "start" });
      }
    }
    // Desktop shortcuts are apps too, unless the Start menu already has them.
    const names = new Set([...next.values()].map((a) => a.name.toLowerCase()));
    for (const dir of desktopDirs()) {
      for (const lnk of await collectShortcuts(dir, 3)) {
        const name = path.basename(lnk).replace(/\.(lnk|url|appref-ms)$/i, "");
        if (names.has(name.toLowerCase())) continue;
        names.add(name.toLowerCase());
        const id = `lnk:${lnk}`;
        next.set(id, { id, name, kind: "path", target: lnk, iconPath: lnk, source: "desktop" });
      }
    }
    apps.clear();
    for (const [k, v] of next) apps.set(k, v);
    return [...apps.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ id, name, source, iconPath }) => ({ id, name, source, hasIcon: !!iconPath }));
  }, 10 * 60 * 1000);

  const resolveApp = async (id) => {
    if (!apps.size) await index();
    const entry = apps.get(id);
    if (!entry) throw new Error("Unknown application");
    return entry;
  };

  handle("apps:list", (_e, force) => {
    if (force) index.invalidate();
    return index();
  });

  handle("apps:launch", async (_e, id, opts = {}) => {
    const entry = await resolveApp(asString(id, "app id"));
    windows.yieldFocus();
    if (opts.admin) {
      const target = entry.kind === "path" ? entry.target : (/^[A-Za-z]:\\/.test(entry.target) ? entry.target : null);
      if (!target) throw new Error("This app cannot be started as administrator from here");
      spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -FilePath ${psQuote(target)} -Verb RunAs`],
        { windowsHide: true, detached: true, stdio: "ignore" }).unref();
      return true;
    }
    if (entry.kind === "appsfolder") {
      spawn("explorer.exe", [`shell:AppsFolder\\${entry.target}`], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    const err = await shell.openPath(entry.target);
    if (err) throw new Error(err);
    return true;
  });

  handle("apps:icons", async (_e, ids) => {
    const out = {};
    if (!apps.size) await index().catch(() => {});
    for (const id of (Array.isArray(ids) ? ids.slice(0, 120) : [])) {
      const entry = apps.get(id);
      out[id] = entry?.iconPath ? await iconFor(entry.iconPath) : null;
    }
    return out;
  });

  handle("apps:reveal", async (_e, id) => {
    const entry = await resolveApp(asString(id, "app id"));
    const target = entry.kind === "path" ? entry.target : entry.iconPath;
    if (!target) throw new Error("No file location for this app");
    windows.yieldFocus();
    shell.showItemInFolder(target);
    return true;
  });

  // ── Running windows ──────────────────────────────────────────────────────
  const ownPids = () => [process.pid, ...app.getAppMetrics().map((m) => m.pid)];
  const asHwnd = (v) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid window handle");
    return n;
  };

  handle("win:list", async () => {
    const list = await bridge.call("windows", { exclude: ownPids() });
    return list.map((w) => ({
      hwnd: w.hwnd, pid: w.pid, title: w.title, exe: w.exe,
      app: w.exe ? path.basename(w.exe).replace(/\.exe$/i, "") : "",
      minimized: w.minimized, maximized: w.maximized, active: w.active
    }));
  });

  handle("win:focus", async (_e, hwnd) => {
    const h = asHwnd(hwnd);
    // An always-on-top overlay must get out of the way first or the target
    // would activate underneath it.
    if (windows.mode === "overlay") windows.hide();
    return bridge.call("focus", { hwnd: h });
  });
  handle("win:minimize", (_e, hwnd) => bridge.call("minimize", { hwnd: asHwnd(hwnd) }));
  handle("win:maximize", (_e, hwnd) => bridge.call("maximize", { hwnd: asHwnd(hwnd) }));
  handle("win:close", (_e, hwnd) => bridge.call("close", { hwnd: asHwnd(hwnd) }));

  // ── Media, volume, power ─────────────────────────────────────────────────
  const MEDIA_KEYS = new Set(["playpause", "next", "prev", "stop", "mute", "voldown", "volup"]);
  handle("media:key", (_e, key) => {
    if (!MEDIA_KEYS.has(key)) throw new Error("Unknown media key");
    return bridge.call("media", { key });
  });
  handle("media:volume", () => bridge.call("volume"));
  handle("media:setVolume", (_e, level) => bridge.call("setVolume", { level: Math.max(0, Math.min(100, Number(level) || 0)) }));
  handle("media:setMute", (_e, muted) => bridge.call("setMute", { muted: !!muted }));

  const POWER = {
    lock: { confirm: null, run: () => bridge.call("lock") },
    sleep: { confirm: "Put the computer to sleep?", run: () => bridge.call("sleep") },
    signout: { confirm: "Sign out of Windows? Unsaved work in open apps may be lost.", run: () => spawnDetached("shutdown.exe", ["/l"]) },
    restart: { confirm: "Restart the computer? Unsaved work in open apps may be lost.", run: () => spawnDetached("shutdown.exe", ["/r", "/t", "0"]) },
    shutdown: { confirm: "Shut down the computer? Unsaved work in open apps may be lost.", run: () => spawnDetached("shutdown.exe", ["/s", "/t", "0"]) }
  };
  function spawnDetached(file, args) {
    spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  }
  handle("power:action", async (_e, action) => {
    const entry = POWER[action];
    if (!entry) throw new Error("Unknown power action");
    if (entry.confirm) {
      const { response } = await windows.withDialog((win) => dialog.showMessageBox(win, {
        type: "warning", buttons: ["Cancel", action[0].toUpperCase() + action.slice(1)],
        defaultId: 0, cancelId: 0, noLink: true, message: entry.confirm
      }));
      if (response !== 1) return false;
    }
    return entry.run();
  });

  // ── External links ───────────────────────────────────────────────────────
  handle("shell:openExternal", async (_e, url) => {
    const target = asString(url, "url", 4096);
    if (!/^(https?|mailto):/i.test(target)) throw new Error("Only http(s) and mailto links can be opened");
    windows.yieldFocus();
    await shell.openExternal(target);
    return true;
  });

  // System pages that are useful from a launcher ("ms-settings:" URIs).
  const SETTINGS_URIS = new Set([
    "ms-settings:", "ms-settings:display", "ms-settings:sound", "ms-settings:network", "ms-settings:bluetooth",
    "ms-settings:windowsupdate", "ms-settings:appsfeatures", "ms-settings:personalization", "ms-settings:powersleep",
    "ms-settings:storagesense", "ms-settings:privacy", "ms-settings:defaultapps", "ms-settings:notifications"
  ]);
  handle("shell:openSettings", async (_e, uri) => {
    if (!SETTINGS_URIS.has(uri)) throw new Error("Unknown settings page");
    windows.yieldFocus();
    await shell.openExternal(uri);
    return true;
  });
  // Task Manager auto-elevates, which CreateProcess refuses; ShellExecute
  // (behind shell.openPath) handles the UAC hand-off.
  handle("shell:taskManager", async () => {
    windows.yieldFocus();
    const err = await shell.openPath(path.join(process.env.WINDIR || "C:\\Windows", "System32", "Taskmgr.exe"));
    if (err) throw new Error(err);
    return true;
  });

  return { warm: () => index().catch(() => {}) };
}

module.exports = { registerDesktop };
