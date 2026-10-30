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
import { editCommandWidget } from "../widgets/extra.js";
import { VIZ_STYLES, VIZ_COLORS } from "../media/visualizer.js";
import { editWallpaperArt, WALLPAPER_EFFECTS, WALLPAPER_BACKDROPS } from "./wallpaper.js";
import { openUpdates } from "./updates.js";
import { clearBrowsingData } from "../workspace/browser.js";
import { emit } from "../core/bus.js";
import { widgetHidden, setWidgetShown } from "../widgets/registry.js";
import { loadGames, openGameLibrary } from "./games.js";
import { profiles, updateProfile, switchProfile, newProfileDialog, renameProfile, deleteProfile, setRemember, captureProfile } from "./profiles.js";

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

// Live status of the desktop takeover (refreshed while the page is open).
function takeoverStatus() {
  const text = h("span", { class: "mono", style: { fontSize: ".8rem" } }, "…");
  const refresh = async () => {
    const s = await api.app.takeoverState().catch(() => null);
    if (!s) { text.textContent = "unavailable"; return; }
    const bar = s.taskbar ? (s.taskbar.visible ? "visible" : "hidden") : "unknown";
    text.textContent = !s.active ? `Off · Windows taskbar ${bar}`
      : `On · Windows taskbar ${bar}${s.hiddenByEdex ? " (by eDEX)" : settings.get("mode") === "overlay" ? " (overlay covers it)" : ""}`;
  };
  refresh();
  const timer = setInterval(refresh, 1500);
  pageCleanups.push(() => clearInterval(timer));
  return row("Status", "If the taskbar ever stays hidden after eDEX closes unexpectedly, starting eDEX again puts it back.", text);
}

// Screen-time daily limits: one row per app with a limit, plus an add form.
function screenTimeLimitsRows() {
  const box = h("div", { class: "st-limits" });
  const render = () => {
    const limits = settings.get("screenTimeLimits") || {};
    const name = h("input", { class: "input", placeholder: "Program name, as shown in Screen time", spellcheck: false });
    const mins = h("input", { class: "input", type: "number", min: 1, max: 1440, value: "60", style: { width: "6rem" } });
    box.replaceChildren(
      row("Daily limits", "A notice (once a day) when a program passes its limit. You can also right-click an app in the Screen time widget.",
        h("span", { style: { display: "flex", gap: ".4rem" } }, name, mins, h("button", { class: "btn", type: "button", onclick: () => {
          const n = name.value.trim();
          const m = Math.round(Number(mins.value));
          if (!n || !(m >= 1 && m <= 1440)) { toast("Enter a program name and 1–1440 minutes", { level: "warn" }); return; }
          settings.set({ screenTimeLimits: { ...(settings.get("screenTimeLimits") || {}), [n]: m } });
          render();
        } }, "Add"))),
      ...Object.entries(limits).map(([app, m]) => row(app, `${m} min a day`, h("button", { class: "btn sm", type: "button", onclick: () => {
        const next = { ...(settings.get("screenTimeLimits") || {}) };
        delete next[app];
        settings.set({ screenTimeLimits: next });
        render();
      } }, "Remove"))));
  };
  render();
  return box;
}

