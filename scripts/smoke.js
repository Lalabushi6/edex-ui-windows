// End-to-end smoke test: starts eDEX (development build, windowed) on a
// throwaway profile, drives it through the DevTools protocol, and checks that
// the main parts open without errors: tabs, media views, every settings page,
// the top-bar panels, workspaces, Ctrl+Tab and a quick benchmark run.
// It never touches your real settings, other apps' windows or the desktop.
//   npm run smoke             about a minute; needs a Windows desktop session
//   npm run smoke -- --keep   leave the window open and keep the profile
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const keep = process.argv.includes("--keep");
const TOTAL_TIMEOUT_MS = 4 * 60 * 1000;
const electron = require("electron"); // in Node this is the path to electron.exe

if (typeof WebSocket === "undefined") {
  console.error("npm run smoke needs Node.js 22 or newer (for the built-in WebSocket).");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edex-smoke-"));
fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({
  bootAnimation: false, audioEnabled: false, mediaVolume: 0, allowNetworkGeolocation: false,
  updateCheck: false, gameMode: "off", openAtLogin: false, screensaver: false, theme: "tron"
}));

const child = spawn(electron, [".", "--remote-debugging-port=0", `--user-data-dir=${profile}`], {
  cwd: root, env: { ...process.env, EDEX_DEV_WINDOWED: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: false
});
const mainLog = [];
let devtoolsPort = null;
const onOutput = (d) => {
  const text = String(d);
  mainLog.push(text);
  const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(text);
  if (m) devtoolsPort = Number(m[1]);
};
child.stdout.on("data", onOutput);
child.stderr.on("data", onOutput);

const results = [];
const exceptions = [];
const consoleErrors = [];
let page = null;

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("DevTools connection failed")); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      exceptions.push(`${d.exception?.description || d.text}`.split("\n").slice(0, 3).join(" | "));
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300));
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  return { ws, send };
}

// Runs an async function body in the interface and returns its value.
async function run(body) {
  const r = await page.send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0] || "evaluation failed");
  return r.result?.result?.value;
}

async function key(k, modifiers = 0) {
  const codes = { Tab: 9, Escape: 27, Enter: 13 };
  const base = { key: k, code: k, windowsVirtualKeyCode: codes[k] || 0, modifiers };
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(250);
}

async function waitFor(body, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await run(body).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

async function check(name, fn) {
  const t0 = Date.now();
  const before = exceptions.length;
  try {
    const detail = await fn();
    const thrown = exceptions.slice(before);
    if (thrown.length) throw new Error(`interface error: ${thrown[0]}`);
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message });
  }
}

const H = `const cmd = (id) => import('app://edex/js/core/commands.js').then((c) => c.runCommand(id));
  const bus = await import('app://edex/js/core/bus.js');
  const settings = await import('app://edex/js/core/settings.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tabs = () => [...document.querySelectorAll('.tab')].filter((t) => !t.hidden);
  const active = () => document.querySelector('.tab.active .t')?.textContent;`;

