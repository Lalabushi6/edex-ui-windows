// Game library: installed Steam, Epic Games and Xbox (Microsoft Store /
// Game Pass) games with cover art, for the launcher, the dock and the game
// library panel.
//
// Games are found by reading the launchers' own files: Steam's
// libraryfolders.vdf and app manifests, Epic's install manifests and catalog
// cache, and installed packages that carry a MicrosoftGame.config. Cover art
// comes from the launchers' local caches; only when none exists (and
// outbound lookups are on) is it downloaded from the store's image server,
// once, into userData/game-art.
"use strict";

const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { app, net, shell } = require("electron");
const { handle, asString } = require("./util");
const { JsonStore } = require("../lib/store");

const SKIP_STEAM = /redistributable|steam linux runtime|^proton\b|steamvr performance test|^steamworks/i;
const RESCAN_MS = 30 * 60 * 1000;

// Valve's KeyValues text format ("key" "value" / "key" { … }).
function parseVdf(text) {
  const root = {};
  const stack = [root];
  let key = null;
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[2] === "{") {
      const obj = {};
      if (key !== null) top[key] = obj;
      stack.push(obj);
      key = null;
    } else if (m[2] === "}") {
      stack.pop();
      key = null;
      if (!stack.length) break;
    } else {
      const s = m[1].replace(/\\(.)/g, "$1");
      if (key === null) key = s;
      else { top[key] = s; key = null; }
    }
  }
  return root;
}

const readText = (p) => fs.promises.readFile(p, "utf8");
const exists = (p) => fs.promises.access(p).then(() => true, () => false);

