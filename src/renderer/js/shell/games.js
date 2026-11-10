// Game library (interface side): your games with square icons, in a grid
// (Ctrl+Shift+G, the dock's game button), in the launcher and in the dock.
// Game mode's top-bar badge lives here too.
//
// Icons are made once in the main process and kept on disk. They are asked for
// only while something shows them, a few at a time, and the asking stops when
// the library closes.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { openModal, toast, contextMenu, cleanError, prompt } from "../core/ui.js";
import { runCommand } from "../core/commands.js";
import { loadAppsCached, appIcons } from "./launcher.js";

const api = window.edex;
export const SOURCE = { steam: "Steam", epic: "Epic Games", xbox: "Xbox", added: "Added by you" };
const FILTERS = [["all", "All"], ["steam", "Steam"], ["epic", "Epic"], ["xbox", "Xbox"], ["added", "Added"]];
let cache = null;
let loading = null;
const listeners = new Set();
const checked = new Set(); // games whose icons were asked for since the last opening or scan

// Listeners get (list, kind): kind "icons" when only icons or "not found"
// notes changed.
export const onGames = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = (kind = "list") => { for (const fn of listeners) { try { fn(cache, kind); } catch (_) {} } };

// Plain fetches share one request; a scan request always goes through (the
// main process runs one scan at a time).
function fetchGames(scan) {
  const req = () => api.games.list(scan ? { scan } : undefined)
    .then((list) => { cache = list; changed(); return list; })
    .catch(() => cache || []);
  if (scan) return req();
  if (!loading) loading = req().finally(() => { loading = null; });
  return loading;
}

// The last list (no scan); force: look for new games now.
export function loadGames(force = false) {
  if (force) return fetchGames("force");
  return cache ? Promise.resolve(cache) : fetchGames();
}

// A scan or a change in the library: the new list, with icons checked again.
api.games.onChange(() => { checked.clear(); fetchGames(); });

// A game's square icon, or the plain game icon on the same square.
export function gameIcon(g, cls = "game-icon") {
  return g?.icon
    ? h("img", { class: cls, src: fmt.fileUrl(g.icon), alt: "", draggable: false })
    : h("span", { class: `${cls} game-icon-plain` }, icon("gamepad"));
}

// Asks for the icons of games on screen, eight at a time, while alive() holds.
export async function ensureIcons(ids, alive = () => true) {
  const todo = [...new Set(ids)].filter((id) => !checked.has(id));
  for (let i = 0; i < todo.length; i += 8) {
    if (!alive()) return;
    const chunk = todo.slice(i, i + 8);
    chunk.forEach((id) => checked.add(id));
    let res;
    try { res = await api.games.icons(chunk); } catch (_) { chunk.forEach((id) => checked.delete(id)); continue; }
    let any = false;
    for (const [id, r] of Object.entries(res || {})) {
      const g = cache?.find((x) => x.id === id);
      if (g && (g.icon !== r.icon || g.missing !== r.missing)) { g.icon = r.icon; g.missing = r.missing; any = true; }
    }
    if (any) changed("icons");
  }
}

const missingText = (g) => (g.missing === "drive" ? "Drive not connected" : g.missing ? "Not found" : "");

export async function launchGame(g) {
  try {
    await api.games.launch(g.id);
    sfx.play("granted");
    toast(`Starting ${g.name}…`, { timeout: 2200 });
    g.lastPlayed = Date.now();
    return true;
  } catch (e) {
    toast(`Couldn't start ${g.name}: ${cleanError(e)}`, { level: "warn" });
    return false;
  }
}

const warn = (e) => toast(cleanError(e), { level: "warn" });

async function renameGame(g) {
  const name = await prompt({ title: "Rename game", message: "Leave it empty to go back to the original name.", value: g.name, confirmLabel: "Rename" });
  if (name === null || name === undefined) return;
  api.games.rename(g.id, name).catch(warn);
}

export function gameMenu(e, g, after) {
  const pinned = (settings.get("pinnedApps") || []).includes(`game:${g.id}`);
  contextMenu(e, [
    { label: `Play ${g.name}`, icon: "play", run: () => { launchGame(g).then((ok) => ok && after?.()); } },
    { label: pinned ? "Unpin from dock" : "Pin to dock", icon: "pin", run: () => {
      const pins = settings.get("pinnedApps") || [];
      const id = `game:${g.id}`;
      settings.set({ pinnedApps: pinned ? pins.filter((p) => p !== id) : [...pins, id] });
    } },
    g.reveal === "folder" && { label: "Open install folder", icon: "folder", run: () => api.games.reveal(g.id).catch(warn) },
    g.reveal === "file" && { label: g.kind === "exe" ? "Show program in folder" : "Show shortcut in folder", icon: "folder", run: () => api.games.reveal(g.id).catch(warn) },
    { label: "Rename…", icon: "edit", run: () => renameGame(g) },
    { label: g.source === "added" ? "Remove from library" : "Hide from library", icon: g.source === "added" ? "trash" : "close", run: () => {
      api.games.remove(g.id).then(() => toast(g.source === "added" ? `Removed ${g.name}` : `${g.name} is hidden. Settings → Games shows it again.`, { timeout: 3200 })).catch(warn);
    } },
    { separator: true },
    { label: "Rescan library", icon: "refresh", run: () => loadGames(true).then((l) => toast(`${l.length} game${l.length === 1 ? "" : "s"}`, { level: "ok" })) }
  ]);
}

