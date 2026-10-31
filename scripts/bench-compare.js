// Compares eDEX benchmark reports (Settings -> Performance -> Run benchmark,
// saved to Documents\eDEX benchmarks): one column per PC and version, the
// median when a PC was run more than once, a change column when exactly two
// columns are shown, and an optional pass/fail check against a budget.
//   npm run bench:compare                         every report in Documents\eDEX benchmarks
//   npm run bench:compare -- <files or folders>   those reports (folders are searched recursively)
//   npm run bench:compare -- <paths> --budget scripts/bench-budget.json
// Options:
//   --budget <file>     limits to check; pass only the reports from the PC it is for
//   --detail            CPU and memory by process type
//   --runs              one column per report instead of per PC and version
//   --quick             include quick runs (a few seconds per phase, so noisy)
//   --tolerance <pct>   smallest change called better or worse (default 10)
// Exit code: 0 fine, 1 a budget limit is exceeded, 2 nothing to compare or bad arguments.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// floor: the smallest change worth calling a difference, in the metric's unit.
const METRICS = [
  { key: "startupToUsableSec", label: "Startup to usable", unit: "s", better: "low", floor: 0.3, digits: 1 },
  { key: "idleCpuPctOfCore", label: "Idle CPU, your settings", unit: "% core", better: "low", floor: 1, digits: 1 },
  { key: "calmIdleCpuPctOfCore", label: "Idle CPU, calm", unit: "% core", better: "low", floor: 1, digits: 1 },
  { key: "ecoIdleCpuPctOfCore", label: "Idle CPU, Eco", unit: "% core", better: "low", floor: 1, digits: 1 },
  { key: "idleMemoryMB", label: "Idle memory", unit: "MB", better: "low", floor: 25, digits: 0 },
  { key: "memoryAfterMB", label: "Memory after tests", unit: "MB", better: "low", floor: 25, digits: 0 },
  { key: "idleFrameP95Ms", label: "Frame time p95", unit: "ms", better: "low", floor: 1, digits: 1 },
  { key: "idleLongFrames", label: "Long frames", unit: "", better: "low", floor: 1, digits: 0 },
  { key: "interfaceLagP95Ms", label: "Interface lag p95", unit: "ms", better: "low", floor: 2, digits: 1 },
  { key: "mainLagP95Ms", label: "Main process lag p95", unit: "ms", better: "low", floor: 2, digits: 1 },
  { key: "effectDrawMedianMs", label: "Effect draw", unit: "ms", better: "low", floor: 0.3, digits: 2 },
  { key: "terminalMBps", label: "Terminal throughput", unit: "MB/s", better: "high", floor: 0.5, digits: 1 },
  { key: "helperMedianMs", label: "Native helper median", unit: "ms", better: "low", floor: 0.2, digits: 2 },
  { key: "helperP95Ms", label: "Native helper p95", unit: "ms", better: "low", floor: 0.3, digits: 2 }
].map((m) => ({ ...m, get: (r) => num(r.summary?.[m.key]) }));

const TYPE_NAMES = { Tab: "renderers", GPU: "GPU process", Browser: "main process", Utility: "utility services", Helper: "native helpers" };
const TYPE_ORDER = ["Tab", "GPU", "Browser", "Utility", "Helper"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function median(values) {
  const s = values.filter((v) => v !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { inputs: [], budget: null, detail: false, runs: false, quick: false, tolerance: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (a.includes("=")) return a.slice(a.indexOf("=") + 1);
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    const flag = a.split("=")[0];
    if (flag === "--budget") o.budget = value();
    else if (flag === "--tolerance") {
      o.tolerance = Number(value());
      if (!Number.isFinite(o.tolerance) || o.tolerance < 0) fail("--tolerance needs a number of percent, such as 10");
    } else if (flag === "--detail") o.detail = true;
    else if (flag === "--runs") o.runs = true;
    else if (flag === "--quick") o.quick = true;
    else if (flag === "--help" || flag === "-h") {
      const lines = fs.readFileSync(__filename, "utf8").split("\n");
      console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.slice(3)).join("\n"));
      process.exit(0);
    } else if (a.startsWith("--")) fail(`Unknown option ${a} (try --help)`);
    else o.inputs.push(a);
  }
  return o;
}

// Windows may keep Documents elsewhere (OneDrive), so ask for the real folder.
function defaultFolder() {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
  return path.join((r.stdout || "").trim() || path.join(os.homedir(), "Documents"), "eDEX benchmarks");
}

function collect(inputs) {
  const files = [];
  const visit = (p) => {
    let st;
    try { st = fs.statSync(p); } catch (_) { fail(`Not found: ${p}`); }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p).sort()) {
        const full = path.join(p, e);
        if (fs.statSync(full).isDirectory() || e.toLowerCase().endsWith(".json")) visit(full);
      }
    } else files.push(p);
  };
  inputs.forEach((p) => visit(path.resolve(p)));
  return files;
}

