// Left-column telemetry widgets. Readings come from the shared feeds in
// core/live.js, so CPU, memory, GPU, disk and network share one IPC round
// trip per refresh no matter how many widgets show them.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import { onLive, onBattery, onProcesses, onDrives, getStatic } from "../core/live.js";
import { Sparkline } from "../core/sparkline.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import { emit } from "../core/bus.js";
import { toast, contextMenu, prompt, cleanError } from "../core/ui.js";
import { defineWidget } from "./registry.js";

const api = window.edex;

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

// A big number with a small unit, updated in place.
function metric(initial = "--") {
  const value = document.createTextNode(initial);
  const unit = h("small");
  const el = h("span", { class: "metric-big" }, value, unit);
  return {
    el,
    set(v, u = "") {
      if (value.data !== v) value.data = v;
      setText(unit, u);
    }
  };
}

// ── Clock ───────────────────────────────────────────────────────────────────
defineWidget({
  id: "clock",
  order: 1,
  title: "Clock",
  column: "left",
  create(panel) {
    const hh = document.createTextNode("--");
    const mm = document.createTextNode("--");
    const ss = document.createTextNode("--");
    const suffix = h("span", { class: "colon" });
    const time = h("div", { class: "clock-time" },
      hh, h("span", { class: "colon" }, ":"), mm, h("span", { class: "colon" }, ":"), ss, suffix);
    const date = h("span");
    const uptime = h("span");
    const zones = h("div", { class: "clock-zones" });
    panel.body.append(time, h("div", { class: "clock-date" }, date, uptime), zones);

    const zoneLabel = (z) => (z === "UTC" ? "UTC" : z.split("/").pop().replace(/_/g, " "));
    // Intl formatters are expensive to build, so they are cached per zone and
    // rebuilt only when the 12/24-hour setting changes.
    let formatters = new Map();
    let formatters24 = null;
    const zoneFormatter = (z, h24) => {
      if (formatters24 !== h24) { formatters = new Map(); formatters24 = h24; }
      if (!formatters.has(z)) {
        try {
          formatters.set(z, new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: !h24, timeZone: z }));
        } catch (_) { formatters.set(z, null); }
      }
      return formatters.get(z);
    };
    let uptimeSec = 0;
    let uptimeAt = 0;
    let lastDay = -1;
    let lastMinute = -1;
    const pad = (n) => String(n).padStart(2, "0");
    const set = (node, v) => { if (node.data !== v) node.data = v; };

    const tick = () => {
      const now = new Date();
      const h24 = settings.get("clock24h");
      let hours = now.getHours();
      setText(suffix, h24 ? "" : (hours >= 12 ? " PM" : " AM"));
      if (!h24) hours = hours % 12 || 12;
      set(hh, pad(hours));
      set(mm, pad(now.getMinutes()));
      set(ss, pad(now.getSeconds()));
      if (now.getDate() !== lastDay) {
        lastDay = now.getDate();
        setText(date, now.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }).toUpperCase());
      }
      // Uptime and world clocks only change once a minute.
      const minute = Math.floor(now.getTime() / 60000);
      if (minute === lastMinute && !tick.force) return;
      lastMinute = minute;
      tick.force = false;
      if (uptimeAt) setText(uptime, `UP ${fmt.duration(uptimeSec + (Date.now() - uptimeAt) / 1000)}`);
      const extra = (settings.get("clockZones") || []).filter((z) => z !== "local");
      if (zones.childElementCount !== extra.length) zones.replaceChildren(...extra.map(() => h("span", { class: "clock-zone" })));
      extra.forEach((z, i) => {
        const f = zoneFormatter(z, h24);
        setText(zones.children[i], `${zoneLabel(z)} ${f ? f.format(now) : "--"}`);
      });
    };
    const tickPoll = poll(tick, 1000, { fixed: true });
    const upPoll = poll(async () => {
      uptimeSec = await api.sys.uptime();
      uptimeAt = Date.now();
      tick.force = true;
    }, 300000, { fixed: true });
    const offSettings = settings.watch(["clock24h", "clockZones"], () => { tick.force = true; tickPoll.kick(); });
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
    return { destroy() { tickPoll.stop(); upPoll.stop(); offSettings(); } };
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
    const off = onBattery((b) => {
      if (!b.hasBattery) { setText(refs.power, "AC POWER"); return; }
      const left = b.timeRemaining > 0 ? `${Math.floor(b.timeRemaining / 60)}h${String(b.timeRemaining % 60).padStart(2, "0")} LEFT` : "ON BATTERY";
      const state = b.charging ? "CHARGING" : (b.ac ? "PLUGGED IN" : left);
      setText(refs.power, `${Math.round(b.percent)}% ${state}${b.saver ? " · SAVER" : ""}`);
    });
    return { destroy: off };
  }
});

