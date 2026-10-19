// Network lookups, clipboard history, notes and themes.
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { app, clipboard, Notification } = require("electron");
const { cached } = require("../lib/cache");
const { JsonStore } = require("../lib/store");
const { handle, asString } = require("./util");

// ── Network ─────────────────────────────────────────────────────────────────
function fetchJson(url, maxBytes = 32768) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = https.get(url, { timeout: 6000, headers: { "User-Agent": "eDEX-UI" } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return done(null); }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); return done(null); }
        chunks.push(c);
      });
      res.on("end", () => {
        try { done(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (_) { done(null); }
      });
    });
    req.on("error", () => done(null));
    req.on("timeout", () => { req.destroy(); done(null); });
  });
}

const PING_HOSTS = [
  { city: "New York", lat: 40.7, lon: -74.0, url: "https://www.nytimes.com" },
  { city: "London", lat: 51.5, lon: -0.1, url: "https://www.bbc.co.uk" },
  { city: "Frankfurt", lat: 50.1, lon: 8.7, url: "https://www.tagesschau.de" },
  { city: "Tokyo", lat: 35.7, lon: 139.7, url: "https://www.yahoo.co.jp" },
  { city: "Singapore", lat: 1.4, lon: 103.8, url: "https://www.straitstimes.com" },
  { city: "Sydney", lat: -33.9, lon: 151.2, url: "https://www.abc.net.au" },
  { city: "São Paulo", lat: -23.5, lon: -46.6, url: "https://www.globo.com" },
  { city: "Dubai", lat: 25.2, lon: 55.3, url: "https://www.du.ae" },
  { city: "Mumbai", lat: 19.1, lon: 72.9, url: "https://www.airtel.in" },
  { city: "Toronto", lat: 43.7, lon: -79.4, url: "https://www.cbc.ca" },
  { city: "Cape Town", lat: -33.9, lon: 18.4, url: "https://www.news24.com" },
  { city: "Moscow", lat: 55.8, lon: 37.6, url: "https://www.rbc.ru" }
];

// Round-trip time to a site: a HEAD request timed to the response headers.
function checkSite(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = https.request(url, { method: "HEAD", timeout: timeoutMs, headers: { "User-Agent": "eDEX-UI" } }, (res) => {
      res.resume();
      done(Number(process.hrtime.bigint() - start) / 1e6);
    });
    req.on("error", () => done(null));
    req.on("timeout", () => { req.destroy(); done(null); });
    req.end();
  });
}

function registerNetwork({ settings }) {
  const allowed = () => settings.get("allowNetworkGeolocation") !== false;

  const geo = cached(async () => {
    const a = await fetchJson("https://ipapi.co/json/");
    if (a && a.latitude != null) {
      return { lat: a.latitude, lon: a.longitude, city: a.city, region: a.region, country: a.country_name, timezone: a.timezone, org: a.org, ip: a.ip };
    }
    const b = await fetchJson("https://ipinfo.io/json");
    if (b && typeof b.loc === "string") {
      const [lat, lon] = b.loc.split(",").map(Number);
      return { lat, lon, city: b.city, region: b.region, country: b.country, timezone: b.timezone, org: b.org, ip: b.ip };
    }
    throw new Error("Geolocation lookup failed");
  }, 15 * 60 * 1000);

  const pings = cached(() => Promise.all(PING_HOSTS.map(async (h) => {
    const ms = await checkSite(h.url);
    return { city: h.city, lat: h.lat, lon: h.lon, ms: ms === null ? null : Math.round(ms) };
  })), 2 * 60 * 1000);

  const latency = cached(async () => {
    const ms = await checkSite("https://www.google.com");
    return ms === null ? null : Math.round(ms);
  }, 30000);

  // Current conditions and a short forecast from Open-Meteo (no API key),
  // for the coordinates of the public-IP lookup.
  const weather = cached(async () => {
    const g = await geo();
    const q = new URLSearchParams({
      latitude: g.lat.toFixed(3),
      longitude: g.lon.toFixed(3),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      forecast_days: "4"
    });
    const w = await fetchJson(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!w?.current) throw new Error("Weather lookup failed");
    return {
      place: [g.city, g.country].filter(Boolean).join(", "),
      current: {
        temp: w.current.temperature_2m, feels: w.current.apparent_temperature, humidity: w.current.relative_humidity_2m,
        code: w.current.weather_code, wind: w.current.wind_speed_10m, day: w.current.is_day === 1
      },
      daily: (w.daily?.time || []).map((date, i) => ({
        date, code: w.daily.weather_code[i], max: w.daily.temperature_2m_max[i], min: w.daily.temperature_2m_min[i],
        rain: w.daily.precipitation_probability_max?.[i] ?? null
      }))
    };
  }, 20 * 60 * 1000);

  handle("net:geo", () => (allowed() ? geo().catch(() => null) : null));
  handle("net:pings", () => (allowed() ? pings() : []));
  handle("net:latency", () => (allowed() ? latency() : null));
  handle("net:weather", () => (allowed() ? weather().catch(() => null) : null));
}

