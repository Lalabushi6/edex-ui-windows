// Theme studio: edit every part of a theme (colours, fonts, terminal,
// palette filter, globe, layout hints, theme CSS) with a live preview, save
// it as your own theme, import / export eDEX-UI theme files. Also the global
// custom CSS editor, applied on top of any theme.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { currentTheme, applyTheme, applyThemeData, parseFilter, formatFilter } from "../core/theme.js";
import { openModal, toast, confirm, cleanError } from "../core/ui.js";
import { emit } from "../core/bus.js";

const api = window.edex;
const UI_FONTS = ["United Sans", "Fira Mono", "Fira Code", "Segoe UI", "Bahnschrift", "Consolas", "Cascadia Mono", "Cascadia Code", "Courier New", "Lucida Console", "OCR A Extended"];
const TERM_FONTS = ["Fira Mono", "Fira Code", "Cascadia Mono", "Cascadia Code", "Consolas"];

// Any CSS colour → #rrggbb (the colour inputs only take hex).
const probe = document.createElement("canvas").getContext("2d");
function toHex(c, fallback = "#000000") {
  if (!c) return fallback;
  probe.fillStyle = "#000000";
  probe.fillStyle = String(c);
  const v = probe.fillStyle;
  if (v.startsWith("#")) return v;
  const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(v);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : fallback;
}
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function colorField(value, onInput) {
  const input = h("input", { type: "color", class: "ts-color", value: toHex(value) });
  const text = h("input", { class: "input ts-hex", spellcheck: false, value: toHex(value), maxlength: 7 });
  input.addEventListener("input", () => { text.value = input.value; onInput(); });
  text.addEventListener("change", () => {
    const v = toHex(text.value, input.value);
    text.value = v;
    input.value = v;
    onInput();
  });
  return { el: h("span", { class: "ts-field" }, input, text), get: () => input.value, set: (v) => { input.value = toHex(v); text.value = input.value; } };
}

function selectField(options, value, onInput) {
  const el = h("select", { class: "input" }, ...options.map(([v, label]) => h("option", { value: v }, label)));
  el.value = value;
  el.addEventListener("change", onInput);
  return { el, get: () => el.value, set: (v) => { el.value = v; } };
}

const field = (label, control, hint) => h("div", { class: "ts-row" },
  h("span", { class: "ts-label" }, label, hint ? h("small", null, hint) : null), control);

// Hold to fade the dialog and see the whole interface with the changes.
function peekButton() {
  const btn = h("button", { class: "btn", type: "button", title: "Hold to see the interface behind this dialog" }, icon("eye"), "Peek");
  const set = (on) => btn.closest(".modal-backdrop")?.classList.toggle("peek", on);
  btn.addEventListener("pointerdown", () => set(true));
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, () => set(false));
  return btn;
}

