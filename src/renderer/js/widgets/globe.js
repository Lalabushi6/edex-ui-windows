// World view: the original eDEX-UI ENCOM globe (hex-tile continents, orbiting
// satellites, pins and connected markers) showing your approximate location
// and links to reference cities with their latency. Falls back to a light
// canvas point-cloud globe when WebGL is unavailable.
import { h, setText } from "../core/dom.js";
import { poll, appActive, animationFps, onSchedulingChange, profile } from "../core/poll.js";
import { onLive } from "../core/live.js";
import { accent, accentHex, currentTheme } from "../core/theme.js";
import { on, booted } from "../core/bus.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { defineWidget } from "./registry.js";

const api = window.edex;
const RAD = Math.PI / 180;

// ── ENCOM loader ────────────────────────────────────────────────────────────
let encomPromise = null;
let tilesPromise = null;

function loadEncom() {
  encomPromise ||= new Promise((resolve, reject) => {
    if (window.ENCOM?.Globe) { resolve(window.ENCOM); return; }
    const script = document.createElement("script");
    script.src = "lib/encom-globe.js";
    script.onload = () => (window.ENCOM?.Globe ? resolve(window.ENCOM) : reject(new Error("ENCOM globe did not register")));
    script.onerror = () => reject(new Error("ENCOM globe failed to load"));
    document.head.append(script);
  });
  return encomPromise;
}

function loadTiles() {
  tilesPromise ||= fetch("assets/misc/grid.json").then((r) => r.json()).then((d) => d.tiles);
  return tilesPromise;
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch (_) {
    return false;
  }
}

function measured(el) {
  return new Promise((resolve) => {
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20) { ro.disconnect(); resolve({ w: Math.round(r.width), h: Math.round(r.height) }); }
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
  });
}

async function createEncomGlobe(stage) {
  if (!webglAvailable()) throw new Error("WebGL unavailable");
  const [ENCOM, tiles] = await Promise.all([loadEncom(), loadTiles()]);
  const { w, h: height } = await measured(stage);
  const theme = currentTheme();
  const colors = theme.globe || {};
  const acc = accentHex();
  const globe = new ENCOM.Globe(w, height, {
    font: "United Sans",
    data: [],
    tiles,
    baseColor: colors.base || acc,
    markerColor: colors.marker || acc,
    pinColor: colors.pin || acc,
    satelliteColor: colors.satellite || acc,
    scale: 1.1,
    viewAngle: 0.63,
    dayLength: 45000,
    introLinesDuration: 2000,
    introLinesColor: colors.marker || acc,
    maxPins: 300,
    maxMarkers: 100
  });
  // three r66 fixes the pixel ratio at construction; render crisply on HiDPI,
  // but never above 2x (and 1x in Eco), which quadruples the fill cost.
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, profile().name === "eco" ? 1 : 2);
  globe.renderer.devicePixelRatio = pixelRatio();
  globe.renderer.setSize(w, height);
  stage.prepend(globe.domElement);

  let running = false;
  let destroyed = false;
  let visible = true;
  let timer = null;
  let pending = null;

  const loop = () => {
    timer = null;
    if (destroyed) return;
    try { globe.tick(); } catch (e) { console.warn("globe tick", e); }
    schedule();
  };
  // Frame rate follows the performance profile and drops while eDEX is in
  // the background; the loop stops entirely when hidden or scrolled away.
  function schedule() {
    if (timer || destroyed || !running || !visible || !appActive()) return;
    timer = setTimeout(() => requestAnimationFrame(loop), 1000 / animationFps(30));
  }

  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); });
  io.observe(stage);
  const resize = () => {
    const r = stage.getBoundingClientRect();
    if (!globe.camera || r.width < 20 || r.height < 20) return;
    globe.width = r.width;
    globe.height = r.height;
    globe.camera.aspect = r.width / r.height;
    globe.camera.updateProjectionMatrix();
    globe.renderer.setSize(r.width, r.height);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  const offSched = onSchedulingChange(() => {
    const ratio = pixelRatio();
    if (globe.renderer.devicePixelRatio !== ratio) { globe.renderer.devicePixelRatio = ratio; resize(); }
    schedule();
  });

  // ENCOM's marker removal animates connected splines back in and breaks if
  // a marker is removed while still drawing, so markers are only rebuilt
  // when the location or the set of reachable cities actually changes, and
  // child markers go before the one they connect to.
  let signature = "";
  const apply = (geo, cities) => {
    const next = geo ? `${geo.lat},${geo.lon}|${cities.filter((c) => c.ms !== null).map((c) => c.city).join(",")}` : "";
    if (next === signature) return;
    signature = next;
    globe.pins.forEach((p) => p.remove());
    globe.pins = [];
    for (let i = globe.markers.length - 1; i >= 0; i--) {
      try { globe.markers[i].remove(); } catch (_) {}
    }
    globe.markers = [];
    if (!geo) return;
    globe.addPin(geo.lat, geo.lon, "", 1.2);
    const home = globe.addMarker(geo.lat, geo.lon, "", false, 1.2);
    for (const c of cities) {
      if (c.ms === null) continue;
      globe.addPin(c.lat, c.lon, "", 1.1 + Math.min(0.15, c.ms / 4000));
      globe.addMarker(c.lat, c.lon, "", home, 1.2);
    }
  };

  globe.init(theme.lightBlack, () => {
    if (destroyed) return;
    running = true;
    schedule();
    sfx.play("scan");
  });
  // Same constellation layout as eDEX-UI: two staggered rings of three.
  const constellation = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 3; j++) {
      constellation.push({ lat: 50 * i - 30 + 15 * Math.random(), lon: 120 * j - 120 + 30 * i, altitude: Math.random() * 0.4 + 1.3 });
    }
  }
  globe.addConstellation(constellation);
  if (pending) apply(...pending);

  return {
    kind: "encom",
    setData(geo, cities) {
      if (!globe.scene) { pending = [geo, cities]; return; }
      apply(geo, cities);
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      io.disconnect();
      ro.disconnect();
      offSched();
      // Release the WebGL context now rather than waiting for GC; Chromium
      // caps live contexts and theme switches rebuild the globe.
      try {
        const gl = globe.domElement.getContext("webgl") || globe.domElement.getContext("experimental-webgl");
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch (_) {}
      globe.domElement.remove();
    }
  };
}

