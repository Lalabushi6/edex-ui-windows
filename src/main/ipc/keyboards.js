// On-screen keyboard layouts: the eDEX-UI set shipped in /keyboards, plus
// custom layouts in %APPDATA%\eDEX-UI\keyboards (same JSON format). A custom
// file with a built-in's name replaces it, so a layout can be tweaked by
// copying it there.
"use strict";

const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");
const { cached } = require("../lib/cache");
const { handle } = require("./util");
const { normalizeLayout, LAYOUT_ID } = require("../lib/kb-layout");

const ID_RE = LAYOUT_ID;
const MAX_FILE = 256 * 1024;

const NAMES = {
  "da-DK": "Danish", "de-DE": "German", "en-COLEMAK": "English (Colemak)", "en-DVORAK": "English (Dvorak)",
  "en-GB": "English (UK)", "en-NORMAN": "English (Norman)", "en-US": "English (US)", "en-WORKMAN": "English (Workman)",
  "es-ES": "Spanish", "es-LAT": "Spanish (Latin America)", "fr-BEPO": "French (BÉPO)", "fr-FR": "French (AZERTY)",
  "hu-HU": "Hungarian", "it-IT": "Italian", "nl-BE": "Dutch (Belgium)", "pt-BR": "Portuguese (Brazil)",
  "sv-SE": "Swedish", "tr-TR-F": "Turkish (F)", "tr-TR-Q": "Turkish (Q)"
};

function registerKeyboards({ windows }) {
  const builtinDir = path.join(__dirname, "..", "..", "..", "keyboards");
  const userDir = path.join(app.getPath("userData"), "keyboards");

  const readLayout = async (file) => {
    const st = await fs.promises.stat(file);
    if (st.size > MAX_FILE) throw new Error("file is larger than 256 KB");
    const text = (await fs.promises.readFile(file, "utf8")).replace(/^﻿/, "");
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error(`invalid JSON (${e.message})`); }
    return { raw, rows: normalizeLayout(raw) };
  };

  // id -> { id, name, custom, file }; custom files are read after built-ins
  // so they win. Unreadable custom files are reported, not fatal.
  const catalog = cached(async () => {
    const out = new Map();
    const errors = [];
    for (const [dir, custom] of [[builtinDir, false], [userDir, true]]) {
      let files = [];
      try { files = await fs.promises.readdir(dir); } catch (_) { continue; }
      for (const f of files) {
        if (!f.toLowerCase().endsWith(".json")) continue;
        const id = f.slice(0, -5);
        if (!ID_RE.test(id)) { if (custom) errors.push({ file: f, message: "file name must be letters, digits, - _ or ." }); continue; }
        const file = path.join(dir, f);
        try {
          const { raw } = await readLayout(file);
          const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 48) : (NAMES[id] || id);
          out.set(id, { id, name, custom, file });
        } catch (e) {
          if (custom) errors.push({ file: f, message: e.message });
          else console.warn(`[keyboards] skipping ${f}: ${e.message}`);
        }
      }
    }
    return { layouts: out, errors };
  }, 60000);

  handle("kb:list", async () => {
    // The folder may have been created since startup (by hand, or by Open).
    if (watch()) catalog.invalidate();
    const { layouts, errors } = await catalog();
    return {
      layouts: [...layouts.values()].map(({ id, name, custom }) => ({ id, name, custom })).sort((a, b) => a.name.localeCompare(b.name)),
      errors,
      folder: userDir
    };
  });

  handle("kb:get", async (_e, id) => {
    const { layouts } = await catalog();
    const entry = layouts.get(String(id)) || layouts.get("en-US");
    if (!entry) return null;
    try {
      const { rows } = await readLayout(entry.file);
      return { id: entry.id, name: entry.name, custom: entry.custom, rows };
    } catch (e) {
      catalog.invalidate();
      throw new Error(`Layout ${entry.id} could not be read: ${e.message}`);
    }
  });

  handle("kb:folder", async () => {
    await fs.promises.mkdir(userDir, { recursive: true });
    if (watch()) catalog.invalidate();
    return userDir;
  });

  // Copies validated layout files into the custom folder.
  handle("kb:import", async () => {
    const { canceled, filePaths } = await windows.withDialog((win) => dialog.showOpenDialog(win, {
      title: "Import keyboard layouts",
      filters: [{ name: "eDEX-UI keyboard layout", extensions: ["json"] }],
      properties: ["openFile", "multiSelections"]
    }));
    if (canceled || !filePaths.length) return { imported: [], errors: [] };
    await fs.promises.mkdir(userDir, { recursive: true });
    const imported = [];
    const errors = [];
    for (const src of filePaths.slice(0, 50)) {
      const base = path.basename(src);
      const id = base.replace(/\.json$/i, "").replace(/[^\w.-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64);
      try {
        if (!ID_RE.test(id)) throw new Error("unusable file name");
        await readLayout(src);
        await fs.promises.copyFile(src, path.join(userDir, `${id}.json`));
        imported.push(id);
      } catch (e) {
        errors.push({ file: base, message: e.message });
      }
    }
    catalog.invalidate();
    watch();
    return { imported, errors };
  });

  // Editing or adding a custom layout applies without a restart. Returns
  // true when watching starts now (the folder has just appeared).
  let watcher = null;
  let timer = null;
  function watch() {
    if (watcher || !fs.existsSync(userDir)) return false;
    try {
      watcher = fs.watch(userDir, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          catalog.invalidate();
          windows.send("kb:changed", {});
        }, 300);
      });
      watcher.on("error", () => { watcher?.close(); watcher = null; });
      return true;
    } catch (_) {
      watcher = null;
      return false;
    }
  }
  watch();

  return { stop() { clearTimeout(timer); watcher?.close(); watcher = null; } };
}

module.exports = { registerKeyboards };
