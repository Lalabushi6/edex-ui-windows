// Web links: opened in an eDEX browser tab when Settings → Web & apps says so,
// otherwise in the default browser. Mail links always go to the mail app.
import * as settings from "./settings.js";
import { emit } from "./bus.js";
import { toast, cleanError } from "./ui.js";

export function openUrl(url, { external = false } = {}) {
  const target = String(url || "");
  if (!external && settings.get("browserLinks") && /^https?:\/\//i.test(target)) {
    emit("open-browser", { url: target });
    return Promise.resolve(true);
  }
  return window.edex.shell.openExternal(target).catch((e) => { toast(cleanError(e), { level: "warn" }); return false; });
}

// What the address bar does with typed text: an address, or a web search.
export function toUrl(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (!/\s/.test(t) && /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/\S*)?$/i.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(t)) return `https://${t}`;
  const engine = settings.get("webSearchUrl") || "https://www.google.com/search?q=%s";
  return engine.includes("%s") ? engine.replace("%s", encodeURIComponent(t)) : `${engine}${encodeURIComponent(t)}`;
}