// ── CPU ─────────────────────────────────────────────────────────────────────
defineWidget({
  id: "cpu",
  order: 3,
  title: "CPU",
  column: "left",
  create(panel) {
    const big = metric();
    const speed = h("span", { class: "muted" });
    const canvas = h("canvas", { class: "spark" });
    const cores = h("div", { class: "cores" });
    const { grid, refs } = kv([["cores", "Cores"], ["speed", "Speed"], ["temp", "Temp"]], 3);
    panel.body.append(h("div", { class: "metric-row" }, big.el, speed), canvas, cores, grid);
    const spark = new Sparkline(canvas, { max: 100, points: 80 });
    let bars = [];
    let hot = 0;
    let lastAlert = 0;

    getStatic().then((s) => {
      const brand = `${s.cpu?.manufacturer || ""} ${s.cpu?.brand || ""}`.trim();
      panel.setSub(brand);
      panel.setSubTitle(brand);
      setText(refs.cores, s.cpu?.physicalCores && s.cpu.physicalCores !== s.cpu.cores ? `${s.cpu.physicalCores}C/${s.cpu.cores}T` : (s.cpu?.cores ?? "--"));
    });

    const off = onLive(({ cpu: c }) => {
      big.set(String(Math.round(c.load)), "%");
      spark.push(c.load);
      if (bars.length !== c.cores.length) {
        cores.replaceChildren(...c.cores.map(() => h("div", { class: "core" }, h("i"))));
        bars = [...cores.children].map((el) => el.firstElementChild);
      }
      c.cores.forEach((v, i) => { bars[i].style.transform = `scaleY(${Math.max(2, Math.min(100, Math.round(v))) / 100})`; });
      cores.title = c.cores.map((v, i) => `#${i + 1} ${Math.round(v)}%`).join("  ");
      if (c.mhz) setText(refs.speed, `${(c.mhz / 1000).toFixed(2)} GHz`);
      setText(speed, `${c.cores.length} THREADS`);
      hot = c.load > 90 ? hot + 1 : 0;
      if (hot === 5 && Date.now() - lastAlert > 300000) {
        lastAlert = Date.now();
        toast("CPU has been above 90% for several seconds", { level: "warn", action: { label: "Processes", run: () => emit("open-processes") } });
      }
    });
    // Thermal zones are slow to query and rarely available without elevation.
    const temp = poll(async () => {
      const t = await api.sys.temp();
      setText(refs.temp, t.main ? fmt.temperature(t.main, settings.get("temperatureUnit")) : "N/A");
      refs.temp.title = t.main ? "" : "Windows only exposes CPU temperature to elevated apps on most machines";
    }, 30000);
    return { destroy() { off(); temp.stop(); spark.destroy(); } };
  }
});

// ── Memory ──────────────────────────────────────────────────────────────────
defineWidget({
  id: "memory",
  order: 4,
  title: "Memory",
  column: "left",
  create(panel) {
    const big = metric();
    const detail = h("span", { class: "muted" });
    const DOTS = 200;
    const dots = h("div", { class: "dots" });
    const order = Array.from({ length: DOTS }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < DOTS; i++) dots.append(h("i"));
    const dotEls = order.map((idx) => dots.children[idx]);
    const swapBar = bar();
    const swapText = h("span", { class: "muted" });
    panel.body.append(h("div", { class: "metric-row" }, big.el, detail), dots,
      h("div", { class: "metric-row" }, h("span", { class: "label" }, "Swap"), swapText), swapBar);
    let high = 0;
    let lit = -1;

    const off = onLive(({ mem: m }) => {
      const usedPct = (m.used / m.total) * 100;
      big.set(String(Math.round(usedPct)), "%");
      setText(detail, `${fmt.bytes(m.used)} / ${fmt.bytes(m.total)}`);
      panel.setSub(`${fmt.bytes(m.available)} FREE`);
      const on = Math.round((usedPct / 100) * DOTS);
      // Only the dots between the old and new fill level change.
      if (on !== lit) {
        const from = lit < 0 ? 0 : Math.min(on, lit);
        const to = lit < 0 ? DOTS : Math.max(on, lit);
        for (let rank = from; rank < to; rank++) dotEls[rank].className = rank < on ? "on" : "";
        lit = on;
      }
      const swapPct = m.swapTotal ? (m.swapUsed / m.swapTotal) * 100 : 0;
      setBar(swapBar, swapPct);
      setText(swapText, m.swapTotal ? `${fmt.bytes(m.swapUsed)} / ${fmt.bytes(m.swapTotal)}` : "none");
      high = usedPct > 90 ? high + 1 : 0;
      if (high === 4) toast(`Memory usage is at ${Math.round(usedPct)}%`, { level: "warn", action: { label: "Processes", run: () => emit("open-processes", { sort: "mem" }) } });
    });
    return { destroy: off };
  }
});

