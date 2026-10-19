"use strict";

const fs = require("fs");
const { app, shell, nativeImage } = require("electron");
const { isSensitive } = require("./paths");

const cache = new Map();
const MAX = 1200;
const SIZE = 48;

const expandEnv = (p) => String(p || "").replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);
const usable = (p) => p && !/\.dll$/i.test(p) && !isSensitive(p) && fs.existsSync(p);

// Where Windows would take this file's icon from, best guess first.
function iconSources(file) {
  const out = [];
  if (/\.lnk$/i.test(file)) {
    try {
      const link = shell.readShortcutLink(file);
      const icon = expandEnv(link.icon);
      const target = expandEnv(link.target);
      if (usable(icon)) out.push(icon);
      if (usable(target)) out.push(target);
    } catch (_) { /* unreadable shortcut */ }
  } else if (/\.url$/i.test(file)) {
    try {
      const m = /^IconFile=(.+)$/im.exec(fs.readFileSync(file, "utf8").slice(0, 8192));
      const icon = m && expandEnv(m[1].trim());
      if (usable(icon)) out.push(icon);
    } catch (_) {}
  }
  out.push(file);
  return out;
}

async function imageFor(source) {
  // The shell hands back a generic page for .ico files rather than the
  // picture inside, so decode those directly.
  if (/\.(ico|png|jpe?g|bmp)$/i.test(source)) {
    const img = nativeImage.createFromPath(source);
    if (!img.isEmpty()) return img.resize({ width: SIZE, height: SIZE, quality: "best" });
  }
  const img = await app.getFileIcon(source, { size: "large" });
  return img.isEmpty() ? null : img;
}

// Shell icon for a file as a data URL (cached).
async function iconFor(file) {
  if (cache.has(file)) return cache.get(file);
  let url = null;
  for (const source of iconSources(file)) {
    try {
      const img = await imageFor(source);
      if (img) { url = img.toDataURL(); break; }
    } catch (_) {}
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value);
  cache.set(file, url);
  return url;
}

module.exports = { iconFor };
