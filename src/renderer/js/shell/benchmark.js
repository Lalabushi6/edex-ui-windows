// Benchmark: how well this PC runs eDEX, as numbers to compare across
// machines and versions. About 50 seconds: eDEX idle with your settings and
// in the Eco profile, frame pacing, drawing an effect, filling a terminal,
// and the native helper's round trip, plus startup times and the hardware.
// The report has no personal data and is saved to Documents\eDEX benchmarks.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { openModal, toast, copyText, cleanError } from "../core/ui.js";
import { profile, configure, animationFps, holdCalm, forceCalm } from "../core/poll.js";
import { terminalTheme, terminalFont } from "../core/theme.js";
import { effectStepper } from "./fx.js";

const api = window.edex;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const pct = (v, p) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const PHASES = [
  ["info", "Hardware and startup"],
  ["idle", "eDEX idle (your settings)"],
  ["calm", "eDEX idle (calm animations)"],
  ["eco", "eDEX idle (Eco profile)"],
  ["smooth", "Smoothness (frame pacing)"],
  ["anim", "Drawing an effect"],
  ["term", "Filling a terminal"],
  ["helper", "Native helper round trip"],
  ["after", "Memory afterwards"]
];

// Startup marks for the report: "uiReady" when eDEX became usable, "booted"
// after the boot animation.
export function markStartup(stage) {
  api.bench.mark({ navStart: performance.timeOrigin, [stage]: Date.now() }).catch(() => {});
}

// Frame pacing of the interface (requestAnimationFrame deltas).
function frameMonitor() {
  const deltas = [];
  let last = 0;
  let raf = 0;
  let stopped = false;
  const tick = (t) => {
    if (last) deltas.push(t - last);
    last = t;
    if (!stopped) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      const secs = deltas.reduce((a, b) => a + b, 0) / 1000;
      return { fps: secs ? round(deltas.length / secs, 1) : null, p95FrameMs: round(pct(deltas, 95), 1), longFrames: deltas.filter((d) => d > 50).length, frames: deltas.length };
    }
  };
}

// How late timers fire on the interface's main thread (responsiveness).
function lagMonitor(step = 50) {
  const values = [];
  let expected = performance.now() + step;
  const timer = setInterval(() => {
    const now = performance.now();
    values.push(Math.max(0, now - expected));
    expected = now + step;
  }, step);
  return { stop() { clearInterval(timer); return { p50Ms: round(pct(values, 50), 1), p95Ms: round(pct(values, 95), 1), maxMs: round(values.length ? Math.max(...values) : null, 1) }; } };
}

// Averages a phase's samples: CPU as % of one logical core and memory in MB,
// summed over eDEX's processes and its native helpers.
function summarizeSamples(samples, logical) {
  const all = (s) => [...s.procs, ...s.helpers];
  const cpu = samples.map((s) => all(s).reduce((a, p) => a + (p.cpu || 0), 0));
  const mem = samples.map((s) => all(s).reduce((a, p) => a + (p.wsMB || 0), 0));
  const priv = samples.map((s) => s.procs.reduce((a, p) => a + (p.privMB || 0), 0));
  // Per process type (main "Browser", "Tab" renderers, GPU, utility,
  // helpers) and per kind (which renderer: interface, browser-tab page, HUD
  // …; which utility service): totals per sample, then averaged.
  const group = (keyOf) => {
    const acc = {};
    for (const s of samples) {
      const totals = {};
      for (const p of all(s)) {
        const t = (totals[keyOf(p)] ||= { cpu: 0, mem: 0, n: 0 });
        t.cpu += p.cpu || 0;
        t.mem += p.wsMB || 0;
        t.n++;
      }
      for (const [k, t] of Object.entries(totals)) {
        const b = (acc[k] ||= { cpu: [], mem: [], n: [] });
        b.cpu.push(t.cpu);
        b.mem.push(t.mem);
        b.n.push(t.n);
      }
    }
    return Object.fromEntries(Object.entries(acc).map(([k, b]) => [k, { cpuPctOfCore: round(avg(b.cpu)), memMB: round(avg(b.mem), 0), processes: Math.round(avg(b.n)) }]));
  };
  const types = group((p) => p.type);
  const kinds = group((p) => (p.type === "Tab" ? `Tab · ${p.role || "other"}` : p.type === "Utility" ? `Utility · ${p.name || "other"}` : p.type));
  const sys = samples.map((s) => s.system?.cpuLoadPct).filter(Number.isFinite);
  return {
    samples: samples.length,
    cpuAvgPctOfCore: round(avg(cpu)),
    cpuMaxPctOfCore: round(cpu.length ? Math.max(...cpu) : null),
    cpuAvgPctOfAllCores: round(avg(cpu) / logical, 2),
    memAvgMB: round(avg(mem), 0),
    memMaxMB: round(mem.length ? Math.max(...mem) : null, 0),
    privateAvgMB: round(avg(priv), 0),
    byType: types,
    byKind: kinds,
    systemCpuAvgPct: round(avg(sys), 0)
  };
}

