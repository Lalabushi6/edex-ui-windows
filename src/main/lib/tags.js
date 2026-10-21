// Audio tags: title, artist, album, album artist, track / disc numbers,
// year and (optionally) the embedded cover, from MP3 (ID3v2 / ID3v1), FLAC
// and Ogg Vorbis / Opus (Vorbis comments) and MP4 / M4A (iTunes atoms).
// Reads only the header blocks, never the audio.
"use strict";

const fs = require("fs");

const MAX_TAG_BYTES = 3 * 1024 * 1024;
const MAX_ART_BYTES = 1536 * 1024;
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i;

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

const num = (s) => {
  const n = parseInt(String(s || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

async function readId3(fd, wantPicture) {
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
    const text = () => decodeText(frame.subarray(1), enc);
    if (id === "TIT2" || id === "TT2") result.title = text();
    else if (id === "TPE1" || id === "TP1") result.artist = text();
    else if (id === "TPE2" || id === "TP2") result.albumArtist = text();
    else if (id === "TALB" || id === "TAL") result.album = text();
    else if (id === "TRCK" || id === "TRK") result.track = num(text());
    else if (id === "TPOS" || id === "TPA") result.disc = num(text());
    else if (id === "TYER" || id === "TDRC" || id === "TYE") result.year = num(text().slice(0, 4));
    else if (wantPicture && (id === "APIC" || id === "PIC") && !result.picture) {
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
      if (data.length > 0 && data.length <= MAX_ART_BYTES && IMAGE_MIME.test(mime)) result.picture = { mime, data: Buffer.from(data) };
    }
    pos = end;
  }
  return result;
}

async function readId3v1(fd, size) {
  if (size < 128) return null;
  const buf = Buffer.alloc(128);
  await fd.read(buf, 0, 128, size - 128);
  if (buf.toString("latin1", 0, 3) !== "TAG") return null;
  const field = (a, b) => buf.toString("latin1", a, b).replace(/\u0000.*$/, "").trim();
  const out = { title: field(3, 33), artist: field(33, 63), album: field(63, 93), year: num(field(93, 97)) };
  if (buf[125] === 0 && buf[126]) out.track = buf[126];
  return out;
}

// ── Vorbis comments (FLAC, Ogg) ─────────────────────────────────────────────
function vorbisComments(b, off) {
  const out = {};
  if (off + 8 > b.length) return out;
  const vlen = b.readUInt32LE(off);
  let p = off + 4 + vlen;
  if (p + 4 > b.length) return out;
  const n = Math.min(b.readUInt32LE(p), 500);
  p += 4;
  for (let i = 0; i < n && p + 4 <= b.length; i++) {
    const l = b.readUInt32LE(p);
    p += 4;
    if (p + l > b.length) break;
    const s = b.toString("utf8", p, p + l);
    p += l;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const k = s.slice(0, eq).toUpperCase();
    const v = s.slice(eq + 1).trim();
    if (k === "TITLE") out.title = v;
    else if (k === "ARTIST" && !out.artist) out.artist = v;
    else if (k === "ALBUMARTIST" || k === "ALBUM ARTIST") out.albumArtist = v;
    else if (k === "ALBUM") out.album = v;
    else if (k === "TRACKNUMBER") out.track = num(v);
    else if (k === "DISCNUMBER") out.disc = num(v);
    else if ((k === "DATE" || k === "YEAR") && !out.year) out.year = num(v.slice(0, 4));
  }
  return out;
}

async function readFlac(fd, wantPicture) {
  const head = Buffer.alloc(4);
  await fd.read(head, 0, 4, 0);
  if (head.toString("latin1") !== "fLaC") return null;
  let pos = 4;
  const out = {};
  for (let i = 0; i < 128; i++) {
    const bh = Buffer.alloc(4);
    const { bytesRead } = await fd.read(bh, 0, 4, pos);
    if (bytesRead < 4) break;
    const last = bh[0] & 0x80;
    const type = bh[0] & 0x7f;
    const len = bh.readUIntBE(1, 3);
    pos += 4;
    if (type === 4 && len < MAX_TAG_BYTES) {
      const b = Buffer.alloc(len);
      await fd.read(b, 0, len, pos);
      Object.assign(out, vorbisComments(b, 0));
    } else if (type === 6 && wantPicture && !out.picture && len <= MAX_ART_BYTES + 65536) {
      const b = Buffer.alloc(len);
      await fd.read(b, 0, len, pos);
      let p = 4;
      const mlen = b.readUInt32BE(p); p += 4;
      const mime = b.toString("latin1", p, p + mlen); p += mlen;
      const dlen = b.readUInt32BE(p); p += 4 + dlen + 16;
      const size = b.readUInt32BE(p); p += 4;
      if (IMAGE_MIME.test(mime) && size <= MAX_ART_BYTES && p + size <= b.length) out.picture = { mime, data: Buffer.from(b.subarray(p, p + size)) };
    }
    pos += len;
    if (last) break;
  }
  return out;
}

async function readOgg(fd) {
  const b = Buffer.alloc(128 * 1024);
  const { bytesRead } = await fd.read(b, 0, b.length, 0);
  const buf = b.subarray(0, bytesRead);
  if (buf.toString("latin1", 0, 4) !== "OggS") return null;
  let i = buf.indexOf("OpusTags", 0, "latin1");
  if (i >= 0) return vorbisComments(buf, i + 8);
  i = buf.indexOf(Buffer.from([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])); // \x03vorbis
  return i >= 0 ? vorbisComments(buf, i + 7) : null;
}

// ── MP4 / M4A ───────────────────────────────────────────────────────────────
function children(buf, start, end, fn) {
  let p = start;
  while (p + 8 <= end) {
    let len = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let head = 8;
    if (len === 1 && p + 16 <= end) { len = Number(buf.readBigUInt64BE(p + 8)); head = 16; }
    else if (len === 0) len = end - p;
    if (len < head || p + len > end) break;
    if (fn(type, p + head, p + len) === false) return;
    p += len;
  }
}

async function readMp4(fd, size, wantPicture) {
  const h = Buffer.alloc(16);
  let pos = 0;
  let moov = null;
  for (let i = 0; i < 64 && pos + 8 <= size; i++) {
    await fd.read(h, 0, 16, pos);
    let len = h.readUInt32BE(0);
    const type = h.toString("latin1", 4, 8);
    if (i === 0 && type !== "ftyp") return null;
    if (len === 1) len = Number(h.readBigUInt64BE(8));
    else if (len === 0) len = size - pos;
    if (len < 8) break;
    if (type === "moov") {
      if (len > 32 * 1024 * 1024) return null;
      moov = Buffer.alloc(len);
      await fd.read(moov, 0, len, pos);
      break;
    }
    pos += len;
  }
  if (!moov) return null;
  const out = {};
  const value = (s, e, fn) => children(moov, s, e, (t, a, b) => { if (t === "data" && b - a >= 8) { fn(moov.readUInt32BE(a) & 0xffffff, moov.subarray(a + 8, b)); return false; } });
  children(moov, 8, moov.length, (t, s, e) => {
    if (t !== "udta") return;
    children(moov, s, e, (t2, s2, e2) => {
      if (t2 !== "meta") return;
      children(moov, s2 + 4, e2, (t3, s3, e3) => {
        if (t3 !== "ilst") return;
        children(moov, s3, e3, (item, a, b) => {
          const text = (fn) => value(a, b, (_type, v) => fn(v.toString("utf8").trim()));
          if (item === "©nam") text((v) => { out.title = v; });
          else if (item === "©ART") text((v) => { out.artist = v; });
          else if (item === "aART") text((v) => { out.albumArtist = v; });
          else if (item === "©alb") text((v) => { out.album = v; });
          else if (item === "©day") text((v) => { out.year = num(v.slice(0, 4)); });
          else if (item === "trkn") value(a, b, (_t, v) => { if (v.length >= 4) out.track = v.readUInt16BE(2) || undefined; });
          else if (item === "disk") value(a, b, (_t, v) => { if (v.length >= 4) out.disc = v.readUInt16BE(2) || undefined; });
          else if (item === "covr" && wantPicture && !out.picture) value(a, b, (type, v) => {
            if (v.length && v.length <= MAX_ART_BYTES) out.picture = { mime: type === 14 ? "image/png" : "image/jpeg", data: Buffer.from(v) };
          });
        });
      });
    });
  });
  return out;
}

// { title, artist, album, albumArtist, track, disc, year, picture? }
async function readTags(file, { picture = false } = {}) {
  const ext = (/\.([^.\\/]+)$/.exec(file)?.[1] || "").toLowerCase();
  const fd = await fs.promises.open(file, "r");
  try {
    const { size } = await fd.stat();
    let tags = null;
    if (ext === "mp3") {
      tags = await readId3(fd, picture).catch(() => null);
      if (!tags?.title) {
        const v1 = (await readId3v1(fd, size).catch(() => null)) || {};
        const v2 = tags || {};
        tags = { ...v2 };
        for (const k of ["title", "artist", "album", "year", "track"]) if (!v2[k] && v1[k]) tags[k] = v1[k];
      }
    } else if (ext === "flac") tags = await readFlac(fd, picture);
    else if (ext === "ogg" || ext === "oga" || ext === "opus") tags = await readOgg(fd);
    else if (ext === "m4a" || ext === "mp4" || ext === "aac" || ext === "m4b") tags = await readMp4(fd, size, picture);
    return tags;
  } finally {
    await fd.close();
  }
}

const pictureUrl = (pic) => (pic ? `data:${pic.mime};base64,${pic.data.toString("base64")}` : undefined);

module.exports = { readTags, pictureUrl };
