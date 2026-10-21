// Boot logo: plain title text or multi-line ASCII art. Normalises pasted or
// loaded art, scales it to fit the screen, generates block-letter art from
// text, and provides the editor dialog and a full-screen title preview.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { openModal, toast, prompt, contextMenu } from "../core/ui.js";
import { getStatic } from "../core/live.js";

export const MAX_ART = 12000;
const MAX_LINES = 120;
const MAX_COLS = 240;
const LINE_HEIGHT = 1; // block characters (█ ▓) join up into solid shapes
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Normalising ─────────────────────────────────────────────────────────────
function expandTabs(line) {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const ch of line) out += ch === "\t" ? " ".repeat(4 - ([...out].length % 4)) : ch;
  return out;
}

// CRLF → LF, tabs → spaces, control codes and ANSI colour sequences removed,
// trailing spaces and blank edge lines trimmed, shared indentation removed.
export function normalizeArt(text) {
  let lines = String(text || "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .split("\n")
    .map((l) => expandTabs(l).replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  if (common) lines = lines.map((l) => l.slice(common));
  return lines.join("\n");
}

export function artSize(text) {
  const lines = text ? text.split("\n") : [];
  return { lines: lines.length, cols: lines.reduce((m, l) => Math.max(m, [...l].length), 0) };
}

export function describeLogo(raw) {
  const text = normalizeArt(raw);
  if (!text) return "Default (eDEX-UI)";
  if (!text.includes("\n")) return `Text: ${text.length > 28 ? `${text.slice(0, 28)}…` : text}`;
  const { lines, cols } = artSize(text);
  return `ASCII art · ${lines} × ${cols}`;
}

// ── Fitting ─────────────────────────────────────────────────────────────────
// Width of one character of the element's monospace font, in em.
function charWidthEm(el) {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-size:100px;line-height:1;letter-spacing:0";
  probe.style.fontFamily = getComputedStyle(el).fontFamily;
  probe.textContent = "M█#".repeat(10);
  document.body.append(probe);
  const w = probe.getBoundingClientRect().width / 30 / 100;
  probe.remove();
  return w > 0.2 && w < 2 ? w : 0.6;
}

// Scales ASCII art so the whole piece fits the given box.
export function fitArt(el, maxWidth, maxHeight) {
  const { lines, cols } = artSize(el.textContent);
  if (!lines) return;
  const size = Math.min(64, maxWidth / (Math.max(cols, 1) * charWidthEm(el)), maxHeight / (lines * LINE_HEIGHT));
  el.style.fontSize = `${Math.max(3, Math.floor(size * 10) / 10)}px`;
  el.style.lineHeight = String(LINE_HEIGHT);
}

// Puts a logo (text or art) into a boot-title <h1>; returns true for art.
export function applyLogo(el, raw) {
  const text = normalizeArt(raw);
  const value = text || "eDEX-UI";
  el.textContent = value;
  el.dataset.text = value;
  const art = value.includes("\n");
  el.classList.toggle("ascii", art);
  el.style.fontSize = "";
  el.style.lineHeight = "";
  return art;
}

export function fitLogoToScreen(el) {
  if (el.classList.contains("ascii")) fitArt(el, window.innerWidth * 0.9 - 40, window.innerHeight * 0.62);
}

// ── Block-letter generator ──────────────────────────────────────────────────
// A 5-row bitmap font; '#' is ink.
const GLYPHS = {
  A: ".###.|#...#|#####|#...#|#...#", B: "####.|#...#|####.|#...#|####.", C: ".####|#....|#....|#....|.####",
  D: "####.|#...#|#...#|#...#|####.", E: "#####|#....|####.|#....|#####", F: "#####|#....|####.|#....|#....",
  G: ".####|#....|#..##|#...#|.###.", H: "#...#|#...#|#####|#...#|#...#", I: "###|.#.|.#.|.#.|###",
  J: "..###|...#.|...#.|#..#.|.##..", K: "#...#|#..#.|###..|#..#.|#...#", L: "#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#...#|#...#", N: "#...#|##..#|#.#.#|#..##|#...#", O: ".###.|#...#|#...#|#...#|.###.",
  P: "####.|#...#|####.|#....|#....", Q: ".###.|#...#|#.#.#|#..#.|.##.#", R: "####.|#...#|####.|#..#.|#...#",
  S: ".####|#....|.###.|....#|####.", T: "#####|..#..|..#..|..#..|..#..", U: "#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|.#.#.|..#..", W: "#...#|#...#|#.#.#|##.##|#...#", X: "#...#|.#.#.|..#..|.#.#.|#...#",
  Y: "#...#|.#.#.|..#..|..#..|..#..", Z: "#####|...#.|..#..|.#...|#####",
  0: ".###.|#..##|#.#.#|##..#|.###.", 1: ".#.|##.|.#.|.#.|###", 2: "####.|....#|.###.|#....|#####",
  3: "####.|....#|.###.|....#|####.", 4: "#...#|#...#|#####|....#|....#", 5: "#####|#....|####.|....#|####.",
  6: ".###.|#....|####.|#...#|.###.", 7: "#####|....#|...#.|..#..|..#..", 8: ".###.|#...#|.###.|#...#|.###.",
  9: ".###.|#...#|.####|....#|.###.",
  " ": "...|...|...|...|...", "-": "....|....|####|....|....", ".": ".|.|.|.|#", "!": "#|#|#|.|#",
  "_": ".....|.....|.....|.....|#####", ":": ".|#|.|#|.", "/": "....#|...#.|..#..|.#...|#....", "?": "####.|....#|..##.|.....|..#.."
};

export function blockText(text, ink = "█") {
  const out = [];
  for (const line of String(text).toUpperCase().split(/\r?\n/).slice(0, 6)) {
    const glyphs = [...line.slice(0, 24)].map((ch) => (GLYPHS[ch] || GLYPHS[" "]).split("|"));
    if (!glyphs.length) continue;
    if (out.length) out.push("");
    for (let r = 0; r < 5; r++) out.push(glyphs.map((g) => g[r]).join(".").replace(/#/g, ink).replace(/\./g, " ").replace(/\s+$/, ""));
  }
  return out.join("\n");
}

// ── Loading art files ───────────────────────────────────────────────────────
// .nfo / .ans art is usually code page 437 (DOS); anything that is not valid
// UTF-8 is decoded as CP437.
const CP437 = [
  "ÇüéâäàåçêëèïîìÄÅ", "ÉæÆôöòûùÿÖÜ¢£¥₧ƒ", "áíóúñÑªº¿⌐¬½¼¡«»", "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐",
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧", "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀", "αßΓπΣσµτΦΘΩδ∞φε∩", "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ "
].join("");

function decodeArt(buffer) {
  let bytes = new Uint8Array(buffer);
  const sauce = bytes.indexOf(0x1a); // SAUCE metadata / DOS EOF marker
  if (sauce >= 0) bytes = bytes.subarray(0, sauce);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch (_) {
    const table = [...CP437];
    if (table.length !== 128) return new TextDecoder("utf-8").decode(bytes);
    let s = "";
    for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : table[b - 128];
    return s;
  }
}

function pickArtFile() {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: ".txt,.asc,.ans,.nfo,.diz,text/plain", style: { display: "none" } });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) { resolve(null); return; }
      if (file.size > 256 * 1024) { toast("That file is too large for a boot logo (256 KB max)", { level: "warn" }); resolve(null); return; }
      resolve(decodeArt(await file.arrayBuffer()));
    });
    document.body.append(input);
    input.click();
  });
}