export async function addGame(req) {
  try {
    const g = await api.games.add(req);
    if (g) toast(`Added ${g.name}`, { level: "ok" });
    return g;
  } catch (e) {
    toast(`Couldn't add that game: ${cleanError(e)}`, { level: "warn" });
    return null;
  }
}

// Pick a game from your apps (its Start menu or desktop shortcut comes along,
// with its icon), or browse for a program.
export async function openAddGame() {
  let closed = false;
  const apps = await loadAppsCached().catch(() => []);
  openModal((close) => {
    const search = h("input", { class: "input", placeholder: "Search your apps", spellcheck: false, "data-autofocus": true });
    const list = h("div", { class: "game-add-list" });
    const render = async () => {
      const q = search.value.trim().toLowerCase();
      const rows = apps.filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 200);
      list.replaceChildren(...(rows.length ? rows.map((a) => h("button", {
        class: "game-add-row", type: "button", dataset: { app: a.id },
        onclick: async () => { if (await addGame({ app: a.id })) close(); }
      }, h("span", { class: "result-icon" }, h("span", { class: "letter-icon" }, a.name[0]?.toUpperCase() || "?")),
      h("span", { class: "ellipsis" }, a.name),
      h("span", { class: "muted game-add-src" }, a.source === "store" ? "Store app" : a.source === "desktop" ? "Desktop" : "Start menu"))) : [h("div", { class: "empty" }, "No apps match")]));
      const want = rows.filter((a) => a.hasIcon).slice(0, 60);
      const urls = await appIcons(want.map((a) => a.id));
      if (closed) return;
      for (const a of want) {
        const box = list.querySelector(`[data-app="${CSS.escape(a.id)}"] .result-icon`);
        if (urls[a.id] && box) box.replaceChildren(h("img", { src: urls[a.id], alt: "" }));
      }
    };
    search.addEventListener("input", render);
    render();
    return h("div", { class: "game-add" },
      h("div", { class: "modal-head" }, icon("plus"), h("span", { class: "modal-title" }, "Add a game"), h("span", { class: "grow" }),
        h("button", { class: "icon-btn", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("close"))),
      h("div", { class: "game-add-body" }, search, list),
      h("div", { class: "game-add-foot" },
        h("span", { class: "muted" }, "Or drag a game's shortcut or program onto the library."),
        h("span", { class: "grow" }),
        h("button", { class: "btn", type: "button", onclick: async () => { if (await addGame({ browse: true })) close(); } }, icon("folder"), "Browse for a program…")));
  }, { className: "game-add-modal", label: "Add a game", onClose: () => { closed = true; } });
}

function card(g, close) {
  const el = h("button", {
    class: "game-card", type: "button", dataset: { id: g.id },
    onclick: () => { launchGame(g).then((ok) => ok && close()); },
    oncontextmenu: (e) => gameMenu(e, g, close)
  },
  h("span", { class: "game-tile" }),
  h("span", { class: "game-name" }, g.name),
  h("span", { class: "game-meta" }));
  return paintCard(el, g);
}

// The parts of a card that change once its icon has been looked at.
function paintCard(el, g) {
  const note = missingText(g);
  if (el.dataset.icon !== (g.icon || "") || !el.querySelector(".game-tile").firstChild) {
    el.querySelector(".game-tile").replaceChildren(gameIcon(g));
    el.dataset.icon = g.icon || "";
  }
  el.classList.toggle("missing", !!g.missing);
  el.title = `${g.name} — ${SOURCE[g.source] || g.source}${note ? ` — ${note}` : ""}`;
  const meta = el.querySelector(".game-meta");
  meta.classList.toggle("warn", !!note);
  setText(meta, note || SOURCE[g.source] || g.source);
  return el;
}

// Arrow keys move between cards row by row, as they're laid out.
function moveFocus(grid, from, key) {
  const cards = [...grid.querySelectorAll(".game-card")];
  const i = cards.indexOf(from);
  if (i < 0) return;
  const top = cards[0].offsetTop;
  const cols = Math.max(1, cards.findIndex((c) => c.offsetTop !== top) === -1 ? cards.length : cards.findIndex((c) => c.offsetTop !== top));
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: cards.length - 1 }[key];
  if (next === undefined) return false;
  cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus();
  return true;
}

