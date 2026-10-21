// Bottom dock: start button, pinned apps and every open window, so switching
// apps never needs the Windows taskbar.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import * as settings from "../core/settings.js";
import { runCommand } from "../core/commands.js";
import { emit } from "../core/bus.js";
import { toast, contextMenu, cleanError } from "../core/ui.js";
import { openLauncher, loadAppsCached, appIcons, exeIcons, launchApp, togglePinnedApp } from "./launcher.js";
import { openSnapPicker, snapWindow } from "./arrange.js";
import { openGameLibrary, loadGames, launchGame, gameArt, gameMenu, onGames } from "./games.js";

const api = window.edex;

export function initDock(root) {
  const start = h("button", { class: "icon-btn dock-start", type: "button", title: "Apps (Ctrl+Shift+Space)", onclick: () => openLauncher({ filter: "apps" }) }, icon("apps"));
  const gamesBtn = h("button", { class: "icon-btn dock-start", type: "button", title: "Games (Ctrl+Shift+G)", onclick: () => openGameLibrary() }, icon("gamepad"));
  const pins = h("div", { class: "dock-pins" });
  const wins = h("div", { class: "dock-windows" });
  const kbBtn = h("button", { class: "icon-btn", type: "button", title: "On-screen keyboard (Ctrl+Shift+K)", onclick: () => settings.set({ showKeyboard: !settings.get("showKeyboard") }) }, icon("keyboard"));
  // While desktop takeover hides the Windows taskbar: bring it back briefly
  // for tray icons and the Start menu.
  const winBarBtn = h("button", {
    class: "icon-btn", type: "button", title: "Show the Windows taskbar for 15 seconds (tray icons, Start)",
    onclick: () => api.app.takeoverPeek().then((ok) => ok && toast("Windows taskbar shown for 15 seconds", { timeout: 1800 })).catch((e) => toast(cleanError(e), { level: "warn" }))
  }, icon("desktop"));
  const syncWinBar = () => {
    winBarBtn.hidden = !(settings.get("takeover") === true && settings.get("takeoverHideTaskbar") !== false && settings.get("mode") === "desktop");
  };
  settings.watch(["takeover", "takeoverHideTaskbar", "mode"], syncWinBar);
  syncWinBar();
  const tray = h("div", { class: "dock-tray" },
    winBarBtn,
    kbBtn,
    h("button", { class: "icon-btn", type: "button", title: "Process manager", onclick: () => runCommand("processes.open") }, icon("process")),
    h("button", { class: "icon-btn", type: "button", title: "Hide eDEX (show the Windows desktop)", onclick: () => api.app.hide() }, icon("minimize")));
  root.append(start, gamesBtn, pins, h("div", { class: "dock-sep" }), wins, tray);
  settings.watch("showKeyboard", (v) => kbBtn.classList.toggle("active", !!v));
  kbBtn.classList.toggle("active", !!settings.get("showKeyboard"));

  async function renderPins() {
    const ids = settings.get("pinnedApps") || [];
    if (!ids.length) { pins.replaceChildren(); return; }
    const apps = await loadAppsCached();
    const byId = new Map(apps.map((a) => [a.id, a]));
    // Pinned games ("game:steam:620") show their cover art.
    const games = ids.some((id) => id.startsWith("game:")) ? await loadGames() : [];
    const gameById = new Map(games.map((g) => [`game:${g.id}`, g]));
    const list = ids.map((id) => byId.get(id)).filter(Boolean);
    const icons = await appIcons(list.filter((a) => a.hasIcon).map((a) => a.id));
    const gameButtons = ids.filter((id) => gameById.has(id)).map((id) => {
      const g = gameById.get(id);
      const art = gameArt(g);
      return h("button", { class: "dock-app dock-game", type: "button", title: `${g.name} (game)`, onclick: () => launchGame(g), oncontextmenu: (e) => gameMenu(e, g) },
        art ? h("img", { src: art, alt: "" }) : icon("gamepad"));
    });
    pins.replaceChildren(...gameButtons, ...list.map((app) => h("button", {
      class: "dock-app", type: "button", title: app.name,
      onclick: () => launchApp(app),
      oncontextmenu: (e) => contextMenu(e, [
        { label: `Open ${app.name}`, icon: "external", run: () => launchApp(app) },
        { label: "Run as administrator", icon: "lock", run: () => launchApp(app, { admin: true }) },
        { label: "Open file location", icon: "folder", run: () => api.apps.reveal(app.id).catch((err) => toast(cleanError(err), { level: "warn" })) },
        { separator: true },
        { label: "Unpin from dock", icon: "pin", run: () => togglePinnedApp(app.id) }
      ])
    }, icons[app.id] ? h("img", { src: icons[app.id], alt: "" }) : h("span", { class: "letter-icon" }, app.name[0].toUpperCase()))));
  }

  let lastSignature = "";
  async function renderWindows() {
    let list = [];
    try {
      list = await api.win.list();
    } catch (e) {
      wins.replaceChildren(h("span", { class: "dock-empty" }, "Window list unavailable"));
      return;
    }
    const signature = list.map((w) => `${w.hwnd}|${w.title}|${w.active}|${w.minimized}`).join("\n");
    if (signature === lastSignature) return;
    lastSignature = signature;
    const icons = await exeIcons(list.map((w) => w.exe).filter(Boolean));
    if (!list.length) {
      wins.replaceChildren(h("span", { class: "dock-empty" }, "No open windows — launch something with the apps button"));
      return;
    }
    wins.replaceChildren(...list.map((w) => h("button", {
      class: `dock-win${w.active ? " active" : ""}${w.minimized ? " minimized" : ""}`,
      type: "button",
      title: `${w.title}${w.app ? ` — ${w.app}` : ""}`,
      onclick: async () => {
        try {
          if (w.active && !w.minimized) await api.win.minimize(w.hwnd);
          else await api.win.focus(w.hwnd);
        } catch (err) {
          toast(cleanError(err), { level: "warn" });
        }
        setTimeout(() => winPoll.kick(), 350);
      },
      onauxclick: (e) => { if (e.button === 1) api.win.close(w.hwnd).then(() => setTimeout(() => winPoll.kick(), 500)); },
      oncontextmenu: (e) => { const btn = e.currentTarget; contextMenu(e, [
        { label: "Switch to", icon: "window", run: () => api.win.focus(w.hwnd) },
        { label: "Show as a tab in eDEX", icon: "apptab", run: () => emit("open-app-tab", w) },
        { label: w.minimized ? "Restore" : "Minimize", icon: "minimize", run: () => (w.minimized ? api.win.focus(w.hwnd) : api.win.minimize(w.hwnd)).then(() => winPoll.kick()) },
        { label: w.maximized ? "Restore size" : "Maximize", icon: "maximize", run: () => api.win.maximize(w.hwnd).then(() => winPoll.kick()) },
        { label: "Snap left half", icon: "layout", run: () => snapWindow(w.hwnd, "left").then(() => winPoll.kick()) },
        { label: "Snap right half", icon: "layout", run: () => snapWindow(w.hwnd, "right").then(() => winPoll.kick()) },
        { label: "Snap layouts…", icon: "grid4", run: () => openSnapPicker(btn, w.hwnd, w.app || w.title) },
        w.exe && { label: "Open file location", icon: "folder", run: () => api.fs.reveal(w.exe) },
        { separator: true },
        { label: "Close window", icon: "close", danger: true, run: () => api.win.close(w.hwnd).then(() => setTimeout(() => winPoll.kick(), 500)) }
      ]); }
    },
    icons[w.exe] ? h("img", { src: icons[w.exe], alt: "" }) : icon("window"),
    h("span", { class: "t" }, w.title))));
  }

  const winPoll = poll(renderWindows, 2000);
  window.addEventListener("focus", () => winPoll.kick());
  settings.watch("pinnedApps", renderPins);
  onGames(() => { if ((settings.get("pinnedApps") || []).some((id) => id.startsWith("game:"))) renderPins(); });
  renderPins();
  return { refresh: () => { winPoll.kick(); renderPins(); } };
}
