// Window tiling (snap a window to a half, quarter, third …), quick layouts
// for the visible windows, and saved arrangements that put every window
// back where it was, launching programs that aren't open.
"use strict";

const fs = require("fs");
const path = require("path");
const { app, shell } = require("electron");
const { handle, asString } = require("./util");
const { JsonStore } = require("../lib/store");

// x, y, w, h as shares of the monitor's work area.
const PRESETS = {
  left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5],
  "top-left": [0, 0, 0.5, 0.5], "top-right": [0.5, 0, 0.5, 0.5], "bottom-left": [0, 0.5, 0.5, 0.5], "bottom-right": [0.5, 0.5, 0.5, 0.5],
  "left-third": [0, 0, 1 / 3, 1], "center-third": [1 / 3, 0, 1 / 3, 1], "right-third": [2 / 3, 0, 1 / 3, 1],
  "left-two-thirds": [0, 0, 2 / 3, 1], "right-two-thirds": [1 / 3, 0, 2 / 3, 1],
  center: [0.15, 0.1, 0.7, 0.8], maximize: [0, 0, 1, 1]
};
// Programs that can't be started from their executable path.
const NOT_LAUNCHABLE = /\\(ApplicationFrameHost|explorer|SystemSettings|TextInputHost|ShellExperienceHost)\.exe$|\\WindowsApps\\/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asHwnd = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid window");
  return n;
};

function registerArrange({ bridge, windows, ownPids }) {
  const store = new JsonStore(path.join(app.getPath("userData"), "arrangements.json"), { fallback: { list: [] } });
  const list = () => (Array.isArray(store.data.list) ? store.data.list : []);
  const openWindows = async () => (await bridge.call("windows", { exclude: ownPids() })).filter((w) => w.title);

  handle("win:tile", async (_e, hwnd, preset) => {
    const p = PRESETS[preset];
    if (!p) throw new Error("Unknown layout");
    const h = asHwnd(hwnd);
    windows.yieldFocus();
    const ok = await bridge.call("tileWindow", { hwnd: h, x: p[0], y: p[1], w: p[2], h: p[3] });
    await bridge.call("focus", { hwnd: h }).catch(() => {});
    return ok;
  });

  // Layouts for the visible (not minimised) windows, front-most first.
  handle("win:layout", async (_e, kind) => {
    const visible = (await openWindows()).filter((w) => !w.minimized);
    const cells = {
      side: [PRESETS.left, PRESETS.right],
      grid: [PRESETS["top-left"], PRESETS["top-right"], PRESETS["bottom-left"], PRESETS["bottom-right"]],
      columns: [PRESETS["left-third"], PRESETS["center-third"], PRESETS["right-third"]]
    }[kind];
    if (!cells) throw new Error("Unknown layout");
    const targets = visible.slice(0, cells.length);
    if (!targets.length) throw new Error("No windows to arrange");
    windows.yieldFocus();
    for (let i = 0; i < targets.length; i++) {
      const [x, y, w, h] = cells[i];
      await bridge.call("tileWindow", { hwnd: targets[i].hwnd, x, y, w, h }).catch(() => {});
    }
    return targets.length;
  });

  handle("win:arrangements", () => list().map((a) => ({ name: a.name, saved: a.saved, count: a.windows.length })));

  handle("win:saveArrangement", async (_e, name) => {
    const label = asString(String(name || "").trim(), "name", 60);
    const saved = [];
    for (const w of await openWindows()) {
      if (!w.exe) continue;
      const r = await bridge.call("windowRect", { hwnd: w.hwnd }).catch(() => null);
      if (!r) continue;
      // A minimised window reports an off-screen position; only its state is kept.
      saved.push({ exe: w.exe, title: w.title.slice(0, 200), rect: r.minimized ? null : r.rect, state: r.minimized ? "min" : r.maximized ? "max" : "" });
    }
    if (!saved.length) throw new Error("No windows to save");
    store.data.list = [...list().filter((a) => a.name.toLowerCase() !== label.toLowerCase()), { name: label, saved: Date.now(), windows: saved.slice(0, 40) }].slice(-20);
    store.save();
    return saved.length;
  });

  handle("win:deleteArrangement", (_e, name) => {
    store.data.list = list().filter((a) => a.name !== name);
    store.save();
    return true;
  });

  handle("win:restoreArrangement", async (_e, name) => {
    const entry = list().find((a) => a.name === name);
    if (!entry) throw new Error("Arrangement not found");
    windows.yieldFocus();
    const used = new Set();
    const result = { placed: 0, launched: 0, missing: [] };
    const pick = (all, saved) => {
      const same = all.filter((w) => !used.has(w.hwnd) && w.exe.toLowerCase() === saved.exe.toLowerCase());
      return same.find((w) => w.title === saved.title) || same[0] || null;
    };
    let current = await openWindows();
    const pending = [];
    for (const saved of entry.windows) {
      const w = pick(current, saved);
      if (w) { used.add(w.hwnd); pending.push([w, saved]); continue; }
      if (NOT_LAUNCHABLE.test(saved.exe) || !fs.existsSync(saved.exe)) { result.missing.push(path.basename(saved.exe)); continue; }
      const err = await shell.openPath(saved.exe);
      if (err) { result.missing.push(path.basename(saved.exe)); continue; }
      result.launched++;
      let found = null;
      for (let i = 0; i < 40 && !found; i++) {
        await sleep(300);
        current = await openWindows();
        found = pick(current, saved);
      }
      if (found) { used.add(found.hwnd); pending.push([found, saved]); } else result.missing.push(path.basename(saved.exe));
    }
    for (const [w, saved] of pending) {
      let ok;
      if (!Array.isArray(saved.rect)) ok = await bridge.call("minimize", { hwnd: w.hwnd }).catch(() => false);
      else {
        const [x, y, width, height] = saved.rect;
        ok = await bridge.call("placeWindow", { hwnd: w.hwnd, x, y, w: width, h: height, state: saved.state }).catch(() => false);
      }
      if (ok) result.placed++;
    }
    return result;
  });

  return { flush: () => store.flushSync() };
}

module.exports = { registerArrange, LAYOUT_PRESETS: Object.keys(PRESETS) };
