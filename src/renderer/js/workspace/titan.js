// Titan Protocol tab: the life-tracking sub-app (engines, habits, journal,
// goals, focus timer, workouts, sleep, weight, nutrition, money) inside
// eDEX. Its code and styles load the first time a Titan tab opens, so eDEX
// starts no slower for having it.
import { h } from "../core/dom.js";
import { toast } from "../core/ui.js";

const LABEL = "Titan Protocol";

export class TitanTab {
  constructor(ws, { page, label } = {}) {
    this.ws = ws;
    this.type = "titan";
    this.page = page || "dashboard";
    this.customLabel = label || null;
    this.label = label || LABEL;
    this.el = h("div", { class: "pane titan-pane" });
    this.app = null;
  }

  serialize() {
    return { type: "titan", page: this.page, label: this.customLabel || undefined };
  }

  async mount() {
    let mod;
    try {
      mod = await import("../titan/app.js");
    } catch (e) {
      console.error("titan failed to load", e);
      this.el.replaceChildren(h("div", { class: "empty" }, "Titan Protocol failed to load."));
      return;
    }
    this.app = new mod.TitanApp(this.el, {
      page: this.page,
      visible: this.ws.active === this,
      onPage: (page, title) => {
        this.page = page;
        if (!this.customLabel) this.label = page === "dashboard" ? LABEL : `Titan · ${title}`;
        this.ws.updateTab(this);
        this.ws.persist();
      }
    });
    try {
      await this.app.mount();
    } catch (e) {
      console.error("titan failed to start", e);
      toast("Titan Protocol couldn't read its data", { level: "warn" });
    }
  }

  go(page) {
    if (this.app) this.app.go(page);
    else this.page = page;
  }

  palette() { this.app?.palette(); }
  activate() { this.app?.activate(); }
  deactivate() { this.app?.deactivate(); }
  focus() { this.app?.focus(); }
  dispose() { this.app?.dispose(); }
}
