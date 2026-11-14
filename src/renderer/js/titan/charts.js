// Small SVG charts for Titan Protocol, drawn in the theme colour. Every
// label is a text node; values come in as numbers.
const NS = "http://www.w3.org/2000/svg";

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const tip = (text) => s("title", {}, text);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Semicircle-free ring gauge with the value in the middle.
export function gauge(percent, { size = 150, stroke = 10, label = "TITAN SCORE", sub } = {}) {
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = clamp(percent, 0, 100) / 100;
  const svg = s("svg", { class: "tp-gauge", viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": `${label} ${percent}%` },
    s("circle", { class: "tp-gauge-track", cx: size / 2, cy: size / 2, r, "stroke-width": stroke, fill: "none" }),
    // Minor ticks around the dial, eDEX style.
    ...Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2 - Math.PI / 2;
      const r1 = r + stroke / 2 + 2, r2 = r1 + (i % 5 ? 2 : 4);
      return s("line", { class: "tp-gauge-tick", x1: size / 2 + Math.cos(a) * r1, y1: size / 2 + Math.sin(a) * r1, x2: size / 2 + Math.cos(a) * r2, y2: size / 2 + Math.sin(a) * r2 });
    }),
    s("circle", {
      class: "tp-gauge-fill", cx: size / 2, cy: size / 2, r, "stroke-width": stroke, fill: "none",
      "stroke-dasharray": c, "stroke-dashoffset": c * (1 - p), transform: `rotate(-90 ${size / 2} ${size / 2})`
    }),
    s("text", { class: "tp-gauge-num", x: size / 2, y: size / 2 + 4, "text-anchor": "middle" }, `${Math.round(percent)}%`),
    s("text", { class: "tp-gauge-label", x: size / 2, y: size / 2 + 22, "text-anchor": "middle" }, sub ?? label));
  return svg;
}

export function ring(percent, { size = 56, stroke = 5, color, text } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = clamp(percent, 0, 100) / 100;
  return s("svg", { class: "tp-ring", viewBox: `0 0 ${size} ${size}`, width: size, height: size },
    s("circle", { class: "tp-ring-track", cx: size / 2, cy: size / 2, r, "stroke-width": stroke, fill: "none" }),
    s("circle", {
      class: "tp-ring-fill", cx: size / 2, cy: size / 2, r, "stroke-width": stroke, fill: "none", style: color ? `stroke:${color}` : undefined,
      "stroke-dasharray": c, "stroke-dashoffset": c * (1 - p), "stroke-linecap": "round", transform: `rotate(-90 ${size / 2} ${size / 2})`
    }),
    s("text", { class: "tp-ring-text", x: size / 2, y: size / 2 + 4, "text-anchor": "middle" }, text ?? `${Math.round(percent)}%`));
}

