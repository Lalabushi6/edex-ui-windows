// Left-column telemetry widgets.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import { Sparkline } from "../core/sparkline.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import { emit } from "../core/bus.js";
import { toast, contextMenu, prompt, cleanError } from "../core/ui.js";
import { defineWidget } from "./registry.js";

const api = window.edex;
let staticInfo = null;
const getStatic = () => (staticInfo ||= api.sys.static().catch(() => ({})));

function kv(pairs, cols = 2) {
  const refs = {};
  const grid = h("div", { class: "kv", style: { "--cols": cols } });
  for (const [key, label] of pairs) {
    refs[key] = h("span", { class: "v" }, "--");
    grid.append(h("div", null, h("span", { class: "label" }, label), refs[key]));
  }
  return { grid, refs };
}

function setBar(barEl, percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  barEl.firstElementChild.style.width = `${p}%`;
  barEl.classList.toggle("warn", p >= 80 && p < 92);
  barEl.classList.toggle("danger", p >= 92);
}
const bar = () => h("div", { class: "bar" }, h("i"));

// ── Clock ───────────────────────────────────────────────────────────────────
defineWidget({
  id: "clock",
  order: 1,
  title: "Clock",
  column: "left",
  create(panel) {
    const time = h("div", { class: "clock-time" });
    const date = h("span");
    const uptime = h("span");
    const zones = h("div", { class: "clock-zones" });
    panel.body.append(time, h("div", { class: "clock-date" }, date, uptime), zones);

    const zoneLabel = (z) => (z === "UTC" ? "UTC" : z.split("/").pop().replace(/_/g, " "));
    const fmtZone = (z, now) => {
      try {
        return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: !settings.get("clock24h"), timeZone: z }).format(now);
      } catch (_) { return "--"; }
    };
    let uptimeSec = 0;
    let uptimeAt = 0;

    const tick = () => {
      const now = new Date();
      const h24 = settings.get("clock24h");
      let hh = now.getHours();
      const suffix = h24 ? "" : (hh >= 12 ? " PM" : " AM");
      if (!h24) hh = hh % 12 || 12;
      const pad = (n) => String(n).padStart(2, "0");
      time.replaceChildren(
        pad(hh), h("span", { class: "colon" }, ":"), pad(now.getMinutes()), h("span", { class: "colon" }, ":"), pad(now.getSeconds()),
        suffix && h("span", { class: "colon" }, suffix));
      setText(date, now.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }).toUpperCase());
      if (uptimeAt) setText(uptime, `UP ${fmt.duration(uptimeSec + (Date.now() - uptimeAt) / 1000)}`);
      const extra = (settings.get("clockZones") || []).filter((z) => z !== "local");
      if (zones.childElementCount !== extra.length) zones.replaceChildren(...extra.map(() => h("span", { class: "clock-zone" })));
      extra.forEach((z, i) => setText(zones.children[i], `${zoneLabel(z)} ${fmtZone(z, now)}`));
    };
    const tickPoll = poll(tick, 1000);
    const upPoll = poll(async () => { uptimeSec = await api.sys.uptime(); uptimeAt = Date.now(); }, 60000);
    panel.setSub(Intl.DateTimeFormat().resolvedOptions().timeZone);

    panel.el.addEventListener("contextmenu", (e) => contextMenu(e, [
      { label: settings.get("clock24h") ? "Use 12-hour clock" : "Use 24-hour clock", icon: "clock", run: () => settings.set({ clock24h: !settings.get("clock24h") }) },
      {
        label: "Edit world clocks…", icon: "globe", run: async () => {
          const value = await prompt({
            title: "World clocks",
            message: "Comma-separated IANA time zones, e.g. UTC, America/New_York, Asia/Tokyo",
            value: (settings.get("clockZones") || []).filter((z) => z !== "local").join(", ")
          });
          if (value === null) return;
          const valid = value.split(",").map((s) => s.trim()).filter(Boolean).filter((z) => {
            try { new Intl.DateTimeFormat(undefined, { timeZone: z }); return true; } catch (_) { toast(`Unknown time zone: ${z}`, { level: "warn" }); return false; }
          });
          settings.set({ clockZones: ["local", ...valid].slice(0, 6) });
        }
      }
    ]));
    return { destroy() { tickPoll.stop(); upPoll.stop(); } };
  }
});