function regValue(keyPath, name) {
  return new Promise((resolve) => {
    execFile("reg.exe", ["query", keyPath, "/v", name], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, "i").exec(stdout || "");
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function steamRoot() {
  const fromReg = (await regValue("HKCU\\Software\\Valve\\Steam", "SteamPath")) || (await regValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"));
  const candidates = [fromReg, path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam")].filter(Boolean).map((p) => path.normalize(p));
  for (const c of candidates) if (await exists(path.join(c, "steamapps"))) return c;
  return null;
}

// Steam keeps cover art for installed games in appcache/librarycache, in
// either the old flat layout or per-game folders (some with hashed names).
async function steamLocalArt(root, appid) {
  const base = path.join(root, "appcache", "librarycache");
  for (const f of [`${appid}_library_600x900.jpg`, `${appid}_library_600x900_2x.jpg`]) {
    const p = path.join(base, f);
    if (await exists(p)) return { file: p, tall: true };
  }
  const dir = path.join(base, String(appid));
  let wide = null;
  const walk = async (d, depth) => {
    let ents = [];
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch (_) { return null; }
    for (const e of ents) if (e.isFile() && /^library_600x900(_2x)?\.(jpg|png)$/i.test(e.name)) return path.join(d, e.name);
    for (const e of ents) if (e.isFile() && /^header\.(jpg|png)$/i.test(e.name)) wide ||= path.join(d, e.name);
    if (depth < 2) for (const e of ents) if (e.isDirectory()) { const r = await walk(path.join(d, e.name), depth + 1); if (r) return r; }
    return null;
  };
  const tall = await walk(dir, 0);
  if (tall) return { file: tall, tall: true };
  return wide ? { file: wide, tall: false } : null;
}

async function steamGames() {
  const root = await steamRoot();
  if (!root) return [];
  const libs = new Set([root]);
  try {
    const v = parseVdf(await readText(path.join(root, "steamapps", "libraryfolders.vdf")));
    const lf = v.libraryfolders || v.LibraryFolders || {};
    for (const [k, val] of Object.entries(lf)) {
      if (!/^\d+$/.test(k)) continue;
      const p = typeof val === "string" ? val : val?.path;
      if (p) libs.add(path.normalize(p));
    }
  } catch (_) {}
  const out = [];
  const seen = new Set();
  for (const lib of libs) {
    const dir = path.join(lib, "steamapps");
    let files = [];
    try { files = (await fs.promises.readdir(dir)).filter((f) => /^appmanifest_\d+\.acf$/i.test(f)); } catch (_) { continue; }
    for (const f of files) {
      let st;
      try { st = parseVdf(await readText(path.join(dir, f))).AppState; } catch (_) { continue; }
      if (!/^\d+$/.test(st?.appid || "") || !st.name || seen.has(st.appid) || SKIP_STEAM.test(st.name)) continue;
      if (!((Number(st.StateFlags) || 0) & 4)) continue; // fully installed
      seen.add(st.appid);
      const art = await steamLocalArt(root, st.appid);
      out.push({
        id: `steam:${st.appid}`, source: "steam", name: st.name, appid: st.appid,
        // Without an install folder name, steamapps/common would match every game.
        dir: st.installdir ? path.join(dir, "common", st.installdir) : "",
        art: art?.file || null, tall: art ? art.tall : true,
        remoteArt: art?.tall ? null : `https://shared.steamstatic.com/store_item_assets/steam/apps/${st.appid}/library_600x900.jpg`
      });
    }
  }
  return out;
}

async function epicGames() {
  const data = path.join(process.env.ProgramData || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data");
  let files = [];
  try { files = (await fs.promises.readdir(path.join(data, "Manifests"))).filter((f) => /\.item$/i.test(f)); } catch (_) { return []; }
  // The catalog cache (base64 JSON) has each game's key art.
  const images = new Map();
  try {
    const cat = JSON.parse(Buffer.from((await readText(path.join(data, "Catalog", "catcache.bin"))).trim(), "base64").toString("utf8"));
    for (const item of Array.isArray(cat) ? cat : []) if (item?.id && Array.isArray(item.keyImages)) images.set(item.id, item.keyImages);
  } catch (_) {}
  const pick = (imgs) => {
    for (const type of ["DieselGameBoxTall", "OfferImageTall", "DieselGameBox", "Thumbnail"]) {
      const i = (imgs || []).find((x) => x?.type === type && /^https:\/\//.test(x.url || ""));
      if (i) return { url: i.url, tall: /Tall/.test(type) };
    }
    return null;
  };
  const out = [];
  for (const f of files) {
    let m;
    try { m = JSON.parse(await readText(path.join(data, "Manifests", f))); } catch (_) { continue; }
    if (!m?.DisplayName || !m.AppName || m.bIsIncompleteInstall) continue;
    if (m.MainGameAppName && m.MainGameAppName !== m.AppName) continue; // DLC
    const cats = Array.isArray(m.AppCategories) ? m.AppCategories : [];
    if (cats.length && !cats.includes("games")) continue; // engines, plugins
    const ok = [m.CatalogNamespace, m.CatalogItemId, m.AppName].every((s) => typeof s === "string" && /^[\w.-]+$/.test(s));
    if (!ok) continue;
    const art = pick(images.get(m.CatalogItemId));
    out.push({
      id: `epic:${m.AppName}`, source: "epic", name: m.DisplayName,
      uri: `com.epicgames.launcher://apps/${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}?action=launch&silent=true`,
      dir: m.InstallLocation ? path.normalize(m.InstallLocation) : "",
      exe: m.InstallLocation && m.LaunchExecutable ? path.join(m.InstallLocation, m.LaunchExecutable) : "",
      art: null, tall: art ? art.tall : true, remoteArt: art?.url || null
    });
  }
  return out;
}

async function xboxGames(aux, bridge) {
  let list = [];
  try { list = await aux.call("xboxGames", {}, 60000); } catch (_) { return []; }
  // Packages that only name themselves through a resource string get the
  // Start menu's name. Asked of the slow-call helper, and only when needed,
  // so the panels' helper isn't held up.
  let names = new Map();
  const needNames = (Array.isArray(list) ? list : []).some((g) => !g?.name || /^ms-resource:/i.test(g.name));
  if (needNames) {
    try { names = new Map((await (aux || bridge).call("startApps", {}, 20000)).map((a) => [a.appId, a.name])); } catch (_) {}
  }
  const out = [];
  for (const g of Array.isArray(list) ? list : []) {
    if (!g?.aumid || !/^[\w.-]+_[a-z0-9]+![\w.-]+$/i.test(g.aumid)) continue;
    const name = (g.name && !/^ms-resource:/i.test(g.name) ? g.name : names.get(g.aumid)) || null;
    if (!name) continue;
    let art = null;
    if (g.logo && g.dir) {
      const p = path.join(g.dir, g.logo);
      if (await exists(p)) art = p;
    }
    out.push({ id: `xbox:${g.aumid}`, source: "xbox", name, aumid: g.aumid, dir: g.dir || "", art, tall: false, remoteArt: null });
  }
  return out;
}

function registerGames({ settings, windows, bridge, aux }) {
  const userData = app.getPath("userData");
  const artDir = path.join(userData, "game-art");
  const store = new JsonStore(path.join(userData, "games.json"), { fallback: { games: [], played: {} } });
  let games = Array.isArray(store.data.games) ? store.data.games : [];
  let scanning = null;
  let scannedAt = 0;

  const played = () => store.data.played || (store.data.played = {});
  const view = () => games.map((g) => ({
    id: g.id, source: g.source, name: g.name, art: g.art || null, tall: !!g.tall,
    dir: g.dir || "", lastPlayed: played()[g.id] || 0
  })).sort((a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name));

  // Missing art is fetched once per game (in the background) and kept.
  async function fetchArt(g) {
    if (!g.remoteArt || settings.get("allowNetworkGeolocation") === false) return;
    const file = path.join(artDir, `${g.id.replace(/[^\w.-]+/g, "_")}.jpg`);
    if (await exists(file)) { g.art = file; g.tall = true; return; }
    try {
      const res = await net.fetch(g.remoteArt);
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !/^image\//.test(type)) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) return;
      await fs.promises.mkdir(artDir, { recursive: true });
      await fs.promises.writeFile(file, buf);
      g.art = file;
      g.tall = true;
      windows.send("games:art", { id: g.id, art: file });
    } catch (_) {}
  }

  async function scan() {
    if (scanning) return scanning;
    scanning = (async () => {
      const found = (await Promise.all([steamGames(), epicGames(), xboxGames(aux, bridge)].map((p) => p.catch(() => [])))).flat();
      // Art downloaded earlier is reused.
      for (const g of found) {
        if (g.art) continue;
        const cached = path.join(artDir, `${g.id.replace(/[^\w.-]+/g, "_")}.jpg`);
        if (await exists(cached)) { g.art = cached; g.tall = true; }
      }
      games = found;
      scannedAt = Date.now();
      store.data.games = games;
      store.save();
      windows.send("games:changed", {});
      (async () => { for (const g of games) if (!g.art) await fetchArt(g); store.save(); })();
      return games;
    })().finally(() => { scanning = null; });
    return scanning;
  }

  handle("games:list", async (_e, force) => {
    if (force || !scannedAt) {
      const p = scan();
      // The first answer comes from the cache when there is one.
      if (force || !games.length) await p;
    }
    return view();
  });

  const find = (id) => {
    const g = games.find((x) => x.id === asString(id, "game"));
    if (!g) throw new Error("That game isn't in the library any more");
    return g;
  };

  handle("games:launch", async (_e, id) => {
    const g = find(id);
    windows.yieldFocus();
    if (g.source === "steam") {
      if (!/^\d+$/.test(g.appid)) throw new Error("Invalid game");
      await shell.openExternal(`steam://rungameid/${g.appid}`);
    } else if (g.source === "epic") {
      await shell.openExternal(g.uri);
    } else if (g.source === "xbox") {
      spawn("explorer.exe", [`shell:AppsFolder\\${g.aumid}`], { detached: true, stdio: "ignore" }).unref();
    }
    played()[g.id] = Date.now();
    store.save();
    return true;
  });

  handle("games:reveal", async (_e, id) => {
    const g = find(id);
    if (!g.dir || !(await exists(g.dir))) throw new Error("Install folder not found");
    windows.yieldFocus();
    const err = await shell.openPath(g.dir);
    if (err) throw new Error(err);
    return true;
  });

  // Background refresh now and then, so new installs show up — only while
  // eDEX is on screen (the Xbox part runs Get-AppxPackage, which isn't free).
  const timer = setInterval(() => {
    const win = windows.win;
    const onScreen = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    if (onScreen && Date.now() - scannedAt > RESCAN_MS) scan().catch(() => {});
  }, 5 * 60 * 1000);
  setTimeout(() => scan().catch(() => {}), 20000);

  return {
    // The game whose files the given executable lives in, if any.
    match(exe) {
      if (!exe) return null;
      const p = path.normalize(exe).toLowerCase();
      for (const g of games) {
        if (g.exe && path.normalize(g.exe).toLowerCase() === p) return g;
        const d = g.dir && path.normalize(g.dir).toLowerCase();
        if (d && d.length > 3 && (p.startsWith(d.endsWith(path.sep) ? d : d + path.sep))) return g;
      }
      return null;
    },
    stop: () => clearInterval(timer),
    flush: () => store.flushSync()
  };
}

module.exports = { registerGames, parseVdf };