// ── Title preview ───────────────────────────────────────────────────────────
// Plays the boot title sequence (fill, box, derez) full-screen.
export function previewBootTitle(raw, subtitle) {
  const logo = h("h1");
  applyLogo(logo, raw);
  const overlay = h("div", { id: "boot-preview", class: "boot-screen titling" },
    h("div", { class: "boot-title" }, logo, h("div", { class: "boot-sub" }, subtitle || "WINDOWS EDITION")),
    h("div", { class: "boot-skip" }, "CLICK OR PRESS ANY KEY TO CLOSE"));
  document.body.append(overlay);
  fitLogoToScreen(logo);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey, true);
    overlay.classList.add("done");
    setTimeout(() => overlay.remove(), 500);
  };
  // Captured on window so the dialog underneath does not also see the key.
  const onKey = (e) => { e.preventDefault(); e.stopPropagation(); close(); };
  window.addEventListener("keydown", onKey, true);
  overlay.addEventListener("mousedown", close);
  (async () => {
    sfx.play("theme");
    await delay(200);
    logo.classList.add("fill");
    await delay(280);
    logo.classList.replace("fill", "boxed");
    await delay(100);
    logo.classList.replace("boxed", "glitch");
    await delay(450);
    logo.classList.replace("glitch", "boxed");
    await delay(2500);
    close();
  })();
}

