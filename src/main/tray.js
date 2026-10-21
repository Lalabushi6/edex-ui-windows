"use strict";

const path = require("path");
const { Tray, Menu, nativeImage } = require("electron");

function createTray({ windows, settings, quit, startSaver }) {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("eDEX-UI");

  const rebuild = () => {
    const mode = settings.get("mode");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show / Hide", click: () => windows.toggle() },
      { label: "Open Launcher", click: () => windows.show("launcher") },
      { type: "separator" },
      { label: "Desktop mode", type: "radio", checked: mode === "desktop", click: () => settings.set({ mode: "desktop" }) },
      { label: "Overlay mode", type: "radio", checked: mode === "overlay", click: () => settings.set({ mode: "overlay" }) },
      { type: "separator" },
      { label: "Take over the desktop", type: "checkbox", checked: settings.get("takeover") === true, click: (item) => settings.set({ takeover: item.checked }) },
      { label: "Start screen saver", click: () => startSaver?.() },
      { type: "separator" },
      { label: "Settings", click: () => windows.show("settings") },
      { label: "Quit eDEX-UI", click: quit }
    ]));
  };
  rebuild();
  settings.on("change", (changed) => { if ("mode" in changed || "takeover" in changed) rebuild(); });
  tray.on("click", () => windows.toggle());
  return tray;
}

module.exports = { createTray };