class Aborted extends Error {}

// CPU and memory with nothing extra running (one sample a second).
async function measure(ms, logical, ctl) {
  const samples = [];
  await api.bench.sample(); // fresh baseline for this phase
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await sleep(1000);
    if (ctl.aborted) throw new Aborted();
    samples.push(await api.bench.sample());
  }
  return summarizeSamples(samples, logical);
}

// Frame pacing and timer lag. Watching every frame keeps the page drawing,
// so this is its own phase rather than part of the idle numbers.
async function smoothness(ms, logical, ctl) {
  await api.bench.sample();
  const frames = frameMonitor();
  const lag = lagMonitor();
  let pacing = null;
  let delays = null;
  try {
    await sleep(ms);
    if (ctl.aborted) throw new Aborted();
  } finally {
    pacing = frames.stop();
    delays = lag.stop();
  }
  return { frames: pacing, lag: delays, cpu: summarizeSamples([await api.bench.sample()], logical) };
}

async function animationTest(area, ms, logical) {
  const canvas = h("canvas", { class: "bench-canvas" });
  area.replaceChildren(canvas);
  await nextFrame();
  const step = effectStepper(canvas, "matrix");
  const draw = [];
  await api.bench.sample();
  const t0 = performance.now();
  await new Promise((resolve) => {
    const loop = () => {
      const s = performance.now();
      step();
      draw.push(performance.now() - s);
      if (performance.now() - t0 < ms) requestAnimationFrame(loop);
      else resolve();
    };
    requestAnimationFrame(loop);
  });
  const secs = (performance.now() - t0) / 1000;
  const sample = await api.bench.sample();
  area.replaceChildren();
  const median = pct(draw, 50);
  return {
    effect: "matrix", canvasPx: `${canvas.width}x${canvas.height}`, frames: draw.length, fps: round(draw.length / secs, 1),
    drawMedianMs: round(median, 2), drawP95Ms: round(pct(draw, 95), 2), drawFpsPossible: median ? Math.round(1000 / median) : null,
    cpu: summarizeSamples([sample], logical)
  };
}

async function terminalTest(area, kb, logical) {
  const { Terminal } = await import("../../vendor/xterm/lib/xterm.mjs");
  const host = h("div", { class: "bench-term" });
  area.replaceChildren(host);
  const term = new Terminal({ cols: 110, rows: 24, fontFamily: terminalFont(), fontSize: 13, theme: terminalTheme(), scrollback: 1000, disableStdin: true });
  term.open(host);
  let renderer = "dom";
  if (settings.get("termGpu") !== false) {
    try {
      const mod = await import("../../vendor/xterm-webgl/lib/addon-webgl.mjs");
      term.loadAddon(new mod.WebglAddon());
      renderer = "webgl";
    } catch (_) { renderer = "dom (WebGL failed)"; }
  }
  // Coloured lines like busy command output, in chunks a shell would send.
  const filler = "eDEX benchmark output ".repeat(4);
  const chunks = [];
  let bytes = 0;
  let chunk = "";
  for (let i = 0; bytes < kb * 1024; i++) {
    const line = `\x1b[3${(i % 7) + 1}m${String(i).padStart(6, "0")}\x1b[0m ${filler}\r\n`;
    chunk += line;
    bytes += line.length;
    if (chunk.length > 16384) { chunks.push(chunk); chunk = ""; }
  }
  if (chunk) chunks.push(chunk);
  await api.bench.sample();
  const t0 = performance.now();
  await new Promise((resolve) => {
    for (const c of chunks) term.write(c);
    term.write("", resolve);
  });
  await nextFrame();
  await nextFrame();
  const ms = performance.now() - t0;
  const sample = await api.bench.sample();
  term.dispose();
  area.replaceChildren();
  return { renderer, kb: Math.round(bytes / 1024), ms: Math.round(ms), mbPerSec: round(bytes / 1048576 / (ms / 1000), 2), cpu: summarizeSamples([sample], logical) };
}