function load(file) {
  let r;
  try { r = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { return { skip: `not readable JSON (${e.message.split("\n")[0]})` }; }
  if (!r || r.kind !== "edex-benchmark") return { skip: "not an eDEX benchmark report" };
  return { report: r };
}

const shortCpu = (brand) => String(brand || "CPU ?")
  .replace(/\((R|TM)\)/gi, "").replace(/@.*$/, "")
  .replace(/\b(CPU|Processor|Intel|Core|AMD|with Radeon Graphics|\d+(st|nd|rd|th) Gen)\b/gi, "")
  .replace(/\s+/g, " ").trim() || "CPU ?";

function machineOf(r) {
  const hw = r.hardware || {};
  const disks = [...new Set((hw.disks || []).map((d) => d.type).filter(Boolean))].join("/");
  return [shortCpu(hw.cpu?.brand), hw.ramGB != null ? `${Math.round(hw.ramGB)}GB` : "?GB", disks].filter(Boolean).join(" ");
}

// 3.0.0-beta.1 sorts before 3.0.0.
function compareVersions(a, b) {
  const parse = (v) => { const [core, pre] = String(v).split("-"); return { n: core.split(".").map((x) => parseInt(x, 10) || 0), pre: pre || "" }; };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) {
    const d = (x.n[i] || 0) - (y.n[i] || 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

const buildOf = (r) => (r.app?.packaged === false ? "from source" : r.app?.portable ? "portable" : r.app?.packaged ? "installed" : "?");

// Runs are pooled only when PC, version, kind of build and run length all
// match: a build from source or a quick run isn't comparable with the rest.
function buildGroups(reports, perRun) {
  const groups = new Map();
  for (const { file, report: r } of reports) {
    const machine = machineOf(r);
    const version = r.app?.version || "?";
    const id = perRun ? file : `${machine}|${version}|${buildOf(r)}|${!!r.quick}`;
    if (!groups.has(id)) groups.set(id, { id, machine, version, reports: [] });
    groups.get(id).reports.push(r);
  }
  return [...groups.values()].sort((a, b) => a.machine.localeCompare(b.machine) || compareVersions(a.version, b.version) ||
    String(a.reports[0].createdAt).localeCompare(String(b.reports[0].createdAt)));
}

function loadBudget(file) {
  let b;
  try { b = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail(`Can't read the budget ${file}: ${e.message.split("\n")[0]}`); }
  const known = new Set(METRICS.map((m) => m.key));
  const limits = [];
  for (const kind of ["max", "min"]) {
    for (const [key, v] of Object.entries(b[kind] || {})) {
      if (!known.has(key)) fail(`The budget names an unknown measure "${key}". Known: ${[...known].join(", ")}`);
      if (v === null) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) fail(`The budget's ${kind}.${key} must be a number or null`);
      limits.push({ key, kind, value: v });
    }
  }
  return { name: b.name || "budget", limits };
}

const fmt = (v, digits) => (v === null ? "-" : v.toFixed(digits));

function change(a, b, m, tolerance) {
  if (a === null || b === null) return "";
  const d = b - a;
  const sign = d > 0 ? "+" : d < 0 ? "-" : "";
  const pct = a !== 0 ? ` (${sign}${Math.abs((d / a) * 100).toFixed(0)}%)` : "";
  const worse = m.better === "low" ? d > 0 : d < 0;
  const material = Math.abs(d) >= m.floor && (a === 0 || Math.abs(d / a) * 100 >= tolerance);
  return `${sign}${Math.abs(d).toFixed(m.digits)}${pct} ${material ? (worse ? "worse" : "better") : "same"}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = collect(opts.inputs.length ? opts.inputs : [defaultFolder()]);
  const loaded = [];
  const skipped = [];
  for (const file of files) {
    const r = load(file);
    if (r.report) loaded.push({ file, report: r.report });
    else skipped.push(`${path.basename(file)}: ${r.skip}`);
  }
  const quick = loaded.filter((x) => x.report.quick);
  const reports = opts.quick ? loaded : loaded.filter((x) => !x.report.quick);
  if (!opts.quick && quick.length) skipped.push(`${quick.length} quick run${quick.length > 1 ? "s" : ""} (add --quick to include)`);
  if (!reports.length) {
    for (const s of skipped) console.error(`Skipped ${s}`);
    fail("No benchmark reports to compare. Run Settings -> Performance -> Run benchmark, or pass the report files or folders.");
  }

  const groups = buildGroups(reports, opts.runs);
  const budget = opts.budget ? loadBudget(opts.budget) : null;
  const limitsFor = (key) => (budget ? budget.limits.filter((l) => l.key === key) : []);
  const exceeds = (v, l) => v !== null && (l.kind === "max" ? v > l.value : v < l.value);

  const metrics = [...METRICS];
  if (opts.detail) {
    const types = new Set(reports.flatMap((x) => Object.keys(x.report.phases?.idle?.byType || {})));
    const ordered = [...TYPE_ORDER.filter((t) => types.has(t)), ...[...types].filter((t) => !TYPE_ORDER.includes(t)).sort()];
    for (const t of ordered) metrics.push({ key: `mem:${t}`, section: "Idle memory by process type", label: TYPE_NAMES[t] || t, unit: "MB", better: "low", floor: 25, digits: 0, get: (r) => num(r.phases?.idle?.byType?.[t]?.memMB) });
    for (const t of ordered) metrics.push({ key: `cpu:${t}`, section: "Idle CPU by process type", label: TYPE_NAMES[t] || t, unit: "% core", better: "low", floor: 1, digits: 1, get: (r) => num(r.phases?.idle?.byType?.[t]?.cpuPctOfCore) });
  }

  const value = (g, m) => median(g.reports.map(m.get));
  const diff = groups.length === 2;
  const rows = [];
  const labels = (g) => [...new Set(g.reports.map((r) => r.label).filter(Boolean))].join(", ") || "-";
  // The change and budget columns are named on the first row.
  const head = (name, f, extra = ["", ""]) => rows.push([name, ...groups.map(f), ...(diff ? [extra[0]] : []), ...(budget ? [extra[1]] : [])]);
  head("PC", (g) => g.machine, ["Change (right vs left)", "Budget"]);
  head("eDEX version", (g) => g.version);
  head("Build", (g) => [...new Set(g.reports.map(buildOf))].join("/"));
  head("Name", labels);
  head("Runs", (g) => `${g.reports.length}${g.reports.length > 1 ? " (median)" : ""}${g.reports[0].quick ? " (quick)" : ""}`);
  rows.push("-");

  let section = null;
  const over = [];
  for (const m of metrics) {
    if (m.section && m.section !== section) { section = m.section; rows.push({ section }); }
    const values = groups.map((g) => value(g, m));
    const limits = limitsFor(m.key);
    const cells = values.map((v, i) => {
      const hit = limits.some((l) => exceeds(v, l));
      if (hit) over.push({ group: groups[i], m, v, limit: limits.find((l) => exceeds(v, l)) });
      return fmt(v, m.digits) + (hit ? " !" : "");
    });
    const unit = m.unit ? ` (${m.unit})` : "";
    rows.push([m.label + unit, ...cells, ...(diff ? [change(values[0], values[1], m, opts.tolerance)] : []),
      ...(budget ? [limits.map((l) => `${l.kind === "max" ? "<=" : ">="} ${l.value}`).join(", ")] : [])]);
  }

  const table = rows.filter((r) => Array.isArray(r));
  const cols = Math.max(...table.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(...table.map((r) => String(r[c] ?? "").length)));
  const lineWidth = widths.reduce((a, b) => a + b, 0) + (cols - 1) * 2;
  const line = (r) => r.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ").trimEnd();

  console.log(`eDEX benchmark comparison: ${reports.length} report${reports.length > 1 ? "s" : ""}, ${groups.length} column${groups.length > 1 ? "s" : ""}\n`);
  for (const r of rows) {
    if (r === "-") console.log("-".repeat(lineWidth));
    else if (r.section) console.log(`\n${r.section}`);
    else console.log(line(r));
  }

  const schemas = [...new Set(reports.map((x) => x.report.schema))].sort();
  if (schemas.length > 1) console.log(`\nThe reports use different schema versions (${schemas.join(", ")}): measures added later show "-" for older reports.`);
  const notes = groups.flatMap((g) => [...new Set(g.reports.flatMap((r) => r.notes || []))].map((n) => `  ${g.machine}, eDEX ${g.version}: ${n}`));
  if (notes.length) console.log(`\nNotes recorded during the runs:\n${notes.join("\n")}`);

  let code = 0;
  if (budget) {
    console.log("");
    if (!budget.limits.length) console.log(`Budget "${budget.name}": no limits set yet (edit ${opts.budget}).`);
    else {
      const missing = [];
      for (const g of groups) for (const l of budget.limits) {
        const m = METRICS.find((x) => x.key === l.key);
        if (value(g, m) === null) missing.push(`${g.machine}, eDEX ${g.version}: ${m.label.toLowerCase()}`);
      }
      if (over.length) {
        code = 1;
        console.log(`Budget "${budget.name}": ${over.length} limit${over.length > 1 ? "s" : ""} exceeded.`);
        for (const x of over) console.log(`  OVER  ${x.group.machine}, eDEX ${x.group.version}: ${x.m.label.toLowerCase()} ${fmt(x.v, x.m.digits)} ${x.m.unit}, limit ${x.limit.kind === "max" ? "at most" : "at least"} ${x.limit.value} ${x.m.unit}`.trimEnd());
      } else console.log(`Budget "${budget.name}": every limit met.`);
      for (const m of missing) console.log(`  not measured  ${m}`);
    }
  }
  if (skipped.length) console.log(`\nSkipped: ${skipped.join("; ")}`);
  process.exit(code);
}

main();