// ── System ──────────────────────────────────────────────────────────────────
defineWidget({
  id: "system",
  order: 2,
  title: "System",
  column: "left",
  create(panel) {
    const { grid, refs } = kv([["host", "Host"], ["user", "User"], ["os", "OS"], ["model", "Model"], ["chassis", "Chassis"], ["power", "Power"]]);
    panel.body.append(grid);
    getStatic().then((s) => {
      setText(refs.host, s.hostname || "--");
      setText(refs.user, s.user || "--");
      const osName = (s.os?.distro || "Windows").replace(/^Microsoft\s+/, "");
      setText(refs.os, osName);
      refs.os.title = `${osName} ${s.os?.release || ""} (build ${s.os?.build || "?"})`;
      setText(refs.model, [s.system?.manufacturer, s.system?.model].filter(Boolean).join(" ") || "--");
      refs.model.title = refs.model.textContent;
      setText(refs.chassis, s.chassis?.type || "--");
      panel.setSub(s.os?.release ? `${s.os.arch || ""} · ${s.os.release}` : "");
    });
    const p = poll(async () => {
      const b = await api.sys.battery();
      if (!b.hasBattery) { setText(refs.power, "AC POWER"); return; }
      const state = b.charging ? "CHARGING" : (b.ac ? "PLUGGED IN" : `${b.timeRemaining > 0 ? `${Math.floor(b.timeRemaining / 60)}h${String(b.timeRemaining % 60).padStart(2, "0")} LEFT` : "ON BATTERY"}`);
      setText(refs.power, `${Math.round(b.percent)}% ${state}`);
    }, 30000);
    return { destroy: () => p.stop() };
  }
});

// ── CPU ─────────────────────────────────────────────────────────────────────
defineWidget({
  id: "cpu",
  order: 3,
  title: "CPU",
  column: "left",
  create(panel) {
    const big = h("span", { class: "metric-big" }, "--");
    const speed = h("span", { class: "muted" });
    const canvas = h("canvas", { class: "spark" });
    const cores = h("div", { class: "cores" });
    const { grid, refs } = kv([["cores", "Cores"], ["speed", "Speed"], ["temp", "Temp"]], 3);
    panel.body.append(h("div", { class: "metric-row" }, big, speed), canvas, cores, grid);
    const spark = new Sparkline(canvas, { max: 100, points: 80 });
    let hot = 0;
    let lastAlert = 0;

    getStatic().then((s) => {
      const brand = `${s.cpu?.manufacturer || ""} ${s.cpu?.brand || ""}`.trim();
      panel.setSub(brand);
      panel.setSubTitle(brand);
      setText(refs.cores, s.cpu?.physicalCores && s.cpu.physicalCores !== s.cpu.cores ? `${s.cpu.physicalCores}C/${s.cpu.cores}T` : (s.cpu?.cores ?? "--"));
    });

    const load = poll(async () => {
      const c = await api.sys.cpu();
      big.replaceChildren(String(Math.round(c.load)), h("small", null, "%"));
      spark.push(c.load);
      if (cores.childElementCount !== c.cores.length) cores.replaceChildren(...c.cores.map(() => h("div", { class: "core" }, h("i"))));
      c.cores.forEach((v, i) => { cores.children[i].firstElementChild.style.height = `${Math.max(2, Math.min(100, v))}%`; });
      cores.title = c.cores.map((v, i) => `#${i + 1} ${Math.round(v)}%`).join("  ");
      if (c.speed) setText(refs.speed, `${c.speed.toFixed(2)} GHz`);
      setText(speed, c.speed ? `${c.cores.length} THREADS` : "");
      hot = c.load > 90 ? hot + 1 : 0;
      if (hot === 5 && Date.now() - lastAlert > 300000) {
        lastAlert = Date.now();
        toast(`CPU has been above 90% for several seconds`, { level: "warn", action: { label: "Processes", run: () => emit("open-processes") } });
      }
    }, 1500);
    const temp = poll(async () => {
      const t = await api.sys.temp();
      setText(refs.temp, t.main ? fmt.temperature(t.main, settings.get("temperatureUnit")) : "N/A");
      refs.temp.title = t.main ? "" : "Windows only exposes CPU temperature to elevated apps on most machines";
    }, 15000);
    return { destroy() { load.stop(); temp.stop(); spark.destroy(); } };
  }
});

