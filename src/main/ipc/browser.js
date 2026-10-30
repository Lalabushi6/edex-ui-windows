// Browser tabs: real web pages inside eDEX's workspace.
//
// Each tab is an Electron WebContentsView laid over the tab's area of the
// eDEX window (the interface reports where that is). Pages run in their own
// persistent session, kept apart from the interface: no preload bridge, no
// app:// or localfile: access, http(s) only, web permissions (camera,
// microphone, location, notifications, USB/HID/serial) refused, and
// downloads saved only where the user picks in a Save dialog.
//
// A tab left in the background longer than Settings → Web & apps → "Unload
// background tabs after" gives its page back (each page is a process of its
// own, often 100 MB or more). Its address, history and zoom are kept, and it
// loads again when you return to it. Tabs playing sound or downloading stay.
"use strict";

const path = require("path");
const { app, Menu, WebContentsView, clipboard, session, shell } = require("electron");
const { handle } = require("./util");
const { matchesInput } = require("../lib/accel");

const PARTITION = "persist:edex-browser";
const MAX_VIEWS = 12;
const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write"]);
const ACTIONS = new Set(["back", "forward", "reload", "stop", "zoomIn", "zoomOut", "zoomReset", "external", "inspect"]);
const isWeb = (u) => /^https?:\/\//i.test(String(u || ""));