// points: [{ label, value, title? }]. max defaults to 100 (percentages).
export function lineChart(points, { width = 440, height = 200, max, min = 0, unit = "%", threshold, area = true, labelsEvery } = {}) {
  const padL = 34, padR = 10, padT = 12, padB = 24;
  const w = width - padL - padR, h = height - padT - padB;
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  const hi = max ?? Math.max(100, ...values);
  const lo = Math.min(min, ...values);
  const span = hi - lo || 1;
  const x = (i) => padL + (points.length <= 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => padT + h - ((v - lo) / span) * h;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = lo + span * f;
    return [s("line", { class: "tp-gridline", x1: padL, x2: padL + w, y1: y(v), y2: y(v) }),
      s("text", { class: "tp-axis", x: padL - 6, y: y(v) + 3, "text-anchor": "end" }, `${Math.round(v)}${f === 1 ? unit : ""}`)];
  });
  const valid = points.map((p, i) => [p, i]).filter(([p]) => Number.isFinite(p.value));
  const d = valid.map(([p, i], j) => `${j ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const every = labelsEvery || Math.max(1, Math.ceil(points.length / Math.max(4, Math.round(width / 80))));
  // The last label shows unless it would sit on top of the one before it.
  const lastFits = (points.length - 1) % every >= every / 2 || (points.length - 1) % every === 0;
  return s("svg", { class: "tp-chart tp-line", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "xMidYMid meet", role: "img" },
    grid,
    threshold !== undefined && s("line", { class: "tp-threshold", x1: padL, x2: padL + w, y1: y(threshold), y2: y(threshold) }),
    area && valid.length > 1 && s("path", { class: "tp-area", d: `${d} L${x(valid[valid.length - 1][1]).toFixed(1)},${padT + h} L${x(valid[0][1]).toFixed(1)},${padT + h} Z` }),
    valid.length > 0 && s("path", { class: "tp-stroke", d, fill: "none" }),
    valid.map(([p, i]) => s("circle", { class: "tp-dot", cx: x(i), cy: y(p.value), r: points.length > 40 ? 1.6 : 3 }, tip(p.title || `${p.label}: ${p.value}${unit}`))),
    points.map((p, i) => (i % every === 0 || (i === points.length - 1 && lastFits)) && s("text", { class: "tp-axis", x: x(i), y: height - 6, "text-anchor": "middle" }, p.label)));
}

// items: [{ label, value, color?, cls?, title? }].
export function barChart(items, { width = 400, height = 180, max, unit = "%", threshold, showValues = true } = {}) {
  const padL = 30, padR = 6, padT = 14, padB = 24;
  const w = width - padL - padR, h = height - padT - padB;
  const hi = max ?? Math.max(1, ...items.map((i) => i.value || 0));
  const bw = w / Math.max(1, items.length);
  const y = (v) => padT + h - (clamp(v, 0, hi) / hi) * h;
  const every = Math.max(1, Math.ceil(items.length / 14));
  return s("svg", { class: "tp-chart tp-bars", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "xMidYMid meet", role: "img" },
    [0, 0.5, 1].map((f) => [s("line", { class: "tp-gridline", x1: padL, x2: padL + w, y1: y(hi * f), y2: y(hi * f) }),
      s("text", { class: "tp-axis", x: padL - 5, y: y(hi * f) + 3, "text-anchor": "end" }, `${Math.round(hi * f)}`)]),
    threshold !== undefined && s("line", { class: "tp-threshold", x1: padL, x2: padL + w, y1: y(threshold), y2: y(threshold) }),
    items.map((it, i) => {
      const bh = Math.max(it.value > 0 ? 2 : 0, padT + h - y(it.value || 0));
      const bx = padL + i * bw + bw * 0.18;
      return s("g", { class: `tp-bar ${it.cls || ""}` },
        s("rect", { x: bx, y: padT + h - bh, width: Math.max(1, bw * 0.64), height: bh, style: it.color ? `fill:${it.color}` : undefined }, tip(it.title || `${it.label}: ${Math.round((it.value || 0) * 10) / 10}${unit}`)),
        showValues && items.length <= 16 && it.value > 0 && s("text", { class: "tp-val", x: bx + bw * 0.32, y: padT + h - bh - 3, "text-anchor": "middle" }, `${Math.round(it.value * 10) / 10}`),
        (i % every === 0) && s("text", { class: "tp-axis", x: bx + bw * 0.32, y: height - 7, "text-anchor": "middle" }, it.label));
    }));
}

// items: [{ label, value (0–100) }], drawn as a polygon over rings.
export function radar(items, { size = 230 } = {}) {
  const c = size / 2, R = size / 2 - 34;
  const pt = (i, f) => {
    const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
    return [c + Math.cos(a) * R * f, c + Math.sin(a) * R * f];
  };
  const poly = (f) => items.map((_, i) => pt(i, f).map((v) => v.toFixed(1)).join(",")).join(" ");
  const shape = items.map((it, i) => pt(i, clamp(it.value, 0, 100) / 100).map((v) => v.toFixed(1)).join(",")).join(" ");
  return s("svg", { class: "tp-chart tp-radar", viewBox: `0 0 ${size} ${size}`, role: "img" },
    [0.25, 0.5, 0.75, 1].map((f) => s("polygon", { class: "tp-gridline", points: poly(f), fill: "none" })),
    items.map((_, i) => { const [x, y] = pt(i, 1); return s("line", { class: "tp-gridline", x1: c, y1: c, x2: x, y2: y }); }),
    s("polygon", { class: "tp-radar-shape", points: shape }),
    items.map((it, i) => { const [x, y] = pt(i, clamp(it.value, 0, 100) / 100); return s("circle", { class: "tp-dot", cx: x, cy: y, r: 3 }, tip(`${it.label}: ${it.value}%`)); }),
    items.map((it, i) => {
      const [x, y] = pt(i, 1.2);
      return s("text", { class: "tp-radar-label", x, y: y + 4, "text-anchor": "middle" }, `${it.label.toUpperCase()} ${it.value}%`);
    }));
}

export function sparkline(values, { width = 120, height = 30, max = 100 } = {}) {
  if (!values.length) return s("svg", { class: "tp-spark", viewBox: `0 0 ${width} ${height}` });
  const x = (i) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 4) + 2);
  const y = (v) => height - 3 - (clamp(v, 0, max) / max) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return s("svg", { class: "tp-spark", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" },
    s("path", { class: "tp-area", d: `${d} L${x(values.length - 1)},${height} L${x(0)},${height} Z` }),
    s("path", { class: "tp-stroke", d, fill: "none" }));
}

// GitHub-style grid: one column per week (Mon–Sun), days as squares.
// days: [{ dateKey, level (0–1) | null for future, title }].
export function heatGrid(days, { cell = 12, gap = 3, labels = true } = {}) {
  if (!days.length) return s("svg", { class: "tp-heat" });
  const first = new Date(`${days[0].dateKey}T00:00:00`);
  const lead = (first.getDay() + 6) % 7;
  const cols = Math.ceil((lead + days.length) / 7);
  const left = labels ? 16 : 0;
  const width = left + cols * (cell + gap);
  const height = 7 * (cell + gap);
  return s("svg", { class: "tp-heat", viewBox: `0 0 ${width} ${height}`, width, height },
    labels && ["M", "", "W", "", "F", "", ""].map((t, r) => t && s("text", { class: "tp-axis", x: 0, y: r * (cell + gap) + cell - 2 }, t)),
    days.map((d, i) => {
      const idx = lead + i;
      const col = Math.floor(idx / 7), row = idx % 7;
      const cls = d.level === null ? "future" : d.state ? `st-${d.state}` : d.level > 0 ? "on" : "off";
      return s("rect", {
        class: `tp-heat-cell ${cls}`, x: left + col * (cell + gap), y: row * (cell + gap), width: cell, height: cell, rx: 2,
        style: d.level ? `--lv:${clamp(d.level, 0, 1).toFixed(2)}` : undefined
      }, tip(d.title || d.dateKey));
    }));
}
