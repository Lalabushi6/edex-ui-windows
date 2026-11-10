// Game library: installed Steam, Epic Games and Xbox games, and any game you
// add yourself (a shortcut or a program), for the library, the launcher and
// the dock, and for game mode.
//
// Games are found from the launchers' own files: Steam's library folders and
// app manifests, Epic's install manifests, and installed packages that carry a
// MicrosoftGame.config. Start menu and desktop shortcuts are read to find each
// game's own shortcut, whose icon the library shows (see lib/game-icons.js).
// Nothing is downloaded.
//
// Nothing runs on a timer. A full scan runs when the library opens and the
// last one is over ten minutes old, or on Rescan. A quick one (Steam's and
// Epic's manifests only, no helper) runs once, 20 s after start, so game mode
// knows games installed since. A source whose scan fails keeps its last list.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { app, dialog, shell } = require("electron");
const { handle, asString } = require("./util");
const { JsonStore } = require("../lib/store");
const paths = require("../lib/paths");
const { GameIcons, probe } = require("../lib/game-icons");
const { startMenuDirs, desktopDirs, collectShortcuts, readUrlShortcut, expandEnv } = require("../lib/shortcuts");
const { EXPLORER, system32, spawnDetached } = require("../lib/sysexe");

const SOURCES = ["steam", "epic", "xbox"];
const SKIP_STEAM = /redistributable|steam linux runtime|^proton\b|steamvr performance test|^steamworks/i;
const FULL_SCAN_AGE = 10 * 60 * 1000;
const QUICK_SCAN_DELAY = 20000;
const AUMID = /^[\w.-]+_[a-z0-9]+![\w.-]+$/i;
const EPIC_URI = /^com\.epicgames\.launcher:\/\/apps\/[\w.%-]+\?action=launch&silent=true$/;

// Development runs can point discovery at a folder of fake installs and
// shortcuts (EDEX_GAMES_FIXTURES), so tests never read this PC's real games.
function locations() {
  const fx = !app.isPackaged && process.env.EDEX_GAMES_FIXTURES;
  if (fx) {
    return { fixtures: true, steam: path.join(fx, "steam"), epic: path.join(fx, "epic"), shortcutDirs: [path.join(fx, "startmenu"), path.join(fx, "desktop")] };
  }
  return {
    fixtures: false, steam: null,
    epic: path.join(process.env.ProgramData || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data"),
    shortcutDirs: [...startMenuDirs(), ...desktopDirs()].filter((d) => !paths.isUncPath(d))
  };
}

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
const lower = (p) => path.normalize(p).replace(/[\\/]+$/, "").toLowerCase();
const isExe = (p) => typeof p === "string" && /^[A-Za-z]:\\.+\.exe$/i.test(p);

function regValue(keyPath, name) {
  return new Promise((resolve) => {
    execFile(system32("reg.exe"), ["query", keyPath, "/v", name], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, "i").exec(stdout || "");
      resolve(m ? m[1].trim() : null);
    });
  });
}

// The last root found is tried first, so a quick scan needs no reg.exe.
async function steamRoot(loc, last) {
  if (loc.fixtures) return loc.steam;
  if (last && await exists(path.join(last, "steamapps"))) return last;
  const fromReg = (await regValue("HKCU\\Software\\Valve\\Steam", "SteamPath")) || (await regValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"));
  const candidates = [fromReg, path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam")].filter(Boolean).map((p) => path.normalize(p));
  for (const c of candidates) if (await exists(path.join(c, "steamapps"))) return c;
  return null;
}

async function steamGames(root) {
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
      out.push({
        id: `steam:${st.appid}`, source: "steam", name: st.name, appid: st.appid,
        // Without an install folder name, steamapps/common would match every game.
        dir: st.installdir ? path.join(dir, "common", st.installdir) : "",
        build: String(st.buildid || "")
      });
    }
  }
  return out;
}