function registerBrowser({ windows, notices, settings }) {
  const ses = session.fromPartition(PARTITION);
  // id -> { view, wc, bounds, visible, active, full, hiddenAt, downloads,
  //         unloaded: null | { entries, index, url, title, zoom } }
  const views = new Map();
  const idOf = (wc) => { for (const [id, v] of views) if (v.wc === wc) return id; return null; };
  const live = (v) => !!v && !v.unloaded && !!v.wc && !v.wc.isDestroyed();

  // Sites see an ordinary Chrome user agent, not "Electron" / "eDEX-UI".
  ses.setUserAgent(ses.getUserAgent().replace(/\s+(eDEX-UI|edex-ui-windows)\/\S+/gi, "").replace(/\s+Electron\/\S+/i, ""));
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (_event, item, wc) => {
    item.setSaveDialogOptions({ title: "Save download", defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
    const id = idOf(wc);
    const owner = views.get(id);
    if (owner) owner.downloads = (owner.downloads || 0) + 1;
    windows.send("browser:download", { id, state: "started", name: item.getFilename() });
    item.once("done", (_e, state) => {
      if (owner) owner.downloads = Math.max(0, (owner.downloads || 1) - 1);
      const file = state === "completed" ? item.getSavePath() : null;
      windows.send("browser:download", { id, state, name: item.getFilename(), file });
      if (state === "completed") notices?.add({ level: "ok", kind: "download", title: "Download finished", body: item.getFilename(), action: { type: "reveal", value: file } }, { toast: false, system: "hidden" });
      else if (state === "interrupted") notices?.add({ level: "warn", kind: "download", title: "Download failed", body: item.getFilename() }, { toast: false, system: "never" });
    });
  });

  const send = (id, extra = {}) => {
    const v = views.get(id);
    if (v?.unloaded) {
      const u = v.unloaded;
      windows.send("browser:state", { id, url: u.url, title: u.title, loading: false, canBack: u.index > 0, canForward: u.index < u.entries.length - 1, zoom: Math.round(u.zoom * 100), unloaded: true, ...extra });
      return;
    }
    if (!live(v)) return;
    const h = v.wc.navigationHistory;
    windows.send("browser:state", {
      id,
      url: v.wc.getURL(),
      title: v.wc.getTitle(),
      loading: v.wc.isLoading(),
      canBack: h.canGoBack(),
      canForward: h.canGoForward(),
      zoom: Math.round(v.wc.getZoomFactor() * 100),
      unloaded: false,
      ...extra
    });
  };

  // Favicons are fetched through the browser session and handed over as
  // data URLs (the interface's CSP allows no remote images).
  async function favicon(id, url) {
    if (!isWeb(url)) return;
    try {
      const res = await ses.fetch(url, { headers: { Accept: "image/*" } });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !/^image\//i.test(type)) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 200 * 1024) return;
      windows.send("browser:state", { id, favicon: `data:${type.split(";")[0]};base64,${buf.toString("base64")}` });
    } catch (_) {}
  }

  const applyBounds = (v) => {
    const win = windows.win;
    if (!win || win.isDestroyed() || !v.view) return;
    if (v.full) {
      const [width, height] = win.getContentSize();
      v.view.setBounds({ x: 0, y: 0, width, height });
    } else if (v.bounds) {
      const z = windows.webContents?.getZoomFactor() || 1;
      const b = v.bounds;
      v.view.setBounds({ x: Math.round(b.x * z), y: Math.round(b.y * z), width: Math.max(1, Math.round(b.width * z)), height: Math.max(1, Math.round(b.height * z)) });
    }
    v.view.setVisible(!!v.visible || !!v.full);
  };

  const KEY_FOR_PAGE = (input) => {
    const k = input.key;
    if (input.control && !input.shift && !input.alt && (k === "=" || k === "+" || k === "-" || k === "0")) return k === "-" ? "zoomOut" : k === "0" ? "zoomReset" : "zoomIn";
    if (k === "F5" || (input.control && !input.shift && k.toLowerCase() === "r")) return "reload";
    if (input.alt && !input.control && k === "ArrowLeft") return "back";
    if (input.alt && !input.control && k === "ArrowRight") return "forward";
    return null;
  };
  // Keys the interface handles (its own shortcuts, and browser-tab keys that
  // need its toolbar); everything else, Ctrl+Shift+V included, stays with
  // the page.
  const UI_SHIFT_KEYS = new Set([" ", "p", "a", "t", "e", "w", "f", "s", "k", "j", "m", "b", "Tab"]);
  const UI_KEYS = new Set(["Tab", "l", "t", "w", "f", ",", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  const KEY_FOR_UI = (input) => {
    // The tab-switching hotkeys, whatever they've been changed to.
    if (settings && (matchesInput(settings.get("hotkeyTabNext"), input) || matchesInput(settings.get("hotkeyTabPrev"), input))) return true;
    const k = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    if (input.control && input.shift && !input.alt) return UI_SHIFT_KEYS.has(k);
    if (input.control && !input.alt) return UI_KEYS.has(k);
    return k === "F1" && !input.control && !input.alt;
  };

  function wire(id, wc) {
    const push = () => send(id);
    for (const evt of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) wc.on(evt, push);
    wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) send(id, { error: `${desc || "Load failed"} (${code})`, failedUrl: url });
    });
    wc.on("page-favicon-updated", (_e, icons) => favicon(id, icons?.[0]));
    wc.on("found-in-page", (_e, r) => send(id, { find: { active: r.activeMatchOrdinal, matches: r.matches } }));
    wc.on("render-process-gone", () => send(id, { crashed: true }));
    wc.on("enter-html-full-screen", () => { const v = views.get(id); if (v) { v.full = true; applyBounds(v); } });
    wc.on("leave-html-full-screen", () => { const v = views.get(id); if (v) { v.full = false; applyBounds(v); } });

    // Only web pages; mail links go to the mail app; other schemes are refused.
    const guard = (event, url) => {
      if (isWeb(url) || url === "about:blank") return;
      event.preventDefault();
      if (/^mailto:/i.test(url)) shell.openExternal(url).catch(() => {});
      else windows.send("browser:state", { id, blocked: String(url).split(":")[0].slice(0, 32) });
    };
    wc.on("will-navigate", (e) => guard(e, e.url));
    wc.on("will-redirect", (e) => guard(e, e.url));
    wc.on("will-frame-navigate", (e) => { if (!isWeb(e.url) && e.url !== "about:blank" && !/^(about|data|blob):/i.test(e.url)) e.preventDefault(); });
    wc.on("will-attach-webview", (e) => e.preventDefault());
    // Pop-ups and target=_blank links open as new eDEX browser tabs.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (isWeb(url)) windows.send("browser:open", { url, from: id, background: disposition === "background-tab" });
      return { action: "deny" };
    });

    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const page = KEY_FOR_PAGE(input);
      if (page) { event.preventDefault(); act(id, page); return; }
      if (KEY_FOR_UI(input)) {
        event.preventDefault();
        windows.webContents?.focus();
        windows.send("browser:key", { id, key: input.key, code: input.code, ctrl: input.control, shift: input.shift, alt: input.alt });
      }
    });

    wc.on("context-menu", (_e, p) => {
      const items = [];
      if (p.linkURL && isWeb(p.linkURL)) {
        items.push({ label: "Open link in new tab", click: () => windows.send("browser:open", { url: p.linkURL, from: id }) });
        items.push({ label: "Open link in your browser", click: () => shell.openExternal(p.linkURL).catch(() => {}) });
        items.push({ label: "Copy link address", click: () => clipboard.writeText(p.linkURL) });
        items.push({ type: "separator" });
      }
      if (p.mediaType === "image" && isWeb(p.srcURL)) {
        items.push({ label: "Open image in new tab", click: () => windows.send("browser:open", { url: p.srcURL, from: id }) });
        items.push({ label: "Save image as…", click: () => wc.downloadURL(p.srcURL) });
        items.push({ label: "Copy image address", click: () => clipboard.writeText(p.srcURL) });
        items.push({ type: "separator" });
      }
      if (p.isEditable) {
        items.push({ role: "undo", enabled: p.editFlags.canUndo }, { role: "redo", enabled: p.editFlags.canRedo }, { type: "separator" },
          { role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy },
          { role: "paste", enabled: p.editFlags.canPaste }, { role: "selectAll" });
        for (const s of (p.dictionarySuggestions || []).slice(0, 5)) items.unshift({ label: s, click: () => wc.replaceMisspelling(s) });
      } else if (p.selectionText) {
        items.push({ role: "copy" });
      }
      if (!p.isEditable) {
        if (items.length) items.push({ type: "separator" });
        items.push({ label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => act(id, "back") },
          { label: "Forward", enabled: wc.navigationHistory.canGoForward(), click: () => act(id, "forward") },
          { label: "Reload", click: () => act(id, "reload") },
          { type: "separator" },
          { label: "Open page in your browser", click: () => act(id, "external") },
          { label: "Inspect", click: () => wc.inspectElement(p.x, p.y) });
      }
      Menu.buildFromTemplate(items).popup({ window: windows.win });
    });
  }

  function act(id, action) {
    const v = views.get(id);
    if (v?.unloaded) {
      if (action === "reload") { reload(id); return true; }
      if (action === "external" && isWeb(v.unloaded.url)) { windows.yieldFocus(); shell.openExternal(v.unloaded.url).catch(() => {}); return true; }
      return false;
    }
    if (!live(v)) return false;
    const wc = v.wc;
    const h = wc.navigationHistory;
    switch (action) {
      case "back": if (h.canGoBack()) h.goBack(); break;
      case "forward": if (h.canGoForward()) h.goForward(); break;
      case "reload": wc.reload(); break;
      case "stop": wc.stop(); break;
      case "zoomIn": wc.setZoomFactor(Math.min(3, Math.round((wc.getZoomFactor() + 0.1) * 10) / 10)); send(id); break;
      case "zoomOut": wc.setZoomFactor(Math.max(0.3, Math.round((wc.getZoomFactor() - 0.1) * 10) / 10)); send(id); break;
      case "zoomReset": wc.setZoomFactor(1); send(id); break;
      case "external": if (isWeb(wc.getURL())) { windows.yieldFocus(); shell.openExternal(wc.getURL()).catch(() => {}); } break;
      case "inspect": wc.openDevTools({ mode: "detach" }); break;
      default: return false;
    }
    return true;
  }

  const asId = (id) => {
    if (typeof id !== "string" || !/^b[\w-]{1,24}$/.test(id)) throw new Error("Invalid browser tab");
    return id;
  };
  const asUrl = (url) => {
    const u = String(url || "");
    if (!isWeb(u) || u.length > 8192) throw new Error("Only http(s) addresses can be opened");
    return u;
  };

  // A page for the entry: a new tab, or one coming back after unloading.
  function makeView(key, entry) {
    const win = windows.win;
    if (!win || win.isDestroyed()) throw new Error("No window");
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: true,
        safeDialogs: true,
        navigateOnDragDrop: false,
        backgroundThrottling: true
      }
    });
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    win.contentView.addChildView(view);
    entry.view = view;
    entry.wc = view.webContents;
    wire(key, entry.wc);
  }

  handle("browser:create", (_e, id, url) => {
    const key = asId(id);
    if (views.has(key)) return true;
    if (views.size >= MAX_VIEWS) throw new Error(`At most ${MAX_VIEWS} browser tabs`);
    const entry = { view: null, wc: null, bounds: null, visible: false, active: false, full: false, hiddenAt: Date.now(), downloads: 0, unloaded: null };
    makeView(key, entry);
    views.set(key, entry);
    if (url) entry.wc.loadURL(asUrl(url)).catch(() => {});
    return true;
  });

  // Gives a background tab's page back, keeping what's needed to reload it.
  function unload(key) {
    const v = views.get(key);
    if (!live(v)) return false;
    const h = v.wc.navigationHistory;
    let entries = [];
    let index = 0;
    try { entries = h.getAllEntries(); index = h.getActiveIndex(); } catch (_) {}
    v.unloaded = { entries, index, url: v.wc.getURL(), title: v.wc.getTitle(), zoom: v.wc.getZoomFactor() };
    try { windows.win?.contentView.removeChildView(v.view); } catch (_) {}
    v.wc.close();
    v.view = null;
    v.wc = null;
    send(key);
    return true;
  }

  // Brings an unloaded tab's page back: its history (and the page's saved
  // state, where the site allows), else just its address.
  function reload(key, url = null) {
    const v = views.get(key);
    if (!v?.unloaded) return false;
    const saved = v.unloaded;
    v.unloaded = null;
    makeView(key, v);
    applyBounds(v);
    const zoom = () => { if (live(v) && saved.zoom && saved.zoom !== 1) v.wc.setZoomFactor(saved.zoom); };
    v.wc.once("did-finish-load", zoom);
    if (url) v.wc.loadURL(url).catch(() => {});
    else if (saved.entries.length) {
      v.wc.navigationHistory.restore({ entries: saved.entries, index: saved.index }).catch(() => {
        if (live(v) && isWeb(saved.url)) v.wc.loadURL(saved.url).catch(() => {});
      });
    } else if (isWeb(saved.url)) v.wc.loadURL(saved.url).catch(() => {});
    send(key);
    return true;
  }

  // Once a minute: unload tabs that have been out of sight long enough.
  const unloadTimer = setInterval(() => {
    const minutes = Number(settings?.get("browserUnloadMinutes")) || 0;
    if (!minutes) return;
    const cutoff = Date.now() - minutes * 60000;
    for (const [key, v] of views) {
      if (!live(v) || v.visible || v.active || v.full || !v.hiddenAt || v.hiddenAt > cutoff) continue;
      if (v.downloads > 0 || v.wc.isCurrentlyAudible() || v.wc.isDevToolsOpened()) continue;
      unload(key);
    }
  }, 60000);

  handle("browser:go", (_e, id, url) => {
    const key = asId(id);
    const v = views.get(key);
    if (!v) throw new Error("No such browser tab");
    if (v.unloaded) { reload(key, asUrl(url)); return true; }
    v.wc.loadURL(asUrl(url)).catch(() => {});
    return true;
  });

  handle("browser:action", (_e, id, action) => {
    if (!ACTIONS.has(action)) throw new Error("Unknown action");
    return act(asId(id), action);
  });

  // rect: the tab's area in interface pixels; visible: whether it shows now;
  // active: whether it's the workspace's current tab (covered by a menu, say,
  // it isn't visible but isn't in the background either).
  handle("browser:layout", (_e, id, rect, visible, active) => {
    const key = asId(id);
    const v = views.get(key);
    if (!v) return false;
    if (rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      v.bounds = { x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) };
    }
    v.visible = !!visible && !!v.bounds && v.bounds.width > 8 && v.bounds.height > 8;
    v.active = active === undefined ? v.visible : !!active;
    if (v.visible || v.active) v.hiddenAt = null;
    else if (!v.hiddenAt) v.hiddenAt = Date.now();
    if (v.visible && v.unloaded) reload(key);
    applyBounds(v);
    return true;
  });

  handle("browser:focus", (_e, id) => {
    const v = views.get(asId(id));
    if (v?.visible && live(v)) v.wc.focus();
    return !!v;
  });

  // A still of the page, shown while an eDEX menu or dialog covers the tab.
  handle("browser:snapshot", async (_e, id) => {
    const v = views.get(asId(id));
    if (!live(v) || !v.visible) return null;
    try {
      const img = await v.wc.capturePage();
      if (img.isEmpty()) return null;
      return `data:image/jpeg;base64,${img.toJPEG(82).toString("base64")}`;
    } catch (_) { return null; }
  });

  handle("browser:find", (_e, id, text, opts = {}) => {
    const v = views.get(asId(id));
    if (!live(v)) return false;
    if (!text) { v.wc.stopFindInPage("clearSelection"); return true; }
    v.wc.findInPage(String(text).slice(0, 200), { forward: opts.forward !== false, findNext: !!opts.findNext, matchCase: !!opts.matchCase });
    return true;
  });

  handle("browser:close", (_e, id) => close(asId(id)));

  handle("browser:clearData", async () => {
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    return true;
  });

  function close(id) {
    const v = views.get(id);
    if (!v) return false;
    views.delete(id);
    if (v.view) { try { windows.win?.contentView.removeChildView(v.view); } catch (_) {} }
    if (live(v)) v.wc.close();
    return true;
  }

  function closeAll() {
    for (const id of [...views.keys()]) close(id);
  }

  // A reloaded interface rebuilds its tabs; drop the old pages first.
  const attach = (win) => {
    win.webContents.on("did-navigate", closeAll);
    win.on("closed", () => views.clear());
  };

  return {
    isBrowserSession: (s) => s === ses,
    attach,
    closeAll,
    stop: () => clearInterval(unloadTimer),
    // For the benchmark: open browser tabs and how many are unloaded.
    stats: () => ({ tabs: views.size, unloaded: [...views.values()].filter((v) => v.unloaded).length }),
    // Development probes: unload every background tab now.
    unloadBackground: () => [...views.keys()].filter((k) => { const v = views.get(k); return !v.visible && !v.active; }).filter(unload)
  };
}

module.exports = { registerBrowser, PARTITION };