// ── Theme editor ────────────────────────────────────────────────────────────
export async function openThemeEditor() {
  const themes = await api.themes.list().catch(() => []);
  const savedId = settings.get("theme");
  let saved = false;

  openModal((close) => {
    const live = () => schedulePreview();
    const f = {
      name: h("input", { class: "input", spellcheck: false, maxlength: 48 }),
      accent: colorField("#aacfd1", live),
      bg: colorField("#05080d", live),
      deep: colorField("#000000", live),
      grid: colorField("#262828", live),
      uiFont: selectField(UI_FONTS.map((x) => [x, x]), "United Sans", live),
      termFont: selectField(TERM_FONTS.map((x) => [x, x]), "Fira Mono", live),
      cursor: selectField([["block", "Block"], ["bar", "Bar"], ["underline", "Underline"]], "block", live),
      fg: colorField("#aacfd1", live),
      tbg: colorField("#05080d", live),
      caret: colorField("#aacfd1", live),
      selection: colorField("#aacfd1", live),
      palette: selectField([["tint", "Tinted to the accent (eDEX-UI)"], ["filter", "Custom colour filter"]], "tint", live),
      filter: h("input", { class: "input", spellcheck: false, placeholder: "e.g. rotate(180) saturate(0.5) mix(0.7)" }),
      gBase: colorField("#000000", live),
      gMarker: colorField("#aacfd1", live),
      gPin: colorField("#aacfd1", live),
      gSat: colorField("#aacfd1", live),
      lSide: selectField([["", "Don't change"], ["split", "Either side"], ["left", "Both on the left"], ["right", "Both on the right"]], "", live),
      lFiles: selectField([["", "Don't change"], ["off", "Hidden"], ["bottom", "Bottom strip"], ["column", "Under the panels"]], "", live),
      lOrder: selectField([["", "Don't change"], ["files-left", "Files left, keyboard right"], ["keyboard-left", "Keyboard left, files right"]], "", live),
      css: h("textarea", { class: "input ts-css", spellcheck: false, wrap: "off", placeholder: "/* CSS applied with this theme, e.g. */\n.panel-title { letter-spacing: .2em; }\n#workspace { border-color: var(--c-50); }" })
    };
    f.filter.addEventListener("input", live);
    f.css.addEventListener("input", live);
    const base = h("select", { class: "input" }, ...themes.map((t) => h("option", { value: t.id }, `${t.name}${t.custom ? " (yours)" : ""}`)));
    base.value = savedId;

    const load = (t) => {
      f.name.value = t.custom ? t.name : `${t.name} custom`.slice(0, 48);
      f.accent.set(`rgb(${t.rgb.join(",")})`);
      f.bg.set(t.lightBlack); f.deep.set(t.black); f.grid.set(t.grey);
      f.uiFont.set(UI_FONTS.includes(t.fonts?.ui) ? t.fonts.ui : "United Sans");
      const term = t.terminal || {};
      f.termFont.set(TERM_FONTS.includes(term.fontFamily) ? term.fontFamily : "Fira Mono");
      f.cursor.set(term.cursorStyle || "block");
      const accent = `rgb(${t.rgb.join(",")})`;
      f.fg.set(term.foreground || accent); f.tbg.set(term.background || t.lightBlack);
      f.caret.set(term.cursor || term.foreground || accent); f.selection.set(term.selectionBackground || accent);
      f.palette.set(t.colorFilter?.length ? "filter" : "tint");
      f.filter.value = formatFilter(t.colorFilter);
      const g = t.globe || {};
      f.gBase.set(g.base || "#000000"); f.gMarker.set(g.marker || accent); f.gPin.set(g.pin || accent); f.gSat.set(g.satellite || accent);
      f.lSide.set(t.layout?.columnsSide || ""); f.lFiles.set(t.layout?.filesPanel || ""); f.lOrder.set(t.layout?.bottomOrder || "");
      f.css.value = t.css || "";
      f.base = t;
      schedulePreview();
    };
    base.addEventListener("change", async () => {
      const t = await api.themes.get(base.value).catch(() => null);
      if (t) load(t);
    });

    const values = () => {
      const rgb = hexToRgb(f.accent.get());
      const sel = hexToRgb(f.selection.get());
      const layout = {};
      if (f.lSide.get()) layout.columnsSide = f.lSide.get();
      if (f.lFiles.get()) layout.filesPanel = f.lFiles.get();
      if (f.lOrder.get()) layout.bottomOrder = f.lOrder.get();
      const steps = f.palette.get() === "filter" ? parseFilter(f.filter.value) : [];
      return {
        rgb, black: f.deep.get(), lightBlack: f.bg.get(), grey: f.grid.get(), uiFont: f.uiFont.get(),
        terminal: {
          fontFamily: f.termFont.get(), cursorStyle: f.cursor.get(), foreground: f.fg.get(), background: f.tbg.get(),
          cursor: f.caret.get(), cursorAccent: f.tbg.get(), selection: `rgba(${sel.join(",")},0.3)`
        },
        steps,
        colorFilter: steps.map((s) => `${s.func}(${s.arg ?? ""})`),
        globe: { base: f.gBase.get(), marker: f.gMarker.get(), pin: f.gPin.get(), satellite: f.gSat.get() },
        layout: Object.keys(layout).length ? layout : null,
        css: f.css.value
      };
    };

    let timer = null;
    function schedulePreview() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const v = values();
        const b = f.base || currentTheme();
        applyThemeData({
          ...b, id: "preview", name: f.name.value || b.name,
          rgb: v.rgb, black: v.black, lightBlack: v.lightBlack, grey: v.grey,
          terminal: { ...b.terminal, ...v.terminal, selectionBackground: v.terminal.selection },
          colorFilter: v.steps, globe: v.globe, fonts: { ui: v.uiFont }, css: v.css, layout: v.layout
        }, { preview: true });
      }, 120);
    }

    const save = async () => {
      const name = f.name.value.trim();
      if (!name) { toast("Give the theme a name", { level: "warn" }); f.name.focus(); return; }
      try {
        const id = await api.themes.save(name, values());
        saved = true;
        if (settings.get("theme") === id) await applyTheme(id);
        else settings.set({ theme: id });
        emit("themes-changed");
        toast(`Saved theme "${name}"`, { level: "ok" });
        close(true);
      } catch (e) { toast(cleanError(e), { level: "warn" }); }
    };

    api.themes.get(savedId).then((t) => t && load(t));

    const section = (title, ...rows) => h("fieldset", { class: "ts-section" }, h("legend", null, title), ...rows);
    return h("div", { class: "ts" },
      h("div", { class: "modal-head" }, icon("palette"), h("span", { class: "modal-title grow" }, "Theme editor"),
        h("button", { class: "icon-btn", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("close"))),
      h("div", { class: "ts-body" },
        h("div", { class: "ts-col" },
          section("Theme", field("Start from", base), field("Name", f.name, "saved as your own theme")),
          section("Colours", field("Accent", f.accent.el), field("Background", f.bg.el), field("Deep background", f.deep.el), field("Grid lines", f.grid.el)),
          section("Fonts", field("Interface", f.uiFont.el), field("Terminal", f.termFont.el, "if Settings → Terminal → Font is “From theme”"), field("Cursor", f.cursor.el))),
        h("div", { class: "ts-col" },
          section("Terminal", field("Text", f.fg.el), field("Background", f.tbg.el), field("Cursor", f.caret.el), field("Selection", f.selection.el, "drawn at 30%"),
            field("ANSI colours", f.palette.el), field("Filter", f.filter, "negate grayscale lighten darken saturate desaturate whiten blacken rotate mix")),
          section("World view globe", field("Land", f.gBase.el), field("Markers", f.gMarker.el), field("Pins", f.gPin.el), field("Satellites", f.gSat.el))),
        h("div", { class: "ts-col" },
          section("Layout (applied with the theme)", field("Panel columns", f.lSide.el), field("File browser", f.lFiles.el), field("Bottom strip", f.lOrder.el)),
          section("Theme CSS", f.css, h("div", { class: "ts-hint" }, "Styles shipped with this theme. Variables: --rgb, --c, --c-50, --bg, --grey, --font-ui, --col-w. Regions: #topbar, #col-left, #col-right, #work, #workspace, #filepanel, #keyboard, #dock, .panel, .tab.")))),
      h("div", { class: "dialog-actions ts-actions" },
        h("button", { class: "btn", type: "button", onclick: () => importThemes() }, icon("download"), "Import…"),
        h("button", { class: "btn", type: "button", onclick: () => exportTheme(base.value) }, icon("external"), "Export selected…"),
        h("button", { class: "btn", type: "button", onclick: () => openThemesFolder() }, icon("folder"), "Folder"),
        h("span", { class: "grow" }),
        peekButton(),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"),
        h("button", { class: "btn primary", type: "button", onclick: save }, "Save theme")));
  }, {
    className: "ts-modal",
    label: "Theme editor",
    // Leaving without saving puts the real theme back.
    onClose: () => { if (!saved) applyTheme(settings.get("theme")).catch(() => {}); }
  });
}