// ── Memory ──────────────────────────────────────────────────────────────────
defineWidget({
  id: "memory",
  order: 4,
  title: "Memory",
  column: "left",
  create(panel) {
    const big = h("span", { class: "metric-big" }, "--");
    const detail = h("span", { class: "muted" });
    const DOTS = 200;
    const dots = h("div", { class: "dots" });
    const order = Array.from({ length: DOTS }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < DOTS; i++) dots.append(h("i"));
    const swapBar = bar();
    const swapText = h("span", { class: "muted" });
    panel.body.append(h("div", { class: "metric-row" }, big, detail), dots,
      h("div", { class: "metric-row" }, h("span", { class: "label" }, "Swap"), swapText), swapBar);
    let high = 0;

    const p = poll(async () => {
      const m = await api.sys.mem();
      const usedPct = (m.used / m.total) * 100;
      big.replaceChildren(String(Math.round(usedPct)), h("small", null, "%"));
      setText(detail, `${fmt.bytes(m.used)} / ${fmt.bytes(m.total)}`);
      panel.setSub(`${fmt.bytes(m.available)} FREE`);
      const on = Math.round((usedPct / 100) * DOTS);
      const cache = Math.round(((m.total - m.available - m.used) / m.total) * DOTS);
      order.forEach((dotIdx, rank) => {
        const cls = rank < on ? "on" : (rank < on + Math.max(0, cache) ? "cache" : "");
        const el = dots.children[dotIdx];
        if (el.className !== cls) el.className = cls;
      });
      const swapPct = m.swapTotal ? (m.swapUsed / m.swapTotal) * 100 : 0;
      setBar(swapBar, swapPct);
      setText(swapText, m.swapTotal ? `${fmt.bytes(m.swapUsed)} / ${fmt.bytes(m.swapTotal)}` : "none");
      high = usedPct > 90 ? high + 1 : 0;
      if (high === 4) toast(`Memory usage is at ${Math.round(usedPct)}%`, { level: "warn", action: { label: "Processes", run: () => emit("open-processes", { sort: "mem" }) } });
    }, 2000);
    return { destroy: () => p.stop() };
  }
});

// ── GPU ─────────────────────────────────────────────────────────────────────
defineWidget({
  id: "gpu",
  order: 5,
  title: "GPU",
  column: "left",
  create(panel) {
    const big = h("span", { class: "metric-big" }, "--");
    const extra = h("span", { class: "muted" });
    const canvas = h("canvas", { class: "spark" });
    const { grid, refs } = kv([["dedicated", "Dedicated"], ["shared", "Shared"], ["temp", "Temp"]], 3);
    panel.body.append(h("div", { class: "metric-row" }, big, extra), canvas, grid);
    const spark = new Sparkline(canvas, { max: 100, points: 80 });
    const p = poll(async () => {
      const g = await api.sys.gpu();
      if (g.model) { panel.setSub(g.model); panel.setSubTitle(`${g.vendor || ""} ${g.model}`); }
      if (g.util === null || g.util === undefined) {
        big.replaceChildren("N/A");
        setText(extra, "utilization unavailable");
      } else {
        big.replaceChildren(String(Math.round(g.util)), h("small", null, "%"));
        setText(extra, g.vramTotal ? `${fmt.bytes(g.vramTotal, 0)} VRAM` : "3D ENGINE");
        spark.push(g.util);
      }
      setText(refs.dedicated, g.dedicatedUsed ? fmt.bytes(g.dedicatedUsed) : "--");
      setText(refs.shared, g.sharedUsed ? fmt.bytes(g.sharedUsed) : "--");
      setText(refs.temp, g.temp ? fmt.temperature(g.temp, settings.get("temperatureUnit")) : "N/A");
    }, 2000);
    return { destroy() { p.stop(); spark.destroy(); } };
  }
});