// ── Editor ──────────────────────────────────────────────────────────────────
// Edits the boot logo, or (with `key`) any other art setting such as the
// ASCII wallpaper.
export function openBootLogoEditor(onSaved, {
  key = "bootLogo", title = "Boot logo", emptyLabel = "Default logo",
  emptyHint = "Leave empty for the default eDEX-UI logo."
} = {}) {
  const isBoot = key === "bootLogo";
  openModal((close) => {
    const area = h("textarea", {
      class: "input bootart-area", spellcheck: false, wrap: "off",
      placeholder: `Type a title, or paste ASCII art (several lines).\n\n${emptyHint}`
    });
    area.value = settings.get(key) || "";
    const previewLogo = h("h1", { class: "bootart-logo" });
    const previewBox = h("div", { class: "bootart-preview" }, previewLogo);
    const info = h("span", { class: "muted bootart-info" });

    const refresh = () => {
      const text = normalizeArt(area.value);
      applyLogo(previewLogo, text);
      const r = previewBox.getBoundingClientRect();
      if (previewLogo.classList.contains("ascii")) fitArt(previewLogo, r.width - 24, r.height - 24);
      const { lines, cols } = artSize(text);
      const tooBig = text.length > MAX_ART || lines > MAX_LINES || cols > MAX_COLS;
      info.classList.toggle("warn-text", tooBig);
      setText(info, !text ? emptyLabel
        : !text.includes("\n") ? `Title text · ${text.length} characters`
          : `ASCII art · ${lines} lines × ${cols} columns · ${text.length.toLocaleString()} / ${MAX_ART.toLocaleString()} characters${tooBig ? " — too large, trim it" : ""}`);
      return { text, tooBig };
    };
    let timer = null;
    area.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 120); });
    const setArt = (text) => { area.value = text; refresh(); area.focus(); };

    const load = async () => {
      const text = await pickArtFile();
      if (text !== null) setArt(normalizeArt(text));
    };
    const fromText = async () => {
      const word = await prompt({ title: "Block letters", message: "Text to turn into block-letter art (A–Z, 0–9, - . ! _ : / ?). Use \\n for a second line.", value: "eDEX" });
      if (!word) return;
      setArt(blockText(word.replace(/\\n/g, "\n")));
    };
    const presets = async (e) => {
      const s = await getStatic().catch(() => ({}));
      const host = (s.hostname || "PC").slice(0, 12);
      const user = (s.user || "USER").slice(0, 12);
      contextMenu(e, [
        { label: "eDEX block letters", icon: "star", run: () => setArt(blockText("eDEX")) },
        { label: "eDEX-UI shaded", icon: "star", run: () => setArt(blockText("eDEX-UI", "▓")) },
        { label: "eDEX-UI hash marks", icon: "star", run: () => setArt(blockText("eDEX-UI", "#")) },
        { label: `This PC (${host})`, icon: "desktop", run: () => setArt(blockText(host)) },
        { label: `Your name (${user})`, icon: "home", run: () => setArt(blockText(user)) },
        { label: "Welcome + PC name", icon: "desktop", run: () => setArt(blockText(`WELCOME\n${host}`, "▓")) }
      ]);
    };
    const save = () => {
      const { text, tooBig } = refresh();
      if (tooBig) { toast(`${title} must be at most ${MAX_LINES} lines × ${MAX_COLS} columns and ${MAX_ART.toLocaleString()} characters`, { level: "warn" }); return; }
      settings.set({ [key]: text });
      onSaved?.(text);
      toast(text ? `${title} saved` : `${title}: default restored`, { level: "ok" });
      close(true);
    };
    area.addEventListener("keydown", (e) => { if (e.key === "s" && e.ctrlKey) { e.preventDefault(); save(); } });
    requestAnimationFrame(refresh);

    return h("div", { class: "bootart" },
      h("div", { class: "modal-head" }, icon(isBoot ? "terminal" : "wallpaper"), h("span", { class: "modal-title grow" }, title),
        h("button", { class: "icon-btn", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("close"))),
      h("div", { class: "bootart-body" },
        h("div", { class: "bootart-col" }, area,
          h("div", { class: "bootart-tools" },
            h("button", { class: "btn sm", type: "button", onclick: load, title: ".txt, .nfo, .ans or .asc — DOS (CP437) art is converted" }, icon("file"), "Load file…"),
            h("button", { class: "btn sm", type: "button", onclick: fromText }, icon("edit"), "Block letters…"),
            h("button", { class: "btn sm", type: "button", onclick: presets }, icon("star"), "Presets"),
            h("button", { class: "btn sm", type: "button", onclick: () => setArt("") }, icon("trash"), "Clear"))),
        h("div", { class: "bootart-col" }, previewBox, info)),
      h("div", { class: "dialog-actions bootart-actions" },
        isBoot && h("button", { class: "btn", type: "button", onclick: () => previewBootTitle(area.value, settings.get("bootSubtitle")) }, icon("play"), "Preview boot"),
        h("span", { class: "grow" }),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"),
        h("button", { class: "btn primary", type: "button", onclick: save }, "Save")));
  }, { className: "bootart-modal", label: title });
}