// ── GPU ─────────────────────────────────────────────────────────────────────
defineWidget({
  id: "gpu",
  order: 5,
  title: "GPU",
  column: "left",
  create(panel) {
    const big = metric();
    const extra = h("span", { class: "muted" });
    const canvas = h("canvas", { class: "spark" });
    const { grid, refs } = kv([["dedicated", "Dedicated"], ["shared", "Shared"], ["vram", "VRAM"]], 3);
    panel.body.append(h("div", { class: "metric-row" }, big.el, extra), canvas, grid);
    const spark = new Sparkline(canvas, { max: 100, points: 80 });
    getStatic().then((s) => {
      if (!s.gpu?.model) return;
      panel.setSub(s.gpu.model);
      panel.setSubTitle(`${s.gpu.vendor || ""} ${s.gpu.model}`.trim());
      setText(refs.vram, s.gpu.vram ? fmt.bytes(s.gpu.vram, 0) : "--");
    });
    const off = onLive(({ gpu: g }) => {
      if (!g || g.util === null || g.util === undefined) {
        big.set("N/A");
        setText(extra, "utilization unavailable");
      } else {
        big.set(String(Math.round(g.util)), "%");
        setText(extra, "3D ENGINE");
        spark.push(g.util);
      }
      setText(refs.dedicated, g?.dedicated ? fmt.bytes(g.dedicated) : "--");
      setText(refs.shared, g?.shared ? fmt.bytes(g.shared) : "--");
    });
    return { destroy() { off(); spark.destroy(); } };
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

    let signature = "";
    const offDrives = onDrives((ds) => {
      const sig = ds.map((d) => `${d.mount}|${d.size}|${Math.round(d.used / 1048576)}`).join(";");
      if (sig === signature) return;
      signature = sig;
      list.replaceChildren(...ds.map((d) => {
        const b = bar();
        setBar(b, d.use);
        return h("div", { class: "drive", title: `Open ${d.mount}`, onclick: () => emit("open-path", { path: d.mount }) },
          h("span", { class: "drive-name" }, d.mount || d.fs),
          h("span", { class: "muted ellipsis" }, d.type || ""),
          h("span", { class: "drive-meta" }, `${fmt.bytes(d.size - d.used)} free of ${fmt.bytes(d.size, 0)}`),
          b);
      }));
      if (!ds.length) list.append(h("div", { class: "empty" }, "No drives detected"));
    });
    const offIo = onLive(({ disk: d }) => {
      if (!d) { setText(readV, "N/A"); setText(writeV, "N/A"); return; }
      setText(readV, fmt.rate(d.read));
      setText(writeV, fmt.rate(d.write));
      spark.push(d.read, d.write);
    });
    return { destroy() { offDrives(); offIo(); spark.destroy(); } };
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
    // Six rows are built once and refilled; handlers read the row's current process.
    const rows = Array.from({ length: 6 }, () => {
      const row = { name: h("td"), cpu: h("td", { class: "n" }), mem: h("td", { class: "n" }), proc: null };
      row.el = h("tr", {
        onclick: () => row.proc && emit("open-processes", { pid: row.proc.pid }),
        oncontextmenu: (e) => {
          const proc = row.proc;
          if (!proc) return;
          contextMenu(e, [
            { label: `End ${proc.name}`, icon: "close", danger: true, run: () => api.sys.kill(proc.pid).then((ok) => ok && toast(`Ended ${proc.name}`, { level: "ok" })).catch((err) => toast(cleanError(err), { level: "warn" })) },
            { label: "Show in process manager", icon: "process", run: () => emit("open-processes", { pid: proc.pid }) }
          ]);
        }
      }, row.name, row.cpu, row.mem);
      return row;
    });
    table.append(...rows.map((r) => r.el));
    const off = onProcesses(({ list, all }) => {
      panel.setSub(`${all} RUNNING`);
      const top = list.filter((x) => x.pid > 4).sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, rows.length);
      rows.forEach((row, i) => {
        const proc = top[i] || null;
        row.proc = proc;
        row.el.hidden = !proc;
        if (!proc) return;
        row.el.title = proc.path || proc.name;
        setText(row.name, proc.name);
        setText(row.cpu, `${proc.cpu.toFixed(1)}%`);
        setText(row.mem, `${proc.mem.toFixed(1)}%`);
      });
    });
    return { destroy: off };
  }
});
