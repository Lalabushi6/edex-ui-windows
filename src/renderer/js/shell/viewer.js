// Quick-look viewer: images, audio, video, PDF and text (with in-place editing
// for text files). Arrow keys step through sibling files.
import { h, setText } from "../core/dom.js";
import { icon, fileKind } from "../core/icons.js";
import * as fmt from "../core/format.js";
import { openModal, toast, copyText, cleanError, confirm } from "../core/ui.js";
import { emit } from "../core/bus.js";

const api = window.edex;
const EDITABLE_LIMIT = 4 * 1024 * 1024;

export function openViewer(path, { siblings = [], onNavigate } = {}) {
  let current = path;
  let editing = false;
  let dirty = false;
  let editor = null;
  let modal;

  const title = h("span", { class: "modal-title ellipsis" });
  const sub = h("div", { class: "muted ellipsis", style: { fontSize: ".78rem" } });
  const body = h("div", { class: "viewer-body" });
  const footLeft = h("span", { class: "grow ellipsis" });
  const footRight = h("span");
  const editBtn = h("button", { class: "btn", type: "button", onclick: () => toggleEdit() }, icon("edit"), "Edit");
  const playerBtn = h("button", { class: "btn", type: "button", hidden: true, onclick: () => { modal.close(); emit("open-media", { paths: [current], play: true }); } }, icon("play"), "Media player");
  const saveBtn = h("button", { class: "btn primary", type: "button", hidden: true, onclick: () => save() }, "Save");
  const btn = (name, label, onclick) => h("button", { class: "icon-btn", type: "button", title: label, onclick }, icon(name));

  const head = h("div", { class: "modal-head" },
    icon("eye"),
    h("div", { class: "grow" }, title, sub),
    playerBtn, editBtn, saveBtn,
    btn("external", "Open with default app", () => api.fs.open(current).catch((e) => toast(cleanError(e), { level: "warn" }))),
    btn("app", "Open with…", () => api.fs.openWith(current)),
    btn("folder", "Show in Windows Explorer", () => api.fs.reveal(current)),
    btn("link", "Copy path", () => copyText(current, "Path copied")),
    btn("close", "Close (Esc)", () => tryClose()));
  const foot = h("div", { class: "viewer-foot" }, footLeft, footRight);

  async function tryClose() {
    if (dirty && !(await confirm({ title: "Discard changes?", message: "You have unsaved edits.", confirmLabel: "Discard", danger: true }))) return;
    dirty = false;
    modal.close();
  }

  async function load(p) {
    current = p;
    editing = false;
    dirty = false;
    editor = null;
    saveBtn.hidden = true;
    editBtn.hidden = true;
    playerBtn.hidden = !["audio", "video"].includes(fileKind(fmt.basename(p), false));
    setText(title, fmt.basename(p));
    setText(sub, p);
    const idx = siblings.findIndex((s) => fmt.pathsEqual(s, p));
    setText(footRight, siblings.length > 1 && idx >= 0 ? `${idx + 1} / ${siblings.length}  ·  ← → to browse` : "");
    body.replaceChildren(h("div", { class: "muted" }, "Loading…"));
    const kind = fileKind(fmt.basename(p), false);
    const url = fmt.fileUrl(p);
    let stat = null;
    try { stat = await api.fs.stat(p); } catch (_) {}
    setText(footLeft, stat ? `${fmt.bytes(stat.size)}  ·  modified ${fmt.dateTime(stat.mtime)}` : "");

    if (kind === "image") {
      const img = h("img", { src: url, alt: fmt.basename(p) });
      img.addEventListener("load", () => setText(footLeft, `${img.naturalWidth} × ${img.naturalHeight}  ·  ${stat ? fmt.bytes(stat.size) : ""}`));
      img.addEventListener("error", () => body.replaceChildren(h("div", { class: "empty" }, "This image format cannot be previewed")));
      body.replaceChildren(img);
      return;
    }
    if (kind === "video" || kind === "audio") {
      const media = h(kind === "video" ? "video" : "audio", { src: url, controls: true, autoplay: true });
      media.addEventListener("error", () => body.replaceChildren(h("div", { class: "empty" }, "This media format is not supported here — use Open to play it in your default app")));
      body.replaceChildren(kind === "audio" ? h("div", { class: "audio-art" }, icon("audio"), h("div", null, fmt.basename(p)), media) : media);
      return;
    }
    if (kind === "pdf") {
      body.replaceChildren(h("iframe", { src: url, title: fmt.basename(p) }));
      return;
    }
    try {
      const res = await api.fs.peek(p);
      if (res.binary) {
        body.replaceChildren(h("div", { class: "empty" }, "Binary file — no preview available. Use Open to launch it with its default app."));
        return;
      }
      body.replaceChildren(h("pre", { class: "viewer-text" }, res.text + (res.truncated ? "\n\n… preview truncated" : "")));
      editBtn.hidden = !(stat && stat.size <= EDITABLE_LIMIT);
    } catch (e) {
      body.replaceChildren(h("div", { class: "empty" }, cleanError(e)));
    }
  }

  async function toggleEdit() {
    if (editing) return;
    try {
      const text = await api.fs.read(current);
      editing = true;
      editor = h("textarea", { class: "viewer-edit", spellcheck: false });
      editor.value = text;
      editor.addEventListener("input", () => { dirty = true; setText(footRight, "unsaved changes · Ctrl+S to save"); });
      editor.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
        if (e.key === "Tab") {
          e.preventDefault();
          const { selectionStart: s, selectionEnd: en } = editor;
          editor.setRangeText("  ", s, en, "end");
          dirty = true;
        }
      });
      body.replaceChildren(editor);
      editBtn.hidden = true;
      saveBtn.hidden = false;
      editor.focus();
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
    }
  }

  async function save() {
    if (!editor) return;
    try {
      await api.fs.write(current, editor.value);
      dirty = false;
      setText(footRight, "saved");
      toast("File saved", { level: "ok", timeout: 1500 });
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
    }
  }

  const step = (delta) => {
    if (editing || siblings.length < 2) return;
    const idx = siblings.findIndex((s) => fmt.pathsEqual(s, current));
    const next = siblings[(idx + delta + siblings.length) % siblings.length];
    load(next);
    onNavigate?.(next);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); tryClose(); return; }
    if (editing) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    if (e.key === " " && !["VIDEO", "AUDIO", "BUTTON"].includes(e.target.tagName)) { e.preventDefault(); tryClose(); }
  };

  // Not dismissible by the modal stack: Esc goes through tryClose so unsaved
  // edits are never thrown away silently.
  modal = openModal(() => h("div", { class: "viewer-root", style: { display: "contents" } }, head, body, foot), {
    className: "viewer",
    label: "File viewer",
    dismissible: false,
    onClose: () => body.querySelectorAll("video,audio").forEach((m) => { m.pause(); m.removeAttribute("src"); m.load(); })
  });
  modal.box.tabIndex = -1;
  modal.box.addEventListener("keydown", onKey);
  modal.box.focus();
  load(path);
}
