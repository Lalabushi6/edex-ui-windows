// Universal launcher: apps, open windows, files, commands, calculator, web
// search and paths from one search box. Ctrl+Shift+Space summons it from
// anywhere in Windows; ">" switches to command mode.
import { h } from "../core/dom.js";
import { icon, iconSvg, fileKind } from "../core/icons.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { emit, booted } from "../core/bus.js";
import { allCommands } from "../core/commands.js";
import { openModal, toast, contextMenu, copyText, cleanError } from "../core/ui.js";
import { openUrl } from "../core/links.js";
import { loadGames, launchGame, gameArt, gameMenu } from "./games.js";
import { profiles, switchProfile } from "./profiles.js";
import { evaluate, looksLikeMath, formatNumber } from "./calc.js";
import { convert, parseDuration } from "./convert.js";

function humanDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && `${h} h`, m && `${m} min`, sec && `${sec} s`].filter(Boolean).join(" ") || "0 s";
}
import { openViewer } from "./viewer.js";

const api = window.edex;
const cache = { apps: null, appsAt: 0, index: null, indexAt: 0, appIcons: new Map(), exeIcons: new Map() };
let openInstance = null;

const SETTINGS_PAGES = [
  ["Display", "ms-settings:display"], ["Sound", "ms-settings:sound"], ["Network & internet", "ms-settings:network"],
  ["Bluetooth & devices", "ms-settings:bluetooth"], ["Windows Update", "ms-settings:windowsupdate"],
  ["Installed apps", "ms-settings:appsfeatures"], ["Personalization", "ms-settings:personalization"],
  ["Power & sleep", "ms-settings:powersleep"], ["Storage", "ms-settings:storagesense"], ["Privacy & security", "ms-settings:privacy"],
  ["Default apps", "ms-settings:defaultapps"], ["Notifications", "ms-settings:notifications"], ["Windows Settings", "ms-settings:"]
];

function usageMap() {
  try { return JSON.parse(localStorage.getItem("edex.launcherUsage") || "{}"); } catch (_) { return {}; }
}
function recordUsage(key) {
  const map = usageMap();
  map[key] = (map[key] || 0) + 1;
  try { localStorage.setItem("edex.launcherUsage", JSON.stringify(map)); } catch (_) {}
}

// Higher is better; -1 means no match.
function score(query, text) {
  if (!query) return 1;
  const t = text.toLowerCase();
  const idx = t.indexOf(query);
  if (idx === 0) return 1000 - Math.min(200, t.length);
  if (idx > 0) {
    const boundary = /[\s\-_.\\/(]/.test(t[idx - 1]);
    return (boundary ? 800 : 500) - idx;
  }
  // Subsequence match: consecutive letters and word starts score well;
  // letters scattered across the string do not count as a match at all.
  let qi = 0, s = 0, last = -2;
  for (let i = 0; i < t.length && qi < query.length; i++) {
    if (t[i] !== query[qi]) continue;
    s += last === i - 1 ? 12 : (i === 0 || /[\s\-_.\\/]/.test(t[i - 1]) ? 10 : 3);
    last = i;
    qi++;
  }
  if (qi < query.length || s < query.length * 7) return -1;
  return Math.min(400, s * 4);
}

function scoreItem(query, item) {
  const base = score(query, item.title);
  if (base >= 0 || !query) return base;
  return item.match && item.match.toLowerCase().includes(query) ? 250 : -1;
}

function highlight(text, query) {
  if (!query) return [text];
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return [text];
  return [text.slice(0, idx), h("mark", null, text.slice(idx, idx + query.length)), text.slice(idx + query.length)];
}

async function loadApps(force = false) {
  if (!force && cache.apps && Date.now() - cache.appsAt < 120000) return cache.apps;
  try {
    cache.apps = await api.apps.list(force);
    cache.appsAt = Date.now();
  } catch (_) {
    cache.apps = cache.apps || [];
  }
  return cache.apps;
}

async function loadIndex() {
  if (cache.index && Date.now() - cache.indexAt < 180000) return cache.index;
  cache.index = await api.fs.quickIndex().catch(() => []);
  cache.indexAt = Date.now();
  return cache.index;
}

export async function appIcons(ids) {
  const missing = ids.filter((id) => !cache.appIcons.has(id));
  if (missing.length) {
    const res = await api.apps.icons(missing).catch(() => ({}));
    for (const id of missing) cache.appIcons.set(id, res[id] || null);
  }
  return Object.fromEntries(ids.map((id) => [id, cache.appIcons.get(id)]));
}

export async function exeIcons(paths) {
  const missing = [...new Set(paths.filter((p) => p && !cache.exeIcons.has(p)))];
  if (missing.length) {
    const res = await api.fs.icons(missing).catch(() => ({}));
    for (const p of missing) cache.exeIcons.set(p, res[p] || null);
  }
  return Object.fromEntries(paths.map((p) => [p, cache.exeIcons.get(p)]));
}

export function loadAppsCached(force) {
  return loadApps(force);
}

export async function launchApp(app, opts = {}) {
  try {
    await api.apps.launch(app.id, opts);
    recordUsage(`app:${app.id}`);
    sfx.play("granted");
  } catch (e) {
    toast(`Could not start ${app.name}: ${cleanError(e)}`, { level: "warn" });
  }
}

export function togglePinnedApp(id) {
  const pins = settings.get("pinnedApps") || [];
  settings.set({ pinnedApps: pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id] });
}