// ── Storage ─────────────────────────────────────────────────────────────────
defineWidget({
  id: "storage",
  order: 6,
  title: "Storage",
  column: "left",
  create(panel) {
    const list = h("div");
    const canvas = h("canvas", { class: "spark" });
    const readV = h("span", { class: "v" }, "--");
    const writeV = h("span", { class: "v" }, "--");
    panel.body.append(list,
      h("div", { class: "io-row" }, h("span", { class: "label" }, "R"), h("span", { class: "muted" }, "Disk read"), readV),
      h("div", { class: "io-row" }, h("span", { class: "label" }, "W"), h("span", { class: "muted" }, "Disk write"), writeV),
      canvas);
    const spark = new Sparkline(canvas, { mirror: true, series: 2, floor: 1048576, points: 60 });

    const drives = poll(async () => {
      const ds = await api.sys.drives();
      list.replaceChildren(...ds.map((d) => {
        const b = bar();
        setBar(b, d.use);
        const row = h("div", { class: "drive", title: `Open ${d.mount}`, onclick: () => emit("open-path", { path: d.mount }) },
          h("span", { class: "drive-name" }, d.mount || d.fs),
          h("span", { class: "muted ellipsis" }, d.type || ""),
          h("span", { class: "drive-meta" }, `${fmt.bytes(d.size - d.used)} free of ${fmt.bytes(d.size, 0)}`),
          b);
        return row;
      }));
      if (!ds.length) list.append(h("div", { class: "empty" }, "No drives detected"));
    }, 30000);
    const io = poll(async () => {
      const d = await api.sys.diskIO();
      if (!d) { setText(readV, "N/A"); setText(writeV, "N/A"); return; }
      setText(readV, fmt.rate(d.read));
      setText(writeV, fmt.rate(d.write));
      spark.push(d.read, d.write);
    }, 1500);
    return { destroy() { drives.stop(); io.stop(); spark.destroy(); } };
  }
});

// ── Top processes ───────────────────────────────────────────────────────────
defineWidget({
  id: "top",
  order: 7,
  title: "Top Processes",
  column: "left",
  create(panel) {
    const table = h("table", { class: "top-table" });
    panel.body.append(table);
    panel.tools.append(h("button", { class: "icon-btn sm", type: "button", title: "Open process manager", onclick: () => emit("open-processes") }, icon("external")));
    const p = poll(async () => {
      const { list, all } = await api.sys.processes();
      panel.setSub(`${all} RUNNING`);
      const top = list.filter((x) => x.pid > 4).sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, 6);
      table.replaceChildren(...top.map((proc) => h("tr", {
        title: proc.path || proc.name,
        onclick: () => emit("open-processes", { pid: proc.pid }),
        oncontextmenu: (e) => contextMenu(e, [
          { label: `End ${proc.name}`, icon: "close", danger: true, run: () => api.sys.kill(proc.pid).then((ok) => ok && toast(`Ended ${proc.name}`, { level: "ok" })).catch((err) => toast(cleanError(err), { level: "warn" })) },
          { label: "Show in process manager", icon: "process", run: () => emit("open-processes", { pid: proc.pid }) }
        ])
      },
      h("td", null, proc.name),
      h("td", { class: "n" }, `${proc.cpu.toFixed(1)}%`),
      h("td", { class: "n" }, `${proc.mem.toFixed(1)}%`))));
    }, 4000);
    return { destroy: () => p.stop() };
  }
});
