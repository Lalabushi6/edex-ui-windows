// On-screen keyboard. Renders eDEX-UI keyboard layout files (the built-in set
// or custom layouts from %APPDATA%\eDEX-UI\keyboards) and types into the
// focused text field, else the active terminal, else the focused element as
// key presses. Supports the layouts' Shift / Caps / Ctrl / AltGr / Fn layers
// and dead keys (accents, Greek), mirrors the physical keyboard, and has a
// password mode that hides key feedback.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import * as sfx from "../core/audio.js";
import { emit } from "../core/bus.js";
import { runCommand } from "../core/commands.js";
import { toast, contextMenu, cleanError, modalOpen } from "../core/ui.js";

const api = window.edex;
const ESC = "\x1b";

// ~~~CTRLSEQn~~~ placeholders used by eDEX-UI layouts. (The original maps
// CTRLSEQ9 to Ctrl+R; it is Ctrl+T, \x14.)
const CTRLSEQ = ["", "\x1b", "\x1c", "\x1d", "\x1e", "\x1f", "\x11", "\x17", "\x12", "\x14", "\x19", "\x15", "\x10", "\x01", "\x13", "\x04", "\x06", "\x1a", "\x18", "\x03", "\x16", "\x02"];
const expand = (s) => (s ? s.replace(/~~~CTRLSEQ(\d+)~~~/g, (_, n) => CTRLSEQ[Number(n)] ?? "") : s);

// Dead keys: "base+result" pairs (a result may be several code points), and
// the spacing character typed when the dead key is followed by Space.
function pairs(spec) {
  const map = new Map();
  for (const token of spec.split(" ")) {
    const [base] = token;
    map.set(base, token.slice(base.length));
  }
  return map;
}
const DEAD = {
  CIRCUM: { spacing: "^", map: pairs("aâ AÂ zẑ ZẐ eê EÊ yŷ YŶ uû UÛ iî IÎ oô OÔ sŝ SŜ gĝ GĜ hĥ HĤ jĵ JĴ wŵ WŴ cĉ CĈ 1¹ 2² 3³ 4⁴ 5⁵ 6⁶ 7⁷ 8⁸ 9⁹ 0⁰") },
  TREMA: { spacing: "¨", map: pairs("aä AÄ eë EË tẗ yÿ YŸ uü UÜ iï IÏ oö OÖ hḧ HḦ wẅ WẄ xẍ XẌ") },
  ACUTE: { spacing: "´", map: pairs("aá AÁ cć CĆ eé EÉ gǵ GǴ ií IÍ jȷ́ JJ́ kḱ KḰ lĺ LĹ mḿ MḾ nń NŃ oó OÓ pṕ PṔ rŕ RŔ sś SŚ uú UÚ vv́ VV́ wẃ WẂ yý YÝ zź ZŹ êế ÊẾ çḉ ÇḈ") },
  GRAVE: { spacing: "`", map: pairs("aà AÀ eè EÈ iì IÌ mm̀ MM̀ nǹ NǸ oò OÒ uù UÙ vv̀ VV̀ wẁ WẀ yỳ YỲ êề ÊỀ") },
  CARON: { spacing: "ˇ", map: pairs("aǎ AǍ cč CČ dď DĎ eě EĚ gǧ GǦ hȟ HȞ iǐ IǏ jǰ kǩ KǨ lľ LĽ nň NŇ oǒ OǑ rř RŘ sš SŠ tť TŤ uǔ UǓ zž ZŽ 1₁ 2₂ 3₃ 4₄ 5₅ 6₆ 7₇ 8₈ 9₉ 0₀") },
  BAR: { spacing: "", map: pairs("aⱥ AȺ bƀ BɃ cȼ CȻ dđ DĐ eɇ EɆ gǥ GǤ hħ HĦ iɨ IƗ jɉ JɈ lł LŁ oø OØ pᵽ PⱣ rɍ RɌ tŧ TŦ uʉ UɄ yɏ YɎ zƶ ZƵ") },
  BREVE: { spacing: "˘", map: pairs("aă AĂ eĕ EĔ gğ GĞ iĭ IĬ oŏ OŎ uŭ UŬ àằ ÀẰ") },
  TILDE: { spacing: "~", map: pairs("aã AÃ eẽ EẼ iĩ IĨ nñ NÑ oõ OÕ uũ UŨ vṽ VṼ yỹ YỸ êễ ÊỄ") },
  MACRON: { spacing: "¯", map: pairs("aā AĀ eē EĒ gḡ GḠ iī IĪ oō OŌ uū UŪ yȳ YȲ éḗ ÉḖ èḕ ÈḔ") },
  CEDILLA: { spacing: "¸", map: pairs("cç CÇ dḑ DḐ eȩ EȨ gģ GĢ hḩ HḨ kķ KĶ lļ LĻ nņ NŅ rŗ RŖ sş SŞ tţ TŢ") },
  OVERRING: { spacing: "°", map: pairs("aå AÅ uů UŮ wẘ yẙ") },
  GREEK: { spacing: "", map: pairs("aα AΑ bβ BΒ gγ GΓ dδ DΔ eε EΕ zζ ZΖ hη HΗ jθ JΘ iι IΙ kκ KΚ lλ LΛ mμ MΜ nν NΝ xξ XΞ oο OΟ pπ PΠ rρ RΡ sσ SΣ tτ TΤ uυ UΥ fφ FΦ qχ QΧ yψ YΨ wω WΩ") },
  IOTASUB: { spacing: "˛", map: pairs("oǫ OǪ aą AĄ uų UŲ iį IĮ eę EĘ") }
};

