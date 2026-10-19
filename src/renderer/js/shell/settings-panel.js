// Settings overlay. Every control writes straight to the settings store;
// changes apply live.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { currentTheme } from "../core/theme.js";
import { openModal, toast, prompt, cleanError, contextMenu } from "../core/ui.js";
import { profile, onSchedulingChange } from "../core/poll.js";
import * as fmt from "../core/format.js";
import { widgetDefs } from "../widgets/registry.js";
import { runCommand } from "../core/commands.js";
import { autoLayoutId, openLayoutsFolder, importLayouts } from "./keyboard.js";
import { describeLogo, openBootLogoEditor, previewBootTitle } from "./boot-art.js";
import { openThemeEditor, openCssEditor, importThemes, exportTheme, deleteTheme, openThemesFolder } from "./theme-studio.js";
import { PRESETS, computeGrid, applyPreset } from "../core/layout.js";

const api = window.edex;

function row(name, desc, control) {
  return h("div", { class: "setting" },
    h("div", { class: "setting-text" }, h("div", { class: "setting-name" }, name), desc && h("div", { class: "setting-desc" }, desc)),
    h("div", { class: "setting-control" }, control));
}

function toggle(key) {
  const el = h("input", { class: "switch", type: "checkbox", checked: !!settings.get(key) });
  el.addEventListener("change", () => settings.set({ [key]: el.checked }));
  return el;
}

function select(key, options) {
  const el = h("select", { class: "input" }, ...options.map(([value, label]) => h("option", { value }, label)));
  el.value = String(settings.get(key));
  el.addEventListener("change", () => settings.set({ [key]: el.value }));
  return el;
}

function number(key, min, max, step = 1) {
  const el = h("input", { class: "input", type: "number", min, max, step });
  el.value = String(settings.get(key));
  el.addEventListener("change", () => {
    const n = Math.max(min, Math.min(max, Number(el.value) || min));
    el.value = String(n);
    settings.set({ [key]: n });
  });
  return el;
}

function text(key, placeholder = "") {
  const el = h("input", { class: "input", spellcheck: false, placeholder });
  el.value = settings.get(key) || "";
  el.addEventListener("change", () => settings.set({ [key]: el.value.trim() }));
  return el;
}

function range(key, min, max, suffix = "") {
  const label = h("span", { class: "muted", style: { minWidth: "3rem", textAlign: "right" } }, `${settings.get(key)}${suffix}`);
  const el = h("input", { type: "range", min, max, step: 1, style: { width: "12rem" } });
  el.value = String(settings.get(key));
  el.addEventListener("input", () => { label.textContent = `${el.value}${suffix}`; });
  el.addEventListener("change", () => settings.set({ [key]: Number(el.value) }));
  return h("span", { style: { display: "flex", alignItems: "center", gap: ".5rem" } }, el, label);
}