export async function importThemes() {
  try {
    const { imported, errors } = await api.themes.import();
    if (imported.length) {
      emit("themes-changed");
      toast(`Imported ${imported.length} theme${imported.length === 1 ? "" : "s"}`, { level: "ok", action: { label: "Use", run: () => settings.set({ theme: imported[0] }) } });
    }
    for (const err of errors.slice(0, 3)) toast(`${err.file}: ${err.message}`, { level: "warn", timeout: 6000 });
  } catch (e) { toast(cleanError(e), { level: "warn" }); }
}

export async function exportTheme(id) {
  try {
    const dest = await api.themes.export(id);
    if (dest) toast("Theme exported", { level: "ok", action: { label: "Show", run: () => api.fs.reveal(dest) } });
  } catch (e) { toast(cleanError(e), { level: "warn" }); }
}

export async function deleteTheme(t) {
  if (!(await confirm({ title: "Delete theme", message: `Move "${t.name}" to the Recycle Bin?`, confirmLabel: "Delete", danger: true }))) return false;
  try {
    await api.themes.remove(t.id);
    if (settings.get("theme") === t.id) settings.set({ theme: "tron" });
    emit("themes-changed");
    return true;
  } catch (e) { toast(cleanError(e), { level: "warn" }); return false; }
}