// Boxed arrow icons from eDEX-UI's keyboard.
const ARROWS = {
  ARROW_UP: "m12 8 5 5h-3v4h-4v-4H7z",
  ARROW_LEFT: "m7.5 12.5 5-5v3h4v4h-4v3z",
  ARROW_DOWN: "m12 17-5-5h3V8h4v4h3z",
  ARROW_RIGHT: "m16.5 12.5-5 5v-3h-4v-4h4v-3z"
};
const BOX = "M4 3h16c1.1 0 1-.1 1 1v16c0 1.1.1 1-1 1H4c-1.1 0-1 .1-1-1V4c0-1.1-.1-1 1-1zm0 1v16h16V4z";
function arrowSvg(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [d, op] of [[ARROWS[name] || ARROWS.ARROW_UP, "1"], [BOX, ".65"]]) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("fill-opacity", op);
    svg.append(p);
  }
  return svg;
}

// Escape sequences → key names, for typing into fields and app shortcuts.
const SEQ_KEYS = {
  [`${ESC}OA`]: "ArrowUp", [`${ESC}OB`]: "ArrowDown", [`${ESC}OC`]: "ArrowRight", [`${ESC}OD`]: "ArrowLeft",
  [`${ESC}[A`]: "ArrowUp", [`${ESC}[B`]: "ArrowDown", [`${ESC}[C`]: "ArrowRight", [`${ESC}[D`]: "ArrowLeft",
  [`${ESC}[3~`]: "Delete", [`${ESC}[H`]: "Home", [`${ESC}[F`]: "End",
  [`${ESC}OP`]: "F1", [`${ESC}OQ`]: "F2", [`${ESC}OR`]: "F3", [`${ESC}OS`]: "F4",
  [`${ESC}[15~`]: "F5", [`${ESC}[17~`]: "F6", [`${ESC}[18~`]: "F7", [`${ESC}[19~`]: "F8",
  [`${ESC}[20~`]: "F9", [`${ESC}[21~`]: "F10", [`${ESC}[23~`]: "F11", [`${ESC}[24~`]: "F12",
  [ESC]: "Escape", "\r": "Enter", "\n": "Enter", "\t": "Tab", "\b": "Backspace", "\x7f": "Backspace"
};

