// ASCII wallpaper tab: your art as a workspace pane, instead of a terminal.
// Also the pane the idle style "wallpaper" puts in the terminal's place.
import { h } from "../core/dom.js";
import * as settings from "../core/settings.js";
import { contextMenu } from "../core/ui.js";
import { mountWallpaper, editWallpaperArt, WALLPAPER_EFFECTS, WALLPAPER_BACKDROPS } from "../shell/wallpaper.js";

export class WallpaperTab {
  constructor(ws, opts = {}) {
    this.ws = ws;
    this.type = "ascii";
    this.idle = !!opts.idle;
    this.customLabel = opts.label;
    this.label = opts.label || "Wallpaper";
    this.el = h("div", { class: "pane wallpaper-pane", tabindex: 0 });
    this.wp = null;
  }

  // The temporary idle pane is never restored.
  serialize() {
    return this.idle ? null : { type: "ascii", label: this.customLabel };
  }

  async mount() {
    this.wp = mountWallpaper(this.el);
    this.el.addEventListener("contextmenu", (e) => this.menu(e));
    this.el.addEventListener("dblclick", () => editWallpaperArt());
  }

  menu(e) {
    const effect = settings.get("wallpaperEffect");
    const backdrop = settings.get("wallpaperBackdrop");
    contextMenu(e, [
      { label: "Edit ASCII art…", icon: "edit", hint: "double-click", run: () => editWallpaperArt() },
      { separator: true },
      ...WALLPAPER_EFFECTS.map(([id, label]) => ({ label: `Animation: ${label}`, icon: id === effect ? "check" : "", run: () => settings.set({ wallpaperEffect: id }) })),
      { separator: true },
      ...WALLPAPER_BACKDROPS.map(([id, label]) => ({ label: `Behind it: ${label}`, icon: id === backdrop ? "check" : "", run: () => settings.set({ wallpaperBackdrop: id }) })),
      { separator: true },
      { label: settings.get("wallpaperClock") !== false ? "Hide clock" : "Show clock", icon: "clock", run: () => settings.set({ wallpaperClock: settings.get("wallpaperClock") === false }) }
    ]);
  }

  activate() {
    requestAnimationFrame(() => { this.wp?.refresh(); this.el.focus({ preventScroll: true }); });
  }

  focus() {
    this.el.focus({ preventScroll: true });
  }

  dispose() {
    this.wp?.stop();
  }
}
