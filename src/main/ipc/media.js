// Media player support: file/folder pickers, folder scanning and MP3 tag
// (title, artist, album, cover art) reading.
"use strict";

const fs = require("fs");
const path = require("path");
const { dialog } = require("electron");
const paths = require("../lib/paths");
const { handle, asString } = require("./util");

const MEDIA_EXTS = ["mp3", "wav", "ogg", "oga", "opus", "flac", "aac", "m4a", "weba", "mp4", "m4v", "webm", "mkv", "mov", "ogv"];
const MEDIA_RE = new RegExp(`\\.(${MEDIA_EXTS.join("|")})$`, "i");
const MAX_SCAN = 2000;
const MAX_TAG_BYTES = 3 * 1024 * 1024;
const MAX_ART_BYTES = 1536 * 1024;

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

// ── ID3 ─────────────────────────────────────────────────────────────────────
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function decodeText(buf, enc) {
  let s;
  if (enc === 1 || enc === 2) {
    let start = 0;
    let le = enc === 1;
    if (enc === 1 && buf.length >= 2) {
      if (buf[0] === 0xff && buf[1] === 0xfe) { le = true; start = 2; }
      else if (buf[0] === 0xfe && buf[1] === 0xff) { le = false; start = 2; }
    }
    const body = Buffer.from(buf.subarray(start, start + ((buf.length - start) & ~1)));
    if (!le) body.swap16();
    s = body.toString("utf16le");
  } else if (enc === 3) {
    s = buf.toString("utf8");
  } else {
    s = buf.toString("latin1");
  }
  return s.replace(/\u0000+$/g, "").split("\u0000")[0].trim();
}

// Index just past a string terminator (one NUL, or two for UTF-16).
function skipTerminated(buf, from, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < buf.length; i += 2) if (buf[i] === 0 && buf[i + 1] === 0) return i + 2;
  } else {
    for (let i = from; i < buf.length; i++) if (buf[i] === 0) return i + 1;
  }
  return buf.length;
}

function deunsync(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    out.push(buf[i]);
    if (buf[i] === 0xff && buf[i + 1] === 0x00) i++;
  }
  return Buffer.from(out);
}

async function readId3(file) {
  const fd = await fs.promises.open(file, "r");
  try {
    const header = Buffer.alloc(10);
    await fd.read(header, 0, 10, 0);
    if (header.toString("latin1", 0, 3) !== "ID3") return null;
    const major = header[3];
    const flags = header[5];
    const size = Math.min(syncsafe(header, 6), MAX_TAG_BYTES);
    let tag = Buffer.alloc(size);
    await fd.read(tag, 0, size, 10);
    if (flags & 0x80 && major < 4) tag = deunsync(tag);
    let pos = 0;
    if (flags & 0x40) pos = major === 4 ? syncsafe(tag, 0) : tag.readUInt32BE(0) + 4;

    const result = {};
    const v22 = major === 2;
    const headerLen = v22 ? 6 : 10;
    while (pos + headerLen <= tag.length) {
      const id = tag.toString("latin1", pos, pos + (v22 ? 3 : 4));
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const frameSize = v22 ? tag.readUIntBE(pos + 3, 3) : (major === 4 ? syncsafe(tag, pos + 4) : tag.readUInt32BE(pos + 4));
      const start = pos + headerLen;
      const end = start + frameSize;
      if (frameSize <= 0 || end > tag.length) break;
      const frame = tag.subarray(start, end);
      const enc = frame[0];
      if (id === "TIT2" || id === "TT2") result.title = decodeText(frame.subarray(1), enc);
      else if (id === "TPE1" || id === "TP1") result.artist = decodeText(frame.subarray(1), enc);
      else if (id === "TALB" || id === "TAL") result.album = decodeText(frame.subarray(1), enc);
      else if ((id === "APIC" || id === "PIC") && !result.picture) {
        let mime;
        let p;
        if (v22) {
          const fmt = frame.toString("latin1", 1, 4).toLowerCase();
          mime = fmt === "png" ? "image/png" : "image/jpeg";
          p = 4;
        } else {
          const mimeEnd = skipTerminated(frame, 1, 0);
          mime = frame.toString("latin1", 1, mimeEnd - 1) || "image/jpeg";
          if (!mime.includes("/")) mime = `image/${mime.toLowerCase() === "png" ? "png" : "jpeg"}`;
          p = mimeEnd;
        }
        p = skipTerminated(frame, p + 1, enc); // picture type byte, then description
        const data = frame.subarray(p);
        if (data.length > 0 && data.length <= MAX_ART_BYTES && /^image\/(png|jpe?g|gif|webp)$/i.test(mime)) {
          result.picture = `data:${mime};base64,${data.toString("base64")}`;
        }
      }
      pos = end;
    }
    return result;
  } finally {
    await fd.close();
  }
}

async function readId3v1(file) {
  const { size } = await fs.promises.stat(file);
  if (size < 128) return null;
  const fd = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(128);
    await fd.read(buf, 0, 128, size - 128);
    if (buf.toString("latin1", 0, 3) !== "TAG") return null;
    const field = (a, b) => buf.toString("latin1", a, b).replace(/\u0000.*$/, "").trim();
    return { title: field(3, 33), artist: field(33, 63), album: field(63, 93) };
  } finally {
    await fd.close();
  }
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
    if (/\.mp3$/i.test(p)) {
      try { tags = await readId3(p); } catch (_) {}
      if (!tags?.title) {
        // Fall back to ID3v1 field by field; empty ID3v2 values never win.
        try {
          const v1 = (await readId3v1(p)) || {};
          const v2 = tags || {};
          tags = { ...v2 };
          for (const k of ["title", "artist", "album"]) if (!v2[k] && v1[k]) tags[k] = v1[k];
        } catch (_) {}
      }
    }
    if (tagCache.size > 300) tagCache.delete(tagCache.keys().next().value);
    tagCache.set(p, tags);
    return tags;
  });
}

module.exports = { registerMedia, MEDIA_EXTS };