const isLetter = (s) => typeof s === "string" && [...s].length === 1 && s.toLowerCase() !== s.toUpperCase();
const isAsciiLetter = (s) => /^[a-z]$/i.test(s || "");
const printable = (s) => !!s && !/[\x00-\x1f\x7f]/.test(s);

function codeFor(ch) {
  if (/^[a-z]$/i.test(ch)) return `Key${ch.toUpperCase()}`;
  if (/^\d$/.test(ch)) return `Digit${ch}`;
  return { ",": "Comma", "/": "Slash", ".": "Period", " ": "Space", "-": "Minus", "=": "Equal" }[ch] || "";
}

function editableField(el) {
  if (!el || el === document.body || el.closest?.(".xterm")) return null;
  if (el.isContentEditable) return el;
  if (el.tagName === "TEXTAREA" && !el.readOnly && !el.disabled) return el;
  if (el.tagName === "INPUT" && !el.readOnly && !el.disabled && /^(text|search|url|email|password|number|tel|)$/i.test(el.type)) return el;
  return null;
}

// Picks the shipped layout matching the Windows display language.
export function autoLayoutId(ids) {
  const have = new Map(ids.map((id) => [id.toLowerCase(), id]));
  for (const lang of navigator.languages || [navigator.language]) {
    const l = String(lang).toLowerCase();
    if (have.has(l)) return have.get(l);
    const base = l.split("-")[0];
    const preferred = have.get(`${base}-${base}`) || have.get(base === "en" ? "en-us" : "") ;
    if (preferred) return preferred;
    const any = ids.find((id) => id.toLowerCase().startsWith(`${base}-`));
    if (any) return any;
  }
  return have.get("en-us") || ids[0];
}