// ── Timer alarms ────────────────────────────────────────────────────────────
// Countdown timers are scheduled here rather than in the page: a hidden
// window's timers are throttled (up to a minute late), the main process's
// are not. When one fires, a Windows notification is shown and the
// interface is told so it can play the alarm.
function registerAlarms({ windows }) {
  const alarms = new Map(); // id -> timeout
  const fire = (id, label) => {
    alarms.delete(id);
    windows.send("alarm:fired", { id, label });
    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title: "eDEX-UI timer", body: label ? `${label} — time is up` : "Time is up", silent: false });
        n.on("click", () => windows.show());
        n.show();
      }
    } catch (_) {}
  };
  handle("alarm:set", (_e, opts = {}) => {
    const id = asString(opts.id, "alarm id", 64);
    const ms = Math.round(Number(opts.inMs));
    if (!Number.isFinite(ms) || ms < 0 || ms > 7 * 86400000) throw new Error("Invalid alarm time");
    clearTimeout(alarms.get(id));
    const label = typeof opts.label === "string" ? opts.label.slice(0, 80) : "";
    alarms.set(id, setTimeout(() => fire(id, label), ms));
    return true;
  });
  handle("alarm:clear", (_e, id) => {
    const key = asString(id, "alarm id", 64);
    clearTimeout(alarms.get(key));
    return alarms.delete(key);
  });
  return { stop() { for (const t of alarms.values()) clearTimeout(t); alarms.clear(); } };
}

// ── Clipboard history ───────────────────────────────────────────────────────
// Text only and in memory only: nothing copied is ever written to disk.
function registerClipboard({ settings, windows, bridge }) {
  let history = [];
  let last = "";
  let timer = null;
  let lastSeq = null;
  let seqSupported = true;

  const broadcast = () => windows.send("clip:changed", history);

  // The clipboard's change counter is checked first; the text is only read
  // when it moved. Reading the clipboard can block on apps that render
  // their data lazily, so it should not happen every second for nothing.
  const poll = async () => {
    if (seqSupported) {
      let seq = null;
      try { seq = await bridge.call("clipSeq", {}, 3000); } catch (_) { seqSupported = false; }
      if (seq === "0") seqSupported = false;
      else if (seq !== null) {
        if (seq === lastSeq) return;
        lastSeq = seq;
      }
    }
    let text = "";
    try { text = clipboard.readText(); } catch (_) { return; }
    if (!text || text === last || text.length > 100000) return;
    last = text;
    if (!text.trim()) return;
    history = [{ text, at: Date.now() }, ...history.filter((h) => h.text !== text)].slice(0, settings.get("clipboardMax"));
    broadcast();
  };

  const apply = () => {
    clearInterval(timer);
    timer = null;
    if (settings.get("clipboardHistory")) {
      try { last = clipboard.readText(); } catch (_) {}
      timer = setInterval(() => { poll().catch(() => {}); }, 1000);
    } else if (history.length) {
      history = [];
      broadcast();
    }
  };
  settings.on("change", (changed) => {
    if ("clipboardHistory" in changed) apply();
    if ("clipboardMax" in changed) { history = history.slice(0, changed.clipboardMax); broadcast(); }
  });
  apply();

  handle("clip:list", () => history);
  handle("clip:read", () => clipboard.readText());
  handle("clip:copy", (_e, text) => {
    const value = asString(text, "text", 100000);
    clipboard.writeText(value);
    last = value;
    history = [{ text: value, at: Date.now() }, ...history.filter((h) => h.text !== value)].slice(0, settings.get("clipboardMax"));
    broadcast();
    return true;
  });
  handle("clip:remove", (_e, text) => {
    history = history.filter((h) => h.text !== text);
    broadcast();
    return true;
  });
  handle("clip:clear", () => {
    history = [];
    broadcast();
    return true;
  });

  return { stop: () => clearInterval(timer) };
}