// ── Fallback: canvas point cloud ────────────────────────────────────────────
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

function createPointCloudGlobe(stage) {
  const canvas = h("canvas");
  stage.prepend(canvas);
  const ctx = canvas.getContext("2d");
  let geo = null;
  let cities = [];
  let rotation = 0;
  let timer = null;
  let visible = true;
  let destroyed = false;
  let W = 0, H = 0, dpr = 1;
  const cosT = Math.cos(-0.32), sinT = Math.sin(-0.32);
  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    W = canvas.width = Math.round(r.width * dpr);
    H = canvas.height = Math.round(r.height * dpr);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule(); });
  io.observe(canvas);
  const project = (v, R, cx, cy) => {
    const cr = Math.cos(rotation), sr = Math.sin(rotation);
    const x = v[0] * cr + v[2] * sr;
    const z0 = -v[0] * sr + v[2] * cr;
    return [cx + x * R, cy - (v[1] * cosT - z0 * sinT) * R, v[1] * sinT + z0 * cosT];
  };
  const draw = () => {
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.44, cx = W / 2, cy = H / 2, s = 1.3 * dpr;
    for (const v of CLOUD) {
      const [x, y, z] = project(v, R, cx, cy);
      if (z <= 0) continue;
      ctx.fillStyle = accent(0.15 + z * 0.6);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    const marks = [...cities.filter((c) => c.ms !== null), ...(geo ? [{ lat: geo.lat, lon: geo.lon, home: true }] : [])];
    for (const c of marks) {
      const [x, y, z] = project(unit(c.lat, c.lon), R, cx, cy);
      if (z <= 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, (c.home ? 3.4 : 2.2) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = accent(c.home ? 1 : 0.7);
      ctx.fill();
    }
  };
  let last = performance.now();
  const frame = () => {
    timer = null;
    const now = performance.now();
    rotation += ((now - last) / 45000) * Math.PI * 2;
    last = now;
    draw();
    schedule();
  };
  function schedule() {
    if (timer || destroyed || !visible || !appActive()) return;
    timer = setTimeout(() => requestAnimationFrame(frame), 1000 / animationFps(20));
  }
  const offSched = onSchedulingChange(() => { last = performance.now(); schedule(); });
  const offTheme = on("theme", draw);
  schedule();
  return {
    kind: "canvas",
    setData(g, c) { geo = g; cities = c; draw(); },
    destroy() { destroyed = true; clearTimeout(timer); ro.disconnect(); io.disconnect(); offSched(); offTheme(); canvas.remove(); }
  };
}

// ── Widget ──────────────────────────────────────────────────────────────────
defineWidget({
  id: "globe",
  order: 2,
  title: "World View",
  column: "right",
  create(panel) {
    const coords = h("span", { class: "v" }, "0.0000, 0.0000");
    const offline = h("div", { class: "globe-offline" }, "OFFLINE");
    const stage = h("div", { class: "globe-stage" }, offline);
    const refs = {};
    const info = h("div", { class: "globe-info" });
    for (const [k, label] of [["loc", "Location"], ["ip", "Public IP"], ["org", "Provider"], ["peers", "Peers"]]) {
      refs[k] = h("span", { class: "v" }, "--");
      info.append(h("div", null, h("span", { class: "label" }, label), refs[k]));
    }
    panel.setSub("GLOBAL NETWORK MAP");
    panel.body.append(h("div", { class: "globe-endpoint" }, h("span", null, "ENDPOINT LAT/LON"), coords), stage, info);

    let geo = null;
    let cities = [];
    let engine = null;
    let building = null;
    let disposed = false;

    const build = () => {
      building = (async () => {
        engine?.destroy();
        engine = null;
        try {
          engine = await createEncomGlobe(stage);
        } catch (e) {
          console.warn("ENCOM globe unavailable, using canvas fallback:", e.message);
          engine = createPointCloudGlobe(stage);
        }
        if (disposed) { engine.destroy(); return; }
        engine.setData(geo, cities);
      })();
      return building;
    };
    // Building the hex-tile globe is the single heaviest thing the interface
    // does (~200 ms of main-thread work), so it waits until the boot sequence
    // has finished and the page is idle.
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    building = booted.then(() => new Promise((resolve) => idle(resolve, { timeout: 2000 })))
      .then(() => (disposed ? null : build()));

    // The original rebuilt the globe on theme change; colours are baked into
    // its textures, so do the same.
    let themeTimer = null;
    const offTheme = on("theme", (t) => {
      // Live edits in the theme editor skip the (heavy) rebuild until saved.
      if (t?.preview) return;
      clearTimeout(themeTimer);
      themeTimer = setTimeout(() => building.then(build), 150);
    });
    const offNet = onLive(({ net: n }) => stage.classList.toggle("offline", !n.online));

    const lookups = poll(async () => {
      if (!settings.get("allowNetworkGeolocation")) {
        geo = null;
        cities = [];
        setText(coords, "(LOOKUPS OFF)");
        for (const k of Object.keys(refs)) setText(refs[k], "--");
        setText(refs.loc, "Lookups disabled");
        engine?.setData(null, []);
        return;
      }
      geo = await api.net.geo();
      if (geo) {
        setText(coords, `${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}`);
        setText(refs.loc, [geo.city, geo.country].filter(Boolean).join(", "));
        setText(refs.ip, geo.ip || "--");
        setText(refs.org, geo.org || "--");
        refs.org.title = geo.org || "";
      } else {
        setText(coords, "UNKNOWN");
        setText(refs.loc, "Unavailable");
      }
      cities = await api.net.pings();
      const ok = cities.filter((c) => c.ms !== null);
      const avg = ok.length ? Math.round(ok.reduce((a, c) => a + c.ms, 0) / ok.length) : null;
      setText(refs.peers, `${ok.length}/${cities.length}${avg !== null ? ` · ${avg} ms` : ""}`);
      refs.peers.title = cities.map((c) => `${c.city}: ${c.ms === null ? "timeout" : `${Math.round(c.ms)} ms`}`).join("\n");
      engine?.setData(geo, cities);
    }, 120000);
    const unwatch = settings.watch("allowNetworkGeolocation", () => lookups.kick());

    return {
      destroy() {
        disposed = true;
        clearTimeout(themeTimer);
        offTheme();
        offNet();
        lookups.stop();
        unwatch();
        engine?.destroy();
      }
    };
  }
});