const FILTERS = [["all", "All"], ["apps", "Apps"], ["games", "Games"], ["windows", "Windows"], ["files", "Files"], ["commands", "Commands"]];
const GROUP_WEIGHT = { Pinned: 220, Apps: 200, Games: 190, "Open windows": 150, Commands: 100, Workspaces: 95, "Windows Settings": 80, Themes: 60 };
const GAME_SOURCE = { steam: "Steam game", epic: "Epic Games game", xbox: "Xbox game" };

export function openLauncher(opts = {}) {
  if (openInstance) {
    // Re-opening keeps what was typed unless the caller asks for something.
    if (opts.query !== undefined || opts.filter) openInstance.setQuery(opts.query ?? "", opts.filter);
    else openInstance.focus();
    return;
  }
  const { query = "", filter = "all" } = opts;
  sfx.play("expand");
  let activeFilter = filter;
  let results = [];
  let activeIdx = 0;
  let windows = [];
  let themes = [];
  let games = [];
  let pathEntries = { dir: null, entries: [] };
  let renderToken = 0;
  // Windows Search index results for the current query (names, or text
  // inside files when the query is in quotes).
  let indexHits = { q: "", content: false, items: [] };
  let indexTimer = null;

  const input = h("input", { class: "launcher-input", spellcheck: false, placeholder: "Search apps, files, windows — > commands, = calculate, \"text\" inside files, ? ask Claude", "data-autofocus": true });
  input.value = query;
  const chips = h("div", { class: "launcher-filters" });
  const list = h("div", { class: "launcher-results" });
  const foot = h("div", { class: "launcher-foot" },
    h("span", null, h("span", { class: "kbd" }, "↑↓"), " select"),
    h("span", null, h("span", { class: "kbd" }, "Enter"), " open"),
    h("span", null, h("span", { class: "kbd" }, "Ctrl+Enter"), " reveal / alt"),
    h("span", null, h("span", { class: "kbd" }, "Tab"), " filter"),
    h("span", null, "right-click for more"));

  const renderChips = () => chips.replaceChildren(...FILTERS.map(([id, label]) => h("button", {
    class: `chip${activeFilter === id ? " active" : ""}`, type: "button",
    onclick: () => { activeFilter = id; renderChips(); refresh(); input.focus(); }
  }, label)));
  renderChips();

  const modal = openModal(() => h("div", { class: "launcher-root", style: { display: "contents" } },
    h("div", { class: "launcher-input-row", svg: iconSvg("search") }, input), chips, list, foot), {
    className: "launcher",
    label: "Launcher",
    onClose: () => { openInstance = null; }
  });

  const close = () => modal.close();
  const run = (r, alt = false, event) => {
    if (!r) return;
    close();
    recordUsage(r.key);
    if (alt && r.alt) r.alt(event);
    else r.run(event);
  };

  function buildResults() {
    const raw = input.value;
    let q = raw.trim();
    let mode = activeFilter;
    if (q.startsWith(">")) { mode = "commands"; q = q.slice(1).trim(); }
    const ql = q.toLowerCase();
    const usage = usageMap();
    const out = [];
    const groups = [];
    const add = (group, items, limit) => {
      const ranked = items
        .map((it) => {
          const s = scoreItem(ql, it);
          return { ...it, group, score: s < 0 ? s : s + Math.min(150, (usage[it.key] || 0) * 15) };
        })
        .filter((it) => it.score >= 0)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
        .slice(0, limit);
      // Launching an app or switching windows is the common intent, so those
      // groups win ties against a similarly named file.
      if (ranked.length) groups.push({ items: ranked, best: ranked[0].score + (GROUP_WEIGHT[group] || 0) });
    };
    const want = (m) => mode === "all" || mode === m;
    const lim = (all, focused) => (mode === "all" ? all : focused);

    // Calculator
    if (mode === "all" && looksLikeMath(q)) {
      const value = evaluate(q.replace(/^=/, ""));
      if (value !== null) {
        const text = formatNumber(value);
        out.push({ key: "calc", group: "Calculator", title: `= ${text}`, sub: `${q.replace(/^=/, "")}  ·  Enter to copy`, icon: "calc", run: () => copyText(text, `Copied ${text}`) });
      }
    }

    if (mode === "all") {
      // Unit conversion: "10 km to mi", "72 f in c", "5 gb to mib"
      const c = convert(q);
      if (c) out.push({ key: "convert", group: "Calculator", title: `= ${c.text}`, sub: `${c.from} → ${c.to}  ·  Enter to copy`, icon: "calc", run: () => copyText(String(c.value), `Copied ${c.text}`) });

      // Timers: "timer 5m tea", "remind 1h30m stretch", "stopwatch"
      const t = /^(?:timer|countdown|remind(?:er)?(?: me)?(?: in)?)\s+(\S+)(?:\s+(.+))?$/i.exec(q);
      const ms = t ? parseDuration(t[1]) : null;
      if (ms && ms <= 7 * 86400000) {
        const label = (t[2] || "").trim().slice(0, 60);
        out.push({ key: "timer", group: "Timer", title: `Start a ${humanDuration(ms)} timer${label ? ` — ${label}` : ""}`, sub: "Alarm sound and Windows notification when it ends", icon: "timer", run: () => emit("timer-start", { ms, label }) });
      }
      if (/^stop ?watch$/i.test(q)) out.push({ key: "stopwatch", group: "Timer", title: "Start the stopwatch", sub: "Timer widget", icon: "timer", run: () => emit("stopwatch-start") });
      if (/^(pomodoro|focus( timer| session)?)$/i.test(q)) out.push({ key: "pomodoro", group: "Timer", title: "Start a focus session", sub: "Pomodoro cycles in the Timer widget", icon: "tomato", run: () => emit("pomodoro-start") });

      // Shell commands: "$ ipconfig /all"
      const shellCmd = /^\$\s*(\S.*)$/.exec(q);
      if (shellCmd) out.push({ key: "shellcmd", group: "Terminal", title: `Run  ${shellCmd[1]}`, sub: "In the active terminal (or a new one)", icon: "terminal", run: () => emit("terminal-run", { command: shellCmd[1] }) });

      // Ask Claude: "? how do I find large files"
      const ask = /^\?\s*(\S.*)$/.exec(q);
      if (ask) {
        const on = !!settings.get("aiEnabled");
        out.push({
          key: "ai", group: "Claude", title: `Ask Claude: ${ask[1]}`, icon: "ai",
          sub: on ? "AI assistant · answers stream into a panel" : "Turn the AI assistant on in Settings → Privacy",
          run: () => emit("ai-ask", { prompt: ask[1] })
        });
      }
    }

    // Paths typed directly
    if (mode === "all" && /^([a-z]:[\\/]|\\\\|~[\\/]?$|~[\\/])/i.test(q)) {
      out.push({
        key: `path:${q}`, group: "Path", title: q, sub: "Open this location", icon: "folder",
        run: () => openPathLike(q)
      });
      if (pathEntries.dir && pathEntries.entries.length) {
        const leaf = fmt.basename(q.endsWith("\\") || q.endsWith("/") ? "" : q).toLowerCase();
        pathEntries.entries.filter((e) => !leaf || e.name.toLowerCase().startsWith(leaf)).slice(0, 8).forEach((e) => out.push({
          key: `path:${e.path}`, group: "Path", title: e.name, sub: e.path, icon: fileKind(e.name, e.isDir),
          run: () => (e.isDir ? emit("open-path", { path: e.path }) : api.fs.open(e.path).catch((err) => toast(cleanError(err), { level: "warn" }))),
          alt: () => emit("open-path", { path: e.isDir ? e.path : fmt.dirname(e.path), select: e.isDir ? undefined : e.path }),
          complete: e.isDir ? `${e.path}\\` : e.path
        }));
      }
    }

    // URLs
    if (mode === "all" && /^(https?:\/\/\S+|[\w-]+(\.[\w-]+)+(\/\S*)?)$/i.test(q) && !/\s/.test(q) && !/^[\d.]+$/.test(q)) {
      const url = /^https?:/i.test(q) ? q : `https://${q}`;
      out.push({
        key: `url:${url}`, group: "Web", title: url, sub: settings.get("browserLinks") ? "Open in an eDEX browser tab" : "Open in browser", icon: "globe", run: () => openUrl(url),
        menu: (e) => contextMenu(e, [
          { label: "Open in an eDEX browser tab", icon: "globe", run: () => { close(); emit("open-browser", { url }); } },
          { label: "Open in your browser", icon: "external", run: () => { close(); openUrl(url, { external: true }); } }
        ])
      });
    }

    if (want("apps")) {
      const pinned = new Set(settings.get("pinnedApps") || []);
      const apps = (cache.apps || []).map((a) => ({
        key: `app:${a.id}`, title: a.name, sub: pinned.has(a.id) ? "Pinned app" : a.source === "store" ? "Store app" : a.source === "desktop" ? "Desktop shortcut" : "App",
        app: a, icon: "app", run: () => launchApp(a), alt: () => api.apps.reveal(a.id).catch((e) => toast(cleanError(e), { level: "warn" })),
        menu: (e) => contextMenu(e, [
          { label: "Open", icon: "external", run: () => { close(); launchApp(a); } },
          { label: "Run as administrator", icon: "lock", run: () => { close(); launchApp(a, { admin: true }); } },
          { label: pinned.has(a.id) ? "Unpin from dock" : "Pin to dock", icon: "pin", run: () => { togglePinnedApp(a.id); refresh(); } },
          { label: "Open file location", icon: "folder", run: () => { close(); api.apps.reveal(a.id).catch((err) => toast(cleanError(err), { level: "warn" })); } }
        ])
      }));
      if (!q && mode === "all") {
        const pinnedApps = apps.filter((a) => pinned.has(a.app.id));
        if (pinnedApps.length) add("Pinned", pinnedApps, 12);
      }
      if (q || mode === "apps") add("Apps", apps, lim(8, 400));
    }

    if (want("games") && games.length) {
      const items = games.map((g) => ({
        key: `game:${g.id}`, title: g.name, sub: GAME_SOURCE[g.source] || "Game", art: gameArt(g), icon: "gamepad",
        run: () => launchGame(g),
        alt: () => api.games.reveal(g.id).catch((e) => toast(cleanError(e), { level: "warn" })),
        menu: (e) => gameMenu(e, g, close)
      }));
      if (q || mode === "games") add("Games", items, lim(5, 300));
    }

    if (want("windows")) {
      add("Open windows", windows.map((w) => ({
        key: `win:${w.app}`, title: w.title, match: `${w.title} ${w.app}`, sub: w.app || "Window", exe: w.exe, icon: "window",
        run: () => api.win.focus(w.hwnd),
        alt: () => api.win.close(w.hwnd),
        menu: (e) => contextMenu(e, [
          { label: "Switch to", icon: "window", run: () => { close(); api.win.focus(w.hwnd); } },
          { label: "Show as a tab in eDEX", icon: "apptab", run: () => { close(); emit("open-app-tab", w); } },
          { label: "Minimize", icon: "minimize", run: () => api.win.minimize(w.hwnd).then(() => refreshWindows()) },
          { label: "Close window", icon: "close", danger: true, run: () => api.win.close(w.hwnd).then(() => setTimeout(refreshWindows, 400)) }
        ])
      })), lim(q ? 5 : 8, 50));
    }

    if (want("commands")) {
      const cmds = allCommands().map((c) => ({
        key: `cmd:${c.id}`, title: c.title, match: `${c.title} ${c.keywords || ""}`, sub: c.keys ? [].concat(c.keys)[0] : (c.category || "Command"),
        icon: c.icon || "command", run: () => c.run()
      }));
      const themeItems = themes.map((t) => ({
        key: `theme:${t.id}`, title: `Theme: ${t.name}`, match: `theme ${t.name}`, sub: t.id === settings.get("theme") ? "Current theme" : "Apply theme",
        icon: "palette", swatch: t.rgb, run: () => settings.set({ theme: t.id })
      }));
      const winSettings = SETTINGS_PAGES.map(([label, uri]) => ({
        key: `ms:${uri}`, title: `Windows: ${label}`, match: `windows settings ${label}`, sub: "Open Windows Settings", icon: "gear",
        run: () => api.shell.openSettings(uri)
      }));
      const current = settings.get("activeProfile") || "main";
      const wsItems = profiles().map((p) => ({
        key: `ws:${p.id}`, title: `Workspace: ${p.name}`, match: `workspace profile switch ${p.name}`, sub: p.id === current ? "Current workspace" : "Switch to it",
        icon: "layers", run: () => switchProfile(p.id)
      }));
      if (q || mode === "commands") {
        add("Commands", cmds, lim(6, 100));
        add("Workspaces", wsItems, lim(3, 12));
        add("Themes", themeItems, lim(3, 60));
        add("Windows Settings", winSettings, lim(3, 20));
      }
    }

    if (want("files")) {
      const recent = [...(settings.get("recentFiles") || []), ...(settings.get("recentFolders") || [])];
      const recentSet = new Set(recent.map(fmt.pathKey));
      const fileItem = (p, isDir, recentFlag) => ({
        key: `file:${fmt.pathKey(p)}`, title: fmt.basename(p) || p, sub: p, icon: fileKind(fmt.basename(p), isDir), isRecent: recentFlag,
        run: () => (isDir ? emit("open-path", { path: p }) : api.fs.open(p).then((ok) => ok && rememberFile(p)).catch((e) => toast(cleanError(e), { level: "warn" }))),
        alt: () => emit("open-path", { path: isDir ? p : fmt.dirname(p), select: isDir ? undefined : p }),
        menu: (e) => contextMenu(e, [
          { label: "Open", icon: "external", run: () => { close(); fileItem(p, isDir).run(); } },
          !isDir && { label: "Preview", icon: "eye", run: () => { close(); openViewer(p); } },
          { label: isDir ? "Open in explorer" : "Show in folder", icon: "folder", run: () => { close(); fileItem(p, isDir).alt(); } },
          isDir && { label: "Open terminal here", icon: "terminal", run: () => { close(); emit("open-terminal", { cwd: p }); } },
          { label: "Copy path", icon: "copy", run: () => copyText(p, "Path copied") }
        ])
      });
      const recentItems = recent.map((p, i) => fileItem(p, i >= (settings.get("recentFiles") || []).length, true));
      if (!q && mode === "all") add("Recent", recentItems, 6);
      else if (q || mode === "files") {
        const indexed = (cache.index || []).filter((e) => !recentSet.has(fmt.pathKey(e.path)));
        const items = [...recentItems, ...indexed.map((e) => fileItem(e.path, e.isDir, false))];
        add(q ? "Files" : "Recent & indexed files", items, lim(8, 200));
      }
      // Whole-PC results from the Windows Search index, in its rank order.
      // A quoted query searches inside documents and is listed first.
      if (q && indexHits.q === raw.trim() && indexHits.items.length) {
        const seen = new Set([...recentSet, ...(cache.index || []).map((e) => fmt.pathKey(e.path))]);
        const fresh = indexHits.items.filter((e) => !seen.has(fmt.pathKey(e.path)));
        const items = fresh.slice(0, lim(indexHits.content ? 10 : 6, 60)).map((e) => ({
          ...fileItem(e.path, e.isDir, false),
          group: indexHits.content ? "Inside files" : "On this PC",
          sub: `${e.path}${e.mtime ? `  ·  ${fmt.dateTime(e.mtime)}` : ""}`,
          score: 0
        }));
        if (items.length) groups.push({ items, best: indexHits.content ? 5000 : 420 });
      }
    }

    // With a query, the group holding the strongest match comes first.
    if (q) groups.sort((a, b) => b.best - a.best);
    for (const g of groups) out.push(...g.items);

    if (!q && mode === "all" && (cache.apps || []).length) {
      const pinned = new Set(settings.get("pinnedApps") || []);
      out.push(...cache.apps.filter((a) => !pinned.has(a.id)).map((a) => ({
        key: `app:${a.id}`, group: "All apps", title: a.name, sub: a.source === "store" ? "Store app" : "App", app: a, icon: "app",
        run: () => launchApp(a), alt: () => api.apps.reveal(a.id).catch(() => {}),
        menu: (e) => contextMenu(e, [
          { label: "Open", icon: "external", run: () => { close(); launchApp(a); } },
          { label: "Run as administrator", icon: "lock", run: () => { close(); launchApp(a, { admin: true }); } },
          { label: "Pin to dock", icon: "pin", run: () => { togglePinnedApp(a.id); refresh(); } }
        ])
      })));
    }

    if (q && mode === "all") {
      const url = (settings.get("webSearchUrl") || "https://www.google.com/search?q=%s").replace("%s", encodeURIComponent(q));
      out.push({
        key: "web", group: "Web", title: `Search the web for “${q}”`, sub: url.replace(/^https?:\/\//, "").split("/")[0], icon: "search", run: () => openUrl(url),
        menu: (e) => contextMenu(e, [
          { label: "Search in an eDEX browser tab", icon: "globe", run: () => { close(); emit("open-browser", { url }); } },
          { label: "Search in your browser", icon: "external", run: () => { close(); openUrl(url, { external: true }); } }
        ])
      });
    }
    return { items: out, q: ql };
  }

  function render() {
    const token = ++renderToken;
    const { items, q } = buildResults();
    results = items;
    activeIdx = Math.min(activeIdx, Math.max(0, results.length - 1));
    const frag = document.createDocumentFragment();
    let group = null;
    const wantExeIcons = [];
    iconObserver.disconnect();
    iconQueue.clear();
    results.slice(0, 250).forEach((r, i) => {
      if (r.group !== group) {
        group = r.group;
        frag.append(h("div", { class: "launcher-group" }, group));
      }
      const iconBox = h("span", { class: "result-icon" });
      if (r.app) {
        const url = cache.appIcons.get(r.app.id);
        if (url) iconBox.append(h("img", { src: url, alt: "" }));
        else {
          iconBox.append(h("span", { class: "letter-icon" }, r.title[0]?.toUpperCase() || "?"));
          if (r.app.hasIcon && !cache.appIcons.has(r.app.id)) {
            iconBox.dataset.appIcon = r.app.id;
            iconObserver.observe(iconBox);
          }
        }
      } else if (r.exe) {
        const url = cache.exeIcons.get(r.exe);
        iconBox.append(url ? h("img", { src: url, alt: "" }) : icon("window"));
        if (!cache.exeIcons.has(r.exe)) wantExeIcons.push([r.exe, iconBox]);
      } else if (r.art) {
        iconBox.append(h("img", { class: "game-thumb", src: r.art, alt: "" }));
      } else if (r.swatch) {
        iconBox.append(h("span", { class: "theme-swatch", style: { background: `rgb(${r.swatch.join(",")})`, color: `rgb(${r.swatch.join(",")})` } }));
      } else iconBox.append(icon(r.icon || "file"));
      const el = h("button", {
        class: `result${i === activeIdx ? " active" : ""}`, type: "button", dataset: { i },
        onclick: (e) => run(r, e.ctrlKey, e),
        onmousemove: () => { if (activeIdx !== i) setActive(i, false); },
        oncontextmenu: (e) => { if (r.menu) r.menu(e); else e.preventDefault(); }
      },
      iconBox,
      h("span", { class: "result-text" },
        h("div", { class: "result-title" }, ...highlight(r.title, q)),
        r.sub && h("div", { class: "result-sub" }, r.sub)),
      i === activeIdx ? h("span", { class: "result-hint" }, "↵") : null);
      frag.append(el);
    });
    if (!results.length) frag.append(h("div", { class: "empty" }, "No results"));
    list.replaceChildren(frag);
    list.querySelector(".result.active")?.scrollIntoView({ block: "nearest" });

    if (wantExeIcons.length) {
      exeIcons(wantExeIcons.map(([p]) => p)).then((map) => {
        if (token !== renderToken) return;
        for (const [p, box] of wantExeIcons) if (map[p] && box.isConnected) box.replaceChildren(h("img", { src: map[p], alt: "" }));
      });
    }
  }

  // App icons load only for results scrolled into (or near) view.
  const iconQueue = new Set();
  let iconTimer = null;
  const iconObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      iconQueue.add(entry.target);
      iconObserver.unobserve(entry.target);
    }
    clearTimeout(iconTimer);
    iconTimer = setTimeout(async () => {
      const boxes = [...iconQueue].filter((b) => b.isConnected);
      iconQueue.clear();
      const ids = [...new Set(boxes.map((b) => b.dataset.appIcon))].slice(0, 80);
      if (!ids.length) return;
      const map = await appIcons(ids);
      for (const b of boxes) {
        const url = map[b.dataset.appIcon];
        if (url && b.isConnected) b.replaceChildren(h("img", { src: url, alt: "" }));
      }
    }, 40);
  }, { root: list, rootMargin: "240px" });

  function setActive(i, scroll = true) {
    const els = list.querySelectorAll(".result");
    els[activeIdx]?.classList.remove("active");
    els[activeIdx]?.querySelector(".result-hint")?.remove();
    activeIdx = Math.max(0, Math.min(results.length - 1, i));
    const el = els[activeIdx];
    if (!el) return;
    el.classList.add("active");
    el.append(h("span", { class: "result-hint" }, "↵"));
    if (scroll) el.scrollIntoView({ block: "nearest" });
  }

  const refresh = () => { activeIdx = 0; render(); };
  async function refreshWindows() {
    windows = await api.win.list().catch(() => []);
    render();
  }
  async function updatePathEntries() {
    const q = input.value.trim();
    if (!/^([a-z]:[\\/]|\\\\)/i.test(q)) { pathEntries = { dir: null, entries: [] }; return; }
    const dir = /[\\/]$/.test(q) ? q : fmt.dirname(q);
    if (pathEntries.dir && fmt.pathsEqual(pathEntries.dir, dir)) return;
    try {
      const res = await api.fs.list(dir);
      pathEntries = { dir, entries: res.entries.filter((e) => settings.get("showHidden") || !e.hidden) };
    } catch (_) {
      pathEntries = { dir, entries: [] };
    }
    render();
  }

  // Queries the index a moment after typing stops; results that arrive
  // after the text changed are dropped.
  function scheduleIndex() {
    clearTimeout(indexTimer);
    const raw = input.value.trim();
    const quoted = /^"([^"]{2,})"?$/.exec(raw);
    const text = quoted ? quoted[1].trim() : raw;
    const skip = settings.get("indexSearch") === false || text.length < 2 || /^[>=$?]/.test(raw) ||
      /^([a-z]:[\\/]|\\\\|~)/i.test(raw) || /^https?:/i.test(raw) || looksLikeMath(raw);
    if (skip) { if (indexHits.items.length) { indexHits = { q: "", content: false, items: [] }; render(); } return; }
    indexTimer = setTimeout(async () => {
      let items = [];
      try { items = await api.fs.indexSearch(text, { content: !!quoted, max: quoted ? 25 : 30 }); } catch (_) {}
      if (input.value.trim() !== raw) return;
      indexHits = { q: raw, content: !!quoted, items };
      render();
    }, 220);
  }

  input.addEventListener("input", () => { refresh(); updatePathEntries(); scheduleIndex(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === "PageDown") { e.preventDefault(); setActive(activeIdx + 8); }
    else if (e.key === "PageUp") { e.preventDefault(); setActive(activeIdx - 8); }
    else if (e.key === "Enter") { e.preventDefault(); run(results[activeIdx], e.ctrlKey, e); }
    else if (e.key === "Tab") {
      e.preventDefault();
      const r = results[activeIdx];
      if (r?.complete && !e.shiftKey) { input.value = r.complete; refresh(); updatePathEntries(); return; }
      const i = FILTERS.findIndex(([id]) => id === activeFilter);
      activeFilter = FILTERS[(i + (e.shiftKey ? -1 : 1) + FILTERS.length) % FILTERS.length][0];
      renderChips();
      refresh();
    }
  });

  openInstance = {
    setQuery(q, f) {
      input.value = q;
      activeFilter = f || activeFilter;
      renderChips();
      refresh();
      scheduleIndex();
      input.focus();
    },
    focus() {
      input.focus();
      input.select();
    },
    toggle() { close(); }
  };

  render();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  loadApps().then(render);
  loadGames().then((l) => { games = l || []; render(); }).catch(() => {});
  refreshWindows();
  loadIndex().then(render);
  api.themes.list().then((t) => { themes = t; render(); }).catch(() => {});
  updatePathEntries();
  scheduleIndex();
}

export function launcherIsOpen() {
  return !!openInstance;
}

export function closeLauncher() {
  openInstance?.toggle();
}

function rememberFile(p) {
  const list = (settings.get("recentFiles") || []).filter((x) => !fmt.pathsEqual(x, p));
  settings.set({ recentFiles: [p, ...list].slice(0, 24) });
}

async function openPathLike(q) {
  let p = q;
  if (p.startsWith("~")) p = (await api.fs.home()) + p.slice(1);
  try {
    const st = await api.fs.stat(p);
    if (st.isDir) emit("open-path", { path: st.path });
    else {
      await api.fs.open(st.path);
      rememberFile(st.path);
    }
  } catch (e) {
    toast(`Cannot open ${q}: ${cleanError(e)}`, { level: "warn" });
  }
}

// The app list and file index are warmed once the boot sequence is over and
// the page is idle, so the launcher opens instantly without competing with
// startup.
export function preloadLauncher() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 500));
  booted.then(() => setTimeout(() => idle(() => { loadApps(); loadIndex(); }, { timeout: 4000 }), 1500));
}

