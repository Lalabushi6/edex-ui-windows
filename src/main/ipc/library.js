// Music library: the songs in your music folders (your Music folder unless
// you pick others), read once and kept in music-library.json — files are
// re-read only when they change — and browsed by album, artist and song in
// the media player. Album covers come from cover.jpg / folder.jpg next to
// the songs, or from the art embedded in them (saved once to album-art/).
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");
const paths = require("../lib/paths");
const { readTags } = require("../lib/tags");
const { JsonStore } = require("../lib/store");
const { handle, asString } = require("./util");

const AUDIO_RE = /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|weba)$/i;
const COVER_RE = /^(cover|folder|front|album|albumart[\w ]*)\.(jpe?g|png|webp)$/i;
const MAX_TRACKS = 30000;
const CONCURRENCY = 8;

function registerLibrary({ settings, windows }) {
  const userData = app.getPath("userData");
  const store = new JsonStore(path.join(userData, "music-library.json"), { fallback: { tracks: [], scannedAt: 0 } });
  const artDir = path.join(userData, "album-art");
  const artCache = new Map(); // folder -> file | null
  let scanning = null;

  const folders = () => {
    const list = (settings.get("musicFolders") || []).filter(Boolean);
    return list.length ? list : [app.getPath("music")];
  };
  const tracks = () => (Array.isArray(store.data.tracks) ? store.data.tracks : []);

  async function collect(root, out) {
    const walk = async (dir, depth) => {
      if (out.length >= MAX_TRACKS || depth > 10 || paths.isSensitive(dir)) return;
      let ents;
      try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) {
        if (out.length >= MAX_TRACKS) return;
        if (e.name.startsWith(".") || e.name.startsWith("$")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !e.isSymbolicLink()) await walk(full, depth + 1);
        else if (e.isFile() && AUDIO_RE.test(e.name)) out.push(full);
      }
    };
    await walk(root, 0);
  }

  async function scan() {
    if (scanning) return scanning;
    scanning = (async () => {
      const files = [];
      for (const f of folders()) {
        try { await collect(await paths.forRead(f), files); } catch (_) {}
      }
      const old = new Map(tracks().map((t) => [t.path, t]));
      const result = new Array(files.length);
      let done = 0;
      let lastSent = 0;
      const progress = (final) => {
        if (!final && Date.now() - lastSent < 250) return;
        lastSent = Date.now();
        windows.send("library:progress", { done, total: files.length, final: !!final });
      };
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const i = next++;
          const file = files[i];
          let st = null;
          try { st = await fs.promises.stat(file); } catch (_) { done++; continue; }
          const prev = old.get(file);
          if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) {
            result[i] = prev;
          } else {
            let t = null;
            try { t = await readTags(file); } catch (_) {}
            result[i] = {
              path: file,
              title: t?.title || path.basename(file).replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim(),
              artist: t?.artist || "",
              album: t?.album || "",
              albumArtist: t?.albumArtist || "",
              track: t?.track || 0,
              disc: t?.disc || 0,
              year: t?.year || 0,
              mtime: st.mtimeMs,
              size: st.size
            };
          }
          done++;
          progress(false);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      store.data = { tracks: result.filter(Boolean), scannedAt: Date.now(), folders: folders() };
      store.save();
      progress(true);
      return store.data;
    })().finally(() => { scanning = null; });
    return scanning;
  }

  handle("library:list", async () => {
    if (!store.data.scannedAt && !scanning) scan().catch(() => {});
    return { tracks: tracks(), scannedAt: store.data.scannedAt || 0, folders: folders(), scanning: !!scanning };
  });

  handle("library:scan", async () => {
    const d = await scan();
    return { tracks: d.tracks, scannedAt: d.scannedAt, folders: folders(), scanning: false };
  });

  handle("library:addFolder", async () => {
    const { canceled, filePaths } = await windows.withDialog((win) => dialog.showOpenDialog(win, { title: "Add a music folder", properties: ["openDirectory"] }));
    if (canceled || !filePaths[0]) return folders();
    const dir = await paths.forRead(filePaths[0]);
    const current = (settings.get("musicFolders") || []).filter(Boolean);
    const base = current.length ? current : [app.getPath("music")];
    if (!base.some((f) => path.resolve(f).toLowerCase() === dir.toLowerCase())) settings.set({ musicFolders: [...base, dir].slice(0, 12) });
    scan().catch(() => {});
    return folders();
  });

  handle("library:removeFolder", async (_e, dir) => {
    const target = asString(dir, "folder").toLowerCase();
    const next = folders().filter((f) => f.toLowerCase() !== target);
    settings.set({ musicFolders: next });
    scan().catch(() => {});
    return folders();
  });

  // A cover for the album a song belongs to: an image file in its folder,
  // else the art embedded in the song (saved once to album-art/).
  handle("library:art", async (_e, file) => {
    const p = await paths.forRead(asString(file, "path"));
    const dir = path.dirname(p);
    if (artCache.has(dir)) return artCache.get(dir);
    let out = null;
    try {
      const names = await fs.promises.readdir(dir);
      const cover = names.find((n) => COVER_RE.test(n));
      if (cover) out = path.join(dir, cover);
    } catch (_) {}
    if (!out) {
      try {
        const t = await readTags(p, { picture: true });
        if (t?.picture) {
          const name = `${crypto.createHash("sha1").update(dir.toLowerCase()).digest("hex").slice(0, 16)}.${/png/.test(t.picture.mime) ? "png" : "jpg"}`;
          await fs.promises.mkdir(artDir, { recursive: true });
          out = path.join(artDir, name);
          await fs.promises.writeFile(out, t.picture.data);
        }
      } catch (_) { out = null; }
    }
    artCache.set(dir, out);
    while (artCache.size > 2000) artCache.delete(artCache.keys().next().value);
    return out;
  });

  return { flush: () => store.flushSync() };
}

module.exports = { registerLibrary };
