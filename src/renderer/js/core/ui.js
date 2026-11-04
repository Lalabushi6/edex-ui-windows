// Toasts, modal dialogs and context menus.
import { h, $ } from "./dom.js";
import { iconSvg } from "./icons.js";
import * as sfx from "./audio.js";

// ── Toasts ──────────────────────────────────────────────────────────────────
export function toast(message, { level = "info", timeout = 2600, action } = {}) {
  const host = $("#toasts");
  if (!host) return;
  if (level === "warn" || level === "error") sfx.play("denied");
  const el = h("div", { class: `toast ${level}`, role: "status" },
    h("span", { class: "toast-msg" }, message),
    action && h("button", { class: "toast-action", type: "button", onclick: () => { action.run(); dismiss(); } }, action.label));
  host.append(el);
  while (host.children.length > 5) host.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add("show"));
  let timer = setTimeout(dismiss, timeout);
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => { timer = setTimeout(dismiss, 1200); });
  function dismiss() {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }
}

// Strips Electron's IPC wrapper from error messages shown to the user.
export function cleanError(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

// ── Modal stack ─────────────────────────────────────────────────────────────
const modalStack = [];

export function modalOpen() {
  return modalStack.length > 0;
}

// Opens a modal; `build(close)` returns its content. Esc / backdrop close it.
export function openModal(build, { className = "", onClose, dismissible = true, label = "Dialog" } = {}) {
  const backdrop = h("div", { class: "modal-backdrop" });
  // The on-screen keyboard stays uncovered (and usable) below dialogs.
  const kb = document.getElementById("keyboard");
  if (kb?.classList.contains("show")) {
    const top = kb.getBoundingClientRect().top;
    if (top > 0 && top < window.innerHeight) backdrop.style.bottom = `${Math.round(window.innerHeight - top)}px`;
  }
  const box = h("div", { class: `modal ${className}`, role: "dialog", "aria-label": label });
  backdrop.append(box);
  let closed = false;
  const previousFocus = document.activeElement;

  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    const idx = modalStack.indexOf(entry);
    if (idx >= 0) modalStack.splice(idx, 1);
    backdrop.classList.remove("show");
    setTimeout(() => backdrop.remove(), 140);
    onClose?.(result);
    if (previousFocus && previousFocus.isConnected && !modalStack.length) {
      try { previousFocus.focus({ preventScroll: true }); } catch (_) {}
    }
  };
  const onKey = (event) => {
    if (modalStack[modalStack.length - 1] !== entry) return;
    if (event.key === "Escape" && dismissible) {
      event.preventDefault();
      event.stopPropagation();
      close(null);
    }
  };
  const entry = { close };
  modalStack.push(entry);
  box.append(build(close));
  if (dismissible) backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(null); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("show"));
  // The marked field first; a selector list would pick whichever comes first
  // in the DOM (often a header's close button).
  const focusable = box.querySelector("[data-autofocus]") || box.querySelector("input, textarea, button");
  focusable?.focus();
  return { close, box };
}

export function prompt({ title, message = "", value = "", placeholder = "", confirmLabel = "OK", multiline = false }) {
  return new Promise((resolve) => {
    openModal((close) => {
      const input = multiline
        ? h("textarea", { class: "input", rows: 6, placeholder, spellcheck: false })
        : h("input", { class: "input", placeholder, spellcheck: false, "data-autofocus": true });
      input.value = value;
      const submit = () => close(input.value.trim());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (!multiline || e.ctrlKey)) { e.preventDefault(); submit(); }
      });
      setTimeout(() => { input.focus(); input.select(); }, 0);
      return h("div", { class: "dialog" },
        h("h2", { class: "dialog-title" }, title),
        message && h("p", { class: "dialog-msg" }, message),
        input,
        h("div", { class: "dialog-actions" },
          h("button", { class: "btn", type: "button", onclick: () => close(null) }, "Cancel"),
          h("button", { class: "btn primary", type: "button", onclick: submit }, confirmLabel)));
    }, { onClose: (r) => resolve(r ?? null), label: title });
  });
}

