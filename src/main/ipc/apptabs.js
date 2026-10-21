// App tabs: an open app window shown as a workspace tab.
//
// Windows belong to their own programs, so the window itself is moved and
// sized to fill the tab's area of the eDEX window and brought to the front;
// switching to another tab minimises it, and closing the tab (or quitting
// eDEX) puts it back where it was. Nothing is re-parented or injected, so a
// misbehaving app can't freeze eDEX (or the other way round).
"use strict";

const { screen } = require("electron");
const { handle } = require("./util");

const asHwnd = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid window");
  return n;
};

function registerAppTabs({ windows, bridge, aux, ownPids, settings, isGame, gameMode }) {
  // hwnd -> { original: { rect, state } | null, target: [x, y, w, h] }
  const docked = new Map();

  // "Open apps inside eDEX": windows that appear while it's on become app
  // tabs. Watched here rather than in the interface, whose timers pause
  // while an app covers it. Games are left alone: library games by their
  // program, others because they go full screen (a new window waits one
  // more look before it's tabbed, which gives a starting game that time).
  let known = null;
  let pending = new Set();
  const watch = async () => {
    if (!settings.get("openAppsInside")) { known = null; pending = new Set(); return; }
    let list;
    try { list = await bridge.call("windows", { exclude: ownPids() }, 4000); } catch (_) { return; }
    const now = new Set(list.map((w) => w.hwnd));
    if (known) {
      const ready = list.filter((w) => pending.has(w.hwnd));
      pending = new Set(list.filter((w) => !known.has(w.hwnd) && w.title && !isGame?.(w.exe)).map((w) => w.hwnd));
      if (ready.length && !gameMode?.active) {
        // QUNS_BUSY (2) / QUNS_RUNNING_D3D_FULL_SCREEN (3): the window in
        // front is full screen.
        const st = ready.some((w) => w.active) ? await bridge.call("saverBlocked", { exclude: ownPids() }, 3000).catch(() => null) : null;
        const fullscreen = st?.state === 2 || st?.state === 3;
        const win = windows.win;
        const visible = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
        for (const w of ready) {
          if (fullscreen && w.active) continue;
          windows.send("apptab:new", { hwnd: w.hwnd, title: w.title, exe: w.exe, app: w.exe ? w.exe.split(/[\\/]/).pop().replace(/\.exe$/i, "") : "", show: visible });
        }
      }
    }
    known = now;
  };
  const watcher = setInterval(watch, 1500);

  const lookup = async (hwnd) => {
    const list = await bridge.call("windows", { exclude: ownPids() });
    return list.find((w) => w.hwnd === hwnd) || null;
  };

  // A rectangle in interface pixels -> physical screen pixels.
  const toScreen = (rect) => {
    const win = windows.win;
    const cb = win.getContentBounds();
    const z = win.webContents.getZoomFactor() || 1;
    return screen.dipToScreenRect(win, {
      x: Math.round(cb.x + rect.x * z), y: Math.round(cb.y + rect.y * z),
      width: Math.round(rect.width * z), height: Math.round(rect.height * z)
    });
  };

  const asRect = (r) => {
    if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width < 120 || r.height < 90) throw new Error("The tab is too small to show a window");
    return r;
  };

  // Moves the window into the tab and (unless focus is false, as when the
  // tab only changed size) brings it forward.
  handle("apptab:show", async (_e, hwnd, rect, opts = {}) => {
    const h = asHwnd(hwnd);
    const r = asRect(rect);
    const w = await lookup(h);
    if (!w) return { gone: true };
    if (!windows.win || windows.win.isDestroyed()) return { gone: false, ok: false };
    if (!docked.has(h)) {
      const was = await bridge.call("windowRect", { hwnd: h }).catch(() => null);
      docked.set(h, { original: was && !was.minimized ? { rect: was.rect, state: was.maximized ? "max" : "" } : null, target: null });
    }
    const p = toScreen(r);
    docked.get(h).target = [p.x, p.y, p.width, p.height];
    await bridge.call("placeWindow", { hwnd: h, x: p.x, y: p.y, w: p.width, h: p.height, state: "" });
    if (opts?.focus !== false) {
      // An always-on-top overlay would cover the window it just placed.
      if (windows.mode === "overlay") windows.hide();
      await bridge.call("focus", { hwnd: h }).catch(() => {});
    }
    return { ok: true, title: w.title, exe: w.exe };
  });

  // Out of the way while another tab is showing (no other window activates).
  handle("apptab:hide", async (_e, hwnd) => {
    const h = asHwnd(hwnd);
    if (!docked.has(h)) return false;
    return bridge.call("minimizeQuiet", { hwnd: h }).catch(() => false);
  });

  // Is the window still there, still in the tab, and what's its title?
  handle("apptab:check", async (_e, hwnd) => {
    const h = asHwnd(hwnd);
    const w = await lookup(h).catch(() => null);
    if (!w) return { gone: true };
    const r = await bridge.call("windowRect", { hwnd: h }).catch(() => null);
    const t = docked.get(h)?.target;
    const moved = !!(t && r && !r.minimized && (r.maximized || r.rect.some((v, i) => Math.abs(v - t[i]) > 12)));
    return { gone: false, title: w.title, exe: w.exe, active: w.active, minimized: !!r?.minimized, moved };
  });

  handle("apptab:snapshot", async (_e, hwnd) => (aux || bridge).call("windowSnapshot", { hwnd: asHwnd(hwnd), max: 1400 }, 8000).catch(() => null));

  // Puts the window back where it was before it became a tab.
  async function release(h, { focus = false } = {}) {
    const entry = docked.get(h);
    docked.delete(h);
    if (!entry) return false;
    const o = entry.original;
    if (o?.rect) {
      const [x, y, width, height] = o.rect;
      await bridge.call("placeWindow", { hwnd: h, x, y, w: width, h: height, state: o.state }, 4000).catch(() => {});
    }
    if (focus) await bridge.call("focus", { hwnd: h }).catch(() => {});
    return true;
  }

  handle("apptab:release", (_e, hwnd, opts = {}) => release(asHwnd(hwnd), { focus: !!opts.focus }));

  return {
    get count() { return docked.size; },
    stop: () => clearInterval(watcher),
    // Before quitting: every docked window goes back (bounded).
    releaseAll: () => Promise.race([
      Promise.all([...docked.keys()].map((h) => release(h))),
      new Promise((r) => setTimeout(r, 3000))
    ])
  };
}

module.exports = { registerAppTabs };