async function epicGames(data) {
  let files = [];
  try { files = (await fs.promises.readdir(path.join(data, "Manifests"))).filter((f) => /\.item$/i.test(f)); } catch (_) { return []; }
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
    out.push({
      id: `epic:${m.AppName}`, source: "epic", name: m.DisplayName, appName: m.AppName,
      uri: `com.epicgames.launcher://apps/${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}?action=launch&silent=true`,
      dir: m.InstallLocation ? path.normalize(m.InstallLocation) : "",
      exe: m.InstallLocation && m.LaunchExecutable ? path.join(m.InstallLocation, m.LaunchExecutable) : ""
    });
  }
  return out;
}

// Throws when the helper fails, so the last good list is kept.
async function xboxGames(aux) {
  const list = await aux.call("xboxGames", {}, 60000);
  if (!Array.isArray(list)) throw new Error("No answer");
  // Packages that only name themselves through a resource string get the
  // Start menu's name, asked only when needed.
  let names = new Map();
  if (list.some((g) => !g?.name || /^ms-resource:/i.test(g.name))) {
    try { names = new Map((await aux.call("startApps", {}, 20000)).map((a) => [a.appId, a.name])); } catch (_) {}
  }
  const out = [];
  for (const g of list) {
    if (!g?.aumid || !AUMID.test(g.aumid)) continue;
    const name = (g.name && !/^ms-resource:/i.test(g.name) ? g.name : names.get(g.aumid)) || null;
    if (name) out.push({ id: `xbox:${g.aumid}`, source: "xbox", name, aumid: g.aumid, dir: g.dir || "" });
  }
  return out;
}

// The program most likely to be a Steam game's own, for its icon when it has
// no shortcut: named like the game, near the top of its folder, not an
// installer, crash reporter or anti-cheat service.
const SKIP_EXE = /^(unins\d*|uninstall.*|setup.*|install(er)?|vc_?redist.*|vcredist.*|dxsetup|dxwebsetup|dotnet.*|ndp\d+.*|oalinst|physx.*|directx.*|crashpad_handler|unitycrashhandler(32|64)?|crashreportclient|crashreporter|crashsender\d*|bugsplat.*|errorreporter|easyanticheat.*|start_protected_game|beservice.*|battleye.*|eaanticheat.*|cefsharp\..*|qtwebengineprocess|ue\d?prereqsetup.*|7za?|pythonw?\d*|javaw?|ffmpeg|touchup|cleanup|activation|redist.*|.*helper|.*updater|.*uploader|.*crashhandler\d*|.*crash_?reporter)$/i;
const SKIP_DIR = /^(_?commonredist|redist|redistributables?|__installer|installers?|directx|dotnet|vcredist|support|easyanticheat|battleye|monobleedingedge|.*_data|engine|crashreport.*|prereq.*|jre|java|python)$/i;
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function guessExe(dir, names) {
  const wanted = names.map(squash).filter((n) => n.length >= 2);
  const found = [];
  let visited = 0;
  const walk = async (d, depth) => {
    if (depth > 3 || ++visited > 300) return;
    let ents;
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (!e.isFile() || !/\.exe$/i.test(e.name)) continue;
      const stem = e.name.slice(0, -4);
      if (!SKIP_EXE.test(stem)) found.push({ file: path.join(d, e.name), stem, depth });
    }
    for (const e of ents) if (e.isDirectory() && !SKIP_DIR.test(e.name)) await walk(path.join(d, e.name), depth + 1);
  };
  await walk(dir, 0);
  if (!found.length) return "";
  const score = (c) => {
    const n = squash(c.stem.replace(/-win(64|gdk)-shipping$|[-_]?x64$|[-_]?win64$/i, ""));
    let s = -12 * c.depth;
    for (const w of wanted) {
      if (n === w) s = Math.max(s, 100 - 12 * c.depth);
      else if (n.length >= 3 && (w.includes(n) || n.includes(w))) s = Math.max(s, 60 - 12 * c.depth);
    }
    return /launcher/i.test(c.stem) ? s - 5 : s;
  };
  for (const c of found) c.score = score(c);
  found.sort((a, b) => b.score - a.score || a.depth - b.depth);
  // Among equally likely ones, the biggest.
  const top = found.filter((c) => c.score === found[0].score).slice(0, 8);
  if (top.length > 1) {
    for (const c of top) c.size = (await fs.promises.stat(c.file).catch(() => null))?.size || 0;
    top.sort((a, b) => b.size - a.size);
  }
  return top[0].file;
}

