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

export function errorToast(prefix, error) {
  toast(`${prefix}: ${error?.message || error}`.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), { level: "warn", timeout: 4200 });
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
  const focusable = box.querySelector("[data-autofocus], input, textarea, button");
  focusable?.focus();
  return { close, box };
}

export function closeAllModals() {
  for (const m of [...modalStack].reverse()) m.close(null);
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
      setTimeout(() => ok.focus(), 0);
      return h("div", { class: "dialog" },
        h("h2", { class: "dialog-title" }, title),
        message && h("p", { class: "dialog-msg" }, message),
        h("div", { class: "dialog-actions" },
          h("button", { class: "btn", type: "button", onclick: () => close(false) }, "Cancel"),
          ok));
    }, { onClose: (r) => resolve(r === true), label: title });
  });
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
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
  }, 0);
  activeMenu = () => {
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
  panel.style.top = `${Math.max(4, Math.min(a.bottom + 6, H - r.height - 4))}px`;
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
