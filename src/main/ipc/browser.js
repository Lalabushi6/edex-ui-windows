// Browser tabs: real web pages inside eDEX's workspace.
//
// Each tab is an Electron WebContentsView laid over the tab's area of the
// eDEX window (the interface reports where that is). Pages run in their own
// persistent session, kept apart from the interface: no preload bridge, no
// app:// or localfile: access, http(s) only, web permissions (camera,
// microphone, location, notifications, USB/HID/serial) refused, and
// downloads saved only where the user picks in a Save dialog.
"use strict";

const path = require("path");
const { app, Menu, WebContentsView, clipboard, session, shell } = require("electron");
const { handle } = require("./util");

const PARTITION = "persist:edex-browser";
const MAX_VIEWS = 12;
const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write"]);
const ACTIONS = new Set(["back", "forward", "reload", "stop", "zoomIn", "zoomOut", "zoomReset", "external", "inspect"]);
const isWeb = (u) => /^https?:\/\//i.test(String(u || ""));

function registerBrowser({ windows, notices }) {
  const ses = session.fromPartition(PARTITION);
  const views = new Map(); // id -> { view, wc, bounds, visible, full }
  const idOf = (wc) => { for (const [id, v] of views) if (v.wc === wc) return id; return null; };

  // Sites see an ordinary Chrome user agent, not "Electron" / "eDEX-UI".
  ses.setUserAgent(ses.getUserAgent().replace(/\s+(eDEX-UI|edex-ui-windows)\/\S+/gi, "").replace(/\s+Electron\/\S+/i, ""));
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (_event, item, wc) => {
    item.setSaveDialogOptions({ title: "Save download", defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
    const id = idOf(wc);
    windows.send("browser:download", { id, state: "started", name: item.getFilename() });
    item.once("done", (_e, state) => {
      const file = state === "completed" ? item.getSavePath() : null;
      windows.send("browser:download", { id, state, name: item.getFilename(), file });
      if (state === "completed") notices?.add({ level: "ok", kind: "download", title: "Download finished", body: item.getFilename(), action: { type: "reveal", value: file } }, { toast: false, system: "hidden" });
      else if (state === "interrupted") notices?.add({ level: "warn", kind: "download", title: "Download failed", body: item.getFilename() }, { toast: false, system: "never" });
    });
  });

  const send = (id, extra = {}) => {
    const v = views.get(id);
    if (!v || v.wc.isDestroyed()) return;
    const h = v.wc.navigationHistory;
    windows.send("browser:state", {
      id,
      url: v.wc.getURL(),
      title: v.wc.getTitle(),
      loading: v.wc.isLoading(),
      canBack: h.canGoBack(),
      canForward: h.canGoForward(),
      zoom: Math.round(v.wc.getZoomFactor() * 100),
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
    if (!win || win.isDestroyed()) return;
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
    if (!v || v.wc.isDestroyed()) return false;
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

  handle("browser:create", (_e, id, url) => {
    const key = asId(id);
    if (views.has(key)) return true;
    if (views.size >= MAX_VIEWS) throw new Error(`At most ${MAX_VIEWS} browser tabs`);
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
    const entry = { view, wc: view.webContents, bounds: null, visible: false, full: false };
    views.set(key, entry);
    wire(key, entry.wc);
    if (url) entry.wc.loadURL(asUrl(url)).catch(() => {});
    return true;
  });

  handle("browser:go", (_e, id, url) => {
    const v = views.get(asId(id));
    if (!v) throw new Error("No such browser tab");
    v.wc.loadURL(asUrl(url)).catch(() => {});
    return true;
  });

  handle("browser:action", (_e, id, action) => {
    if (!ACTIONS.has(action)) throw new Error("Unknown action");
    return act(asId(id), action);
  });

  // rect: the tab's area in interface pixels; visible: whether it shows now.
  handle("browser:layout", (_e, id, rect, visible) => {
    const v = views.get(asId(id));
    if (!v) return false;
    if (rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      v.bounds = { x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) };
    }
    v.visible = !!visible && !!v.bounds && v.bounds.width > 8 && v.bounds.height > 8;
    applyBounds(v);
    return true;
  });

  handle("browser:focus", (_e, id) => {
    const v = views.get(asId(id));
    if (v?.visible) v.wc.focus();
    return !!v;
  });

  // A still of the page, shown while an eDEX menu or dialog covers the tab.
  handle("browser:snapshot", async (_e, id) => {
    const v = views.get(asId(id));
    if (!v || !v.visible) return null;
    try {
      const img = await v.wc.capturePage();
      if (img.isEmpty()) return null;
      return `data:image/jpeg;base64,${img.toJPEG(82).toString("base64")}`;
    } catch (_) { return null; }
  });

  handle("browser:find", (_e, id, text, opts = {}) => {
    const v = views.get(asId(id));
    if (!v) return false;
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
    try { windows.win?.contentView.removeChildView(v.view); } catch (_) {}
    if (!v.wc.isDestroyed()) v.wc.close();
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

  return { isBrowserSession: (s) => s === ses, attach, closeAll };
}

module.exports = { registerBrowser, PARTITION };