export function initKeyboard(root, getTerminal) {
  const state = { shift: 0, ctrl: 0, alt: 0, caps: false, fn: false, dead: null, password: false, physShift: false };
  let layout = null;      // { id, name, custom, rows }
  let keys = [];          // { def, el, main, tl, tr, br, bl, mod, dead, enter }
  let loadedFor = null;   // layout id the DOM was built for
  let catalog = null;     // cached kb:list result
  let building = null;

  const layoutBtn = h("button", { class: "kb-layout-btn", type: "button", title: "Keyboard layout" }, icon("keyboard"), h("span"), icon("chevronDown"));
  const passBtn = h("button", { class: "icon-btn sm", type: "button", title: "Password mode: hide key feedback while typing secrets" }, icon("lock"));
  const deadHint = h("span", { class: "kb-dead" });
  const bar = h("div", { class: "kb-bar" }, layoutBtn, deadHint, h("span", { class: "grow" }), passBtn,
    h("button", { class: "icon-btn sm", type: "button", title: "Hide keyboard (Ctrl+Shift+K)", onclick: () => settings.set({ showKeyboard: false }) }, icon("close")));
  const rowsEl = h("div", { class: "kb-rows" });
  root.replaceChildren(bar, rowsEl);
  // Toolbar clicks must not steal focus from the field being typed into.
  for (const el of bar.querySelectorAll("button")) el.addEventListener("mousedown", (e) => e.preventDefault());

  // ── Layout loading ───────────────────────────────────────────────────────
  async function list(force = false) {
    if (!catalog || force) catalog = await api.kb.list().catch(() => ({ layouts: [], errors: [], folder: "" }));
    return catalog;
  }
  async function wantedId() {
    const pick = settings.get("keyboardLayout") || "auto";
    let { layouts } = await list();
    // A layout added since the list was fetched (e.g. just imported).
    if (pick !== "auto" && !layouts.some((l) => l.id === pick)) ({ layouts } = await list(true));
    const ids = layouts.map((l) => l.id);
    if (pick !== "auto" && ids.includes(pick)) return pick;
    return autoLayoutId(ids) || "en-US";
  }
  async function load(force = false) {
    if (building) return building;
    building = (async () => {
      try {
        const id = await wantedId();
        if (!force && id === loadedFor) return;
        layout = await api.kb.get(id);
        if (!layout) throw new Error("No keyboard layouts found");
        build();
        loadedFor = id;
      } catch (e) {
        toast(cleanError(e), { level: "warn" });
      } finally {
        building = null;
      }
    })();
    return building;
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function build() {
    keys = [];
    const rows = layout.rows;
    const lastIsEnter = rows.map((r) => r.keys.length && r.keys[r.keys.length - 1].cmd === "\r");
    rowsEl.replaceChildren(...rows.map((row, ri) => {
      const rowEl = h("div", { class: "kb-row", dataset: { row: row.id } });
      row.keys.forEach((raw, ki) => {
        const def = {};
        for (const [k, v] of Object.entries(raw)) def[k] = /_?cmd$/.test(k) ? expand(v) : v;
        const k = { def, el: null };
        const escaped = /^ESCAPED\|-- (.*)$/.exec(def.cmd || "");
        const iconName = /^ESCAPED\|-- ICON: (.*)$/.exec(def.name || "")?.[1];
        if (escaped) {
          const m = /^(SHIFT|CTRL|ALT|FN|CAPSLCK)\b/.exec(escaped[1]);
          if (m) k.mod = { SHIFT: "shift", CTRL: "ctrl", ALT: "alt", FN: "fn", CAPSLCK: "caps" }[m[1]];
        }
        // Dead keys on any layer (e.g. fr-FR: ^ circumflex, Shift+^ diaeresis).
        k.deads = Object.entries(def).filter(([p, v]) => /cmd$/.test(p) && DEAD[/^ESCAPED\|-- (.*)$/.exec(v || "")?.[1]]).map(([, v]) => v.slice(11));
        k.dead = k.deads.length > 0 && !!DEAD[escaped?.[1]];
        const cls = ["kb-key"];
        let grow = 1;
        const label = iconName ? "" : (def.name || "");
        if (def.cmd === " ") { cls.push("space"); grow = 6; }
        else if (def.cmd === "\r") {
          cls.push("enter");
          const isLast = ki === row.keys.length - 1;
          if (isLast && lastIsEnter[ri + 1]) cls.push("enter-top");
          if (isLast && lastIsEnter[ri - 1]) cls.push("enter-bottom");
          grow = cls.includes("enter-bottom") ? 1.25 : 1.6;
        } else if (ki === 0) grow = 1.5;
        else if (ki === row.keys.length - 1 && [...label].length > 1) grow = 1.6;
        else if (k.mod && [...label].length > 2) grow = 1.3;
        if ([...label].length > 2 && !k.dead) cls.push("word");
        if (k.mod) cls.push("mod");
        if (k.dead) cls.push("deadkey");
        k.main = h("span", { class: "kb-main" });
        k.tl = h("span", { class: "kb-l kb-tl" });
        k.tr = h("span", { class: "kb-l kb-tr" }, def.altshift_name || "");
        k.br = h("span", { class: "kb-l kb-br" }, def.alt_name || "");
        k.bl = h("span", { class: "kb-l kb-bl" }, def.fn_name || "");
        k.el = h("button", { class: cls.join(" "), type: "button", tabindex: -1, style: { "--g": grow } },
          k.tl, k.tr, k.br, k.bl, iconName ? arrowSvg(iconName) : k.main);
        k.enter = def.cmd === "\r";
        k.icon = !!iconName;
        wire(k);
        keys.push(k);
        rowEl.append(k.el);
      });
      // Keep the ↑ key above ↓ when the bottom row ends with ← ↓ →.
      if (/ARROW_UP/.test(row.keys[row.keys.length - 1]?.name || "") && /ARROW_RIGHT/.test(rows[ri + 1]?.keys.slice(-1)[0]?.name || "")) {
        rowEl.append(h("span", { class: "kb-gap" }));
      }
      return rowEl;
    }));
    setText(layoutBtn.children[1], `${layout.name}${layout.custom ? " · custom" : ""}`);
    indexKeys();
    paint();
  }

  // Labels follow the active layer: Fn shows F-key names, Shift (or Caps for
  // letters) swaps the main and shifted legends.
  function paint() {
    const shiftView = state.shift > 0 || state.physShift;
    for (const k of keys) {
      const d = k.def;
      if (k.mod) k.el.classList.toggle("latched", k.mod === "caps" ? state.caps : k.mod === "fn" ? state.fn : state[k.mod] > 0);
      if (k.mod && k.mod !== "caps" && k.mod !== "fn") k.el.classList.toggle("locked", state[k.mod] === 2);
      if (k.deads.length) k.el.classList.toggle("pending", k.deads.includes(state.dead));
      if (k.icon) continue;
      const letterKey = isLetter(d.cmd);
      const shifted = letterKey ? shiftView !== state.caps : shiftView;
      let main = d.name || "";
      let corner = d.shift_name || "";
      if (shifted && d.shift_name) { main = d.shift_name; corner = d.name || ""; }
      if (state.fn && d.fn_name) { main = d.fn_name; corner = ""; }
      setText(k.main, main);
      setText(k.tl, corner);
      k.bl.hidden = state.fn;
    }
    root.classList.toggle("fn-on", state.fn);
    setText(deadHint, state.dead ? `${state.dead.toLowerCase()} · next key` : "");
    passBtn.classList.toggle("active", state.password);
    root.dataset.password = String(state.password);
  }

  // ── Input ────────────────────────────────────────────────────────────────
  function wire(k) {
    let holdTimer = null;
    let repeatTimer = null;
    const stop = () => {
      clearTimeout(holdTimer);
      clearInterval(repeatTimer);
      holdTimer = repeatTimer = null;
      flash(k, false);
    };
    k.el.addEventListener("mousedown", (e) => e.preventDefault());
    k.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { k.el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or already-released pointer */ }
      flash(k, true);
      press(k);
      if (!k.mod && !k.dead) {
        holdTimer = setTimeout(() => { repeatTimer = setInterval(() => press(k, true), 70); }, 420);
      }
    });
    k.el.addEventListener("pointerup", stop);
    k.el.addEventListener("pointercancel", stop);
    k.el.addEventListener("lostpointercapture", stop);
  }

  function flash(k, on) {
    const targets = k.enter ? keys.filter((x) => x.enter) : [k];
    for (const t of targets) t.el.classList.toggle("down", on && !state.password);
  }

  function cycleMod(name) {
    // Tap: one-shot; tap again: locked; again: off.
    state[name] = state[name] === 0 ? 1 : state[name] === 1 ? 2 : 0;
  }

  function press(k, repeat = false) {
    const d = k.def;
    if (k.mod) {
      if (k.mod === "caps") state.caps = !state.caps;
      else if (k.mod === "fn") state.fn = !state.fn;
      else cycleMod(k.mod);
      paint();
      return;
    }
    const pendingBefore = state.dead;
    let cmd = resolve(d);
    if (cmd === null) {
      // A dead key or lock: one-shot modifiers are used up all the same.
      for (const m of ["shift", "ctrl", "alt"]) if (state[m] === 1) state[m] = 0;
      paint();
      return;
    }
    if (state.dead && state.dead === pendingBefore) {
      const dead = DEAD[state.dead];
      if (cmd === " ") cmd = dead.spacing || " ";
      else if (printable(cmd)) cmd = dead.map.get(cmd) ?? cmd;
      state.dead = null;
    }
    send(cmd, d);
    if (!state.password && !repeat) sfx.play(cmd === "\r" ? "granted" : "stdin");
    // One-shot modifiers release after a key; locked ones stay.
    for (const m of ["shift", "ctrl", "alt"]) if (state[m] === 1) state[m] = 0;
    paint();
  }

  // Same precedence as eDEX-UI: shift (or caps), caps override, ctrl, alt,
  // alt+shift, fn. Ctrl with an A–Z letter always sends the real control
  // code (some original layouts map those positions inconsistently).
  function resolve(d) {
    let cmd = d.cmd;
    const letterKey = isLetter(d.cmd);
    const shifted = letterKey ? (state.shift > 0) !== state.caps : state.shift > 0;
    if (shifted && d.shift_cmd) cmd = d.shift_cmd;
    if (state.caps && d.capslck_cmd) cmd = d.capslck_cmd;
    if (state.ctrl > 0) {
      if (isAsciiLetter(d.cmd)) cmd = String.fromCharCode(d.cmd.toLowerCase().charCodeAt(0) - 96);
      else if (d.ctrl_cmd) cmd = d.ctrl_cmd;
    }
    if (state.alt > 0 && d.alt_cmd) cmd = d.alt_cmd;
    if (state.alt > 0 && state.shift > 0 && d.altshift_cmd) cmd = d.altshift_cmd;
    if (state.fn && d.fn_cmd) cmd = d.fn_cmd;
    const escaped = /^ESCAPED\|-- (.*)$/.exec(cmd || "");
    if (escaped) {
      const what = escaped[1];
      if (what.startsWith("CAPSLCK")) state.caps = what.endsWith("ON");
      else if (what.startsWith("FN")) state.fn = what.endsWith("ON");
      else if (DEAD[what]) {
        // The same dead key twice types the accent itself, as on Windows.
        if (state.dead === what) { state.dead = null; return DEAD[what].spacing || null; }
        state.dead = what;
      }
      return null;
    }
    return cmd ?? "";
  }

  // The key the app's shortcut handler would see for this press, if any.
  function shortcutEvent(cmd, d) {
    const named = SEQ_KEYS[cmd];
    const base = d.cmd && [...d.cmd].length === 1 ? d.cmd : null;
    const ctrl = state.ctrl > 0, alt = state.alt > 0, shift = state.shift > 0;
    const fkey = named && /^F\d+$/.test(named);
    if (!fkey && !(ctrl && (shift || alt || /^[\d,]$/.test(base || "") || named === "Tab"))) return null;
    const key = fkey || named === "Tab" ? named : (base && /^[a-z]$/i.test(base) ? base.toUpperCase() : base);
    if (!key) return null;
    return new KeyboardEvent("keydown", { key, code: fkey || named === "Tab" ? named : codeFor(base), ctrlKey: ctrl, altKey: alt, shiftKey: shift, bubbles: true, cancelable: true });
  }

  function send(cmd, d) {
    // App shortcuts first (Ctrl+Shift+T, Ctrl+1, F1 …), exactly as a
    // physical key press would trigger them.
    const sc = shortcutEvent(cmd, d);
    if (sc) {
      document.dispatchEvent(sc);
      if (sc.defaultPrevented) return;
    }
    const field = editableField(document.activeElement);
    if (field) { typeIntoField(field, cmd); return; }
    const term = modalOpen() ? null : getTerminal();
    if (term) {
      // Ctrl+Shift+C / V copy and paste, as on the physical keyboard.
      if (state.ctrl > 0 && state.shift > 0 && /^[cv]$/i.test(d.cmd || "")) {
        if (d.cmd.toLowerCase() === "c") term.copy(); else term.paste();
        return;
      }
      term.sendKeys(cmd === "\b" ? "\x7f" : cmd === "\n" ? "\r" : cmd);
      term.focus();
      return;
    }
    // Anything else (explorer, process list, dialogs): deliver key presses.
    fireKey(document.activeElement || document.body, cmd);
  }

  function fireKey(target, cmd) {
    const named = SEQ_KEYS[cmd];
    let key = named;
    let ctrlKey = false;
    if (!key && cmd.length === 1 && cmd.charCodeAt(0) < 27) { key = String.fromCharCode(cmd.charCodeAt(0) + 96); ctrlKey = true; }
    if (!key && printable(cmd)) key = cmd;
    if (!key) return;
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, { key, code: codeFor(key) || key, ctrlKey, shiftKey: state.shift > 0, altKey: false, bubbles: true, cancelable: true }));
    }
  }

  function typeIntoField(el, cmd) {
    const named = SEQ_KEYS[cmd];
    const keyEvent = (key, extra = {}) => {
      const ev = new KeyboardEvent("keydown", { key, code: codeFor(key) || key, bubbles: true, cancelable: true, ...extra });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    if (named === "Backspace") { if (!keyEvent("Backspace")) document.execCommand("delete"); return; }
    if (named === "Delete") { if (!keyEvent("Delete")) document.execCommand("forwardDelete"); return; }
    if (named === "Enter") { if (!keyEvent("Enter") && el.tagName === "TEXTAREA") document.execCommand("insertText", false, "\n"); return; }
    if (named === "ArrowLeft" || named === "ArrowRight") {
      if (keyEvent(named) || el.selectionStart === undefined || el.selectionStart === null) return;
      const pos = Math.max(0, Math.min(el.value.length, (named === "ArrowLeft" ? el.selectionStart : el.selectionEnd) + (named === "ArrowLeft" ? -1 : 1)));
      el.setSelectionRange(pos, pos);
      return;
    }
    if (named) { keyEvent(named); return; }
    if (cmd.length === 1 && cmd.charCodeAt(0) < 27) {
      const letter = String.fromCharCode(cmd.charCodeAt(0) + 96);
      if (keyEvent(letter, { ctrlKey: true })) return;
      if (letter === "a") el.select?.();
      else if (letter === "c") document.execCommand("copy");
      else if (letter === "x") document.execCommand("cut");
      else if (letter === "v") api.clip.read().then((t) => { if (t) { el.focus(); document.execCommand("insertText", false, t); } }).catch(() => {});
      return;
    }
    if (cmd.startsWith(ESC)) return; // Alt/meta sequences mean nothing in a text box
    if (printable(cmd)) document.execCommand("insertText", false, cmd);
  }

  // ── Physical keyboard mirroring ──────────────────────────────────────────
  let byChar = new Map();
  let special = new Map();
  function indexKeys() {
    byChar = new Map();
    special = new Map();
    const mods = { shift: [], ctrl: [], alt: [], fn: [], caps: [] };
    for (const k of keys) {
      const d = k.def;
      if (k.mod) { mods[k.mod].push(k); continue; }
      for (const p of ["cmd", "shift_cmd", "alt_cmd", "altshift_cmd"]) {
        const v = d[p];
        if (v && [...v].length === 1 && printable(v) && !byChar.has(v)) byChar.set(v, k);
      }
      const named = SEQ_KEYS[d.cmd] || SEQ_KEYS[d.shift_cmd];
      if (d.cmd === " ") special.set("Space", k);
      else if (named && !special.has(named)) special.set(named, k);
    }
    const first = (list) => list[0];
    const last = (list) => list[list.length - 1];
    if (mods.shift.length) { special.set("ShiftLeft", first(mods.shift)); special.set("ShiftRight", last(mods.shift)); }
    if (mods.ctrl.length) { special.set("ControlLeft", first(mods.ctrl)); special.set("ControlRight", last(mods.ctrl)); }
    if (mods.alt.length) special.set("AltRight", first(mods.alt));
    if (mods.fn.length) special.set("AltLeft", first(mods.fn));
    if (mods.caps.length) special.set("CapsLock", first(mods.caps));
  }
  const findPhysical = (e) => {
    if (e.code === "Enter" || e.code === "NumpadEnter") return keys.find((k) => k.enter);
    return special.get(e.code) || special.get(e.key) || byChar.get(e.key) || byChar.get(e.key?.toLowerCase()) || byChar.get(e.key?.toUpperCase());
  };
  const shown = () => root.classList.contains("show");
  document.addEventListener("keydown", (e) => {
    if (!shown() || !e.isTrusted) return;
    if (e.key === "Shift" && !state.physShift) { state.physShift = true; paint(); }
    if (state.password) return;
    const k = findPhysical(e);
    if (k) flash(k, true);
  }, true);
  document.addEventListener("keyup", (e) => {
    if (!shown() || !e.isTrusted) return;
    if (e.key === "Shift" && state.physShift) { state.physShift = false; paint(); }
    const k = findPhysical(e);
    if (k) flash(k, false);
  }, true);
  window.addEventListener("blur", () => {
    rowsEl.querySelectorAll(".down").forEach((el) => el.classList.remove("down"));
    if (state.physShift) { state.physShift = false; paint(); }
  });

  // ── Toolbar ──────────────────────────────────────────────────────────────
  layoutBtn.addEventListener("click", async (e) => {
    const anchor = { clientX: e.clientX, clientY: e.clientY - 8, preventDefault() {}, stopPropagation() {} };
    const { layouts } = await list(true);
    const current = settings.get("keyboardLayout") || "auto";
    contextMenu(anchor, [
      { label: "Auto (match Windows language)", icon: current === "auto" ? "star" : null, run: () => settings.set({ keyboardLayout: "auto" }) },
      { separator: true },
      ...layouts.map((l) => ({ label: `${l.name}${l.custom ? " (custom)" : ""}`, hint: l.id, icon: current === l.id ? "star" : null, run: () => settings.set({ keyboardLayout: l.id }) })),
      { separator: true },
      { label: "Open custom layouts folder", icon: "folder", run: openLayoutsFolder },
      { label: "Import layout…", icon: "download", run: importLayouts },
      { label: "Keyboard settings…", icon: "gear", run: () => runCommand("settings.keyboard") }
    ]);
  });
  passBtn.addEventListener("click", () => togglePassword());

  function togglePassword(on = !state.password) {
    state.password = on;
    if (on) rowsEl.querySelectorAll(".down").forEach((el) => el.classList.remove("down"));
    paint();
    toast(on ? "Keyboard password mode on: key feedback hidden" : "Keyboard password mode off", { timeout: 1600 });
  }

  // ── Visibility and live updates ──────────────────────────────────────────
  // Layouts load the first time the keyboard is shown, not at startup.
  const apply = () => {
    const on = !!settings.get("showKeyboard");
    root.classList.toggle("show", on);
    if (on) load();
  };
  settings.watch("showKeyboard", apply);
  settings.watch("keyboardLayout", () => { if (shown()) load(); else loadedFor = null; });
  api.kb.onChange(async () => {
    await list(true);
    if (shown() && (layout?.custom || (settings.get("keyboardLayout") || "auto") !== loadedFor)) load(true);
    else loadedFor = null;
  });
  apply();

  return { togglePassword, reload: () => load(true) };
}

export async function openLayoutsFolder() {
  try {
    const folder = await api.kb.folder();
    emit("open-path", { path: folder, newTab: true });
  } catch (e) {
    toast(cleanError(e), { level: "warn" });
  }
}

export async function importLayouts() {
  try {
    const { imported, errors } = await api.kb.import();
    if (imported.length) {
      toast(`Imported ${imported.join(", ")}`, { level: "ok", action: { label: "Use", run: () => settings.set({ keyboardLayout: imported[0] }) } });
    }
    for (const err of errors.slice(0, 3)) toast(`${err.file}: ${err.message}`, { level: "warn", timeout: 6000 });
  } catch (e) {
    toast(cleanError(e), { level: "warn" });
  }
}