// A folder too general to stand for one game in game mode (a drive, Windows,
// the user's own folders): an added game there matches by its program only.
function broadDir(dir) {
  const d = lower(dir);
  if (d.split(path.sep).filter(Boolean).length < 3) return true;
  const win = lower(process.env.WINDIR || "C:\\Windows");
  if (d === win || d.startsWith(win + path.sep)) return true;
  const home = os.homedir();
  const general = [home, ...["Desktop", "Downloads", "Documents", "OneDrive", "AppData", "AppData\\Local", "AppData\\Roaming", "AppData\\Local\\Programs"].map((n) => path.join(home, n)),
    process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramData, process.env.PUBLIC];
  return general.some((g) => g && lower(g) === d);
}

function strip(g) {
  const out = {};
  for (const k of ["id", "source", "name", "appid", "appName", "uri", "aumid", "dir", "exe", "build"]) if (typeof g[k] === "string") out[k] = g[k];
  return out;
}

// games.json: v2 keeps each launcher's last good list, your added and hidden
// games, renames, the shortcut found for each game and the icon made for it.
function migrate(d) {
  if (d.v !== 2) {
    const old = Array.isArray(d.games) ? d.games : [];
    d.sources = { steam: [], epic: [], xbox: [] };
    for (const g of old) if (g && SOURCES.includes(g.source) && typeof g.id === "string" && typeof g.name === "string") d.sources[g.source].push(strip(g));
    delete d.games;
    d.v = 2;
  }
  if (!d.sources || typeof d.sources !== "object") d.sources = {};
  for (const s of SOURCES) if (!Array.isArray(d.sources[s])) d.sources[s] = [];
  for (const k of ["added", "hidden"]) if (!Array.isArray(d[k])) d[k] = [];
  for (const k of ["played", "names", "links", "exes", "icons"]) if (!d[k] || typeof d[k] !== "object") d[k] = {};
  return d;
}

