// eDEX-UI keyboard layout validation (no Electron dependency, so the static
// checks can use it too).
"use strict";

const KEY_PROPS = [
  "name", "cmd", "shift_name", "shift_cmd", "alt_name", "alt_cmd", "altshift_name", "altshift_cmd",
  "fn_name", "fn_cmd", "ctrl_cmd", "capslck_cmd"
];
const ROW_ORDER = ["row_numbers", "row_1", "row_2", "row_3", "row_space"];
const LAYOUT_ID = /^[A-Za-z0-9][\w.-]{0,63}$/;

// A key sends one key press, and the terminal is where it often lands: text
// followed by Enter would run a command, so a shared layout must not be able
// to do that. Allowed: a named action ("ESCAPED|-- SHIFT: LEFT"), a single
// character of any kind, a terminal key sequence (arrows, F-keys, Alt+key), or
// a very few printable characters (some layouts' dead-key pairs).
function isKeyPress(value) {
  if (/^ESCAPED\|-- [A-Z]+(: [A-Z]+)?$/.test(value)) return true;
  // ~~~CTRLSEQ1~~~ is Escape; the others stand for single control codes.
  const sent = value.replace(/~~~CTRLSEQ(\d+)~~~/g, (_, n) => (Number(n) === 1 ? "\x1b" : "\x01"));
  const chars = [...sent];
  if (chars.length === 1) return true;
  if (sent[0] === "\x1b") return /^\x1b(?:\[\d{0,2}(?:;\d{1,2})?[~A-Za-z]|O[A-Za-z]|[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}])$/u.test(sent);
  return chars.length <= 4 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(sent);
}

// Keeps only the known string properties, in row order, within sane sizes.
// Throws with a readable reason when the file is not a usable layout.
function normalizeLayout(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not a JSON object");
  const rowIds = Object.keys(raw).filter((k) => /^row/i.test(k) && Array.isArray(raw[k]));
  rowIds.sort((a, b) => {
    const ia = ROW_ORDER.indexOf(a), ib = ROW_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  if (!rowIds.length) throw new Error("no rows (expected row_numbers, row_1 … row_space)");
  if (rowIds.length > 8) throw new Error("too many rows (8 at most)");
  let total = 0;
  const rows = rowIds.map((id) => {
    const list = raw[id];
    if (list.length > 24) throw new Error(`${id} has more than 24 keys`);
    const keys = list.map((k, i) => {
      if (!k || typeof k !== "object") throw new Error(`${id}[${i}] is not an object`);
      if (typeof k.cmd !== "string") throw new Error(`${id}[${i}] has no "cmd"`);
      const key = {};
      for (const p of KEY_PROPS) {
        if (typeof k[p] !== "string") continue;
        if (p.endsWith("cmd") && !isKeyPress(k[p])) throw new Error(`${id}[${i}] "${p}" sends more than one key press`);
        if (k[p].length <= 64) key[p] = k[p];
      }
      if (typeof key.name !== "string") key.name = "";
      return key;
    });
    total += keys.length;
    return { id: id.slice(0, 32), keys };
  });
  if (total < 10) throw new Error("fewer than 10 keys");
  return rows;
}

module.exports = { normalizeLayout, LAYOUT_ID };
