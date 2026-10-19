// World view: a rotating point-cloud globe with your approximate location and
// latency to reference cities. Renders at ~20 fps only while on screen.
import { h, setText } from "../core/dom.js";
import { poll, appActive } from "../core/poll.js";
import { accent } from "../core/theme.js";
import * as settings from "../core/settings.js";
import { defineWidget } from "./registry.js";

const api = window.edex;
const RAD = Math.PI / 180;

function unit(lat, lon) {
  const p = lat * RAD, l = lon * RAD;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

const CLOUD = (() => {
  const pts = [];
  for (let lat = -78; lat <= 78; lat += 6) {
    const n = Math.max(8, Math.round(60 * Math.cos(lat * RAD)));
    for (let i = 0; i < n; i++) pts.push(unit(lat, (i / n) * 360 - 180));
  }
  return pts;
})();

const GRATICULE = (() => {
  const lines = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    const line = [];
    for (let lon = -180; lon <= 180; lon += 4) line.push(unit(lat, lon));
    lines.push(line);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const line = [];
    for (let lat = -84; lat <= 84; lat += 4) line.push(unit(lat, lon));
    lines.push(line);
  }
  return lines;
})();

function slerp(a, b, t) {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-4) return a;
  const s = Math.sin(omega);
  const k1 = Math.sin((1 - t) * omega) / s, k2 = Math.sin(t * omega) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}

defineWidget({
  id: "globe",
  order: 2,
  title: "World View",
  column: "right",
  create(panel) {
    const canvas = h("canvas", { class: "globe-canvas" });
    const refs = {};
    const info = h("div", { class: "globe-info" });
    for (const [k, label] of [["loc", "Location"], ["ip", "Public IP"], ["org", "Provider"], ["peers", "Peers"]]) {
      refs[k] = h("span", { class: "v" }, "--");
      info.append(h("div", null, h("span", { class: "label" }, label), refs[k]));
    }
    panel.body.append(h("div", { class: "globe-wrap" }, canvas), info);
    const ctx = canvas.getContext("2d");
    let geo = null;
    let cities = [];
    let rotation = 0;
    let visible = true;
    let timer = null;
    let W = 0, H = 0, dpr = 1;
    const tilt = -0.32;
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      W = canvas.width = Math.round(r.width * dpr);
      H = canvas.height = Math.round(r.height * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); });
    io.observe(canvas);

    const project = (v, R, cx, cy) => {
      const cr = Math.cos(rotation), sr = Math.sin(rotation);
      const x = v[0] * cr + v[2] * sr;
      const z0 = -v[0] * sr + v[2] * cr;
      const y = v[1] * cosT - z0 * sinT;
      const z = v[1] * sinT + z0 * cosT;
      return [cx + x * R, cy - y * R, z];
    };

    const draw = (t) => {
      if (!W || !H) return;
      ctx.clearRect(0, 0, W, H);
      const R = Math.min(W, H) * 0.44;
      const cx = W / 2, cy = H / 2;

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = accent(0.35);
      ctx.lineWidth = dpr;
      ctx.stroke();
      const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.08);
      glow.addColorStop(0, accent(0));
      glow.addColorStop(1, accent(0.08));
      ctx.fillStyle = glow;
      ctx.fill();

      ctx.strokeStyle = accent(0.13);
      for (const line of GRATICULE) {
        ctx.beginPath();
        let pen = false;
        for (const v of line) {
          const [x, y, z] = project(v, R, cx, cy);
          if (z > 0) { pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; } else pen = false;
        }
        ctx.stroke();
      }

      const s = 1.3 * dpr;
      for (const v of CLOUD) {
        const [x, y, z] = project(v, R, cx, cy);
        if (z <= 0) continue;
        ctx.fillStyle = accent(0.15 + z * 0.6);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }

      const home = geo ? unit(geo.lat, geo.lon) : null;
      if (home) {
        for (const c of cities) {
          if (c.ms === null) continue;
          const target = unit(c.lat, c.lon);
          ctx.beginPath();
          let pen = false;
          for (let i = 0; i <= 32; i++) {
            const k = i / 32;
            const p = slerp(home, target, k);
            const lift = 1 + 0.12 * Math.sin(Math.PI * k);
            const [x, y, z] = project([p[0] * lift, p[1] * lift, p[2] * lift], R, cx, cy);
            if (z > -0.05) { pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; } else pen = false;
          }
          ctx.strokeStyle = accent(c.ms < 120 ? 0.5 : 0.22);
          ctx.lineWidth = dpr;
          ctx.stroke();
        }
      }
      for (const c of cities) {
        const [x, y, z] = project(unit(c.lat, c.lon), R, cx, cy);
        if (z <= 0) continue;
        ctx.beginPath();
        ctx.arc(x, y, 2.4 * dpr, 0, Math.PI * 2);
        if (c.ms === null) { ctx.strokeStyle = accent(0.4); ctx.stroke(); }
        else { ctx.fillStyle = accent(c.ms < 120 ? 1 : c.ms < 300 ? 0.7 : 0.4); ctx.fill(); }
      }
      if (home) {
        const [x, y, z] = project(home, R, cx, cy);
        if (z > 0) {
          const pulse = (t / 1600) % 1;
          ctx.beginPath();
          ctx.arc(x, y, (3 + pulse * 12) * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = accent(0.8 * (1 - pulse));
          ctx.lineWidth = 1.2 * dpr;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 3.2 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = accent(1);
          ctx.fill();
        }
      }
    };

    let last = performance.now();
    const frame = () => {
      timer = null;
      const now = performance.now();
      rotation += ((now - last) / 60000) * Math.PI * 2;
      last = now;
      draw(now);
      schedule();
    };
    function schedule() {
      if (timer || !visible || !appActive()) return;
      timer = setTimeout(() => requestAnimationFrame(frame), 50);
    }
    // Resume after the window was hidden.
    const wake = poll(() => { last = performance.now(); schedule(); }, 2000);

    const lookups = poll(async () => {
      if (!settings.get("allowNetworkGeolocation")) {
        geo = null;
        cities = [];
        setText(refs.loc, "Lookups disabled");
        setText(refs.ip, "--");
        setText(refs.org, "--");
        setText(refs.peers, "--");
        panel.setSub("OFFLINE MODE");
        return;
      }
      geo = await api.net.geo();
      if (geo) {
        setText(refs.loc, [geo.city, geo.country].filter(Boolean).join(", "));
        setText(refs.ip, geo.ip || "--");
        setText(refs.org, geo.org || "--");
        refs.org.title = geo.org || "";
        panel.setSub(`${geo.lat.toFixed(2)}, ${geo.lon.toFixed(2)}`);
      } else {
        setText(refs.loc, "Unavailable");
      }
      cities = await api.net.pings();
      const ok = cities.filter((c) => c.ms !== null);
      const avg = ok.length ? Math.round(ok.reduce((a, c) => a + c.ms, 0) / ok.length) : null;
      setText(refs.peers, `${ok.length}/${cities.length}${avg !== null ? ` · ${avg} ms` : ""}`);
      refs.peers.title = cities.map((c) => `${c.city}: ${c.ms === null ? "timeout" : `${Math.round(c.ms)} ms`}`).join("\n");
    }, 120000);
    const unwatch = settings.watch("allowNetworkGeolocation", () => lookups.kick());

    schedule();
    return {
      destroy() {
        clearTimeout(timer);
        ro.disconnect();
        io.disconnect();
        wake.stop();
        lookups.stop();
        unwatch();
      }
    };
  }
});