export function confirm({ title, message = "", confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    openModal((close) => {
      const ok = h("button", { class: `btn primary${danger ? " danger" : ""}`, type: "button", "data-autofocus": true, onclick: () => close(true) }, confirmLabel);
      return h("div", { class: "dialog" },
        h("h2", { class: "dialog-title" }, title),
        message && h("p", { class: "dialog-msg" }, message),
        h("div", { class: "dialog-actions" },
          h("button", { class: "btn", type: "button", onclick: () => close(false) }, "Cancel"),
          ok));
    }, { onClose: (r) => resolve(r === true), label: title });
  });
}

// A command exactly as it would run: blank space that could push the rest out
// of sight is counted, and characters that don't show are named.
function revealCommand(text) {
  return text
    .replace(/\n(?:[\t\p{Zs}]*\n)+/gu, (m) => `\n⟦${m.split("\n").length - 1} line breaks⟧\n`)
    .replace(/[\t\p{Zs}]{4,}/gu, (m) => ` ⟦${m.length} blanks⟧ `)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" || c === "\t" ? c : `⟦U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}⟧`));
}

const COMMAND_PREVIEW_MAX = 20000;

// The elements that show a command in a dialog, for someone deciding whether
// to let it run.
export function commandPreview(command) {
  const plain = String(command).replace(/\r\n?/g, "\n");
  const head = plain.slice(0, COMMAND_PREVIEW_MAX);
  const shown = revealCommand(head);
  const rest = plain.length - head.length;
  return [
    h("pre", { class: "cmdw-out cmdw-review" }, rest > 0 ? `${shown}\n⟦${rest} more characters not shown⟧` : shown),
    shown !== head && h("p", { class: "dialog-msg warn-text" }, "This command has long blank stretches or invisible characters, marked ⟦like this⟧. That's unusual, and can be a way of hiding part of a command.")
  ];
}

// Asks before text reaches a shell. Cancel has the focus, so a stray Enter
// doesn't run anything.
export function confirmCommand({ title, message, command, confirmLabel }) {
  return new Promise((resolve) => {
    openModal((close) => h("div", { class: "dialog cmdw-dialog" },
      h("h2", { class: "dialog-title" }, title),
      h("p", { class: "dialog-msg" }, message),
      commandPreview(command),
      h("div", { class: "dialog-actions" },
        h("button", { class: "btn", type: "button", "data-autofocus": true, onclick: () => close(false) }, "Cancel"),
        h("button", { class: "btn primary", type: "button", onclick: () => close(true) }, confirmLabel))),
    { onClose: (r) => resolve(r === true), label: title });
  });
}

// A saved link (a pin, a quick link) can name a network path, and a settings
// file can plant one under a harmless label. Opening it contacts that server,
// so the full address is shown first the time it's opened each session.
export async function confirmNetworkPath(path) {
  if (!/^[\\/]{2}/.test(path || "") || await window.edex.fs.networkOpen(path)) return true;
  const ok = await confirm({
    title: "Open a network location?",
    message: `eDEX will connect to ${path}, and Windows may send that computer your sign-in details. Only continue if you trust it.`,
    confirmLabel: "Open"
  });
  if (!ok) return false;
  try { return await window.edex.fs.allowNetwork(path); } catch (e) { toast(cleanError(e), { level: "warn" }); return false; }
}

// ── Context menu ────────────────────────────────────────────────────────────
let activeMenu = null;

export function closeMenu() {
  activeMenu?.();
  activeMenu = null;
}