export async function openThemesFolder() {
  try {
    emit("open-path", { path: await api.themes.folder(), newTab: true });
  } catch (e) { toast(cleanError(e), { level: "warn" }); }
}

// ── Custom CSS ──────────────────────────────────────────────────────────────
function userStyle() {
  let el = document.getElementById("user-css");
  if (!el) {
    el = document.createElement("style");
    el.id = "user-css";
    document.head.append(el);
  }
  return el;
}

const cleanCss = (css) => String(css || "").replace(/@import[^;]*;?/gi, "");

export function initCustomCss() {
  userStyle().textContent = cleanCss(settings.get("customCss"));
  settings.watch("customCss", (css) => { userStyle().textContent = cleanCss(css); });
}

const CSS_HOOKS = [
  ["Variables", "--rgb (accent as \"r g b\"), --c, --c-70, --c-50, --c-20, --bg, --bg-deep, --grey, --font-ui, --font-mono, --col-w, --gap, --radius"],
  ["Regions", "#app, #topbar, #col-left, #col-right, #work, #workspace, #bottom, #filepanel, #keyboard, #dock"],
  ["Panels", ".panel, .panel-head, .panel-title, .panel-sub, .panel-body, #w-clock, #w-cpu, #w-globe … (one id per widget)"],
  ["Workspace", ".tabbar, .tab, .tab.active, .pane, .xterm"],
  ["Keyboard", ".kb-key, .kb-key.mod, .kb-key.space, .kb-key.enter, .kb-key.down"],
  ["Files", ".fp-item, .fp-name, .fp-type, .fp-size, .fp-date, .fp-bar"],
  ["Layout state", "#app[data-side=left|right|split], #app[data-files=off|bottom|column], html.eco"]
];

export function openCssEditor() {
  const before = settings.get("customCss") || "";
  let saved = false;
  openModal((close) => {
    const area = h("textarea", { class: "input ts-css big", spellcheck: false, wrap: "off", placeholder: "/* Applied on top of every theme. Example: */\n.panel-title { font-size: 1rem; }\n#keyboard .kb-key { border-color: var(--c-20); }\n#app[data-side=left] #work { margin-left: 1rem; }" });
    area.value = before;
    const status = h("span", { class: "muted", style: { fontSize: ".78rem" } });
    let timer = null;
    area.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        userStyle().textContent = cleanCss(area.value);
        setText(status, `${area.value.length.toLocaleString()} / 50,000 characters · previewing`);
      }, 250);
    });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "  "); }
      if (e.key === "s" && e.ctrlKey) { e.preventDefault(); save(); }
    });
    const save = () => {
      saved = true;
      settings.set({ customCss: area.value.slice(0, 50000) });
      toast("Custom CSS saved", { level: "ok" });
      close(true);
    };
    setText(status, `${before.length.toLocaleString()} / 50,000 characters`);
    setTimeout(() => area.focus(), 0);
    return h("div", { class: "ts css-editor" },
      h("div", { class: "modal-head" }, icon("code"), h("span", { class: "modal-title grow" }, "Custom CSS"),
        h("button", { class: "icon-btn", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("close"))),
      h("div", { class: "ts-body css" },
        h("div", { class: "ts-col" }, area, status),
        h("div", { class: "ts-col ts-hooks" }, h("h4", null, "Hooks"),
          ...CSS_HOOKS.map(([k, v]) => h("div", { class: "ts-hook" }, h("b", null, k), h("span", null, v))),
          h("p", { class: "ts-hint" }, "Changes preview as you type; Save (Ctrl+S) keeps them. If something breaks, clear the box and save, or run “Edit custom CSS” from the launcher."))),
      h("div", { class: "dialog-actions ts-actions" },
        h("button", { class: "btn", type: "button", onclick: () => { area.value = ""; area.dispatchEvent(new Event("input")); } }, icon("trash"), "Clear"),
        h("span", { class: "grow" }),
        peekButton(),
        h("button", { class: "btn", type: "button", onclick: () => close() }, "Cancel"),
        h("button", { class: "btn primary", type: "button", onclick: save }, "Save")));
  }, {
    className: "ts-modal",
    label: "Custom CSS",
    onClose: () => { if (!saved) userStyle().textContent = cleanCss(before); }
  });
}