function webglInfo() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { available: false };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const out = { available: true, version: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? 2 : 1, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return out;
  } catch (_) {
    return { available: false };
  }
}

// The whole run. opts: { quick, label, testArea, onProgress({ id, state }), ctl: { aborted } }
export async function runBenchmark({ quick = false, label = "", testArea = null, onProgress = () => {}, ctl = { aborted: false } } = {}) {
  const D = quick
    ? { settle: 800, idle: 3000, calm: 2000, eco: 2000, smooth: 1500, anim: 1500, termKB: 200, helper: 5, after: 800 }
    : { settle: 4000, idle: 12000, calm: 8000, eco: 8000, smooth: 5000, anim: 6000, termKB: 1536, helper: 30, after: 2500 };
  const area = testArea || document.body.appendChild(h("div", { class: "bench-area bench-offscreen" }));
  const notes = [];
  const timings = {};
  const phase = async (id, fn) => {
    if (ctl.aborted) throw new Aborted();
    onProgress({ id, state: "running" });
    const t0 = performance.now();
    try {
      const r = await fn();
      timings[id] = Math.round(performance.now() - t0);
      onProgress({ id, state: "done" });
      return r;
    } catch (e) {
      onProgress({ id, state: e instanceof Aborted ? "stopped" : "failed" });
      throw e;
    }
  };
  // schema 2: idleCalm phase, byKind breakdowns, workload / open.
  const report = { kind: "edex-benchmark", schema: 2, createdAt: new Date().toISOString(), quick, label: String(label || "").replace(/[^\w .,()+-]/g, "").trim().slice(0, 40) };
  let blurred = false;
  const onBlur = () => { blurred = true; };
  const restoreProfile = () => configure({ profile: settings.get("perfProfile") || "auto" });
  let logical = navigator.hardwareConcurrency || 1;
  window.addEventListener("blur", onBlur);
  // Leaving the PC alone during the run mustn't calm the animations except
  // in the phase that measures exactly that.
  holdCalm("benchmark", true);
  try {
    await phase("info", async () => {
      Object.assign(report, await api.bench.info());
      logical = report.hardware?.cpu?.logicalCores || logical;
      report.startup.bootAnimation = settings.get("bootAnimation") !== false;
      report.interface = {
        devicePixelRatio: window.devicePixelRatio, logicalCores: navigator.hardwareConcurrency || null, deviceMemoryGB: navigator.deviceMemory ?? null,
        webgl: webglInfo(), effectiveProfile: profile().name, animationFps: animationFps(), viewport: `${innerWidth}x${innerHeight}`
      };
      // What's open in eDEX: tabs by type (this workspace, and all of them).
      const tabCounts = (only) => {
        const out = {};
        for (const t of document.querySelectorAll(".tab")) {
          if (only && t.hidden) continue;
          const kind = [...t.classList].find((c) => c.startsWith("tab-"))?.slice(4) || "other";
          out[kind] = (out[kind] || 0) + 1;
        }
        return out;
      };
      report.workload = { tabsInWorkspace: tabCounts(true), tabsAllWorkspaces: tabCounts(false), workspaces: (settings.get("profiles") || []).filter((p) => p.id !== "main").length + 1, panels: document.querySelectorAll(".panel:not([hidden])").length };
      if (report.hardware?.battery?.present && report.hardware.battery.onAC === false) notes.push("Ran on battery: the Auto profile switches to Eco there, and Windows may slow the CPU.");
      if (report.startup.startedSecondsAgo > 900) notes.push("eDEX had been running for a while; for startup times, run the benchmark soon after starting eDEX.");
    });
    await api.bench.begin();
    report.phases = {};
    await sleep(D.settle);
    report.phases.idle = await phase("idle", () => measure(D.idle, logical, ctl));
    report.phases.idleCalm = await phase("calm", async () => {
      forceCalm(true);
      try {
        await sleep(600);
        return await measure(D.calm, logical, ctl);
      } finally { forceCalm(false); }
    });
    report.phases.idleEco = await phase("eco", async () => {
      configure({ profile: "eco" });
      try {
        await sleep(600);
        return await measure(D.eco, logical, ctl);
      } finally { restoreProfile(); }
    });
    report.phases.smoothness = await phase("smooth", () => smoothness(D.smooth, logical, ctl));
    report.phases.animation = await phase("anim", () => animationTest(area, D.anim, logical));
    report.phases.terminal = await phase("term", () => terminalTest(area, D.termKB, logical));
    report.phases.helper = await phase("helper", () => api.bench.helper(D.helper));
    report.phases.after = await phase("after", async () => {
      await sleep(D.after);
      await api.bench.sample();
      await sleep(500);
      return summarizeSamples([await api.bench.sample()], logical);
    });
  } finally {
    window.removeEventListener("blur", onBlur);
    forceCalm(false);
    holdCalm("benchmark", false);
    restoreProfile();
    report.mainProcess = await api.bench.end().catch(() => null);
    if (!testArea) area.remove();
  }
  if (blurred) notes.push("eDEX lost focus during the run, so its refreshes slowed down; idle numbers may read low.");
  report.notes = notes;
  report.phaseMs = timings;
  const p = report.phases;
  report.summary = {
    startupToUsableSec: report.startup?.launchToUsableMs != null ? round(report.startup.launchToUsableMs / 1000, 1) : null,
    idleCpuPctOfCore: p.idle?.cpuAvgPctOfCore ?? null,
    idleCpuPctOfAllCores: p.idle?.cpuAvgPctOfAllCores ?? null,
    calmIdleCpuPctOfCore: p.idleCalm?.cpuAvgPctOfCore ?? null,
    ecoIdleCpuPctOfCore: p.idleEco?.cpuAvgPctOfCore ?? null,
    idleMemoryMB: p.idle?.memAvgMB ?? null,
    idleFrameP95Ms: p.smoothness?.frames?.p95FrameMs ?? null,
    idleLongFrames: p.smoothness?.frames?.longFrames ?? null,
    interfaceLagP95Ms: p.smoothness?.lag?.p95Ms ?? null,
    mainLagP95Ms: report.mainProcess?.mainLagP95Ms ?? null,
    effectDrawMedianMs: p.animation?.drawMedianMs ?? null,
    terminalMBps: p.terminal?.mbPerSec ?? null,
    terminalRenderer: p.terminal?.renderer ?? null,
    helperMedianMs: p.helper?.medianMs ?? null,
    helperP95Ms: p.helper?.p95Ms ?? null,
    memoryAfterMB: p.after?.memAvgMB ?? null
  };
  return report;
}

