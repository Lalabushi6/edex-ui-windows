export function bytes(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)));
  return `${(v / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function rate(n) {
  return `${bytes(n)}/s`;
}

export function bits(bytesPerSec) {
  const v = Math.max(0, Number(bytesPerSec) || 0) * 8;
  if (v < 1000) return `${v.toFixed(0)} b/s`;
  if (v < 1e6) return `${(v / 1e3).toFixed(1)} Kb/s`;
  if (v < 1e9) return `${(v / 1e6).toFixed(1)} Mb/s`;
  return `${(v / 1e9).toFixed(2)} Gb/s`;
}

export function pct(n, digits = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(digits)}%` : "--";
}

export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return d ? `${d}d ${hm}` : hm;
}

export function dateTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function relativeTime(ms) {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function temperature(celsius, unit = "C") {
  if (celsius === null || celsius === undefined || !Number.isFinite(Number(celsius))) return "--";
  const v = unit === "F" ? celsius * 9 / 5 + 32 : celsius;
  return `${v.toFixed(0)}°${unit}`;
}

// ── Paths (Windows-first, tolerant of forward slashes) ─────────────────────
export function normPath(p) {
  let s = String(p || "").trim().replace(/\//g, "\\");
  if (/^[A-Za-z]:$/.test(s)) s += "\\";
  return s;
}

export function pathKey(p) {
  return normPath(p).replace(/\\+$/, "").toLowerCase();
}

export function pathsEqual(a, b) {
  return pathKey(a) === pathKey(b);
}

export function isInside(parent, child) {
  const p = pathKey(parent), c = pathKey(child);
  return !!p && (c === p || c.startsWith(`${p}\\`));
}

export function basename(p) {
  const s = normPath(p).replace(/\\+$/, "");
  const i = s.lastIndexOf("\\");
  return i >= 0 ? s.slice(i + 1) : s;
}

export function dirname(p) {
  const s = normPath(p);
  if (/^[A-Za-z]:\\?$/.test(s)) return s.slice(0, 2) + "\\";
  const trimmed = s.replace(/\\+$/, "");
  const i = trimmed.lastIndexOf("\\");
  if (i < 0) return trimmed;
  const parent = trimmed.slice(0, i);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

export function joinPath(base, name) {
  const b = normPath(base);
  return b.endsWith("\\") ? b + name : `${b}\\${name}`;
}

export function extname(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileUrl(p) {
  return `localfile://f/${encodeURIComponent(normPath(p))}`;
}

export function pathSegments(p) {
  const s = normPath(p).replace(/\\+$/, "");
  if (!s) return [];
  const parts = s.split("\\");
  const out = [];
  let acc = "";
  parts.forEach((part, i) => {
    acc = i === 0 ? (/^[A-Za-z]:$/.test(part) ? `${part}\\` : part) : joinPath(acc, part);
    out.push({ label: i === 0 && /^[A-Za-z]:$/.test(part) ? part : part, path: acc });
  });
  return out;
}