// ── Notes ───────────────────────────────────────────────────────────────────
function registerNotes() {
  const store = new JsonStore(path.join(app.getPath("userData"), "notes.json"), {
    fallback: { notes: [{ id: "welcome", title: "Scratchpad", body: "", updated: Date.now() }] }
  });

  handle("notes:load", () => store.data);
  handle("notes:save", (_e, data) => {
    if (!data || !Array.isArray(data.notes)) throw new Error("Invalid notes payload");
    const notes = data.notes.slice(0, 200).map((n, i) => ({
      id: typeof n.id === "string" ? n.id.slice(0, 64) : `n${Date.now()}${i}`,
      title: typeof n.title === "string" ? n.title.slice(0, 120) : "Untitled",
      body: typeof n.body === "string" ? n.body.slice(0, 1048576) : "",
      updated: Number(n.updated) || Date.now()
    }));
    store.data = { notes, active: typeof data.active === "string" ? data.active.slice(0, 64) : notes[0]?.id };
    store.save();
    return true;
  });
  return { flush: () => store.flushSync() };
}

// ── Themes ──────────────────────────────────────────────────────────────────
const VAR_KEY = /^--[a-z0-9_-]{1,48}$/i;
const BAD_VALUE = /[;{}<>]|url\s*\(|expression\s*\(|@import/i;
const HEX = /^#[0-9a-f]{3,8}$/i;
// A plain colour: hex, rgb()/rgba() or hsl()/hsla() with numeric arguments.
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\(\s*[\d.%\s,/]+\))$/i;
const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
const TERMINAL_FONTS = new Set(["Fira Mono", "Fira Code"]);
const FILTER_FUNCS = new Set(["negate", "grayscale", "lighten", "darken", "saturate", "desaturate", "whiten", "blacken", "rotate", "mix"]);

// Accepts both the original eDEX-UI theme format (colors / cssvars / terminal
// / globe) and the older `styles` variant, and returns only validated values.
function normalizeTheme(id, raw) {
  const clamp = (n) => Math.min(255, Math.max(0, Math.round(Number(n) || 0)));
  const color = (v, fallback = null) => (typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : fallback);
  let r = 0, g = 255, b = 0, black = "#000000", lightBlack = "#05080d", grey = "#262828";
  const ansi = {};
  if (raw.colors) {
    r = clamp(raw.colors.r); g = clamp(raw.colors.g); b = clamp(raw.colors.b);
    if (HEX.test(raw.colors.black || "")) black = raw.colors.black;
    if (HEX.test(raw.colors.light_black || "")) lightBlack = raw.colors.light_black;
    if (HEX.test(raw.colors.grey || "")) grey = raw.colors.grey;
    // Only explicit ANSI palettes; `black` doubles as a background shade in
    // most themes, so it counts as a palette entry only when `red` is set too.
    if (raw.colors.red) for (const name of ANSI) { const c = color(raw.colors[name]); if (c) ansi[name] = c; }
  } else if (raw.styles) {
    r = clamp(raw.styles["--color_r"]); g = clamp(raw.styles["--color_g"]); b = clamp(raw.styles["--color_b"]);
    if (HEX.test(raw.styles["--color_light_black"] || "")) lightBlack = raw.styles["--color_light_black"];
    if (HEX.test(raw.styles["--color_grey"] || "")) grey = raw.styles["--color_grey"];
  }
  const accentHex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

  const t = raw.terminal && typeof raw.terminal === "object" ? raw.terminal : {};
  const terminal = {
    foreground: color(t.foreground),
    background: color(t.background),
    cursor: color(t.cursor),
    cursorAccent: color(t.cursorAccent),
    selectionBackground: color(t.selection) || color(t.selectionBackground),
    cursorStyle: ["block", "bar", "underline"].includes(t.cursorStyle) ? t.cursorStyle : null,
    fontFamily: TERMINAL_FONTS.has(t.fontFamily) ? t.fontFamily : null
  };
  const colorFilter = [];
  if (Array.isArray(t.colorFilter)) {
    for (const step of t.colorFilter.slice(0, 12)) {
      const m = /^([a-z]+)\(\s*(-?[\d.]*)\s*\)$/i.exec(String(step));
      if (!m || !FILTER_FUNCS.has(m[1])) continue;
      colorFilter.push({ func: m[1], arg: m[2] === "" ? null : Number(m[2]) });
    }
  }

  const gl = raw.globe && typeof raw.globe === "object" ? raw.globe : {};
  const globe = {
    base: color(gl.base, "#000000"),
    marker: color(gl.marker, accentHex),
    pin: color(gl.pin, accentHex),
    satellite: color(gl.satellite, accentHex)
  };

  const extra = {};
  if (raw.styles) {
    for (const [k, v] of Object.entries(raw.styles)) {
      const s = String(v);
      if (VAR_KEY.test(k) && s.length <= 128 && !BAD_VALUE.test(s)) extra[k] = s;
    }
  }
  return {
    id,
    name: typeof raw.name === "string" ? raw.name.slice(0, 64) : id,
    author: typeof raw.author === "string" ? raw.author.slice(0, 64) : "",
    description: typeof raw.description === "string" ? raw.description.slice(0, 256) : "",
    rgb: [r, g, b],
    black, lightBlack, grey,
    ansi,
    terminal,
    colorFilter,
    globe,
    extra
  };
}

function registerThemes() {
  const builtinDir = path.join(__dirname, "..", "..", "..", "themes");
  const userDir = path.join(app.getPath("userData"), "themes");

  const catalog = cached(async () => {
    const out = new Map();
    for (const [dir, custom] of [[builtinDir, false], [userDir, true]]) {
      let files = [];
      try { files = await fs.promises.readdir(dir); } catch (_) { continue; }
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const id = f.slice(0, -5);
        if (out.has(id)) continue;
        try {
          const raw = JSON.parse((await fs.promises.readFile(path.join(dir, f), "utf8")).replace(/^﻿/, ""));
          out.set(id, { ...normalizeTheme(id, raw), custom });
        } catch (e) {
          console.warn(`[themes] skipping ${f}: ${e.message}`);
        }
      }
    }
    return out;
  }, 60000);

  handle("themes:list", async () => [...(await catalog()).values()]
    .map(({ id, name, author, rgb, custom }) => ({ id, name, author, rgb, custom }))
    .sort((a, b) => a.name.localeCompare(b.name)));

  handle("themes:get", async (_e, id) => (await catalog()).get(id) || (await catalog()).get("tron") || null);

  handle("themes:save", async (_e, name, theme) => {
    const safeName = String(name || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 48);
    if (!safeName) throw new Error("Theme name is required");
    const id = `custom-${safeName.toLowerCase().replace(/\s+/g, "-")}`;
    const t = theme && typeof theme === "object" ? theme : {};
    const clamp = (n) => Math.min(255, Math.max(0, Math.round(Number(n) || 0)));
    const rgb = Array.isArray(t.rgb) ? t.rgb.map(clamp) : [0, 255, 0];
    const hex = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const lightBlack = HEX.test(t.lightBlack || "") ? t.lightBlack : "#05080d";
    const out = {
      name: safeName,
      author: "You",
      colors: {
        r: rgb[0], g: rgb[1], b: rgb[2],
        black: HEX.test(t.black || "") ? t.black : "#000000",
        light_black: lightBlack,
        grey: HEX.test(t.grey || "") ? t.grey : "#262828"
      },
      cssvars: { font_main: "United Sans Medium", font_main_light: "United Sans Light" },
      terminal: {
        fontFamily: "Fira Mono", cursorStyle: "block", foreground: hex, background: lightBlack,
        cursor: hex, cursorAccent: hex, selection: `rgba(${rgb.join(",")},0.3)`
      },
      globe: { base: "#000000", marker: hex, pin: hex, satellite: hex }
    };
    await fs.promises.mkdir(userDir, { recursive: true });
    await fs.promises.writeFile(path.join(userDir, `${id}.json`), JSON.stringify(out, null, 2), "utf8");
    catalog.invalidate();
    return id;
  });
}

module.exports = { registerNetwork, registerClipboard, registerNotes, registerThemes, registerAlarms, normalizeTheme };
