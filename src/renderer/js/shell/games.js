// Game library (interface side): installed Steam, Epic and Xbox games with
// cover art, in a full-screen grid (Ctrl+Shift+G, the dock's game button) and
// in the launcher and dock. Game mode's top-bar badge lives here too.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { openModal, toast, contextMenu, cleanError } from "../core/ui.js";
import { runCommand } from "../core/commands.js";

const api = window.edex;
const SOURCE = { steam: "Steam", epic: "Epic Games", xbox: "Xbox" };
let cache = null;
let loading = null;
const listeners = new Set();

export const gameArt = (g) => (g?.art ? fmt.fileUrl(g.art) : null);
export const onGames = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { for (const fn of listeners) { try { fn(cache); } catch (_) {} } };

export function loadGames(force = false) {
  if (cache && !force) return Promise.resolve(cache);
  if (!loading) {
    loading = api.games.list(force).then((list) => { cache = list; changed(); return list; }).catch(() => cache || []).finally(() => { loading = null; });
  }
  return loading;
}

api.games.onChange(() => { loadGames(true); });
api.games.onArt(({ id, art }) => {
  const g = cache?.find((x) => x.id === id);
  if (g) { g.art = art; g.tall = true; changed(); }
});

export async function launchGame(g) {
  try {
    await api.games.launch(g.id);
    sfx.play("granted");
    toast(`Starting ${g.name}…`, { timeout: 2200 });
    g.lastPlayed = Date.now();
  } catch (e) {
    toast(`Couldn't start ${g.name}: ${cleanError(e)}`, { level: "warn" });
  }
}

export function gameMenu(e, g, after) {
  const pinned = (settings.get("pinnedApps") || []).includes(`game:${g.id}`);
  contextMenu(e, [
    { label: `Play ${g.name}`, icon: "play", run: () => { after?.(); launchGame(g); } },
    { label: pinned ? "Unpin from dock" : "Pin to dock", icon: "pin", run: () => {
      const pins = settings.get("pinnedApps") || [];
      const id = `game:${g.id}`;
      settings.set({ pinnedApps: pinned ? pins.filter((p) => p !== id) : [...pins, id] });
    } },
    g.dir && { label: "Open install folder", icon: "folder", run: () => api.games.reveal(g.id).catch((err) => toast(cleanError(err), { level: "warn" })) },
    { separator: true },
    { label: "Rescan library", icon: "refresh", run: () => loadGames(true).then((l) => toast(`${l.length} games found`, { level: "ok" })) }
  ]);
}

function card(g, close) {
  const art = gameArt(g);
  return h("button", {
    class: `game-card${g.tall ? "" : " wide"}`, type: "button", title: `${g.name} — ${SOURCE[g.source] || g.source}`,
    onclick: () => { close(); launchGame(g); },
    oncontextmenu: (e) => gameMenu(e, g, close)
  },
  art ? h("img", { class: "game-art", src: art, alt: "", loading: "lazy" }) : h("span", { class: "game-art game-art-blank" }, icon("gamepad"), h("span", null, g.name)),
  h("span", { class: "game-name ellipsis" }, g.name),
  h("span", { class: `game-src src-${g.source}` }, SOURCE[g.source] || g.source));
}

export function openGameLibrary() {
  let off = null;
  openModal((close) => {
    const grid = h("div", { class: "game-grid" });
    const search = h("input", { class: "input game-search", placeholder: "Search your games", spellcheck: false, "data-autofocus": true });
    const status = h("span", { class: "muted game-status" });
    let filter = "all";
    const chips = h("div", { class: "launcher-filters game-filters" });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const list = (cache || []).filter((g) => (filter === "all" || g.source === filter) && (!q || g.name.toLowerCase().includes(q)));
      setText(status, cache ? `${cache.length} GAME${cache.length === 1 ? "" : "S"}` : "SCANNING…");
      chips.replaceChildren(...[["all", "All"], ["steam", "Steam"], ["epic", "Epic"], ["xbox", "Xbox"]].map(([id, label]) => h("button", {
        class: `chip${filter === id ? " active" : ""}`, type: "button", onclick: () => { filter = id; render(); }
      }, label)));
      if (!cache) { grid.replaceChildren(h("div", { class: "empty" }, "Looking for Steam, Epic and Xbox games…")); return; }
      grid.replaceChildren(...(list.length ? list.map((g) => card(g, close)) : [h("div", { class: "empty" }, cache.length ? "No games match" : "No installed Steam, Epic or Xbox games found")]));
    };
    search.addEventListener("input", render);
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const first = grid.querySelector(".game-card");
      first?.click();
    });
    off = onGames(render);
    loadGames().then(render);
    render();
    return h("div", { class: "games" },
      h("div", { class: "modal-head" }, icon("gamepad"), h("span", { class: "modal-title" }, "Games"), status, h("span", { class: "grow" }),
        h("button", { class: "btn sm", type: "button", title: "Look for newly installed games", onclick: () => loadGames(true).then(render) }, icon("refresh"), "Rescan"),
        h("button", { class: "icon-btn", type: "button", title: "Game mode settings", onclick: () => { close(); runCommand("settings.games"); } }, icon("gear")),
        h("button", { class: "icon-btn", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("close"))),
      h("div", { class: "game-tools" }, search, chips),
      grid);
  }, { className: "games-modal", label: "Games", onClose: () => off?.() });
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
