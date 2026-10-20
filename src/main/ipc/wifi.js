// Wi-Fi: nearby networks, the current connection, saved profiles, connect /
// disconnect, via Windows' own `netsh wlan`. Runs only when the panel asks.
"use strict";

const { execFile } = require("child_process");
const { cached } = require("../lib/cache");
const { handle, asString } = require("./util");

// Listing commands go through cmd with code page 65001 so network names
// with non-ASCII characters come back as UTF-8. Only fixed strings are used.
function netshList(args) {
  return new Promise((resolve) => {
    execFile("cmd.exe", ["/d", "/c", `chcp 65001>nul&netsh ${args}`], { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || "") });
    });
  });
}

// User-supplied values never pass through a shell.
function netsh(args) {
  return new Promise((resolve) => {
    execFile("netsh.exe", args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout || ""}${stderr || ""}`.trim() });
    });
  });
}

const kv = (line) => {
  const i = line.indexOf(":");
  return i < 0 ? null : [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
};
const percent = (s) => { const m = /(\d{1,3})\s*%/.exec(s || ""); return m ? Math.min(100, Number(m[1])) : null; };
const OPEN_AUTH = /^(open|offen|ouvert|abierta|aperto|aberto|otwarte)$/i;

function parseInterfaces(out) {
  const iface = { connected: false, ssid: null, signal: null, auth: null, band: null, rate: null, name: null };
  for (const raw of out.split(/\r?\n/)) {
    const p = kv(raw);
    if (!p) continue;
    const [k, v] = p;
    if (k === "name" && !iface.name) iface.name = v;
    else if (k === "ssid") { iface.ssid = v; iface.connected = !!v; }
    else if (k.startsWith("signal")) iface.signal = percent(v);
    else if (k.startsWith("authentication")) iface.auth = v;
    else if (k === "band") iface.band = v;
    else if (k.startsWith("receive rate")) iface.rate = Number(v) || null;
  }
  return iface;
}

function parseNetworks(out) {
  const nets = [];
  let cur = null;
  for (const raw of out.split(/\r?\n/)) {
    const head = /^SSID\s+\d+\s*:\s*(.*)$/.exec(raw.trim());
    if (head) {
      cur = { ssid: head[1].trim(), signal: null, auth: null, secure: true, bssids: 0 };
      if (cur.ssid) nets.push(cur);
      continue;
    }
    if (!cur) continue;
    const p = kv(raw);
    if (!p) continue;
    const [k, v] = p;
    if (k.startsWith("authentication") || k.startsWith("authentifizierung") || k.startsWith("authentification")) {
      cur.auth = v;
      cur.secure = !OPEN_AUTH.test(v);
    } else if (/^bssid\s+\d+/.test(k)) cur.bssids++;
    else if (percent(v) !== null && /signal/i.test(k)) cur.signal = Math.max(cur.signal ?? 0, percent(v));
  }
  // The same name can appear once per radio; keep the strongest.
  const best = new Map();
  for (const n of nets) if (!best.has(n.ssid) || (n.signal ?? 0) > (best.get(n.ssid).signal ?? 0)) best.set(n.ssid, n);
  return [...best.values()].sort((a, b) => (b.signal ?? 0) - (a.signal ?? 0));
}

function parseProfiles(out) {
  const names = [];
  let started = false;
  for (const raw of out.split(/\r?\n/)) {
    if (/^-{3,}/.test(raw.trim())) { started = true; continue; }
    if (!started) continue;
    const p = kv(raw);
    if (p && p[1]) names.push(p[1]);
  }
  return names;
}

function registerWifi() {
  const status = cached(async () => {
    const [ifs, nets, profs] = await Promise.all([
      netshList("wlan show interfaces"),
      netshList("wlan show networks mode=bssid"),
      netshList("wlan show profiles")
    ]);
    if (/no wireless interface|wlansvc.*not running|wireless autoconfig service/i.test(ifs.out)) return { error: "nowifi" };
    const iface = parseInterfaces(ifs.out);
    const profiles = parseProfiles(profs.out);
    const saved = new Set(profiles.map((p) => p.toLowerCase()));
    // Windows 11 requires location access to list networks.
    const locationBlocked = /location/i.test(nets.out) && !/SSID\s+\d+/.test(nets.out);
    const networks = locationBlocked ? [] : parseNetworks(nets.out).map((n) => ({
      ssid: n.ssid, signal: n.signal, secure: n.secure, auth: n.auth,
      saved: saved.has(n.ssid.toLowerCase()),
      connected: iface.connected && iface.ssid === n.ssid
    }));
    return { iface, networks, profiles, error: locationBlocked ? "location" : null };
  }, 4000);

  handle("wifi:status", (_e, opts = {}) => {
    if (opts.fresh) status.invalidate();
    return status();
  });

  // Saved networks only: new networks need a password, which belongs in
  // Windows' own Wi-Fi settings.
  handle("wifi:connect", async (_e, ssid) => {
    const name = asString(ssid, "network", 64);
    const profiles = parseProfiles((await netshList("wlan show profiles")).out);
    const match = profiles.find((p) => p.toLowerCase() === name.toLowerCase());
    if (!match) throw new Error("Only saved networks can be joined from here — use Windows Wi-Fi settings for new ones");
    const res = await netsh(["wlan", "connect", `name=${match}`]);
    status.invalidate();
    if (!res.ok) throw new Error(res.out || "Could not connect");
    return true;
  });

  handle("wifi:disconnect", async () => {
    const res = await netsh(["wlan", "disconnect"]);
    status.invalidate();
    if (!res.ok) throw new Error(res.out || "Could not disconnect");
    return true;
  });
}

module.exports = { registerWifi, parseNetworks, parseInterfaces, parseProfiles };
