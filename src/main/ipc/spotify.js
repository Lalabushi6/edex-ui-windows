// Spotify in the media player: your playlists, liked songs, search, devices
// and playback control.
//
// Uses the Spotify Web API with the user's own Client ID (a free app made at
// developer.spotify.com) and the PKCE sign-in flow: Spotify's sign-in page
// opens in the default browser and answers on a loopback address
// (http://127.0.0.1:43821/callback). There is no client secret. The refresh
// token is encrypted with Windows DPAPI (Electron safeStorage); access tokens
// only live in memory.
//
// Spotify itself plays the music (the desktop app, a phone, a speaker); eDEX
// tells it what to play. Spotify requires Premium for playback control.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, net, safeStorage, shell } = require("electron");
const { handle } = require("./util");
const { readCapped } = require("../lib/http");

const REDIRECT_PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = [
  "user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing",
  "playlist-read-private", "playlist-read-collaborative", "user-library-read", "user-read-recently-played"
];
const ART_HOST = /^https:\/\/([\w-]+\.)*(scdn\.co|spotifycdn\.com)\//i;
const URI = /^spotify:(track|episode|album|playlist|artist|show|collection):[\w:]{1,120}$/;

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fail = (message, code) => Object.assign(new Error(message), { code });

function page(title, text) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="background:#05080d;color:#aacfd1;font:16px system-ui,sans-serif;display:grid;place-items:center;height:96vh;margin:0"><div style="text-align:center"><h1 style="font-weight:400;letter-spacing:.08em">${title}</h1><p>${text}</p></div>`;
}

function image(images, min) {
  if (!Array.isArray(images) || !images.length) return null;
  const sorted = [...images].filter((i) => i?.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 640) >= min) || sorted[sorted.length - 1])?.url || null;
}

function track(t) {
  if (!t || !t.uri) return null;
  const images = t.album?.images || t.images || t.show?.images;
  return {
    uri: t.uri,
    name: t.name || "",
    artists: Array.isArray(t.artists) ? t.artists.map((a) => a.name).join(", ") : t.show?.name || "",
    album: t.album?.name || t.show?.name || "",
    duration: Number(t.duration_ms) || 0,
    art: image(images, 64),
    artLarge: image(images, 480)
  };
}

function registerSpotify({ settings, windows }) {
  const tokenFile = path.join(app.getPath("userData"), "spotify-token.bin");
  // Development runs can point at a test server; packaged builds never can.
  const testAccounts = !app.isPackaged ? process.env.EDEX_SPOTIFY_ACCOUNTS : "";
  const accountsBase = testAccounts || "https://accounts.spotify.com";
  const apiBase = (!app.isPackaged && process.env.EDEX_SPOTIFY_API) || "https://api.spotify.com/v1";
  let access = null; // { token, expires }
  let profile = null;
  let pending = null;
  const art = new Map();

  const clientId = () => settings.get("spotifyClientId") || "";
  const readRefresh = () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(fs.readFileSync(tokenFile));
    } catch (_) { return null; }
  };
  const forget = async () => {
    access = null;
    profile = null;
    await fs.promises.rm(tokenFile, { force: true });
  };

  async function tokenRequest(params) {
    const res = await net.fetch(`${accountsBase}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString()
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(body.error_description || body.error || `Spotify sign-in failed (${res.status})`, body.error);
    return body;
  }

  function keep(body) {
    if (!body.access_token) throw fail("Spotify didn't return a token");
    access = { token: body.access_token, expires: Date.now() + ((Number(body.expires_in) || 3600) - 60) * 1000 };
    // Spotify may rotate the refresh token; always keep the newest.
    if (body.refresh_token) fs.writeFileSync(tokenFile, safeStorage.encryptString(body.refresh_token));
  }

  async function token() {
    if (access && Date.now() < access.expires) return access.token;
    const refresh = readRefresh();
    if (!refresh || !clientId()) throw fail("Connect your Spotify account first", "not_connected");
    try {
      keep(await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId() }));
    } catch (e) {
      if (e.code === "invalid_grant" || e.code === "invalid_client") {
        await forget();
        throw fail("Spotify signed eDEX out — connect again", "not_connected");
      }
      throw e;
    }
    return access.token;
  }

  async function api(method, endpoint, { query, body } = {}) {
    const url = new URL(`${apiBase}${endpoint}`);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await net.fetch(url.href, {
          method,
          headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (e) {
        if (e.code) throw e;
        throw fail("Couldn't reach Spotify — check your connection", "offline");
      }
      if (res.status === 401 && attempt === 0) { access = null; continue; }
      if (res.status === 204 || res.status === 202) return null;
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) {}
      if (res.ok) return data;
      const reason = data?.error?.reason || "";
      const msg = data?.error?.message || `Spotify answered ${res.status}`;
      if (res.status === 403 && (reason === "PREMIUM_REQUIRED" || /premium/i.test(msg))) throw fail("Playback control needs Spotify Premium", "premium");
      if (res.status === 404 && (reason === "NO_ACTIVE_DEVICE" || /device/i.test(msg))) throw fail("No active Spotify device — open Spotify on this PC or your phone, or pick a device", "no_device");
      if (res.status === 403) throw fail("Spotify doesn't allow this for your app (playlists you don't own can be played, not listed)", "forbidden");
      if (res.status === 429) throw fail("Spotify rate limit reached — wait a moment", "rate");
      throw fail(msg, reason || res.status);
    }
    throw fail("Spotify sign-in expired — connect again", "not_connected");
  }

  async function me() {
    if (!profile) {
      const p = await api("GET", "/me");
      profile = { id: p?.id || "", name: p?.display_name || p?.id || "Spotify user", product: p?.product || "" };
    }
    return profile;
  }

  handle("spotify:status", () => ({
    clientId: clientId(),
    connected: !!clientId() && !!readRefresh(),
    encryption: safeStorage.isEncryptionAvailable(),
    redirectUri: REDIRECT_URI,
    user: profile
  }));

  // PKCE: the sign-in page opens in the default browser; Spotify sends the
  // browser back to the loopback address with a one-time code.
  handle("spotify:connect", async () => {
    if (!clientId()) throw fail("Paste your Spotify Client ID first");
    if (!safeStorage.isEncryptionAvailable()) throw fail("Windows can't encrypt the sign-in on this account");
    pending?.cancel();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(18));
    const code = await new Promise((resolve, reject) => {
      let done = false;
      const server = http.createServer((req, res) => {
        const u = new URL(req.url || "/", REDIRECT_URI);
        if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
        const got = u.searchParams.get("state") === state ? u.searchParams.get("code") : null;
        const err = u.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
        res.end(got ? page("Connected to eDEX-UI", "You can close this tab and go back to eDEX.")
          : page("Spotify sign-in didn't finish", err === "access_denied" ? "Access was declined." : "Try again from eDEX."));
        finish(got ? null : fail(err === "access_denied" ? "Spotify access was declined" : "Spotify sign-in didn't finish"), got);
      });
      const timer = setTimeout(() => finish(fail("Spotify sign-in timed out")), 180000);
      const finish = (e, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        server.close();
        pending = null;
        if (e) reject(e); else resolve(value);
      };
      pending = { cancel: () => finish(fail("Cancelled")) };
      server.on("error", (e) => finish(fail(e.code === "EADDRINUSE" ? `Port ${REDIRECT_PORT} is in use by another program` : e.message)));
      server.listen(REDIRECT_PORT, "127.0.0.1", () => {
        const auth = new URL(`${accountsBase}/authorize`);
        auth.search = new URLSearchParams({
          client_id: clientId(), response_type: "code", redirect_uri: REDIRECT_URI,
          code_challenge_method: "S256", code_challenge: challenge, state, scope: SCOPES.join(" ")
        }).toString();
        if (testAccounts) {
          net.fetch(auth.href).catch((e) => finish(e));
        } else {
          windows.yieldFocus();
          shell.openExternal(auth.href).catch((e) => finish(e));
        }
      });
    });
    keep(await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId(), code_verifier: verifier }));
    profile = null;
    return me();
  });

  handle("spotify:cancel", () => { pending?.cancel(); return true; });
  handle("spotify:disconnect", async () => { pending?.cancel(); await forget(); return true; });
  handle("spotify:me", () => me());

  handle("spotify:player", async () => {
    const p = await api("GET", "/me/player", { query: { additional_types: "episode" } });
    if (!p) return null;
    return {
      device: p.device ? { id: p.device.id, name: p.device.name, type: p.device.type, volume: p.device.volume_percent, canVolume: p.device.supports_volume !== false } : null,
      playing: !!p.is_playing,
      progress: Number(p.progress_ms) || 0,
      shuffle: !!p.shuffle_state,
      repeat: p.repeat_state || "off",
      context: p.context?.uri || null,
      item: track(p.item),
      at: Date.now()
    };
  });

  handle("spotify:devices", async () => {
    const d = await api("GET", "/me/player/devices");
    return (d?.devices || []).map((x) => ({ id: x.id, name: x.name, type: x.type, active: !!x.is_active, volume: x.volume_percent, restricted: !!x.is_restricted }));
  });

  const deviceQuery = (opts) => (typeof opts?.device === "string" && /^[\w-]{1,80}$/.test(opts.device) ? { device_id: opts.device } : {});
  handle("spotify:control", async (_e, action, opts = {}) => {
    switch (action) {
      case "play": return api("PUT", "/me/player/play", { query: deviceQuery(opts) });
      case "pause": return api("PUT", "/me/player/pause", { query: deviceQuery(opts) });
      case "next": return api("POST", "/me/player/next");
      case "prev": return api("POST", "/me/player/previous");
      case "seek": return api("PUT", "/me/player/seek", { query: { position_ms: Math.max(0, Math.round(Number(opts.position) || 0)) } });
      case "volume": return api("PUT", "/me/player/volume", { query: { volume_percent: Math.max(0, Math.min(100, Math.round(Number(opts.volume) || 0))) } });
      case "shuffle": return api("PUT", "/me/player/shuffle", { query: { state: !!opts.state } });
      case "repeat": return api("PUT", "/me/player/repeat", { query: { state: ["off", "context", "track"].includes(opts.state) ? opts.state : "off" } });
      case "transfer": {
        if (typeof opts.device !== "string" || !/^[\w-]{1,80}$/.test(opts.device)) throw fail("Unknown device");
        return api("PUT", "/me/player", { body: { device_ids: [opts.device], play: !!opts.play } });
      }
      // { context: playlist/album URI, offset?: track URI } or { uris: [track URIs] }
      case "start": {
        const body = {};
        if (typeof opts.context === "string" && URI.test(opts.context)) {
          body.context_uri = opts.context;
          if (typeof opts.offset === "string" && URI.test(opts.offset)) body.offset = { uri: opts.offset };
        } else if (Array.isArray(opts.uris)) {
          body.uris = opts.uris.filter((u) => typeof u === "string" && URI.test(u)).slice(0, 100);
          if (!body.uris.length) throw fail("Nothing to play");
        } else throw fail("Nothing to play");
        return api("PUT", "/me/player/play", { query: deviceQuery(opts), body });
      }
      default: throw fail("Unknown Spotify action");
    }
  });

  const offsetOf = (n) => Math.max(0, Math.min(100000, Math.round(Number(n) || 0)));

  handle("spotify:playlists", async (_e, offset) => {
    const [d, user] = await Promise.all([api("GET", "/me/playlists", { query: { limit: 50, offset: offsetOf(offset) } }), me().catch(() => null)]);
    return {
      total: d?.total || 0,
      next: !!d?.next,
      items: (d?.items || []).filter(Boolean).map((p) => ({
        id: p.id, uri: p.uri, name: p.name || "", owner: p.owner?.display_name || p.owner?.id || "",
        count: p.items?.total ?? p.tracks?.total ?? null,
        // Spotify only lists the tracks of playlists you own or collaborate on.
        listable: !!(user && (p.owner?.id === user.id || p.collaborative)),
        art: image(p.images, 64)
      }))
    };
  });

  handle("spotify:playlistTracks", async (_e, id, offset) => {
    if (typeof id !== "string" || !/^\w{1,64}$/.test(id)) throw fail("Unknown playlist");
    const d = await api("GET", `/playlists/${id}/items`, { query: { limit: 100, offset: offsetOf(offset) } });
    return { total: d?.total || 0, next: !!d?.next, items: (d?.items || []).map((x) => track(x?.item || x?.track)).filter(Boolean) };
  });

  handle("spotify:liked", async (_e, offset) => {
    const d = await api("GET", "/me/tracks", { query: { limit: 50, offset: offsetOf(offset) } });
    return { total: d?.total || 0, next: !!d?.next, items: (d?.items || []).map((x) => track(x?.track)).filter(Boolean) };
  });

  handle("spotify:recent", async () => {
    const d = await api("GET", "/me/player/recently-played", { query: { limit: 30 } });
    const seen = new Set();
    return (d?.items || []).map((x) => track(x?.track)).filter((t) => t && !seen.has(t.uri) && seen.add(t.uri));
  });

  // Spotify allows at most 10 results per type.
  handle("spotify:search", async (_e, q) => {
    const query = String(q || "").trim().slice(0, 200);
    if (!query) return { tracks: [], playlists: [] };
    const d = await api("GET", "/search", { query: { q: query, type: "track,playlist,album", limit: 10 } });
    return {
      tracks: (d?.tracks?.items || []).map(track).filter(Boolean),
      playlists: (d?.playlists?.items || []).filter(Boolean).map((p) => ({ id: p.id, uri: p.uri, name: p.name || "", owner: p.owner?.display_name || "", art: image(p.images, 64), listable: false })),
      albums: (d?.albums?.items || []).filter(Boolean).map((a) => ({ uri: a.uri, name: a.name || "", artists: (a.artists || []).map((x) => x.name).join(", "), art: image(a.images, 64) }))
    };
  });

  // Cover art as data URLs (the interface's CSP allows no remote images).
  handle("spotify:art", async (_e, url) => {
    if (typeof url !== "string" || !ART_HOST.test(url) || url.length > 512) return null;
    if (art.has(url)) return art.get(url);
    try {
      const res = await net.fetch(url);
      const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      if (!res.ok || !/^image\//.test(type)) { res.body?.cancel().catch(() => {}); return null; }
      const data = `data:${type};base64,${(await readCapped(res, 1024 * 1024)).toString("base64")}`;
      art.set(url, data);
      while (art.size > 120) art.delete(art.keys().next().value);
      return data;
    } catch (_) { return null; }
  });

  return { stop: () => pending?.cancel(), tokenFile };
}

module.exports = { registerSpotify, REDIRECT_URI };