// A miniature of a layout preset, drawn from the same grid the app uses.
const SKETCH_LABEL = { top: "", left: "SYS", right: "NET", work: "TERMINAL", files: "FILES", bottom: "FILES · KEYBOARD", dock: "" };
function layoutSketch(values) {
  const v = { showKeyboard: settings.get("showKeyboard"), ...Object.fromEntries(["showTopbar", "showDock", "showLeftColumn", "showRightColumn", "columnsSide", "filesPanel", "bottomOrder"].map((k) => [k, settings.get(k)])), ...values };
  const g = computeGrid(v);
  const ROW = { top: "5px", main: g.kinds.includes("files") ? "2.2fr" : "1fr", files: "1fr", bottom: "15px", dock: "6px" };
  const areas = [...new Set(g.areas.replace(/"/g, " ").split(/\s+/).filter(Boolean))];
  const bottomLabel = g.files === "bottom" && g.keyboard ? (v.bottomOrder === "keyboard-left" ? "KEYS · FILES" : "FILES · KEYS") : g.files === "bottom" ? "FILES" : "KEYBOARD";
  return h("span", {
    class: "sketch",
    style: {
      gridTemplateColumns: g.cols.map((c) => (c === "work" ? "2.6fr" : "1fr")).join(" "),
      gridTemplateRows: g.kinds.map((k) => ROW[k]).join(" "),
      gridTemplateAreas: g.areas
    }
  }, ...areas.map((a) => h("span", { class: `sketch-${a}`, style: { gridArea: a } }, a === "bottom" ? bottomLabel : SKETCH_LABEL[a])));
}

// Boot logo: a title or ASCII art, edited in its own dialog.
function bootLogoRow() {
  const summary = h("span", { class: "muted", style: { fontSize: ".82rem" } }, describeLogo(settings.get("bootLogo")));
  const refresh = () => setText(summary, describeLogo(settings.get("bootLogo")));
  return row("Boot logo", "A title, or ASCII art: paste it, load a .txt / .nfo / .ans file, or generate block letters. Art is scaled to fit the screen.",
    h("span", { style: { display: "flex", alignItems: "center", gap: ".5rem" } }, summary,
      h("button", { class: "btn", type: "button", onclick: () => previewBootTitle(settings.get("bootLogo"), settings.get("bootSubtitle")) }, icon("play"), "Preview"),
      h("button", { class: "btn", type: "button", onclick: () => openBootLogoEditor(refresh) }, icon("edit"), "Edit…")));
}

// Click, then press the new key combination. Esc cancels, Backspace clears.
function hotkey(key) {
  const el = h("input", { class: "input hotkey-input", readOnly: true });
  const show = () => { el.value = settings.get(key) || "(none)"; };
  show();
  el.addEventListener("focus", () => { el.classList.add("recording"); el.value = "Press keys…"; });
  el.addEventListener("blur", () => { el.classList.remove("recording"); show(); });
  el.addEventListener("keydown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { el.blur(); return; }
    if (e.key === "Backspace" || e.key === "Delete") { settings.set({ [key]: "" }); el.blur(); return; }
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const parts = [];
    if (e.ctrlKey) parts.push("CommandOrControl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");
    let k = e.key;
    if (e.code.startsWith("Key")) k = e.code.slice(3);
    else if (e.code.startsWith("Digit")) k = e.code.slice(5);
    else if (k === " ") k = "Space";
    else if (e.code === "Backquote") k = "`";
    if (!parts.length && !/^F\d+$/.test(k)) { toast("Use at least one modifier (Ctrl, Alt or Shift)", { level: "warn" }); return; }
    parts.push(k.length === 1 ? k.toUpperCase() : k);
    settings.set({ [key]: parts.join("+") });
    el.blur();
  });
  return el;
}

const PAGES = [
  { id: "general", label: "General", icon: "gear" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "keyboard", label: "Keyboard", icon: "keyboard" },
  { id: "layout", label: "Layout", icon: "layout" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "performance", label: "Performance", icon: "gauge" },
  { id: "privacy", label: "Privacy", icon: "lock" },
  { id: "about", label: "About", icon: "info" }
];

// Pages with live content register a cleanup that runs when the page is
// left or the panel closes.
let pageCleanups = [];
function runPageCleanups() {
  for (const fn of pageCleanups) { try { fn(); } catch (_) {} }
  pageCleanups = [];
}

const PROCESS_LABELS = { Browser: "Main process", Tab: "Interface", GPU: "GPU process", Utility: "Utility (network, audio…)" };

function performanceUsage() {
  const total = h("span", { class: "mono" }, "--");
  const list = h("div", { class: "perf-usage" });
  const render = (u) => {
    const rows = u.processes.map((p) => ({ label: PROCESS_LABELS[p.type] || p.type, cpu: p.cpu, memory: p.memory }));
    if (u.bridge) rows.push({ label: "Native helper", cpu: u.bridge.cpu, memory: u.bridge.memory });
    // Same process types are merged (e.g. several utility processes).
    const merged = new Map();
    for (const r of rows) {
      const m = merged.get(r.label) || { label: r.label, cpu: 0, memory: 0, count: 0 };
      m.cpu += r.cpu || 0;
      m.memory += r.memory || 0;
      m.count++;
      merged.set(r.label, m);
    }
    const all = [...merged.values()];
    const cpu = all.reduce((a, r) => a + r.cpu, 0);
    const mem = all.reduce((a, r) => a + r.memory, 0);
    total.textContent = `${cpu.toFixed(1)}% CPU · ${fmt.bytes(mem)}`;
    list.replaceChildren(...all.map((r) => h("div", { class: "perf-row" },
      h("span", { class: "ellipsis" }, r.count > 1 ? `${r.label} ×${r.count}` : r.label),
      h("span", { class: "num" }, `${r.cpu.toFixed(1)}%`),
      h("span", { class: "num" }, fmt.bytes(r.memory)))));
  };
  const refresh = () => api.sys.appUsage().then(render).catch(() => {});
  refresh();
  const timer = setInterval(refresh, 2000);
  pageCleanups.push(() => clearInterval(timer));
  return { total, list };
}

async function buildPage(id) {
  const page = [];
  if (id === "general") {
    page.push(h("h3", null, "Behaviour"),
      row("Mode", "Desktop: a full-screen home that sits behind your apps. Overlay: an always-on-top HUD you summon with the hotkey.", select("mode", [["desktop", "Desktop"], ["overlay", "Overlay"]])),
      row("Cover the Windows taskbar", "Use the whole screen instead of the work area.", toggle("coverTaskbar")),
      row("Hide overlay when it loses focus", "Overlay mode only.", toggle("overlayHideOnBlur")),
      row("Hide overlay after launching", "Get out of the way after opening an app, file or window (overlay mode).", toggle("hideAfterLaunch")),
      row("Close button hides to tray", "Alt+F4 keeps eDEX running in the tray instead of quitting.", toggle("closeToTray")),
      row("Start with Windows", "Launch eDEX (hidden) when you sign in.", toggle("openAtLogin")),
      row("Start hidden", "Stay in the tray at launch until summoned.", toggle("startHidden")),
      h("h3", null, "Global hotkeys"),
      row("Show / hide eDEX", "Works from any app. Click, then press a new combination.", hotkey("hotkeyToggle")),
      row("Open launcher", "Summons eDEX straight into search.", hotkey("hotkeyLauncher")),
      h("h3", null, "Launcher"),
      row("Web search URL", "%s is replaced by your query.", text("webSearchUrl", "https://www.google.com/search?q=%s")),
      h("h3", null, "Sound"),
      row("Interface sounds", null, toggle("audioEnabled")),
      row("Volume", null, range("audioVolume", 0, 100, "%")),
      row("Typing feedback", "Click sounds for terminal input.", toggle("audioFeedback")));
  }
  if (id === "appearance") {
    const themes = await api.themes.list().catch(() => []);
    const grid = h("div", { class: "theme-grid" });
    const renderThemes = () => grid.replaceChildren(...themes.map((t) => h("button", {
      class: `theme-card${settings.get("theme") === t.id ? " active" : ""}`, type: "button",
      onclick: () => { settings.set({ theme: t.id }); renderThemes(); }
    }, h("span", { class: "theme-swatch", style: { background: `rgb(${t.rgb.join(",")})`, color: `rgb(${t.rgb.join(",")})` } }), h("span", { class: "ellipsis grow" }, t.name),
    t.hasLayout && h("span", { class: "theme-badge", title: "Also changes the layout (Settings → Layout → Themes can change the layout)" }, icon("layout")))));
    renderThemes();
    // Right-click a theme to export it (or delete one of your own).
    grid.addEventListener("contextmenu", (e) => {
      const card = e.target.closest(".theme-card");
      if (!card) return;
      const t = themes[[...grid.children].indexOf(card)];
      if (!t) return;
      contextMenu(e, [
        { label: "Use", icon: "palette", run: () => { settings.set({ theme: t.id }); renderThemes(); } },
        { label: "Export…", icon: "external", run: () => exportTheme(t.id) },
        t.custom && { label: "Delete…", icon: "trash", danger: true, run: async () => { if (await deleteTheme(t)) openPanel?.show("appearance"); } }
      ]);
    });
    const btns = (...items) => h("span", { style: { display: "flex", gap: ".4rem", alignItems: "center" } }, ...items);
    page.push(h("h3", null, "Theme"), grid,
      row("Theme editor", "Every colour, the interface and terminal fonts, terminal palette, globe colours, layout and theme CSS, with a live preview. Saves as your own theme.",
        btns(h("button", { class: "btn primary", type: "button", onclick: () => openThemeEditor() }, icon("palette"), "Edit theme…"))),
      row("Import themes", "eDEX-UI theme files (.json) — the original's format works as is. Right-click a theme above to export it.",
        btns(h("button", { class: "btn", type: "button", onclick: async () => { await importThemes(); openPanel?.show("appearance"); } }, icon("download"), "Import…"),
          h("button", { class: "btn", type: "button", onclick: () => openThemesFolder() }, icon("folder"), "Folder"))),
      row("Custom CSS", "Your own styles, applied on top of any theme (hooks for every region, panel and key are listed in the editor).",
        btns(h("button", { class: "btn", type: "button", onclick: () => openCssEditor() }, icon("code"), "Edit CSS…"))),
      h("h3", null, "Display"),
      row("Interface scale", "Size of text and controls.", range("uiScale", 70, 160, "%")),
      row("24-hour clock", null, toggle("clock24h")),
      row("Temperature unit", null, select("temperatureUnit", [["C", "Celsius"], ["F", "Fahrenheit"]])),
      h("h3", null, "Boot screen"),
      row("Boot animation", null, toggle("bootAnimation")),
      bootLogoRow(),
      row("Boot subtitle", null, text("bootSubtitle", "WINDOWS EDITION")));
  }
  if (id === "terminal") {
    const shells = await api.term.shells().catch(() => []);
    page.push(h("h3", null, "Shell"),
      row("Default shell", "Used for new terminal tabs.", select("defaultShell", shells.map((s) => [s.id, s.name]))),
      h("h3", null, "Display"),
      row("Font", "“From theme” uses the font the theme asks for (Fira Mono, or Fira Code with ligatures).", select("termFontFamily", [["theme", "From theme"], ["Fira Mono", "Fira Mono"], ["Fira Code", "Fira Code"], ["Cascadia Mono", "Cascadia Mono"], ["Consolas", "Consolas"]])),
      row("Font size", "Ctrl+= / Ctrl+- in a terminal also adjusts this.", number("termFontSize", 8, 32)),
      row("Cursor style", null, select("termCursorStyle", [["theme", "From theme"], ["block", "Block"], ["bar", "Bar"], ["underline", "Underline"]])),
      row("Blinking cursor", null, toggle("termCursorBlink")),
      row("Scrollback lines", null, number("termScrollback", 100, 100000, 100)),
      h("h3", null, "Clipboard"),
      row("Copy on select", "Selecting text copies it immediately.", toggle("termCopyOnSelect")));
  }
  if (id === "keyboard") {
    const { layouts, errors, folder } = await api.kb.list().catch(() => ({ layouts: [], errors: [], folder: "" }));
    const auto = autoLayoutId(layouts.map((l) => l.id));
    const autoName = layouts.find((l) => l.id === auto)?.name || auto;
    const picker = select("keyboardLayout", [["auto", `Auto — ${autoName}`], ...layouts.map((l) => [l.id, `${l.name}${l.custom ? " (custom)" : ""}`])]);
    if (![...picker.options].some((o) => o.value === picker.value)) picker.value = "auto";
    const customCount = layouts.filter((l) => l.custom).length;
    page.push(h("h3", null, "On-screen keyboard"),
      row("Show keyboard", "Ctrl+Shift+K. Types into the focused text field, otherwise the active terminal.", toggle("showKeyboard")),
      row("Layout", "The eDEX-UI layouts, including AZERTY, QWERTZ, BÉPO, Dvorak, Colemak, Workman and Norman. Auto follows your Windows display language.", picker),
      h("h3", null, "Custom layouts"),
      row("Layouts folder", `${customCount ? `${customCount} custom layout${customCount === 1 ? "" : "s"}. ` : ""}Drop eDEX-UI layout files (.json) here; a file named like a built-in (e.g. en-US.json) replaces it. Changes apply immediately.`,
        h("span", { style: { display: "flex", gap: ".4rem" } },
          h("button", { class: "btn", type: "button", onclick: () => { openLayoutsFolder(); } }, icon("folder"), "Open"),
          h("button", { class: "btn", type: "button", onclick: async () => { await importLayouts(); openPanel?.show("keyboard"); } }, icon("download"), "Import…"))),
      ...errors.map((e) => row(e.file, `Not loaded: ${e.message}`, h("span", { class: "warn-text mono", style: { fontSize: ".78rem" } }, "error"))),
      h("div", { class: "setting-desc", style: { marginTop: ".6rem" } },
        "Format: rows named row_numbers, row_1, row_2, row_3 and row_space, each a list of keys with name / cmd, and optional shift_, alt_, altshift_, fn_, ctrl_ and capslck_ variants. ",
        "Commands may use ~~~CTRLSEQ1~~~ (Esc) and the other eDEX-UI control placeholders, ESCAPED|-- SHIFT/CTRL/ALT/FN/CAPSLCK modifiers, ESCAPED|-- ICON: ARROW_UP… icons and dead keys (ESCAPED|-- ACUTE, GRAVE, CIRCUM, TREMA, TILDE, CEDILLA, CARON, BREVE, MACRON, OVERRING, BAR, GREEK, IOTASUB). ",
        "An optional top-level \"name\" sets the display name. ", folder ? `Folder: ${folder}` : ""),
      h("h3", null, "Privacy"),
      row("Password mode", "Hides key presses on the on-screen keyboard while you type a secret (the lock button on the keyboard, or the command palette).", h("button", { class: "btn", type: "button", onclick: () => runCommand("keyboard.password") }, icon("lock"), "Toggle")));
  }
  if (id === "layout") {
    const hidden = new Set(settings.get("hiddenWidgets") || []);
    const widgets = widgetDefs().map((w) => {
      const el = h("input", { class: "switch", type: "checkbox", checked: !hidden.has(w.id) });
      el.addEventListener("change", () => {
        const next = new Set(settings.get("hiddenWidgets") || []);
        if (el.checked) next.delete(w.id); else next.add(w.id);
        settings.set({ hiddenWidgets: [...next] });
      });
      return row(w.title, w.column === "left" ? "Left column" : "Right column", el);
    });
    const current = settings.get("layoutPreset");
    const cards = h("div", { class: "preset-grid" }, ...Object.entries(PRESETS).map(([name, p]) => h("button", {
      class: `preset-card${current === name ? " active" : ""}`, type: "button", title: p.desc,
      onclick: () => { applyPreset(name); setTimeout(() => openPanel?.show("layout"), 50); }
    }, layoutSketch(p.values), h("span", { class: "preset-name" }, p.label), h("span", { class: "preset-desc" }, p.desc))));
    const rerender = () => setTimeout(() => openPanel?.show("layout"), 50);
    const live = (el) => { el.addEventListener("change", rerender); return el; };
    page.push(h("h3", null, "Presets"),
      h("div", { class: "setting-desc", style: { marginBottom: ".4rem" } }, current === "custom" ? "Custom arrangement — pick a preset to start over." : "Pick an arrangement, then fine-tune it below."),
      cards,
      h("h3", null, "Regions"),
      row("Top bar", "Search, media, volume, status, clock and power. When hidden: Ctrl+Shift+Space launcher, Ctrl+, settings.", live(toggle("showTopbar"))),
      row("Dock", "Pinned apps and open windows. When hidden: Ctrl+Shift+A switches windows.", live(toggle("showDock"))),
      row("Left column", "System telemetry.", live(toggle("showLeftColumn"))),
      row("Right column", "Network and tools.", live(toggle("showRightColumn"))),
      row("On-screen keyboard", "Ctrl+Shift+K", live(toggle("showKeyboard"))),
      h("h3", null, "Arrangement"),
      row("Panel columns", "Either side of the workspace, or both together on one side (like eDEX-UI's “disrupted” themes).", live(select("columnsSide", [["split", "Either side"], ["left", "Both on the left"], ["right", "Both on the right"]]))),
      row("Column width", null, range("columnWidth", 70, 160, "%")),
      row("File browser", "eDEX-UI's filesystem panel: in the bottom strip beside the keyboard, or under the panel columns.", live(select("filesPanel", [["off", "Hidden"], ["bottom", "Bottom strip"], ["column", "Under the panel columns"]]))),
      row("File browser width", "Share of the bottom strip when the keyboard is shown too.", range("filesWidth", 25, 70, "%")),
      row("Bottom strip order", null, live(select("bottomOrder", [["files-left", "Files left, keyboard right"], ["keyboard-left", "Keyboard left, files right"]]))),
      row("Themes can change the layout", "Some themes (the original's disrupted / notype / typeleft / fulltype variants) move the panels, file browser or keyboard.", toggle("themeLayouts")),
      h("h3", null, "File browser"),
      row("Follow the terminal", "Show the active terminal's folder; clicking a folder changes the shell's directory when it is at a prompt.", toggle("filesFollowTerminal")),
      row("View", null, select("filesView", [["list", "List"], ["grid", "Icons"]])),
      h("h3", null, "Widgets"),
      h("div", { class: "setting-desc", style: { marginBottom: ".4rem" } }, "Drag a widget by its title bar to reorder it or move it to the other column."),
      ...widgets,
      row("Reset widget layout", null, h("button", { class: "btn", type: "button", onclick: () => settings.set({ widgetOrder: { left: [], right: [] }, hiddenWidgets: [] }) }, "Reset")));
  }
  if (id === "files") {
    page.push(h("h3", null, "Explorer"),
      row("Show hidden items", null, toggle("showHidden")),
      row("Confirm before deleting", "Deleted items always go to the Recycle Bin.", toggle("confirmDelete")),
      row("Default view", null, select("explorerView", [["list", "List"], ["grid", "Grid"]])),
      h("h3", null, "History"),
      row("Recent files and folders", "Shown in the launcher and explorer sidebar.", h("button", { class: "btn", type: "button", onclick: () => { settings.set({ recentFiles: [], recentFolders: [] }); toast("History cleared", { level: "ok" }); } }, "Clear history")));
  }
  if (id === "performance") {
    const active = h("span", { class: "muted" });
    const describe = () => {
      const p = profile();
      const auto = (settings.get("perfProfile") || "auto") === "auto";
      active.textContent = `Running: ${p.name[0].toUpperCase()}${p.name.slice(1)}${auto ? " (auto)" : ""}`;
    };
    describe();
    pageCleanups.push(onSchedulingChange(describe));
    const usage = performanceUsage();
    page.push(h("h3", null, "Profile"),
      row("Performance profile", "How often panels refresh and how smoothly the globe and visualizer animate. Auto uses Balanced on mains power and Eco on battery or with battery saver on.",
        h("span", { style: { display: "flex", alignItems: "center", gap: ".6rem" } }, active, select("perfProfile", [["auto", "Auto"], ["performance", "Performance"], ["balanced", "Balanced"], ["eco", "Eco"]]))),
      row("Slow down in the background", "Refresh less often and lower animation frame rates while another app has focus. eDEX always pauses completely when hidden, minimised or covered.", toggle("throttleUnfocused")),
      row("GPU-accelerated terminal", "Draw terminals with WebGL. Much faster for heavy output; turn off if text looks wrong on your graphics driver.", toggle("termGpu")),
      h("h3", null, "eDEX resource usage"),
      row("Total", "All eDEX processes, refreshed every two seconds.", usage.total),
      usage.list);
  }
  if (id === "privacy") {
    page.push(h("h3", null, "Network"),
      row("Outbound lookups", "Public-IP geolocation (ipapi.co / ipinfo.io), latency checks to google.com and twelve reference sites for the world view, and the weather forecast for your approximate location (open-meteo.com). Turn off to make eDEX fully offline.", toggle("allowNetworkGeolocation")),
      h("h3", null, "Clipboard"),
      row("Clipboard history", "Kept in memory only — never written to disk, cleared on quit.", toggle("clipboardHistory")),
      row("History size", null, number("clipboardMax", 5, 200)),
      row("Clear clipboard history", null, h("button", { class: "btn", type: "button", onclick: () => api.clip.clear().then(() => toast("Clipboard history cleared", { level: "ok" })) }, "Clear")),
      h("h3", null, "Launcher"),
      row("Usage ranking", "The launcher ranks frequently used results higher; counts live in this window's local storage.", h("button", {
        class: "btn", type: "button", onclick: () => { try { localStorage.removeItem("edex.launcherUsage"); } catch (_) {} toast("Usage history cleared", { level: "ok" }); }
      }, "Reset")));
  }
  if (id === "about") {
    const info = await api.app.info().catch(() => ({}));
    const sys = await api.sys.static().catch(() => ({}));
    page.push(h("h3", null, "eDEX-UI Windows"),
      row("Version", null, h("span", { class: "mono" }, info.version || "?")),
      row("Mode", null, h("span", { class: "mono" }, info.windowed ? "development (windowed)" : info.mode)),
      row("System", null, h("span", { class: "mono" }, `${sys.os?.distro || "Windows"} ${sys.os?.release || ""}`)),
      row("Developer tools", "Inspect the interface.", h("button", { class: "btn", type: "button", onclick: () => api.app.devtools() }, "Toggle DevTools")),
      row("Reload interface", null, h("button", { class: "btn", type: "button", onclick: () => api.app.reload() }, "Reload")));
  }
  return page;
}

let openPanel = null;

export function openSettings(pageId = "general") {
  if (openPanel) { openPanel.show(pageId); return; }
  const nav = h("nav", { class: "settings-nav" });
  const content = h("div", { class: "settings-page" });
  let current = null;
  const show = async (id) => {
    current = id;
    nav.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.page === id));
    runPageCleanups();
    const items = await buildPage(id);
    if (current === id) content.replaceChildren(...items);
    content.scrollTop = 0;
  };
  nav.append(...PAGES.map((p) => h("button", { type: "button", dataset: { page: p.id }, onclick: () => show(p.id) }, icon(p.icon), p.label)));
  const modal = openModal((close) => h("div", { style: { display: "contents" } },
    h("div", { class: "modal-head" }, icon("gear"), h("span", { class: "modal-title grow" }, "Settings"),
      h("button", { class: "icon-btn", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("close"))),
    h("div", { class: "settings-body" }, nav, content)), {
    className: "settings",
    label: "Settings",
    onClose: () => { openPanel = null; runPageCleanups(); }
  });
  openPanel = { show, close: modal.close };
  show(pageId);
}
