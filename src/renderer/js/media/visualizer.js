// Media player visualizer: the spectrum (or the waveform) in one of several
// styles, coloured by the theme, a theme gradient, a rainbow or a colour of
// your own, with optional peak caps and reflection. Customised from the
// player's visualizer button or Settings → Media.
import { accent } from "../core/theme.js";
import * as settings from "../core/settings.js";

export const VIZ_STYLES = [
  ["bars", "Bars"], ["mirror", "Mirrored"], ["blocks", "LED blocks"], ["dots", "Dots"],
  ["line", "Spectrum line"], ["wave", "Waveform"], ["radial", "Radial"]
];
export const VIZ_COLORS = [["theme", "Theme colour"], ["gradient", "Theme gradient"], ["rainbow", "Rainbow"], ["custom", "Custom colour"]];
export const VIZ_KEYS = ["vizStyle", "vizBars", "vizColor", "vizCustomColor", "vizPeaks", "vizReflection", "vizSmoothing", "vizSensitivity"];

export function vizOptions() {
  return {
    style: settings.get("vizStyle") || "bars",
    bars: settings.get("vizBars") || 64,
    color: settings.get("vizColor") || "theme",
    custom: settings.get("vizCustomColor") || "#ff9a3d",
    peaks: !!settings.get("vizPeaks"),
    reflection: settings.get("vizReflection") !== false,
    smoothing: settings.get("vizSmoothing") ?? 78,
    sensitivity: settings.get("vizSensitivity") ?? 100
  };
}

function hexRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// One drawer per canvas: it keeps the falling peak caps between frames.
export function createViz() {
  let peaks = [];

  return function draw(ctx, W, H, dpr, { freq = null, wave = null, playing = false } = {}, o = vizOptions()) {
    ctx.clearRect(0, 0, W, H);
    const n = Math.max(8, o.bars | 0);
    const sens = o.sensitivity / 100;
    const [cr, cg, cb] = hexRgb(o.custom);
    const solid = (i, alpha) => {
      if (o.color === "rainbow") return `hsla(${Math.round((i / n) * 300)}, 85%, 60%, ${alpha})`;
      if (o.color === "custom") return `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
      return accent(alpha);
    };
    // Gradient: full colour at the tip, fading towards the base.
    const fill = (i, alpha, tipY, baseY) => {
      if (o.color !== "gradient") return solid(i, alpha);
      const g = ctx.createLinearGradient(0, tipY, 0, baseY);
      g.addColorStop(0, accent(alpha));
      g.addColorStop(1, accent(alpha * 0.18));
      return g;
    };

    // Bar values (0..1), spaced logarithmically (~40 Hz to ~16 kHz) so the
    // spectrum reads like a graphic equaliser instead of piling up in the bass.
    const v = new Array(n).fill(0.02);
    if (playing && freq) {
      const lo = 2, hi = Math.min(freq.length - 1, Math.round(freq.length * 0.72));
      for (let i = 0; i < n; i++) {
        const a = Math.floor(lo * Math.pow(hi / lo, i / n));
        const b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / n)));
        let peak = 0;
        for (let k = a; k < b; k++) peak = Math.max(peak, freq[k]);
        v[i] = Math.min(1, (peak / 255) * sens);
      }
    }
    if (peaks.length !== n) peaks = new Array(n).fill(0);
    for (let i = 0; i < n; i++) peaks[i] = Math.max(v[i], peaks[i] - 0.012);

    const gap = Math.max(1, (n > 96 ? 1.5 : 3) * dpr);
    const bw = Math.max(1, (W - gap * (n - 1)) / n);
    const x = (i) => i * (bw + gap);

    if (o.style === "wave") {
      const mid = H / 2;
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = o.color === "gradient" || o.color === "theme" ? accent(0.9) : solid(n / 2, 0.9);
      if (o.color === "rainbow") {
        const g = ctx.createLinearGradient(0, 0, W, 0);
        for (let s = 0; s <= 6; s++) g.addColorStop(s / 6, `hsl(${s * 50}, 85%, 60%)`);
        ctx.strokeStyle = g;
      }
      ctx.beginPath();
      if (playing && wave) {
        const step = wave.length / W;
        for (let px = 0; px < W; px += 2 * dpr) {
          const s = (wave[Math.floor(px * step)] - 128) / 128;
          const y = mid + s * mid * 0.85 * sens;
          if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
      } else {
        ctx.moveTo(0, mid);
        ctx.lineTo(W, mid);
      }
      ctx.stroke();
      if (o.reflection) {
        ctx.globalAlpha = 0.18;
        ctx.lineWidth = 6 * dpr;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      return;
    }

    if (o.style === "radial") {
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.2;
      const len = Math.min(W, H) * 0.26;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.5 * dpr, Math.min(7 * dpr, (2 * Math.PI * R) / (n * 2) * 0.6));
      for (let i = 0; i < n * 2; i++) {
        const k = i < n ? i : 2 * n - 1 - i; // mirrored all the way round
        const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
        const l = Math.max(2 * dpr, v[k] * len);
        ctx.strokeStyle = solid(k, 0.3 + v[k] * 0.7);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l));
        ctx.stroke();
        if (o.peaks) {
          ctx.fillStyle = solid(k, 0.9);
          const pr = R + Math.max(l, peaks[k] * len) + 3 * dpr;
          ctx.fillRect(cx + Math.cos(a) * pr - dpr, cy + Math.sin(a) * pr - dpr, 2 * dpr, 2 * dpr);
        }
      }
      ctx.strokeStyle = accent(0.25);
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, R - 4 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    if (o.style === "mirror") {
      const mid = H / 2;
      const max = mid * 0.9;
      for (let i = 0; i < n; i++) {
        const bh = Math.max(dpr, v[i] * max);
        ctx.fillStyle = fill(i, 0.3 + v[i] * 0.7, mid - bh, mid);
        ctx.fillRect(x(i), mid - bh, bw, bh);
        ctx.fillStyle = fill(i, 0.2 + v[i] * 0.5, mid + bh, mid);
        ctx.fillRect(x(i), mid, bw, bh);
        if (o.peaks) {
          const ph = Math.max(bh, peaks[i] * max);
          ctx.fillStyle = solid(i, 0.85);
          ctx.fillRect(x(i), mid - ph - 2 * dpr, bw, 1.5 * dpr);
          ctx.fillRect(x(i), mid + ph + 0.5 * dpr, bw, 1.5 * dpr);
        }
      }
      return;
    }

    // Bars, blocks, dots and the spectrum line stand on a baseline, with an
    // optional reflection under it.
    const base = o.reflection ? H * 0.72 : H * 0.94;
    const max = base * 0.9;
    if (o.style === "line") {
      const pts = v.map((val, i) => [x(i) + bw / 2, base - Math.max(dpr, val * max)]);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [px, py] = pts[i - 1];
          const [qx, qy] = pts[i];
          ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      };
      path();
      ctx.lineTo(W, base);
      ctx.lineTo(0, base);
      ctx.closePath();
      ctx.fillStyle = fill(n / 2, 0.22, base - max, base);
      ctx.fill();
      path();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = o.color === "rainbow" ? (() => { const g = ctx.createLinearGradient(0, 0, W, 0); for (let s = 0; s <= 6; s++) g.addColorStop(s / 6, `hsl(${s * 50}, 85%, 60%)`); return g; })() : solid(n / 2, 0.95);
      ctx.stroke();
      if (o.reflection) {
        ctx.save();
        ctx.translate(0, base * 2 + 2 * dpr);
        ctx.scale(1, -0.35);
        ctx.globalAlpha = 0.18;
        path();
        ctx.stroke();
        ctx.restore();
      }
    } else {
      const seg = 5 * dpr, segGap = 2 * dpr;
      for (let i = 0; i < n; i++) {
        const bh = Math.max(2 * dpr, v[i] * max);
        if (o.style === "blocks") {
          const count = Math.max(1, Math.round(bh / (seg + segGap)));
          for (let s = 0; s < count; s++) {
            const y = base - (s + 1) * (seg + segGap);
            ctx.fillStyle = o.color === "gradient" ? accent(0.25 + (s / Math.max(1, max / (seg + segGap))) * 0.75) : solid(i, 0.35 + v[i] * 0.65);
            ctx.fillRect(x(i), y, bw, seg);
          }
        } else if (o.style === "dots") {
          const r = Math.max(1.5 * dpr, Math.min(bw / 2, 5 * dpr));
          ctx.fillStyle = solid(i, 0.12);
          ctx.fillRect(x(i) + bw / 2 - dpr / 2, base - bh, dpr, bh);
          ctx.fillStyle = solid(i, 0.5 + v[i] * 0.5);
          ctx.beginPath();
          ctx.arc(x(i) + bw / 2, base - bh, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = fill(i, 0.25 + v[i] * 0.75, base - bh, base);
          ctx.fillRect(x(i), base - bh, bw, bh);
        }
        if (o.reflection) {
          ctx.fillStyle = solid(i, 0.12 * v[i] + 0.03);
          ctx.fillRect(x(i), base + 2 * dpr, bw, bh * 0.35);
        }
        if (o.peaks) {
          const ph = Math.max(bh, peaks[i] * max);
          ctx.fillStyle = solid(i, 0.9);
          ctx.fillRect(x(i), base - ph - 3 * dpr, bw, 2 * dpr);
        }
      }
    }
    ctx.fillStyle = accent(0.35);
    ctx.fillRect(0, base, W, dpr);
  };
}