// A few lines to paste anywhere.
export function summaryText(r) {
  const s = r.summary || {};
  const hw = r.hardware || {};
  const disks = (hw.disks || []).map((d) => d.type).filter(Boolean).join("/") || "?";
  const lines = [
    `eDEX-UI ${r.app?.version} benchmark${r.label ? ` — ${r.label}` : ""}${r.quick ? " (quick)" : ""}`,
    `${hw.cpu?.brand || "CPU ?"} (${hw.cpu?.logicalCores || "?"} threads) · ${hw.ramGB ?? "?"} GB RAM · ${hw.gpu?.model || "GPU ?"} · ${disks} · ${r.os?.distro || "Windows"} ${r.os?.build || ""}`.trim(),
    `Startup to usable: ${s.startupToUsableSec ?? "?"} s`,
    `Idle CPU: ${s.idleCpuPctOfCore ?? "?"}% of one core (${s.idleCpuPctOfAllCores ?? "?"}% of the whole CPU) · calm: ${s.calmIdleCpuPctOfCore ?? "?"}% · Eco: ${s.ecoIdleCpuPctOfCore ?? "?"}%`,
    `Memory: ${s.idleMemoryMB ?? "?"} MB idle, ${s.memoryAfterMB ?? "?"} MB after the tests`,
    `Biggest: ${Object.entries(r.phases?.idle?.byKind || {}).sort((a, b) => (b[1].memMB || 0) - (a[1].memMB || 0)).slice(0, 4).map(([k, v]) => `${k.replace(/^Tab · /, "").replace(/^Utility · /, "")} ${v.memMB} MB${v.processes > 1 ? ` (${v.processes})` : ""}`).join(", ") || "?"}`,
    `Smoothness: 95% of frames within ${s.idleFrameP95Ms ?? "?"} ms, ${s.idleLongFrames ?? "?"} long frames · interface lag p95 ${s.interfaceLagP95Ms ?? "?"} ms`,
    `Effect drawing: ${s.effectDrawMedianMs ?? "?"} ms a frame · terminal: ${s.terminalMBps ?? "?"} MB/s (${s.terminalRenderer || "?"})`,
    `Native helper: ${s.helperMedianMs ?? "?"} ms median, ${s.helperP95Ms ?? "?"} ms p95`,
    ...(r.notes || []).map((n) => `Note: ${n}`)
  ];
  return lines.join("\n");
}