function registerGames({ windows, bridge, aux, desktop }) {
  const userData = app.getPath("userData");
  const store = new JsonStore(path.join(userData, "games.json"), { fallback: { v: 2 } });
  const data = () => migrate(store.data);
  data();
  const icons = new GameIcons({ bridge, dir: path.join(userData, "game-icons"), store });
  const status = new Map(); // id -> "file" | "drive" (target not there), from the last look
  const linkCache = new Map(); // Start menu / desktop .lnk -> { stamp, link }, for this session
  let games = [];
  let byId = new Map();
  let scanning = null;
  let scanningFull = false;

  // Where a game's shortcut file is: the one found for it, or the one you added.
  const linkOf = (g) => data().links[g.id] || null;

  function assemble() {
    const d = data();
    const hidden = new Set(d.hidden);
    const out = [];
    for (const s of SOURCES) for (const raw of d.sources[s]) out.push({ ...raw });
    for (const a of d.added) {
      if (!a || typeof a.id !== "string" || typeof a.path !== "string") continue;
      out.push({ id: a.id, source: "added", name: a.name || "Game", path: a.path, kind: a.kind, aumid: a.aumid || "" });
    }
    for (const g of out) {
      const link = linkOf(g);
      g.link = link;
      g.hidden = hidden.has(g.id);
      g.title = typeof d.names[g.id] === "string" && d.names[g.id] ? d.names[g.id] : g.name;
      const target = link?.target && isExe(link.target) ? link.target : "";
      if (g.source === "steam") g.exe = target && g.dir && lower(target).startsWith(lower(g.dir) + path.sep) ? target : d.exes[g.id]?.exe || "";
      else if (g.source === "epic") g.exe = g.exe || target;
      else if (g.source === "xbox") g.shell = `shell:AppsFolder\\${g.aumid}`;
      else if (g.kind === "exe") g.exe = g.path;
      else if (g.kind === "lnk") g.exe = target;
      else if (g.kind === "url") {
        // An internet shortcut to a program on this PC (file:///C:/...exe).
        let file = "";
        try { file = /^file:/i.test(link?.url || "") ? decodeURIComponent(new URL(link.url).pathname.replace(/^\//, "")).replace(/\//g, "\\") : ""; } catch (_) {}
        g.exe = isExe(file) ? file : "";
      } else if (g.kind === "store") g.shell = `shell:AppsFolder\\${g.aumid}`;
      if (g.source === "added" && !g.dir) g.dir = g.exe ? path.dirname(g.exe) : "";
      // Game mode: a launcher game's whole folder counts; an added one's only
      // when that folder is its own.
      const own = g.source !== "added" ? g.dir && g.dir.length > 3 : g.dir && !broadDir(g.dir);
      g.matchDir = own ? lower(g.dir) + path.sep : "";
      g.matchExe = g.exe ? lower(g.exe) : "";
    }
    games = out;
    byId = new Map(out.map((g) => [g.id, g]));
  }
  assemble();

  const played = () => data().played;
  const view = (g) => {
    const k = icons.known(g.id);
    return {
      id: g.id, source: g.source, name: g.title, dir: g.dir || "",
      reveal: g.source === "added" ? (g.kind === "store" ? null : "file") : g.dir ? "folder" : null,
      kind: g.kind || null, lastPlayed: played()[g.id] || 0,
      icon: k.icon, iconVia: k.via, missing: status.get(g.id) || null
    };
  };
  const visible = () => games.filter((g) => !g.hidden).map(view)
    .sort((a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name));
  const changed = () => { store.save(); assemble(); windows.send("games:changed", {}); };

  // .lnk files through the helper (the shell's reader, no resolving), else
  // Electron's, which runs on this thread.
  async function readLinks(list) {
    const out = {};
    for (let i = 0; i < list.length; i += 64) {
      const chunk = list.slice(i, i + 64);
      try {
        Object.assign(out, await bridge.call("shortcuts", { paths: chunk }, 20000));
      } catch (_) {
        for (const p of chunk) {
          try {
            const l = shell.readShortcutLink(p);
            out[p] = { target: expandEnv(l.target), args: l.args || "", dir: expandEnv(l.cwd), icon: expandEnv(l.icon), index: l.iconIndex | 0 };
          } catch (_) { out[p] = null; }
        }
      }
    }
    return out;
  }

  // Each launcher game's own shortcut in the Start menu or on the desktop: a
  // .url that starts it through Steam or Epic, or a .lnk to a program in its
  // folder.
  async function findShortcuts(list, loc) {
    const files = [];
    for (const dir of loc.shortcutDirs) await collectShortcuts(dir, 0, files, /\.(lnk|url)$/i);
    const steam = new Map(list.filter((g) => g.source === "steam").map((g) => [g.appid, g]));
    const epic = new Map(list.filter((g) => g.source === "epic").map((g) => [g.appName.toLowerCase(), g]));
    const found = {};
    for (const f of files.filter((p) => /\.url$/i.test(p))) {
      const u = await readUrlShortcut(f);
      if (!u?.url) continue;
      let g = null;
      const s = /^steam:\/\/(?:rungameid|run|launch)\/(\d+)/i.exec(u.url);
      const e = /^com\.epicgames\.launcher:\/\/apps\/([^?#]+)/i.exec(u.url);
      if (s) g = steam.get(s[1]);
      else if (e) {
        let parts = [];
        try { parts = decodeURIComponent(e[1]).split(":"); } catch (_) {}
        g = epic.get(String(parts[parts.length - 1] || "").toLowerCase());
      }
      if (g && !found[g.id]) found[g.id] = { path: f, kind: "url", icon: u.icon, index: u.index, url: u.url, m: u.m, s: u.s };
    }
    const dirs = list.filter((g) => g.dir && g.dir.length > 3 && !found[g.id]).map((g) => [g, lower(g.dir) + path.sep]);
    const lnks = files.filter((p) => /\.lnk$/i.test(p));
    if (dirs.length && lnks.length) {
      // Only shortcuts new or changed since the last scan go to the helper.
      const stats = new Map(await Promise.all(lnks.map(async (f) => [f, await fs.promises.stat(f).catch(() => null)])));
      const stamp = (f) => { const st = stats.get(f); return st ? `${Math.round(st.mtimeMs)}|${st.size}` : ""; };
      const fresh = lnks.filter((f) => stats.get(f) && linkCache.get(f)?.stamp !== stamp(f));
      if (fresh.length) {
        const parsed = await readLinks(fresh);
        for (const f of fresh) linkCache.set(f, { stamp: stamp(f), link: parsed[f] || null });
      }
      for (const f of [...linkCache.keys()]) if (!stats.get(f)) linkCache.delete(f);
      for (const f of lnks) {
        const l = linkCache.get(f)?.link;
        if (!l?.target || !isExe(l.target)) continue;
        const t = lower(l.target);
        const hit = dirs.find(([g, d]) => !found[g.id] && t.startsWith(d));
        if (!hit) continue;
        const st = stats.get(f);
        found[hit[0].id] = { path: f, kind: "lnk", icon: l.icon, index: l.index | 0, target: l.target, args: l.args, m: Math.round(st.mtimeMs), s: st.size };
      }
    }
    return found;
  }

  async function doScan(full) {
    const d = data();
    const loc = locations();
    const root = await steamRoot(loc, d.steamRoot).catch(() => null);
    const tasks = { steam: steamGames(root), epic: epicGames(loc.epic) };
    if (full) tasks.xbox = loc.fixtures ? Promise.resolve([]) : xboxGames(aux);
    for (const [k, p] of Object.entries(tasks)) {
      const list = await p.catch(() => null);
      if (Array.isArray(list)) d.sources[k] = list;
    }
    d.steamRoot = loc.fixtures ? "" : root || "";
    if (full) {
      const list = SOURCES.flatMap((s) => d.sources[s]);
      const found = await findShortcuts(list, loc).catch(() => null);
      if (found) {
        const links = {};
        for (const [id, l] of Object.entries(d.links)) if (id.startsWith("added:")) links[id] = l;
        d.links = { ...links, ...found };
      }
      d.fullAt = Date.now();
      // Cover art downloaded by earlier versions isn't used any more.
      if (!d.artCleared) {
        d.artCleared = true;
        fs.promises.rm(path.join(userData, "game-art"), { recursive: true, force: true }).catch(() => {});
      }
    }
    // Leftovers of games that are gone.
    const ids = new Set([...SOURCES.flatMap((s) => d.sources[s].map((g) => g.id)), ...d.added.map((a) => a.id)]);
    for (const k of ["links", "exes", "icons", "names"]) for (const id of Object.keys(d[k])) if (!ids.has(id)) delete d[k][id];
    d.hidden = d.hidden.filter((id) => ids.has(id));
    changed();
    icons.prune().catch(() => {});
    return games;
  }

  // One scan at a time; asking for a full one during a quick one runs it after.
  function scan(full) {
    if (scanning && (scanningFull || !full)) return scanning;
    const run = (scanning || Promise.resolve()).catch(() => {}).then(() => doScan(full));
    scanning = run;
    scanningFull = full;
    run.catch(() => {}).finally(() => { if (scanning === run) { scanning = null; scanningFull = false; } });
    return run;
  }

  // Shortcuts edited since they were read are read again.
  async function freshenLinks(list) {
    const withLinks = list.filter((g) => g.link?.path);
    if (!withLinks.length) return;
    const states = await probe(withLinks.map((g) => g.link.path), bridge);
    const stale = withLinks.filter((g) => {
      const st = states.get(g.link.path);
      return st?.state === "ok" && (st.m !== g.link.m || st.s !== g.link.s);
    });
    if (!stale.length) return;
    const parsed = await readLinks(stale.filter((g) => /\.lnk$/i.test(g.link.path)).map((g) => g.link.path));
    const d = data();
    for (const g of stale) {
      const p = g.link.path;
      const st = states.get(p);
      if (/\.url$/i.test(p)) {
        const u = await readUrlShortcut(p);
        if (u) d.links[g.id] = { ...g.link, icon: u.icon, index: u.index, url: u.url, m: u.m, s: u.s };
      } else if (parsed[p]) {
        const l = parsed[p];
        d.links[g.id] = { ...g.link, icon: l.icon, index: l.index | 0, target: l.target, args: l.args, m: st.m, s: st.s };
      }
    }
    store.save();
    assemble();
  }

  // A Steam game's program, when its icon is needed and no shortcut points at
  // it: guessed once per installed build. With `all` false, a game whose
  // shortcut names an icon file that's there is skipped (no folder to walk).
  async function guessExes(list, all = false) {
    const d = data();
    const keyOf = (g) => `${lower(g.dir)}|${g.build || ""}`;
    const need = list.filter((g) => g.source === "steam" && g.dir && !(g.link?.target && g.exe) && d.exes[g.id]?.key !== keyOf(g));
    if (!need.length) return false;
    const named = all ? [] : need.map((g) => g.link?.icon).filter(Boolean);
    const states = await probe([...named, ...need.map((g) => g.dir)], bridge);
    let any = false;
    for (const g of need) {
      // A folder that can't be read now (its drive is out, say) is tried
      // again next time rather than remembered as having no program.
      if (states.get(g.dir)?.state !== "ok") continue;
      if (!all && g.link?.icon && states.get(g.link.icon)?.state === "ok") continue;
      d.exes[g.id] = { key: keyOf(g), exe: await guessExe(g.dir, [g.name, path.basename(g.dir)]).catch(() => "") };
      any = true;
    }
    if (any) { store.save(); assemble(); }
    return any;
  }

  const iconSources = (g) => {
    const list = [];
    if (g.link?.icon) list.push({ via: "shortcut", file: g.link.icon, index: g.link.index | 0 });
    if (g.shell) list.push({ via: "shortcut", shell: g.shell, stamp: g.dir || "" });
    if (g.exe) list.push({ via: "exe", file: g.exe, index: 0 });
    return list;
  };
  // What has to be there for the game to start: checked in order.
  const targets = (g) => {
    if (g.source === "added") return [g.kind !== "store" && g.path, g.kind === "lnk" && g.link?.target].filter(Boolean);
    if (g.source === "steam" || g.source === "epic") return [g.dir].filter(Boolean);
    return [];
  };

  async function iconsFor(ids) {
    const current = () => ids.map((id) => byId.get(id)).filter(Boolean);
    if (!current().length) return {};
    await freshenLinks(current());
    await guessExes(current());
    const item = (g) => ({ id: g.id, sources: iconSources(g), stamps: g.link?.path ? [g.link.path] : [], targets: targets(g) });
    const res = await icons.resolve(current().map(item));
    // A Steam game whose shortcut named an icon that turned out unusable falls
    // back to its program.
    const retry = current().filter((g) => g.source === "steam" && !res[g.id]?.icon && !g.exe);
    if (retry.length && await guessExes(retry, true)) {
      Object.assign(res, await icons.resolve(retry.map((g) => item(byId.get(g.id)))));
    }
    for (const [id, r] of Object.entries(res)) {
      if (r.missing) status.set(id, r.missing); else status.delete(id);
    }
    return res;
  }

  const find = (id) => {
    const g = byId.get(asString(id, "game"));
    if (!g) throw new Error("That game isn't in the library any more");
    return g;
  };

  function missingText(st, what) {
    if (st?.state === "drive") return `Drive ${st.drive}: isn't connected`;
    return `${what} isn't there any more`;
  }

  // Refuses a start that can only fail, with the reason: Windows' own message
  // for a broken shortcut can search the disk and the network for the target.
  // A launcher game whose folder is gone is left to its launcher, which can
  // offer to install it again; only a disconnected drive is caught.
  async function checkPresent(g) {
    const list = targets(g);
    if (!list.length) return;
    const states = await probe(list, bridge);
    for (const [i, p] of list.entries()) {
      const st = states.get(p);
      if (st?.state === "drive") throw new Error(missingText(st));
      if (st?.state === "missing" && g.source === "added") {
        throw new Error(missingText(st, i === 0 && g.kind !== "exe" ? "The shortcut" : "The program"));
      }
    }
  }

  handle("games:list", async (_e, opts) => {
    const mode = opts === true ? "force" : opts?.scan;
    if (mode === "force") await scan(true);
    else if (mode === "auto" && Date.now() - (data().fullAt || 0) > FULL_SCAN_AGE) {
      const p = scan(true);
      // The first look waits; later ones answer from the last list.
      if (!games.length) await p.catch(() => {});
    }
    return visible();
  });

  handle("games:icons", async (_e, ids) => {
    const list = (Array.isArray(ids) ? ids : []).slice(0, 48).filter((id) => typeof id === "string");
    return iconsFor(list);
  });

  handle("games:launch", async (_e, id) => {
    const g = find(id);
    await checkPresent(g);
    windows.yieldFocus();
    // Everything here is read back from games.json, so it's checked again.
    if (g.source === "steam") {
      if (!/^\d+$/.test(g.appid)) throw new Error("Invalid game");
      await shell.openExternal(`steam://rungameid/${g.appid}`);
    } else if (g.source === "epic") {
      if (!EPIC_URI.test(String(g.uri))) throw new Error("Invalid game");
      await shell.openExternal(g.uri);
    } else if (g.source === "xbox" || g.kind === "store") {
      if (!AUMID.test(String(g.aumid))) throw new Error("Invalid game");
      spawnDetached(EXPLORER, [`shell:AppsFolder\\${g.aumid}`]);
    } else {
      if (!/^[A-Za-z]:\\.+\.(lnk|url|exe)$/i.test(g.path)) throw new Error("Invalid game");
      // Windows starts it as a double-click would: the shortcut's arguments
      // and folder, or the program in its own folder.
      const err = await shell.openPath(g.path);
      if (err) throw new Error(err);
    }
    played()[g.id] = Date.now();
    store.save();
    return true;
  });

  handle("games:reveal", async (_e, id) => {
    const g = find(id);
    const target = g.source === "added" ? (g.kind === "store" ? "" : g.path) : g.dir;
    if (!target) throw new Error("No folder for this game");
    const st = (await probe([target], bridge)).get(target);
    if (st?.state === "drive") throw new Error(missingText(st));
    if (st?.state !== "ok") throw new Error(g.source === "added" ? "That file isn't there any more" : "Install folder not found");
    windows.yieldFocus();
    if (g.source === "added") { shell.showItemInFolder(target); return true; }
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return true;
  });

  const already = (g) => new Error(`${g.title} is already in your library`);

  // A shortcut or program you add, unless it's a game the library has.
  async function addFile(file, name) {
    const p = path.resolve(asString(file, "path"));
    if (!/\.(lnk|url|exe)$/i.test(p)) throw new Error("Add a shortcut (.lnk or .url) or a program (.exe)");
    const st = (await probe([p], bridge)).get(p);
    if (st?.state === "network") throw new Error("Games on a network drive can't be added");
    if (st?.state === "drive") throw new Error(missingText(st));
    if (st?.state !== "ok" || st.dir) throw new Error("That file isn't there");
    const id = `added:${crypto.createHash("sha1").update(p.toLowerCase()).digest("hex").slice(0, 16)}`;
    if (byId.has(id)) throw already(byId.get(id));
    const kind = path.extname(p).slice(1).toLowerCase();
    let link = null;
    if (kind === "lnk") {
      const l = (await readLinks([p]))[p];
      if (!l) throw new Error("That shortcut can't be read");
      link = { path: p, kind, icon: l.icon, index: l.index | 0, target: l.target, args: l.args, m: st.m, s: st.s };
    } else if (kind === "url") {
      const u = await readUrlShortcut(p);
      if (!u?.url) throw new Error("That shortcut can't be read");
      link = { path: p, kind, icon: u.icon, index: u.index, url: u.url, m: u.m, s: u.s };
      const s = /^steam:\/\/(?:rungameid|run|launch)\/(\d+)/i.exec(u.url);
      const same = s && games.find((g) => g.source === "steam" && g.appid === s[1]);
      if (same) throw already(same);
    }
    // A program of a Steam, Epic or Xbox game is that game. Two shortcuts to one
    // program can be two games (an emulator with different arguments).
    const exe = kind === "exe" ? p : kind === "lnk" && isExe(link.target) ? link.target : "";
    if (exe) {
      const e = lower(exe);
      const same = games.find((g) => g.source !== "added" && (g.matchExe === e || (g.matchDir && e.startsWith(g.matchDir))));
      if (same) throw already(same);
    }
    const d = data();
    d.added.push({ id, path: p, kind, name: String(name || path.basename(p, path.extname(p))).trim().slice(0, 120) || "Game", at: Date.now() });
    if (link) d.links[id] = link;
    changed();
    return view(byId.get(id));
  }

  // A Store app from the Start menu, started through its Start menu entry.
  function addStore(aumid, name) {
    if (!AUMID.test(aumid)) throw new Error("This app can't be added as a game");
    const same = games.find((g) => g.aumid && g.aumid.toLowerCase() === aumid.toLowerCase());
    if (same) throw already(same);
    const id = `added:${crypto.createHash("sha1").update(`store|${aumid.toLowerCase()}`).digest("hex").slice(0, 16)}`;
    data().added.push({ id, path: `shell:AppsFolder\\${aumid}`, kind: "store", aumid, name: String(name || "Game").slice(0, 120), at: Date.now() });
    changed();
    return view(byId.get(id));
  }

  handle("games:add", async (_e, req = {}) => {
    if (req?.browse) {
      const { canceled, filePaths } = await windows.withDialog((win) => dialog.showOpenDialog(win, {
        title: "Add a game", buttonLabel: "Add",
        filters: [{ name: "Programs", extensions: ["exe"] }], properties: ["openFile", "dontAddToRecent"]
      }));
      if (canceled || !filePaths?.[0]) return null;
      return addFile(filePaths[0]);
    }
    if (req?.app) {
      const entry = await desktop.resolve(req.app);
      // The shortcut first, since its icon is the one to show.
      if (/\.(lnk|url)$/i.test(entry.iconPath || "") && !paths.isUncPath(entry.iconPath)) return addFile(entry.iconPath, entry.name);
      if (entry.kind === "path") return addFile(entry.target, entry.name);
      if (isExe(entry.target)) return addFile(entry.target, entry.name);
      if (AUMID.test(entry.target)) return addStore(entry.target, entry.name);
      throw new Error("This app can't be added as a game");
    }
    return addFile(req?.path);
  });

  // Added games leave the library; found ones are hidden (and stop counting
  // for game mode) until you show them again.
  handle("games:remove", (_e, id) => {
    const g = find(id);
    const d = data();
    if (g.source === "added") {
      d.added = d.added.filter((a) => a.id !== g.id);
      delete d.links[g.id];
      icons.forget(g.id);
    } else if (!d.hidden.includes(g.id)) d.hidden.push(g.id);
    changed();
    icons.prune().catch(() => {});
    return true;
  });

  handle("games:hidden", () => games.filter((g) => g.hidden).map((g) => ({ id: g.id, name: g.title, source: g.source })));

  handle("games:unhide", (_e, id) => {
    const d = data();
    d.hidden = id ? d.hidden.filter((h) => h !== String(id)) : [];
    changed();
    return true;
  });

  handle("games:rename", (_e, id, name) => {
    const g = find(id);
    const next = String(name ?? "").trim().slice(0, 120);
    if (next && next !== g.name) data().names[g.id] = next;
    else delete data().names[g.id];
    changed();
    return view(byId.get(g.id));
  });

  // Once, a little after start, so game mode knows games installed since.
  const quick = setTimeout(() => scan(false).catch(() => {}), QUICK_SCAN_DELAY);

  return {
    // The game whose files the given program lives in, if any (hidden games
    // don't count).
    match(exe) {
      if (!exe) return null;
      const p = lower(exe);
      for (const g of games) {
        if (g.hidden) continue;
        if (g.matchExe === p || (g.matchDir && p.startsWith(g.matchDir))) return { id: g.id, name: g.title };
      }
      return null;
    },
    scan: (full) => scan(!!full),
    icons: (ids) => iconsFor(ids),
    list: () => games,
    stop: () => clearTimeout(quick),
    flush: () => store.flushSync()
  };
}

module.exports = { registerGames, parseVdf, guessExe };
