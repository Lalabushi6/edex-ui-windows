// Media player support: file/folder pickers, folder scanning and tags
// (title, artist, album, cover art) for MP3, FLAC, Ogg and M4A files.
"use strict";

const fs = require("fs");
const path = require("path");
const { dialog } = require("electron");
const paths = require("../lib/paths");
const { readTags, pictureUrl } = require("../lib/tags");
const { handle, asString } = require("./util");

const MEDIA_EXTS = ["mp3", "wav", "ogg", "oga", "opus", "flac", "aac", "m4a", "weba", "mp4", "m4v", "webm", "mkv", "mov", "ogv"];
const MEDIA_RE = new RegExp(`\\.(${MEDIA_EXTS.join("|")})$`, "i");
const MAX_SCAN = 2000;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

async function scanFolder(root) {
  const out = [];
  const walk = async (dir, depth) => {
    if (out.length >= MAX_SCAN || depth > 4 || paths.isSensitive(dir)) return;
    let dirents;
    try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    dirents.sort((a, b) => collator.compare(a.name, b.name));
    for (const d of dirents) {
      if (out.length >= MAX_SCAN) return;
      const full = path.join(dir, d.name);
      if (d.isDirectory() && !d.name.startsWith(".") && !d.isSymbolicLink()) await walk(full, depth + 1);
      else if (d.isFile() && MEDIA_RE.test(d.name)) out.push(full);
    }
  };
  await walk(root, 0);
  return out;
}

function registerMedia({ windows }) {
  handle("media:pickFiles", async () => {
    const { canceled, filePaths } = await windows.withDialog((win) => dialog.showOpenDialog(win, {
      title: "Add media",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audio & video", extensions: MEDIA_EXTS }, { name: "All files", extensions: ["*"] }]
    }));
    return canceled ? [] : filePaths.filter((p) => !paths.isSensitive(p));
  });

  handle("media:pickFolder", async () => {
    const { canceled, filePaths } = await windows.withDialog((win) => dialog.showOpenDialog(win, {
      title: "Add a folder of media",
      properties: ["openDirectory"]
    }));
    if (canceled || !filePaths[0]) return [];
    return scanFolder(await paths.forRead(filePaths[0]));
  });

  handle("media:scan", async (_e, dir) => scanFolder(await paths.forRead(asString(dir, "folder"))));

  const tagCache = new Map();
  handle("media:tags", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    if (tagCache.has(p)) return tagCache.get(p);
    let tags = null;
    try {
      const t = await readTags(p, { picture: true });
      if (t) tags = { title: t.title, artist: t.artist, album: t.album, picture: pictureUrl(t.picture) };
    } catch (_) {}
    if (tagCache.size > 300) tagCache.delete(tagCache.keys().next().value);
    tagCache.set(p, tags);
    return tags;
  });
}

module.exports = { registerMedia, MEDIA_EXTS };