// Settings → Performance → Benchmark, or the launcher ("Run benchmark").
export function openBenchmark() {
  const ctl = { aborted: false };
  openModal((close) => {
    let report = null;
    let running = false;
    const label = h("input", { class: "input", placeholder: "Name this PC (optional), e.g. old Dell", maxLength: 40, spellcheck: false });
    const start = h("button", { class: "btn primary", type: "button" }, icon("play"), "Start");
    const rows = new Map(PHASES.map(([id, text]) => [id, h("div", { class: "bench-step" }, h("span", { class: "bench-dot" }), h("span", null, text))]));
    const area = h("div", { class: "bench-area" });
    const results = h("pre", { class: "bench-results", hidden: true });
    const save = h("button", { class: "btn primary", type: "button", hidden: true }, icon("download"), "Save report");
    const copy = h("button", { class: "btn", type: "button", hidden: true }, icon("copy"), "Copy summary");
    const status = h("div", { class: "muted bench-status" });
    start.addEventListener("click", async () => {
      if (running) return;
      running = true;
      start.disabled = true;
      label.disabled = true;
      results.hidden = save.hidden = copy.hidden = true;
      for (const r of rows.values()) r.dataset.state = "";
      setText(status, "Running — keep eDEX in front and leave the PC alone for about 50 seconds.");
      try {
        report = await runBenchmark({ label: label.value, testArea: area, ctl, onProgress: ({ id, state }) => { const r = rows.get(id); if (r) r.dataset.state = state; } });
        setText(results, summaryText(report));
        results.hidden = save.hidden = copy.hidden = false;
        setText(status, "Done. Save the report and send the file to compare PCs and versions.");
      } catch (e) {
        if (!(e instanceof Aborted)) { setText(status, `The benchmark stopped: ${cleanError(e)}`); console.error("benchmark failed", e); }
      } finally {
        running = false;
        start.disabled = false;
        label.disabled = false;
        setText(start, "");
        start.append(icon("restart"), report ? "Run again" : "Start");
      }
    });
    save.addEventListener("click", async () => {
      if (!report) return;
      try {
        const file = await api.bench.save(report);
        toast("Benchmark report saved to Documents › eDEX benchmarks", { level: "ok", timeout: 6000, action: { label: "Show", run: () => api.fs.reveal(file).catch(() => {}) } });
      } catch (e) { toast(cleanError(e), { level: "warn" }); }
    });
    copy.addEventListener("click", () => { if (report) copyText(summaryText(report)); });
    return h("div", { class: "dialog bench" },
      h("h2", { class: "dialog-title" }, icon("gauge"), "Benchmark this PC"),
      h("p", { class: "dialog-msg" }, "Measures how eDEX runs here: startup time, CPU and memory while idle (with your settings and in Eco), smoothness, drawing an effect, terminal speed and the native helper. About 50 seconds. The report has no personal data — no PC or user name, paths or network addresses."),
      h("div", { class: "bench-head" }, label, start),
      h("div", { class: "bench-steps" }, ...rows.values()),
      area, status, results,
      h("div", { class: "dialog-actions" }, copy, save, h("button", { class: "btn", type: "button", onclick: () => close() }, "Close")));
  }, { label: "Benchmark", className: "bench-modal", onClose: () => { ctl.aborted = true; } });
}