// AI assistant: on/off, the API key (stored encrypted, never shown again)
// and the model.
async function aiRows() {
  const status = await api.ai.status().catch(() => ({}));
  const keyInput = h("input", { class: "input", type: "password", placeholder: status.configured ? "Key saved — paste a new one to replace it" : "sk-ant-…", spellcheck: false, autocomplete: "off" });
  const state = h("span", { class: status.unreadable ? "warn-text" : "muted" },
    status.configured ? "Key saved (encrypted with your Windows account)"
      : status.unreadable ? "The saved key was encrypted on another PC or Windows account — paste it again" : "No key");
  const save = async () => {
    const k = keyInput.value.trim();
    if (!k) return;
    try { await api.ai.setKey(k); keyInput.value = ""; keyInput.placeholder = "Key saved — paste a new one to replace it"; state.textContent = "Key saved (encrypted with your Windows account)"; toast("API key saved", { level: "ok" }); } catch (e) { toast(cleanError(e), { level: "warn" }); }
  };
  keyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  return [
    row("Use the AI assistant", "Ask Claude from the launcher (start with ?), with Ctrl+Shift+J, or “Explain with Claude” on terminal output (Shift+right-click). Uses your own Anthropic API key; only what you send is shared, and nothing is sent while this is off.", toggle("aiEnabled")),
    row("API key", h("span", null, state, " · get one at console.anthropic.com"), h("span", { style: { display: "flex", gap: ".4rem" } }, keyInput,
      h("button", { class: "btn", type: "button", onclick: save }, "Save"),
      h("button", { class: "btn", type: "button", onclick: async () => { await api.ai.setKey("").catch(() => {}); state.textContent = "No key"; keyInput.placeholder = "sk-ant-…"; toast("API key removed", { level: "ok" }); } }, "Remove"))),
    row("Model", "Opus 5.5 gives the best answers; Sonnet 5.5 and Haiku 5.5 are faster and cheaper.", select("aiModel", [["claude-opus-5-5", "Claude Opus 5.5"], ["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["claude-haiku-5-5", "Claude Haiku 5.5"]]))
  ];
}

// Spotify: the Client ID of the user's own Spotify developer app, and the
// account connection (PKCE sign-in in the default browser).
async function spotifyRows() {
  const s = await api.spotify.status().catch(() => ({}));
  const state = h("span", { class: "muted" }, s.connected ? `Connected${s.user ? ` as ${s.user.name}` : ""}` : s.clientId ? "Not connected" : "No Client ID yet");
  if (s.connected && !s.user) api.spotify.me().then((u) => setText(state, `Connected as ${u.name}${u.product ? ` (${u.product})` : ""}`)).catch(() => {});
  const id = h("input", { class: "input", placeholder: "32-character Client ID", spellcheck: false, autocomplete: "off", style: { width: "18rem" } });
  id.value = s.clientId || "";
  id.addEventListener("change", () => {
    const v = id.value.trim().toLowerCase();
    if (v && !/^[0-9a-f]{32}$/.test(v)) { toast("A Client ID is 32 letters and digits (0–9, a–f)", { level: "warn" }); return; }
    settings.set({ spotifyClientId: v });
  });
  const connect = h("button", { class: "btn primary", type: "button" }, icon("spotify"), s.connected ? "Reconnect" : "Connect");
  connect.addEventListener("click", async () => {
    const v = id.value.trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(v)) { toast("Paste your Spotify Client ID first", { level: "warn" }); return; }
    await settings.set({ spotifyClientId: v });
    connect.disabled = true;
    setText(state, "Waiting for you to sign in to Spotify in your browser…");
    try {
      const me = await api.spotify.connect();
      setText(state, `Connected as ${me.name}${me.product ? ` (${me.product})` : ""}`);
      toast("Spotify connected", { level: "ok" });
    } catch (e) {
      setText(state, cleanError(e));
    } finally { connect.disabled = false; }
  });
  const redirect = s.redirectUri || "http://127.0.0.1:43821/callback";
  return [
    row("Spotify account", h("span", null, state), h("span", { style: { display: "flex", gap: ".4rem" } }, connect,
      h("button", { class: "btn", type: "button", onclick: async () => { await api.spotify.disconnect().catch(() => {}); setText(state, "Not connected"); toast("Spotify disconnected", { level: "ok" }); } }, "Disconnect"))),
    row("Client ID", h("span", null, "From your own app at ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); api.shell.openExternal("https://developer.spotify.com/dashboard"); } }, "developer.spotify.com/dashboard"), " (Create app, tick Web API)."), id),
    row("Redirect URI", "Add exactly this to the app's Redirect URIs.", h("span", { style: { display: "flex", gap: ".4rem", alignItems: "center" } },
      h("code", { class: "mono", style: { fontSize: ".8rem" } }, redirect),
      h("button", { class: "btn sm", type: "button", onclick: () => api.clip.copy(redirect).then(() => toast("Copied", { level: "ok", timeout: 1200 })) }, icon("copy"), "Copy"))),
    h("div", { class: "setting-desc", style: { marginTop: ".3rem" } },
      "Spotify plays the music (its desktop app, your phone or a speaker); eDEX shows what's playing, your playlists, liked songs, recent tracks and search, and controls playback. Spotify's rules: the developer app's owner needs Premium, and controlling playback needs Premium. Without an account the media player still shows and controls the Spotify app on this PC through Windows. The sign-in is encrypted with your Windows account.")
  ];
}

// ASCII wallpaper: art, animation, what's behind it, clock.
function wallpaperRows() {
  return [
    row("ASCII art", "Your own art (paste it, load .txt / .nfo / .ans, or make block letters). Empty uses your boot logo art.",
      h("span", { style: { display: "flex", gap: ".4rem" } },
        h("button", { class: "btn", type: "button", onclick: () => editWallpaperArt() }, icon("edit"), "Edit…"),
        h("button", { class: "btn", type: "button", onclick: () => { openPanel?.close(); emit("open-wallpaper"); } }, icon("wallpaper"), "Open as a tab"))),
    row("Animation", null, select("wallpaperEffect", WALLPAPER_EFFECTS)),
    row("Behind the art", null, select("wallpaperBackdrop", WALLPAPER_BACKDROPS)),
    row("Clock", "The time and date under the art.", toggle("wallpaperClock"))
  ];
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
  return hotkeyInput(() => settings.get(key), (v) => settings.set({ [key]: v }));
}

// read() gives the current accelerator, write(value) saves a new one.
function hotkeyInput(read, write) {
  const el = h("input", { class: "input hotkey-input", readOnly: true });
  const show = () => { el.value = (read() || "(none)").replace("CommandOrControl", "Ctrl"); };
  show();
  el.addEventListener("focus", () => { el.classList.add("recording"); el.value = "Press keys…"; });
  el.addEventListener("blur", () => { el.classList.remove("recording"); show(); });
  el.addEventListener("keydown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { el.blur(); return; }
    if (e.key === "Backspace" || e.key === "Delete") { write(""); el.blur(); return; }
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
    else if (/^Arrow(Left|Right|Up|Down)$/.test(k)) k = k.slice(5); // accelerator names
    else if (k === "+") k = "Plus";
    if (!parts.length && !/^F\d+$/.test(k)) { toast("Use at least one modifier (Ctrl, Alt or Shift)", { level: "warn" }); return; }
    parts.push(k.length === 1 ? k.toUpperCase() : k);
    write(parts.join("+"));
    el.blur();
  });
  return el;
}

// Music library folders (your Music folder unless you add others).
function musicFolderRows() {
  const box = h("div");
  const render = async () => {
    const d = await api.library.list().catch(() => ({ folders: [], tracks: [] }));
    box.replaceChildren(
      ...d.folders.map((f) => row(h("span", { class: "mono", style: { fontSize: ".8rem" } }, f), null,
        h("button", { class: "btn sm", type: "button", onclick: async () => { await api.library.removeFolder(f).catch(() => {}); render(); } }, "Remove"))),
      row("Folders", `${(d.tracks || []).length.toLocaleString()} songs found. Songs are read once and again only when they change.`,
        h("span", { style: { display: "flex", gap: ".4rem" } },
          h("button", { class: "btn", type: "button", onclick: async () => { await api.library.addFolder().catch(() => {}); render(); } }, icon("plus"), "Add folder…"),
          h("button", { class: "btn", type: "button", onclick: async () => { await api.library.scan().catch(() => {}); render(); } }, icon("refresh"), "Read again"))));
  };
  render();
  return [box];
}

// Workspaces: each one's hotkey, schedule and what it remembers.
function workspaceRows() {
  const current = settings.get("activeProfile") || "main";
  const rerender = () => setTimeout(() => openPanel?.show("workspaces"), 60);
  const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  return profiles().map((p) => {
    const sched = p.schedule;
    const time = h("input", { class: "input", type: "time", value: sched?.time || "", title: "Switch to this workspace at this time" });
    const days = new Set(sched?.days || [0, 1, 2, 3, 4, 5, 6]);
    const saveSched = () => updateProfile(p.id, { schedule: time.value ? { time: time.value, days: [...days] } : null });
    time.addEventListener("change", saveSched);
    const dayBtns = DAYS.map((d, i) => {
      const b = h("button", { class: `ws-day${days.has(i) ? " on" : ""}`, type: "button", title: "Days it switches on" }, d);
      b.addEventListener("click", () => { if (days.has(i)) days.delete(i); else days.add(i); b.classList.toggle("on", days.has(i)); if (time.value) saveSched(); });
      return b;
    });
    const remember = (what, label, on) => {
      const el = h("input", { type: "checkbox", checked: on });
      el.addEventListener("change", () => { setRemember(p.id, what, el.checked); });
      return h("label", { class: "ws-check" }, el, label);
    };
    return h("div", { class: `ws-card${p.id === current ? " current" : ""}` },
      h("div", { class: "ws-card-head" }, icon("layers"), h("span", { class: "ws-card-name" }, p.name),
        p.id === current ? h("span", { class: "ws-current" }, "CURRENT") : h("button", { class: "btn sm", type: "button", onclick: () => { switchProfile(p.id); rerender(); } }, "Switch"),
        h("span", { class: "grow" }),
        h("button", { class: "btn sm", type: "button", onclick: async () => { await renameProfile(p.id); rerender(); } }, "Rename"),
        p.id !== "main" ? h("button", { class: "btn sm danger", type: "button", onclick: async () => { await deleteProfile(p.id); rerender(); } }, "Delete") : null),
      row("Hotkey", "Brings eDEX up in this workspace, from any app.", hotkeyInput(() => p.hotkey, (v) => updateProfile(p.id, { hotkey: v }))),
      row("Switch automatically", "At this time on the chosen days (leave the time empty for never).", h("span", { class: "ws-sched" }, time, ...dayBtns)),
      row("Remembers", "Brought back when you switch here.", h("span", { class: "ws-remember" },
        remember("theme", "Theme", p.theme !== null),
        remember("layout", "Layout", p.layout !== null),
        remember("windows", "App windows", !!p.windows),
        h("button", { class: "btn sm", type: "button", title: "Save the current theme, layout and window positions to this workspace", onclick: () => captureProfile(p.id) }, "Save current"))));
  });
}

// Calendar subscriptions: add, colour, reminder, remove; with each feed's status.
async function calendarRows() {
  const feeds = settings.get("calendarFeeds") || [];
  const status = new Map((await api.calendars.status().catch(() => [])).map((s) => [s.id, s]));
  const rerender = () => setTimeout(() => openPanel?.show("calendar"), 60);
  const save = (list) => settings.set({ calendarFeeds: list });
  const REM = [["", "No reminders"], ["0", "At the time"], ["5", "5 min before"], ["10", "10 min before"], ["15", "15 min before"], ["30", "30 min before"], ["60", "1 hour before"]];
  const rows = feeds.map((f) => {
    const s = status.get(f.id);
    const color = h("input", { type: "color", class: "viz-color", value: f.color });
    color.addEventListener("change", () => save(feeds.map((x) => (x.id === f.id ? { ...x, color: color.value } : x))));
    const rem = h("select", { class: "input" }, ...REM.map(([v, l]) => h("option", { value: v }, l)));
    rem.value = f.remind == null ? "" : String(f.remind);
    rem.addEventListener("change", () => save(feeds.map((x) => (x.id === f.id ? { ...x, remind: rem.value === "" ? null : Number(rem.value) } : x))));
    const on = h("input", { class: "switch", type: "checkbox", checked: f.enabled !== false });
    on.addEventListener("change", () => save(feeds.map((x) => (x.id === f.id ? { ...x, enabled: on.checked } : x))));
    let host = "";
    try { host = new URL(f.url).host; } catch (_) {}
    const info = s ? (s.ok ? `${s.count} events · ${s.fetchedAt ? `updated ${new Date(s.fetchedAt).toLocaleString()}` : "not downloaded yet"}` : s.error) : "not downloaded yet";
    return row(h("span", { class: "cal-feed-name", style: { "--feed": f.color } }, f.name), h("span", { class: s && !s.ok ? "warn-text" : "" }, `${host} · ${info}`),
      h("span", { style: { display: "flex", gap: ".4rem", alignItems: "center" } }, color, rem, on,
        h("button", { class: "btn sm", type: "button", onclick: () => { save(feeds.filter((x) => x.id !== f.id)); rerender(); } }, "Remove")));
  });
  const name = h("input", { class: "input", placeholder: "Name (Work, Family…)", spellcheck: false, style: { width: "10rem" } });
  const url = h("input", { class: "input", placeholder: "https://… .ics or webcal://…", spellcheck: false, style: { width: "20rem" } });
  const add = () => {
    const u = url.value.trim();
    if (!/^(https?|webcal):\/\/\S+$/i.test(u)) { toast("Paste the calendar's iCal (.ics) or webcal link", { level: "warn" }); return; }
    if (feeds.length >= 10) { toast("At most 10 calendars", { level: "warn" }); return; }
    const palette = ["#7fc8ff", "#ff9a3d", "#8cf0a5", "#e58cff", "#ffd36b", "#ff7a8a"];
    save([...feeds, { id: `cal${Date.now().toString(36)}`, name: name.value.trim() || "Calendar", url: u, color: palette[feeds.length % palette.length], remind: null, enabled: true }]);
    toast("Calendar added — downloading it now", { level: "ok" });
    setTimeout(rerender, 2500);
  };
  return [
    ...rows,
    row("Add a calendar", "Google Calendar: Settings → your calendar → “Secret address in iCal format”. Outlook: Settings → Calendar → Shared calendars → Publish → ICS link. iCloud: share the calendar publicly and copy the webcal link.",
      h("span", { style: { display: "flex", gap: ".4rem" } }, name, url, h("button", { class: "btn primary", type: "button", onclick: add }, icon("plus"), "Add"))),
    row("Refresh now", "Calendars update about every 30 minutes while Outbound lookups are on.", h("button", { class: "btn", type: "button", onclick: async () => {
      const r = await api.calendars.refresh().catch(() => []);
      const bad = r.filter((x) => !x.ok);
      toast(bad.length ? `${bad.length} calendar${bad.length === 1 ? "" : "s"} couldn't be downloaded` : "Calendars updated", { level: bad.length ? "warn" : "ok" });
      rerender();
    } }, icon("refresh"), "Refresh"))
  ];
}

const PAGES = [
  { id: "general", label: "General", icon: "gear" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "keyboard", label: "Keyboard", icon: "keyboard" },
  { id: "layout", label: "Layout", icon: "layout" },
  { id: "workspaces", label: "Workspaces", icon: "layers" },
  { id: "media", label: "Media", icon: "audio" },
  { id: "games", label: "Games", icon: "gamepad" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "web", label: "Web & apps", icon: "globe" },
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
      h("h3", null, "Desktop takeover"),
      row("Take over the desktop", "eDEX fills the whole screen and stands in for the Windows desktop. In Desktop mode the Windows taskbar is hidden while eDEX is on screen (eDEX's dock lists your windows); hiding eDEX (Ctrl+`) or quitting brings it straight back.", toggle("takeover")),
      row("Hide the Windows taskbar", "Desktop mode only. Maximised apps use the full screen.", toggle("takeoverHideTaskbar")),
      row("Keep eDEX on screen", "If Show desktop (Win+D) or Minimise all hides eDEX, it comes straight back.", toggle("takeoverKeepVisible")),
      takeoverStatus(),
      h("h3", null, "Global hotkeys"),
      row("Show / hide eDEX", "Works from any app. Click, then press a new combination.", hotkey("hotkeyToggle")),
      row("Open launcher", "Summons eDEX straight into search.", hotkey("hotkeyLauncher")),
      h("h3", null, "Tab switching"),
      row("Next tab", "Inside eDEX, in browser tabs, and while a tabbed app is in front (Settings → Web & apps). If another program already has it there, eDEX says so and uses Ctrl+PageDown / Ctrl+PageUp (or Ctrl+Alt+PageDown / PageUp) instead. Backspace clears it.", hotkey("hotkeyTabNext")),
      row("Previous tab", null, hotkey("hotkeyTabPrev")),
      row("Default keys", null, h("button", { class: "btn sm", type: "button", onclick: () => settings.set({ hotkeyTabNext: "CommandOrControl+Tab", hotkeyTabPrev: "CommandOrControl+Shift+Tab" }).then(() => openPanel?.show("general")) }, "Ctrl+Tab / Ctrl+Shift+Tab")),
      h("h3", null, "Launcher"),
      row("Web search URL", "%s is replaced by your query.", text("webSearchUrl", "https://www.google.com/search?q=%s")),
      h("h3", null, "Sound"),
      row("Interface sounds", null, toggle("audioEnabled")),
      row("Volume", null, range("audioVolume", 0, 100, "%")),
      row("Typing feedback", "Click sounds for terminal input.", toggle("audioFeedback")),
      h("h3", null, "Other displays"),
      row("Multi-monitor HUD", "Every display except the main one shows eDEX's telemetry panels, the globe and a large clock, behind your windows. Hidden with eDEX.", toggle("hudDisplays")),
      h("h3", null, "Idle screen"),
      row("Show the idle screen", "When nothing has been typed or clicked for a while and eDEX is the window in front, it switches to an animated clock screen — or, with the wallpaper style, just the workspace shows your ASCII wallpaper instead of the terminal. Any input brings eDEX back.", toggle("idleScreen")),
      row("After (minutes)", null, number("idleMinutes", 1, 120)),
      row("Style", "Full screen: the animated screen covers eDEX. Wallpaper pane: the panels keep running and the ASCII wallpaper takes the terminal's place.", select("idleStyle", [["screen", "Full screen"], ["wallpaper", "Wallpaper pane"]])),
      row("Effect", "For the full-screen style.", h("span", { style: { display: "flex", gap: ".4rem", alignItems: "center" } },
        select("idleEffect", [["matrix", "Matrix rain"], ["hex", "Hex grid"], ["stars", "Starfield"], ["globe", "Globe"], ["ascii", "ASCII wallpaper"]]),
        h("button", { class: "btn", type: "button", onclick: () => { openPanel?.close(); setTimeout(() => runCommand("idle.show"), 250); } }, "Preview"))),
      h("h3", null, "Screen saver"),
      row("Screen saver mode", "After the minutes below without any keyboard or mouse input anywhere, eDEX covers every display with its effect — over every app, even while eDEX is hidden in the tray. Any input ends it.", toggle("screensaver")),
      row("After (minutes)", null, number("screensaverMinutes", 1, 240)),
      row("Effect", null, h("span", { style: { display: "flex", gap: ".4rem", alignItems: "center" } },
        select("screensaverEffect", [["matrix", "Matrix rain"], ["hex", "Hex grid"], ["stars", "Starfield"], ["globe", "Globe"], ["ascii", "ASCII wallpaper"]]),
        h("button", { class: "btn", type: "button", onclick: () => { openPanel?.close(); setTimeout(() => runCommand("saver.start"), 300); } }, "Preview"))),
      row("Lock Windows when it ends", "Like Windows' “On resume, display logon screen”: the next input locks the PC.", toggle("screensaverLock")),
      row("Not during videos or full-screen apps", "Holds back while a full-screen app is in front or a program keeps the display on (video, presentations, calls).", toggle("screensaverRespectApps")),
      row("All displays", "Off: only the main display.", toggle("screensaverAllDisplays")),
      h("h3", null, "Notifications"),
      row("Do not disturb", "No pop-ups, sounds or Windows notifications from eDEX; everything still collects in the notification centre (the bell in the top bar). A critically low battery still shows.", toggle("dnd")),
      row("Hold notifications during games", "The same quiet, only while a game runs (Settings → Games).", toggle("gameModeQuiet")),
      h("h3", null, "Alerts"),
      row("Low battery", "Warns once when the charge drops below the level (again at half of it), with a Windows notification if eDEX is hidden.", toggle("alertBattery")),
      row("Battery level", null, range("alertBatteryLevel", 5, 50, "%")),
      row("Low disk space", "Warns when a fixed drive has less free space than this (or under 10% on small drives). Checked every ten minutes.", toggle("alertDisk")),
      row("Free space limit (GB)", null, number("alertDiskGb", 1, 200)));
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
      row("Animated background", "Drawn faintly behind the panels in the theme colour, at a low frame rate (paused while eDEX is hidden).", select("backgroundFx", [["none", "None"], ["matrix", "Matrix rain"], ["hex", "Hex grid"], ["stars", "Starfield"]])),
      row("24-hour clock", null, toggle("clock24h")),
      row("Temperature unit", null, select("temperatureUnit", [["C", "Celsius"], ["F", "Fahrenheit"]])),
      h("h3", null, "Live wallpaper"),
      row("Live wallpaper", "While eDEX is hidden, this keeps running as your Windows desktop background, behind the desktop icons (which stay clickable). It pauses behind maximised windows, on battery and during games.",
        select("liveWallpaper", [["off", "Off"], ["matrix", "Matrix rain"], ["hex", "Hex grid"], ["stars", "Starfield"], ["globe", "Globe"], ["ascii", "ASCII wallpaper"], ["panels", "Telemetry panels (HUD)"]])),
      row("Displays", null, select("liveWallpaperDisplays", [["all", "All displays"], ["primary", "Main display only"]])),
      row("Pause when it can't be seen", "Behind maximised or full-screen windows, and on battery (unless the profile is Performance).", toggle("liveWallpaperPause")),
      h("h3", null, "ASCII wallpaper"),
      h("div", { class: "setting-desc", style: { marginBottom: ".4rem" } }, "A workspace pane with your ASCII art (tab menu → ASCII wallpaper), the idle pane, and an idle-screen / screen-saver effect."),
      ...wallpaperRows(),
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
    const widgets = widgetDefs().map((w) => {
      const el = h("input", { class: "switch", type: "checkbox", checked: !widgetHidden(w.id) });
      el.addEventListener("change", () => setWidgetShown(w.id, el.checked));
      return row(w.title, `${w.column === "left" ? "Left column" : "Right column"}${w.defaultHidden ? " · off until you switch it on" : ""}`, el);
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
      row("Reset widget layout", null, h("button", { class: "btn", type: "button", onclick: () => settings.set({ widgetOrder: { left: [], right: [] }, hiddenWidgets: [], shownWidgets: [] }) }, "Reset")),
      h("h3", null, "Command widgets"),
      h("div", { class: "setting-desc", style: { marginBottom: ".4rem" } }, "Panels that show a command's output, refreshed on a schedule (disk space, a status API, git log …). Right-click one to edit it."),
      ...(settings.get("commandWidgets") || []).map((c) => row(c.title, `${c.shell === "cmd" ? "cmd" : "PowerShell"} · every ${c.interval} s · ${c.command.slice(0, 80)}`,
        h("span", { style: { display: "flex", gap: ".4rem" } },
          h("button", { class: "btn sm", type: "button", onclick: () => editCommandWidget(c) }, "Edit"),
          h("button", { class: "btn sm", type: "button", onclick: () => { settings.set({ commandWidgets: (settings.get("commandWidgets") || []).filter((x) => x.id !== c.id) }); rerender(); } }, "Remove")))),
      row("New command widget", null, h("button", { class: "btn", type: "button", onclick: () => runCommand("widgets.command") }, icon("plus"), "Add…")));
  }
  if (id === "workspaces") {
    page.push(h("h3", null, "Workspaces"),
      h("div", { class: "setting-desc", style: { marginBottom: ".5rem" } }, "Named setups such as Work, Gaming or Study. Each has its own tabs, which keep running while you're in another workspace, and can bring back a theme, a layout and your app windows. Switch from the name next to the logo, the launcher (“Workspace: …”), a hotkey, or automatically at a time of day."),
      ...workspaceRows(),
      row("New workspace", null, h("button", { class: "btn primary", type: "button", onclick: async () => { await newProfileDialog(); setTimeout(() => openPanel?.show("workspaces"), 60); } }, icon("plus"), "New workspace…")));
  }
  if (id === "games") {
    const games = await loadGames().catch(() => []);
    const by = (s) => games.filter((g) => g.source === s).length;
    page.push(h("h3", null, "Game mode"),
      row("Game mode", "Automatic: while a game from your library (or anything running full-screen Direct3D) is in front, eDEX rests — panels and animations pause, the HUD on other displays hides, the screen saver and live wallpaper hold back. On: always rest. Off: never.", select("gameMode", [["auto", "Automatic"], ["on", "On"], ["off", "Off"]])),
      row("Hold notifications during games", "Reminders, alerts and timers wait silently in the notification centre until the game ends (a critically low battery still shows).", toggle("gameModeQuiet")),
      h("h3", null, "Game library"),
      row("Installed games", `${games.length} found — Steam ${by("steam")}, Epic Games ${by("epic")}, Xbox ${by("xbox")}. Shown in the launcher (Games filter), the dock's game button and Ctrl+Shift+G; right-click a game to pin it to the dock.`,
        h("span", { style: { display: "flex", gap: ".4rem" } },
          h("button", { class: "btn", type: "button", onclick: () => { openPanel?.close(); setTimeout(() => openGameLibrary(), 200); } }, icon("gamepad"), "Open library"),
          h("button", { class: "btn", type: "button", onclick: async () => { await loadGames(true); openPanel?.show("games"); } }, icon("refresh"), "Rescan"))),
      h("div", { class: "setting-desc" }, "Games are found from the launchers' own files (Steam's library folders, Epic's install manifests, installed Xbox / Microsoft Store packages). Cover art comes from the launchers' caches; missing art is downloaded once from the store's image server while Outbound lookups are on."));
  }
  if (id === "calendar") {
    page.push(h("h3", null, "Calendar subscriptions"),
      h("div", { class: "setting-desc", style: { marginBottom: ".5rem" } }, "Read-only calendars from Google, Outlook, iCloud or anything with an iCal (.ics) link, shown in the top-bar calendar and the Tasks widget beside your own events. Treat these links like passwords: anyone with one can read that calendar."),
      ...(await calendarRows()));
  }
  if (id === "media") {
    const custom = h("input", { type: "color", class: "viz-color", value: settings.get("vizCustomColor") || "#ff9a3d" });
    custom.addEventListener("input", () => settings.set({ vizCustomColor: custom.value }));
    page.push(h("h3", null, "Visualizer"),
      h("div", { class: "setting-desc", style: { marginBottom: ".4rem" } }, "How the media player draws music (also the V key or the visualizer button in the player)."),
      row("Style", null, select("vizStyle", VIZ_STYLES)),
      row("Bars", "How many bands the spectrum is split into.", range("vizBars", 16, 128)),
      row("Colour", null, select("vizColor", VIZ_COLORS)),
      row("Custom colour", "Used when Colour is “Custom colour”.", custom),
      row("Peak caps", "Little markers that hold the peaks for a moment.", toggle("vizPeaks")),
      row("Reflection", null, toggle("vizReflection")),
      row("Smoothing", "Higher is calmer, lower reacts faster.", range("vizSmoothing", 0, 95, "%")),
      row("Sensitivity", null, range("vizSensitivity", 50, 200, "%")),
      h("h3", null, "Lyrics"),
      row("Synced lyrics", "The lyrics button (L) in the player and the Lyrics widget show the words in time with the music. A .lrc file next to a song is used first; otherwise LRCLIB (lrclib.net, a free community database) is asked by title, artist, album and length — only while Outbound lookups are on.", toggle("lyrics")),
      h("h3", null, "Music library"),
      ...musicFolderRows(),
      h("h3", null, "Spotify"),
      ...(await spotifyRows()));
  }
  if (id === "web") {
    page.push(h("h3", null, "Browser tabs"),
      h("div", { class: "setting-desc", style: { marginBottom: ".4rem" } }, "Web pages as workspace tabs (Ctrl+Shift+B, or the tab menu). They run in their own sandboxed session: separate sign-ins from your usual browser, no access to your files, and camera, microphone, location and notification requests are refused."),
      row("Open web links in eDEX", "Links from the launcher, quick links, the terminal (Ctrl+click) and the explorer open as eDEX browser tabs instead of your default browser.", toggle("browserLinks")),
      row("Browsing data", "Sign-ins, cookies, site storage and the cache of eDEX's browser tabs.", h("button", { class: "btn", type: "button", onclick: () => clearBrowsingData() }, icon("trash"), "Clear…")),
      h("h3", null, "App tabs"),
      h("div", { class: "setting-desc", style: { marginBottom: ".4rem" } }, "Show an app's window as a workspace tab: the window moves into the tab's area and comes forward; switching tabs minimises it; closing the tab puts it back where it was. Right-click a window in the dock or launcher → Show as a tab, or tab menu → App window…. Works best in Desktop mode."),
      row("Open apps inside eDEX", "Every app window that opens from now on (from the launcher, the dock, or anywhere else) becomes a tab and is shown inside the workspace while eDEX is on screen. Games are left alone.", toggle("openAppsInside")),
      row("Show every open window as a tab", "Each open window gets a tab automatically; turning this off closes those tabs and puts the windows back.", select("appTabs", [["off", "Off — only windows I choose"], ["all", "On — every open window"]])),
      row("Tab hotkeys work from app tabs", "While a tabbed app is in front, the next / previous tab hotkeys (Ctrl+Tab / Ctrl+Shift+Tab unless changed in Settings → General) go to eDEX instead of to that app. Other apps keep their own keys.", toggle("appTabsCtrlTab")),
      row("Add a window now", null, h("button", { class: "btn", type: "button", onclick: () => { openPanel?.close(); setTimeout(() => runCommand("apptab.pick"), 200); } }, icon("apptab"), "Choose a window…")));
  }
  if (id === "files") {
    page.push(h("h3", null, "Explorer"),
      row("Show hidden items", null, toggle("showHidden")),
      row("Confirm before deleting", "Deleted items always go to the Recycle Bin.", toggle("confirmDelete")),
      row("Default view", null, select("explorerView", [["list", "List"], ["grid", "Grid"]])),
      h("h3", null, "Search"),
      row("Search the whole PC from the launcher", "Uses the Windows Search index for file names everywhere it indexes; put the query in quotes (\"budget 2026\") to search inside documents.", toggle("indexSearch")),
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
      h("h3", null, "Benchmark"),
      row("Benchmark this PC", "About 45 seconds: startup time, idle CPU and memory (your settings and Eco), smoothness, effect drawing, terminal speed and the native helper. Saves a report with no personal data to Documents › eDEX benchmarks, to compare PCs and versions.",
        h("button", { class: "btn", type: "button", onclick: () => { openPanel?.close(); setTimeout(() => runCommand("benchmark.open"), 200); } }, icon("gauge"), "Run benchmark…")),
      h("h3", null, "eDEX resource usage"),
      row("Total", "All eDEX processes, refreshed every two seconds.", usage.total),
      usage.list);
  }
  if (id === "privacy") {
    page.push(h("h3", null, "Network"),
      row("Outbound lookups", "Public-IP geolocation (ipapi.co / ipinfo.io), latency checks to google.com and twelve reference sites for the world view, the weather forecast for your approximate location (open-meteo.com), the daily update check (api.github.com), synced lyrics (lrclib.net), missing game cover art (Steam / Epic image servers) and refreshing calendar subscriptions. Turn off to make eDEX fully offline; pages you open in browser tabs, radio stations, the radio directory search, Spotify (once connected) and pressing Refresh on calendars still go online when you use them.", toggle("allowNetworkGeolocation")),
      h("h3", null, "Screen time"),
      row("Track app usage", "Counts how long each program is the focused window (idle and locked time excluded). Only program names and durations are kept, on this PC, for two weeks.", toggle("screenTime")),
      row("Clear screen time history", null, h("button", { class: "btn", type: "button", onclick: () => api.screenTime.clear().then(() => toast("Screen time history cleared", { level: "ok" })) }, "Clear")),
      screenTimeLimitsRows(),
      h("h3", null, "AI assistant"),
      ...(await aiRows()),
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
      row("Data folder", info.portable
        ? "Portable: settings, notes, tasks, themes and sign-ins are kept here, beside the .exe, so they travel with the drive."
        : info.portableNote || "Settings, notes, tasks, themes and keyboard layouts.",
      h("span", { style: { display: "flex", gap: ".4rem", alignItems: "center" } },
        h("span", { class: "mono ellipsis", style: { fontSize: ".78rem", maxWidth: "20rem" }, title: info.dataDir || "" }, info.dataDir || "?"),
        h("button", { class: "btn sm", type: "button", onclick: () => api.app.openData().catch((e) => toast(cleanError(e), { level: "warn" })) }, icon("folder"), "Open"))),
      h("h3", null, "Updates"),
      row("Check for updates", "Looks at this project's GitHub releases page and offers new versions (downloads are checked against GitHub's SHA-256 before anything runs).",
        h("button", { class: "btn primary", type: "button", onclick: () => openUpdates() }, icon("update"), "Check now")),
      row("Check automatically", "Once a day, only while Outbound lookups (Privacy) is on.", toggle("updateCheck")),
      settings.get("updateSkip") && row("Skipped version", `${settings.get("updateSkip")} isn't offered automatically.`, h("button", { class: "btn sm", type: "button", onclick: () => { settings.set({ updateSkip: "" }); openPanel?.show("about"); } }, "Offer it again")),
      h("h3", null, "Backup and tools"),
      row("Back up settings", "Every setting, your own themes and keyboard layouts in one file, to keep or move to another PC.", h("span", { style: { display: "flex", gap: ".4rem" } },
        h("button", { class: "btn", type: "button", onclick: async () => {
          try { const r = await api.tools.exportSettings(); if (r) toast(`Exported (${r.themes} themes, ${r.keyboards} layouts)`, { level: "ok", action: { label: "Show", run: () => api.fs.reveal(r.file) } }); } catch (e) { toast(cleanError(e), { level: "warn" }); }
        } }, icon("external"), "Export…"),
        h("button", { class: "btn", type: "button", onclick: async () => {
          try {
            const r = await api.tools.importSettings();
            if (r) {
              toast(`Imported ${r.settings} settings, ${r.themes} themes, ${r.keyboards} layouts${r.skippedCommands ? ` (${r.skippedCommands} command widgets left out)` : ""}`, { level: "ok", timeout: 5000 });
              openPanel?.show("about");
            }
          } catch (e) { toast(cleanError(e), { level: "warn" }); }
        } }, icon("download"), "Import…"))),
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
    if (current === id) content.replaceChildren(...items.filter(Boolean));
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