export function openGameLibrary() {
  let off = null;
  let closed = false;
  checked.clear();
  openModal((close) => {
    const grid = h("div", { class: "game-grid" });
    const search = h("input", { class: "input game-search", placeholder: "Search your games", spellcheck: false, "data-autofocus": true });
    const status = h("span", { class: "muted game-status" });
    const chips = h("div", { class: "launcher-filters game-filters" });
    let filter = "all";
    const shown = () => {
      const q = search.value.trim().toLowerCase();
      return (cache || []).filter((g) => (filter === "all" || g.source === filter) && (!q || g.name.toLowerCase().includes(q)));
    };
    const render = () => {
      if (closed) return;
      const list = shown();
      setText(status, cache ? `${cache.length} GAME${cache.length === 1 ? "" : "S"}` : "SCANNING…");
      const present = new Set((cache || []).map((g) => g.source));
      if (filter !== "all" && !present.has(filter)) filter = "all";
      chips.replaceChildren(...FILTERS.filter(([id]) => id === "all" || present.has(id)).map(([id, label]) => h("button", {
        class: `chip${filter === id ? " active" : ""}`, type: "button", onclick: () => { filter = id; render(); }
      }, label)));
      chips.hidden = present.size < 2;
      const focusedId = document.activeElement?.closest?.(".game-card")?.dataset.id;
      if (!cache) {
        grid.replaceChildren(h("div", { class: "empty" }, "Looking for games…"));
        return;
      }
      grid.replaceChildren(...(list.length ? list.map((g) => card(g, close)) : [h("div", { class: "empty game-empty" }, cache.length ? "No games match" :
        "No games yet. Games installed through Steam, Epic Games or the Xbox app show up here by themselves. For any other game, use Add game, or drag its shortcut or program here.")]));
      if (focusedId) grid.querySelector(`[data-id="${CSS.escape(focusedId)}"]`)?.focus();
      ensureIcons(list.map((g) => g.id), () => !closed);
    };
    search.addEventListener("input", render);
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") grid.querySelector(".game-card")?.click();
      else if (e.key === "ArrowDown") { e.preventDefault(); grid.querySelector(".game-card")?.focus(); }
    });
    grid.addEventListener("keydown", (e) => {
      const from = e.target.closest?.(".game-card");
      if (!from) return;
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault();
        const r = from.getBoundingClientRect();
        from.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      } else if (e.key === "ArrowUp" && from === grid.querySelector(".game-card")) {
        e.preventDefault();
        search.focus();
      } else if (moveFocus(grid, from, e.key)) e.preventDefault();
    });
    const patch = () => {
      if (closed) return;
      for (const el of grid.querySelectorAll(".game-card")) {
        const g = cache?.find((x) => x.id === el.dataset.id);
        if (g) paintCard(el, g);
      }
    };
    off = onGames((_list, kind) => (kind === "icons" ? patch() : render()));

    // Dropping a shortcut or a program adds it.
    const root = h("div", { class: "games" });
    root.addEventListener("dragover", (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      root.classList.add("drop");
    });
    root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove("drop"); });
    root.addEventListener("drop", async (e) => {
      e.preventDefault();
      root.classList.remove("drop");
      for (const f of [...(e.dataTransfer?.files || [])].slice(0, 20)) {
        const p = api.fs.pathForFile(f);
        if (p) await addGame({ path: p });
      }
    });

    fetchGames("auto").then(render);
    render();
    root.append(
      h("div", { class: "modal-head" }, icon("gamepad"), h("span", { class: "modal-title" }, "Games"), status, h("span", { class: "grow" }),
        h("button", { class: "btn sm", type: "button", title: "Add a game from your apps, or any program", onclick: () => openAddGame() }, icon("plus"), "Add game"),
        h("button", { class: "btn sm", type: "button", title: "Look for newly installed games", onclick: () => loadGames(true).then(render) }, icon("refresh"), "Rescan"),
        h("button", { class: "icon-btn", type: "button", title: "Game settings", onclick: () => { close(); runCommand("settings.games"); } }, icon("gear")),
        h("button", { class: "icon-btn", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("close"))),
      h("div", { class: "game-tools" }, search, chips),
      grid);
    return root;
  }, { className: "games-modal", label: "Games", onClose: () => { closed = true; off?.(); } });
}

// Top-bar badge while game mode is on.
export function gameModeBadge() {
  const badge = h("button", { class: "status-item game-badge", type: "button", hidden: true, title: "Game mode — eDEX is resting. Click for settings." }, icon("gamepad"), h("span", null, "GAME MODE"));
  badge.addEventListener("click", () => runCommand("settings.games"));
  const show = (s) => {
    badge.hidden = !s?.active;
    badge.title = s?.active ? `Game mode${s.name ? ` — ${s.name}` : ""}: eDEX is resting. Click for settings.` : "";
  };
  api.games.onGameMode(show);
  api.games.state().then(show).catch(() => {});
  return badge;
}
