// Command registry + keyboard bindings. Commands feed the launcher's ">"
// mode, the help sheet and hotkeys from one definition.
import { isTyping } from "./dom.js";

const commands = new Map();
const bindings = [];

export function command(def) {
  commands.set(def.id, def);
  if (def.keys) for (const combo of [].concat(def.keys)) bind(combo, def.id, def);
}

export function runCommand(id, ...args) {
  const cmd = commands.get(id);
  if (!cmd) return false;
  if (cmd.enabled && !cmd.enabled()) return false;
  Promise.resolve(cmd.run(...args)).catch((e) => console.error(`command ${id} failed`, e));
  return true;
}

export function allCommands() {
  return [...commands.values()].filter((c) => !c.hidden && (!c.enabled || c.enabled()));
}

function normalize(combo) {
  return combo.split("+").map((p) => p.trim()).map((p) => (p.length === 1 ? p.toUpperCase() : p)).sort((a, b) => {
    const order = ["Ctrl", "Alt", "Shift"];
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  }).join("+");
}

function comboOf(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  let key = event.key;
  if (key === " ") key = "Space";
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (event.code === "Comma") key = ",";
  else if (event.code === "Slash") key = "/";
  else if (key.length === 1) key = key.toUpperCase();
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  parts.push(key);
  return parts.join("+");
}

export function bind(combo, id, { when, allowInInput } = {}) {
  const norm = normalize(combo);
  const hasModifier = /Ctrl|Alt/.test(norm) || /^F\d+$/.test(norm);
  bindings.push({ combo: norm, id, when, allowInInput: allowInInput ?? hasModifier });
}

// Replaces a command's keys (hotkeys you can change in Settings).
export function setKeys(id, keys) {
  for (let i = bindings.length - 1; i >= 0; i--) if (bindings[i].id === id) bindings.splice(i, 1);
  const list = [].concat(keys || []).filter(Boolean);
  const def = commands.get(id);
  if (def) def.keys = list.length ? list : undefined;
  for (const combo of list) bind(combo, id, def || {});
}

// An Electron accelerator ("CommandOrControl+Shift+Tab") as a key combo
// here ("Ctrl+Shift+Tab"); null for ones the interface can't see (Win key).
export function comboFromAccelerator(acc) {
  const names = { Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown", Esc: "Escape", Return: "Enter", Plus: "+" };
  const parts = String(acc || "").split("+").filter(Boolean);
  if (/\+\+$/.test(String(acc || ""))) parts.push("+");
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) {
    if (/^(CommandOrControl|CmdOrCtrl|Control|Ctrl)$/i.test(p)) out.push("Ctrl");
    else if (/^(Alt|Option|AltGr)$/i.test(p)) out.push("Alt");
    else if (/^Shift$/i.test(p)) out.push("Shift");
    else if (/^(Super|Meta|Command|Cmd)$/i.test(p)) return null;
    else out.push(names[p] || (p.length === 1 ? p.toUpperCase() : p));
  }
  return out.join("+");
}

export function initHotkeys() {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    // A hotkey field recording a new combination gets every key.
    if (event.target?.closest?.(".hotkey-input")) return;
    const combo = comboOf(event);
    if (!combo) return;
    for (const b of bindings) {
      if (b.combo !== combo) continue;
      if (!b.allowInInput && isTyping(event.target)) continue;
      if (b.when && !b.when(event)) continue;
      if (runCommand(b.id, event)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
  }, true);
}