// items: { label, icon, hint, run, disabled, danger } | { separator: true }
export function contextMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  closeMenu();
  const menu = h("div", { class: "ctx-menu", role: "menu" });
  const buttons = [];
  for (const item of items.filter(Boolean)) {
    if (item.separator) { menu.append(h("div", { class: "ctx-sep" })); continue; }
    const btn = h("button", {
      class: `ctx-item${item.danger ? " danger" : ""}`, type: "button", role: "menuitem", disabled: !!item.disabled,
      onclick: () => { closeMenu(); item.run?.(); }
    },
    h("span", { class: "ctx-ico", svg: item.icon ? iconSvg(item.icon) : "" }),
    h("span", { class: "ctx-label" }, item.label),
    item.hint && h("span", { class: "ctx-hint" }, item.hint));
    buttons.push(btn);
    menu.append(btn);
  }
  document.body.append(menu);
  const { innerWidth: W, innerHeight: H } = window;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(event.clientX, W - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, H - r.height - 4))}px`;

  let focusIdx = -1;
  const onDown = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const enabled = buttons.filter((b) => !b.disabled);
      if (!enabled.length) return;
      focusIdx = (focusIdx + (e.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      enabled[focusIdx].focus();
    }
  };
  const onBlur = () => closeMenu();
  const timer = setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
  }, 0);
  activeMenu = () => {
    // Closed before those went on: left on, they'd swallow every Esc from now on.
    clearTimeout(timer);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onBlur);
    menu.remove();
  };
}

// A small panel anchored under a button (brightness, calendar…). Shares the
// context menu's slot, so opening one closes the other. `build(close)`
// returns the content; returns the close function.
export function popover(anchor, build, { className = "", onClose } = {}) {
  closeMenu();
  const panel = h("div", { class: `popover ${className}`, role: "dialog" });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (activeMenu === teardown) activeMenu = null;
    teardown();
  };
  panel.append(build(close));
  document.body.append(panel);
  const a = anchor.getBoundingClientRect();
  const r = panel.getBoundingClientRect();
  const { innerWidth: W, innerHeight: H } = window;
  panel.style.left = `${Math.max(4, Math.min(a.right - r.width, W - r.width - 4))}px`;
  // Opens upward when there is no room below (anchors in bottom bars).
  const below = a.bottom + 6 + r.height <= H - 4 || a.top - 6 - r.height < 4;
  panel.style.top = `${Math.max(4, below ? Math.min(a.bottom + 6, H - r.height - 4) : a.top - 6 - r.height)}px`;
  const onDown = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  const timer = setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
  }, 0);
  function teardown() {
    clearTimeout(timer);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("resize", close);
    panel.remove();
    closed = true;
    onClose?.();
  }
  activeMenu = teardown;
  return close;
}

// ── Cover tracking ──────────────────────────────────────────────────────────
// Browser tabs and app tabs are drawn above the interface (a web page view,
// another app's window), so they step aside while a menu, dialog, popover or
// full-screen overlay is open. All of those are appended straight to <body>.
const COVER = ".modal-backdrop, .ctx-menu, .popover, .idle-screen, #boot-preview, #boot";
const coverSubs = new Set();
let coverObserver = null;
let covered = false;

export function isCovered() {
  return !!document.querySelector(`body > :is(${COVER})`);
}

// cb(covered) runs whenever that changes; returns an unsubscribe function.
export function onCoverChange(cb) {
  coverSubs.add(cb);
  if (!coverObserver) {
    covered = isCovered();
    coverObserver = new MutationObserver(() => {
      const now = isCovered();
      if (now === covered) return;
      covered = now;
      for (const fn of coverSubs) { try { fn(now); } catch (_) {} }
    });
    coverObserver.observe(document.body, { childList: true });
  }
  return () => coverSubs.delete(cb);
}

export async function copyText(text, message = "Copied") {
  try {
    await window.edex.clip.copy(String(text));
    toast(message, { level: "ok", timeout: 1600 });
  } catch (_) {
    try {
      await navigator.clipboard.writeText(String(text));
      toast(message, { level: "ok", timeout: 1600 });
    } catch (e) {
      toast("Clipboard is unavailable", { level: "warn" });
    }
  }
}
