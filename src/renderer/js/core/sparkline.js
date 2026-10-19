// Lightweight canvas time-series chart (replaces smoothie.js).
import { accent } from "./theme.js";
import { on } from "./bus.js";

export class Sparkline {
  constructor(canvas, { points = 60, min = 0, max = null, series = 1, mirror = false, fill = true, floor = 1 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.points = points;
    this.min = min;
    this.max = max;
    this.floor = floor;
    this.mirror = mirror;
    this.fill = fill;
    this.data = Array.from({ length: series }, () => new Array(points).fill(0));
    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.offTheme = on("theme", () => this.draw());
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.draw();
  }

  push(...values) {
    values.forEach((v, i) => {
      const s = this.data[i];
      if (!s) return;
      s.push(Number.isFinite(v) ? v : 0);
      if (s.length > this.points) s.shift();
    });
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const peak = this.max ?? Math.max(this.floor, ...this.data.flat()) * 1.15;
    const dpr = window.devicePixelRatio || 1;

    ctx.strokeStyle = accent(0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = Math.round((H / 4) * i) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    this.data.forEach((series, idx) => {
      const up = !this.mirror || idx === 0;
      const base = this.mirror ? H / 2 : H;
      const span = this.mirror ? H / 2 - 2 : H - 2;
      const step = W / (this.points - 1);
      ctx.beginPath();
      series.forEach((v, i) => {
        const norm = Math.min(1, Math.max(0, (v - this.min) / (peak - this.min || 1)));
        const y = up ? base - norm * span : base + norm * span;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * step, y);
      });
      const alpha = idx === 0 ? 1 : 0.55;
      ctx.strokeStyle = accent(alpha);
      ctx.lineWidth = 1.4 * dpr;
      ctx.stroke();
      if (this.fill) {
        ctx.lineTo(W, base);
        ctx.lineTo(0, base);
        ctx.closePath();
        ctx.fillStyle = accent(idx === 0 ? 0.12 : 0.07);
        ctx.fill();
      }
    });
    if (this.mirror) {
      ctx.strokeStyle = accent(0.35);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(H / 2) + 0.5);
      ctx.lineTo(W, Math.round(H / 2) + 0.5);
      ctx.stroke();
    }
  }

  destroy() {
    this.observer.disconnect();
    this.offTheme();
  }
}
