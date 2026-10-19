// Bottom dock: start button, pinned apps and every open window, so switching
// apps never needs the Windows taskbar.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import * as settings from "../core/settings.js";
import { runCommand } from "../core/commands.js";
import { toast, contextMenu, cleanError } from "../core/ui.js";
import { openLauncher, loadAppsCached, appIcons, exeIcons, launchApp, togglePinnedApp } from "./launcher.js";

const api = window.edex;

export function initDock(root) {
  const start = h("button", { class: "icon-btn dock-start", type: "button", title: "Apps (Ctrl+Shift+Space)", onclick: () => openLauncher({ filter: "apps" }) }, icon("apps"));
  const pins = h("div", { class: "dock-pins" });
  const wins = h("div", { class: "dock-windows" });
  const kbBtn = h("button", { class: "icon-btn", type: "button", title: "On-screen keyboard (Ctrl+Shift+K)", onclick: () => settings.set({ showKeyboard: !settings.get("showKeyboard") }) }, icon("keyboard"));
  const tray = h("div", { class: "dock-tray" },
    kbBtn,
    h("button", { class: "icon-btn", type: "button", title: "Process manager", onclick: () => runCommand("processes.open") }, icon("process")),
    h("button", { class: "icon-btn", type: "button", title: "Hide eDEX (show the Windows desktop)", onclick: () => api.app.hide() }, icon("minimize")));
  root.append(start, pins, h("div", { class: "dock-sep" }), wins, tray);
  settings.watch("showKeyboard", (v) => kbBtn.classList.toggle("active", !!v));
  kbBtn.classList.toggle("active", !!settings.get("showKeyboard"));

  async function renderPins() {
    const ids = settings.get("pinnedApps") || [];
    if (!ids.length) { pins.replaceChildren(); return; }
    const apps = await loadAppsCached();
    const byId = new Map(apps.map((a) => [a.id, a]));
    const list = ids.map((id) => byId.get(id)).filter(Boolean);
    const icons = await appIcons(list.filter((a) => a.hasIcon).map((a) => a.id));
    pins.replaceChildren(...list.map((app) => h("button", {
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
      oncontextmenu: (e) => contextMenu(e, [
        { label: "Switch to", icon: "window", run: () => api.win.focus(w.hwnd) },
        { label: w.minimized ? "Restore" : "Minimize", icon: "minimize", run: () => (w.minimized ? api.win.focus(w.hwnd) : api.win.minimize(w.hwnd)).then(() => winPoll.kick()) },
        { label: w.maximized ? "Restore size" : "Maximize", icon: "maximize", run: () => api.win.maximize(w.hwnd).then(() => winPoll.kick()) },
        w.exe && { label: "Open file location", icon: "folder", run: () => api.fs.reveal(w.exe) },
        { separator: true },
        { label: "Close window", icon: "close", danger: true, run: () => api.win.close(w.hwnd).then(() => setTimeout(() => winPoll.kick(), 500)) }
      ])
    },
    icons[w.exe] ? h("img", { src: icons[w.exe], alt: "" }) : icon("window"),
    h("span", { class: "t" }, w.title))));
  }

  const winPoll = poll(renderWindows, 2000);
  window.addEventListener("focus", () => winPoll.kick());
  settings.watch("pinnedApps", renderPins);
  renderPins();
  return { refresh: () => { winPoll.kick(); renderPins(); } };
}