async function main() {
  // The interface's DevTools target.
  const end = Date.now() + 40000;
  let target = null;
  while (Date.now() < end && !target) {
    if (devtoolsPort) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
        target = list.find((t) => t.type === "page" && /^app:\/\/edex\/index\.html$/.test(t.url));
      } catch (_) {}
    }
    if (!target) await sleep(300);
  }
  if (!target) throw new Error("eDEX didn't open its window (no DevTools target)");
  page = await connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");

  await check("starts and shows a terminal", async () => {
    if (!(await waitFor(`return !!document.querySelector('.tab') && !!document.querySelector('.pane.active .xterm');`, 40000))) throw new Error("no terminal tab after 40 s");
    await run(`document.querySelector('.greeting')?.remove();`);
    return await run(`return document.querySelectorAll('.tab').length + ' tabs';`);
  });

  await check("command palette opens", async () => {
    await run(`${H} await cmd('palette.open'); await sleep(500);`);
    const open = await run(`return !!document.querySelector('.launcher');`);
    await key("Escape");
    if (!open) throw new Error("no launcher");
  });

  await check("every tab type opens", async () => {
    const opened = await run(`${H}
      const before = tabs().length;
      await cmd('files.new'); await sleep(700);
      bus.emit('open-processes', {}); await sleep(700);
      bus.emit('open-media', {}); await sleep(900);
      bus.emit('open-disk', {}); await sleep(700);
      bus.emit('open-browser', { url: '' }); await sleep(900);
      bus.emit('open-wallpaper'); await sleep(900);
      const kinds = ['files', 'processes', 'media', 'disk', 'browser', 'ascii'].filter((k) => !document.querySelector('.tab-' + k));
      return { added: tabs().length - before, missing: kinds };`);
    if (opened.missing.length) throw new Error(`didn't open: ${opened.missing.join(", ")}`);
    return `${opened.added} tabs added`;
  });

  await check("media player views (player, library, radio)", async () => {
    const r = await run(`${H}
      bus.emit('open-media', {}); await sleep(600);
      await settings.set({ mediaView: 'library' }); await sleep(900);
      const lib = !!document.querySelector('.pane.active .lib:not([hidden])');
      await settings.set({ mediaView: 'radio' }); await sleep(700);
      const radio = !!document.querySelector('.pane.active .radio:not([hidden])');
      await settings.set({ mediaView: 'player' }); await sleep(400);
      return { lib, radio };`);
    if (!r.lib || !r.radio) throw new Error(JSON.stringify(r));
  });

  await check("every settings page opens", async () => {
    const bad = await run(`${H}
      const m = await import('app://edex/js/shell/settings-panel.js');
      const ids = ['general', 'appearance', 'terminal', 'keyboard', 'layout', 'workspaces', 'media', 'games', 'calendar', 'web', 'files', 'performance', 'privacy', 'about'];
      const bad = [];
      for (const id of ids) {
        m.openSettings(id); await sleep(450);
        const text = document.querySelector('.settings-page')?.innerText || '';
        if (text.length < 40) bad.push(id);
      }
      return bad;`);
    await key("Escape");
    if (bad.length) throw new Error(`empty pages: ${bad.join(", ")}`);
    return "14 pages";
  });

  await check("top-bar panels (notifications, calendar, games)", async () => {
    const r = await run(`${H}
      document.querySelector('.nc-btn')?.click(); await sleep(500);
      const nc = !!document.querySelector('.nc-pop');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
      document.querySelector('.status-clock')?.click(); await sleep(500);
      const cal = !!document.querySelector('.calendar-pop');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
      await cmd('games.open'); await sleep(1500);
      const games = !!document.querySelector('.games-modal');
      return { nc, cal, games };`);
    await key("Escape");
    if (!r.nc || !r.cal || !r.games) throw new Error(JSON.stringify(r));
  });

  await check("workspaces switch and come back", async () => {
    const r = await run(`${H}
      const p = await import('app://edex/js/shell/profiles.js');
      await settings.set({ profiles: [{ id: 'smoke', name: 'Smoke', tabs: null, theme: null, layout: null, windows: false, hotkey: '', schedule: null }] });
      await sleep(300);
      await p.switchProfile('smoke'); await sleep(1200);
      const inSmoke = settings.get('activeProfile') === 'smoke' && tabs().length >= 1;
      await p.switchProfile('main'); await sleep(900);
      const back = settings.get('activeProfile') === 'main';
      await settings.set({ profiles: [] });
      return { inSmoke, back };`);
    if (!r.inSmoke || !r.back) throw new Error(JSON.stringify(r));
  });

  await check("Ctrl+Tab switches tabs", async () => {
    const before = await run(`${H} document.querySelector('.tab')?.click(); await sleep(400); document.querySelector('.pane.active .xterm-helper-textarea')?.focus(); return active();`);
    await key("Tab", 2);
    const after = await run(`${H} return active();`);
    await key("Tab", 10);
    const back = await run(`${H} return active();`);
    if (before === after || back !== before) throw new Error(`${before} -> ${after} -> ${back}`);
  });

  await check("quick benchmark runs", async () => {
    const s = await run(`const b = await import('app://edex/js/shell/benchmark.js'); const r = await b.runBenchmark({ quick: true }); return r.summary;`);
    const missing = ["idleMemoryMB", "idleCpuPctOfCore", "terminalMBps", "helperMedianMs", "effectDrawMedianMs"].filter((k) => !Number.isFinite(s?.[k]));
    if (missing.length) throw new Error(`missing numbers: ${missing.join(", ")}`);
    return `idle ${s.idleCpuPctOfCore}% of a core, ${s.idleMemoryMB} MB, terminal ${s.terminalMBps} MB/s`;
  });
}

function report() {
  const failed = results.filter((r) => !r.ok);
  console.log("");
  for (const r of results) console.log(`${r.ok ? "  ok  " : "  FAIL"}  ${r.name}  (${(r.ms / 1000).toFixed(1)} s)${r.detail ? `  — ${r.detail}` : ""}`);
  const log = mainLog.join("");
  const mainProblems = log.split(/\r?\n/).filter((l) => /Uncaught|UnhandledPromiseRejection|FATAL/i.test(l));
  if (mainProblems.length) {
    failed.push({ name: "main process" });
    console.log("  FAIL  main process errors:");
    for (const l of mainProblems.slice(0, 10)) console.log(`        ${l.trim().slice(0, 200)}`);
  }
  if (consoleErrors.length) {
    console.log(`\n  ${consoleErrors.length} console error(s) (not failures):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 8)) console.log(`    - ${e}`);
  }
  console.log(`\n${failed.length ? `${failed.length} check(s) failed` : `All ${results.length} checks passed`}.`);
  return failed.length ? 1 : 0;
}

function cleanup() {
  try { page?.ws.close(); } catch (_) {}
  if (keep) { console.log(`\nKept running; profile: ${profile}`); return; }
  try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" }); } catch (_) {}
  // The profile can stay locked for a moment after the processes exit.
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch (_) { execSync("ping -n 2 127.0.0.1 >nul"); }
  }
}

const watchdog = setTimeout(() => {
  results.push({ name: "finished in time", ok: false, ms: TOTAL_TIMEOUT_MS, detail: "the smoke test took more than 4 minutes" });
  const code = report();
  cleanup();
  process.exit(code || 1);
}, TOTAL_TIMEOUT_MS);

main()
  .catch((e) => results.push({ name: "setup", ok: false, ms: 0, detail: e.message }))
  .finally(() => {
    clearTimeout(watchdog);
    const code = report();
    cleanup();
    process.exit(code);
  });
