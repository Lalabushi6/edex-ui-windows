// Renders the app and tray icons as PNGs (no image tooling required).
//   node scripts/make-icons.js
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const ACCENT = [143, 227, 255];

// Coverage-based shapes in a unit square centred on (0.5, 0.5).
function sample(x, y, withBackground) {
  const dx = x - 0.5, dy = y - 0.5;
  const r = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const layers = [];
  if (withBackground) {
    // Rounded square plate.
    const q = Math.max(Math.abs(dx), Math.abs(dy));
    const corner = Math.hypot(Math.max(Math.abs(dx) - 0.36, 0), Math.max(Math.abs(dy) - 0.36, 0));
    if (q <= 0.48 && corner <= 0.12) layers.push([4, 10, 14, 1]);
  }
  // Outer ring with four gaps, like a HUD reticle.
  const gap = Math.abs(Math.sin(2 * angle)) < 0.12;
  if (r > 0.33 && r < 0.4 && !gap) layers.push([...ACCENT, 1]);
  // Inner hexagon outline.
  const hex = Math.cos(Math.PI / 6) / Math.cos(((angle + Math.PI / 6) % (Math.PI / 3) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6);
  const hr = r / hex;
  if (hr > 0.19 && hr < 0.235) layers.push([...ACCENT, 0.85]);
  if (r < 0.07) layers.push([...ACCENT, 1]);
  return layers;
}

function render(size, withBackground) {
  const out = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const [lr, lg, lb, la] of sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, withBackground)) {
            cr = lr * la + cr * (1 - la); cg = lg * la + cg * (1 - la); cb = lb * la + cb * (1 - la);
            ca = la + ca * (1 - la);
          }
          rr += cr; gg += cg; bb += cb; aa += ca;
        }
      }
      const n = ss * ss;
      const a = aa / n;
      const i = (py * size + px) * 4;
      out[i] = a ? Math.round(rr / n / a) : 0;
      out[i + 1] = a ? Math.round(gg / n / a) : 0;
      out[i + 2] = a ? Math.round(bb / n / a) : 0;
      out[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, out);
}

const root = path.resolve(__dirname, "..");
const assets = path.join(root, "src", "main", "assets");
const build = path.join(root, "build");
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(build, { recursive: true });
fs.writeFileSync(path.join(assets, "icon.png"), render(256, true));
fs.writeFileSync(path.join(assets, "tray.png"), render(32, false));
fs.writeFileSync(path.join(build, "icon.png"), render(256, true));
console.log("Wrote src/main/assets/icon.png, src/main/assets/tray.png, build/icon.png");
