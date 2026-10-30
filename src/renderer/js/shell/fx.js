// Ambient canvas effects in the theme colour: matrix rain, a pulsing hex
// grid, a starfield and a wireframe globe. Used by the idle screen and as an
// optional animated background behind the panels. Frame rate follows the
// performance profile and drawing stops while eDEX isn't on screen.
import { accent } from "../core/theme.js";
import { animationFps, appActive } from "../core/poll.js";
import * as settings from "../core/settings.js";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF<>/=+*";

function matrix(ctx, W, H, dpr) {
  const size = Math.round(15 * dpr);
  const cols = Math.ceil(W / size);
  const drops = Array.from({ length: cols }, () => Math.random() * -H / size);
  const speed = Array.from({ length: cols }, () => 0.35 + Math.random() * 0.65);
  ctx.font = `${size}px "Fira Mono", monospace`;
  return () => {
    // Fade what's there (keeps the canvas transparent over the backdrop).
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.11)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < cols; i++) {
      const y = drops[i] * size;
      if (y > 0) {
        ctx.fillStyle = accent(0.95);
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * size, y);
      }
      drops[i] += speed[i];
      if (y > H && Math.random() > 0.975) drops[i] = Math.random() * -20;
    }
  };
}

function hex(ctx, W, H, dpr) {
  const r = 22 * dpr;
  const w = Math.sqrt(3) * r;
  const cells = [];
  for (let row = -1, y = 0; y < H + r * 2; row++, y = row * r * 1.5) {
    for (let x = row % 2 ? w / 2 : 0; x < W + w; x += w) cells.push({ x, y, phase: Math.random() * Math.PI * 2, rate: 0.4 + Math.random() * 1.2 });
  }
  const path = (cx, cy, rr) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + k * Math.PI / 3;
      ctx[k ? "lineTo" : "moveTo"](cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    ctx.closePath();
  };
  let t = 0;
  return () => {
    t += 0.03;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = dpr;
    for (const c of cells) {
      const v = Math.max(0, Math.sin(t * c.rate + c.phase));
      path(c.x, c.y, r * 0.92);
      ctx.strokeStyle = accent(0.08 + v * 0.35);
      ctx.stroke();
      if (v > 0.93) { ctx.fillStyle = accent((v - 0.93) * 3); ctx.fill(); }
    }
  };
}

function stars(ctx, W, H) {
  const N = Math.min(700, Math.round((W * H) / 4000));
  const make = () => ({ x: (Math.random() - 0.5) * W, y: (Math.random() - 0.5) * H, z: Math.random() * W });
  const list = Array.from({ length: N }, make);
  return () => {
    ctx.clearRect(0, 0, W, H);
    for (const s of list) {
      s.z -= W * 0.006;
      if (s.z <= 1) Object.assign(s, make(), { z: W });
      const k = (W * 0.5) / s.z;
      const x = W / 2 + s.x * k, y = H / 2 + s.y * k;
      if (x < 0 || x > W || y < 0 || y > H) continue;
      const size = Math.max(0.6, (1 - s.z / W) * 3);
      ctx.fillStyle = accent(Math.min(1, 1.2 - s.z / W));
      ctx.fillRect(x, y, size, size);
    }
  };
}

function globe(ctx, W, H, dpr) {
  const pts = [];
  for (let lat = -80; lat <= 80; lat += 10) {
    const step = 360 / Math.max(6, Math.round(36 * Math.cos((lat * Math.PI) / 180)));
    for (let lon = 0; lon < 360; lon += step) pts.push([(lat * Math.PI) / 180, (lon * Math.PI) / 180]);
  }
  let rot = 0;
  return () => {
    rot += 0.004;
    ctx.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.32;
    const cx = W / 2, cy = H / 2;
    const tilt = 0.35;
    for (const [lat, lon] of pts) {
      const x = Math.cos(lat) * Math.sin(lon + rot);
      let y = Math.sin(lat);
      let z = Math.cos(lat) * Math.cos(lon + rot);
      const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
      z = y * Math.sin(tilt) + z * Math.cos(tilt);
      y = y2;
      const front = z > 0;
      ctx.fillStyle = accent(front ? 0.35 + z * 0.65 : 0.08);
      const s = (front ? 2.2 : 1.2) * dpr;
      ctx.fillRect(cx + x * R - s / 2, cy - y * R - s / 2, s, s);
    }
    ctx.strokeStyle = accent(0.25);
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
    ctx.stroke();
  };
}

const EFFECTS = { matrix, hex, stars, globe };

// Runs an effect on a canvas until stop(); resizes with the element.
export function startEffect(canvas, kind, { maxFps = 24, scale = 1 } = {}) {
  const make = EFFECTS[kind] || matrix;
  const ctx = canvas.getContext("2d");
  let step = null;
  let timer = null;
  let stopped = false;
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    step = make(ctx, canvas.width, canvas.height, dpr);
  };
  const frame = () => {
    timer = null;
    if (stopped) return;
    if (appActive()) step?.();
    timer = setTimeout(() => requestAnimationFrame(frame), 1000 / animationFps(maxFps));
  };
  const ro = new ResizeObserver(() => size());
  ro.observe(canvas);
  size();
  frame();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      ro.disconnect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };
}

// One frame of an effect per call, with no timer or pausing (the benchmark
// times how long drawing takes on this PC).
export function effectStepper(canvas, kind, { scale = 1 } = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  return (EFFECTS[kind] || matrix)(ctx, canvas.width, canvas.height, dpr);
}

// Optional animated background behind the panels (Settings → Appearance).
export function initBackgroundFx() {
  let canvas = null;
  let fx = null;
  const apply = () => {
    const kind = settings.get("backgroundFx") || "none";
    fx?.stop();
    fx = null;
    if (kind === "none") { canvas?.remove(); canvas = null; return; }
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "bgfx";
      canvas.setAttribute("aria-hidden", "true");
      document.body.prepend(canvas);
    }
    // Half resolution and a low frame rate: it's decoration.
    fx = startEffect(canvas, kind, { maxFps: 15, scale: 0.6 });
  };
  settings.watch("backgroundFx", apply);
  apply();
}
