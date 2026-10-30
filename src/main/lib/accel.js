// Keyboard accelerators ("CommandOrControl+Shift+Tab"): comparing two of
// them, matching one against a key press in a web page, and showing one.
"use strict";

const MODS = {
  commandorcontrol: "ctrl", cmdorctrl: "ctrl", control: "ctrl", ctrl: "ctrl",
  alt: "alt", option: "alt", altgr: "alt",
  shift: "shift",
  super: "super", meta: "super", command: "super", cmd: "super"
};
// Accelerator key names -> KeyboardEvent.key names, where they differ.
const KEY_NAMES = { left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown", esc: "escape", return: "enter", plus: "+", space: " " };

function parse(acc) {
  const parts = String(acc || "").split("+").map((p) => p.trim()).filter(Boolean);
  // "Ctrl++" (the plus key) splits into an empty last part.
  if (/\+\+$/.test(String(acc || ""))) parts.push("+");
  if (!parts.length) return null;
  const mods = new Set();
  let key = null;
  for (const p of parts) {
    const m = MODS[p.toLowerCase()];
    if (m) mods.add(m);
    else key = p.toLowerCase();
  }
  if (!key) return null;
  return { ctrl: mods.has("ctrl"), alt: mods.has("alt"), shift: mods.has("shift"), super: mods.has("super"), key: KEY_NAMES[key] || key };
}

// One canonical spelling, so "Ctrl+Tab" and "CommandOrControl+Tab" compare equal.
function normalize(acc) {
  const a = parse(acc);
  if (!a) return "";
  return [a.ctrl && "ctrl", a.alt && "alt", a.shift && "shift", a.super && "super", a.key].filter(Boolean).join("+");
}

// Does a before-input-event key press match the accelerator?
function matchesInput(acc, input) {
  const a = parse(acc);
  if (!a || !input) return false;
  if (!!input.control !== a.ctrl || !!input.alt !== a.alt || !!input.shift !== a.shift || !!input.meta !== a.super) return false;
  const key = String(input.key || "").toLowerCase();
  if (key === a.key) return true;
  // Letters and digits by their physical key, as accelerators mean them.
  const code = String(input.code || "");
  return (/^Key[A-Z]$/.test(code) && code.slice(3).toLowerCase() === a.key) || (/^Digit\d$/.test(code) && code.slice(5) === a.key);
}

// "CommandOrControl+Shift+Tab" -> "Ctrl+Shift+Tab".
function describe(acc) {
  return String(acc || "").replace(/\b(CommandOrControl|CmdOrCtrl|Control)\b/g, "Ctrl");
}

module.exports = { parse, normalize, matchesInput, describe };
