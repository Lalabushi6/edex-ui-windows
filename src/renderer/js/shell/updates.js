// Updates from the GitHub releases page: the "new version" notice, and the
// dialog with the release notes, download progress and install.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openModal, toast, cleanError } from "../core/ui.js";
import * as fmt from "../core/format.js";
import { isQuiet } from "./notices.js";

const api = window.edex;

// Release notes are Markdown; shown as plain text with headings, bullets and
// links recognised (links are opened only through the main process).
function notes(text) {
  const box = h("div", { class: "upd-notes" });
  for (const raw of String(text || "").split(/\r?\n/).slice(0, 300)) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1");
    if (!line.trim()) continue;
    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (head) box.append(h("div", { class: `upd-h upd-h${head[1].length}` }, head[2]));
    else if (bullet) box.append(h("div", { class: "upd-li" }, bullet[1]));
    else box.append(h("div", { class: "upd-p" }, line));
  }
  if (!box.childElementCount) box.append(h("div", { class: "muted" }, "No release notes."));
  return box;
}

export async function openUpdates({ result = null } = {}) {
  const info = await api.updates.info().catch(() => ({}));
  openModal((close) => {
    const body = h("div", { class: "upd-body" });
    const status = h("div", { class: "upd-status" });
    const bar = h("div", { class: "upd-bar", hidden: true }, h("i"));
    const actions = h("div", { class: "dialog-actions" });
    let busy = false;

    const show = (r, error) => {
      body.replaceChildren();
      actions.replaceChildren();
      const closeBtn = h("button", { class: "btn", type: "button", onclick: () => close() }, "Close");
      if (error) {
        setText(status, error);
        status.className = "upd-status warn-text";
        actions.append(h("button", { class: "btn", type: "button", onclick: () => check() }, icon("refresh"), "Try again"), closeBtn);
        return;
      }
      if (!r) {
        setText(status, "Checking GitHub for a newer version…");
        status.className = "upd-status muted";
        return;
      }
      status.className = "upd-status";
      if (!r.newer) {
        setText(status, `You have the latest version (${r.current}).`);
        actions.append(h("button", { class: "btn", type: "button", onclick: () => api.updates.openPage() }, icon("external"), "Release page"), closeBtn);
        return;
      }
      setText(status, `eDEX-UI ${r.version} is available — you have ${r.current}.`);
      body.append(
        h("div", { class: "upd-meta muted" }, [r.name, r.published ? new Date(r.published).toLocaleDateString() : "", r.asset ? `${r.asset.name} · ${fmt.bytes(r.asset.size)}${r.asset.verified ? " · checked against GitHub's SHA-256" : ""}` : ""].filter(Boolean).join(" · ")),
        notes(r.notes));
      const install = h("button", { class: "btn primary", type: "button" }, icon("download"), r.kind === "portable" ? "Download and replace" : "Download and install");
      install.disabled = !r.asset;
      if (!r.asset) install.title = r.kind ? "This release has no matching file" : "Development runs can't install updates";
      install.addEventListener("click", async () => {
        if (busy) return;
        busy = true;
        install.disabled = true;
        bar.hidden = false;
        const off = api.updates.onProgress(({ got, total }) => {
          bar.firstChild.style.width = `${total ? Math.min(100, (got / total) * 100) : 0}%`;
          setText(status, `Downloading… ${fmt.bytes(got)}${total ? ` of ${fmt.bytes(total)}` : ""}`);
        });
        try {
          await api.updates.download();
          setText(status, "Downloaded and verified. Installing restarts eDEX.");
          const ok = await api.updates.install();
          if (!ok) { install.disabled = false; setText(status, "Ready to install whenever you like."); }
        } catch (e) {
          setText(status, cleanError(e));
          status.className = "upd-status warn-text";
          install.disabled = false;
        } finally {
          off();
          busy = false;
        }
      });
      actions.append(
        h("button", { class: "btn", type: "button", onclick: () => { api.updates.skip(r.version); toast(`Version ${r.version} won't be offered again`, { timeout: 2400 }); close(); } }, "Skip this version"),
        h("button", { class: "btn", type: "button", onclick: () => api.updates.openPage() }, icon("external"), "Release page"),
        h("span", { class: "grow" }),
        closeBtn, install);
    };

    const check = async () => {
      show(null);
      try { show(await api.updates.check()); } catch (e) { show(null, cleanError(e)); }
    };
    if (result) show(result); else check();

    return h("div", { class: "dialog upd-dialog" },
      h("h2", { class: "dialog-title" }, icon("update"), " Updates"),
      h("div", { class: "muted upd-from" }, info.repo ? `From github.com/${info.repo}/releases · ${info.kind === "portable" ? "portable copy" : info.kind === "installer" ? "installed copy" : "development run"}` : "This build doesn't know its GitHub repository"),
      status, bar, body, actions);
  }, { label: "Updates", dismissible: true });
}

// The once-a-day background check reports newer versions here.
export function initUpdates() {
  api.updates.onAvailable((r) => {
    if (isQuiet()) return; // the notification centre keeps it
    toast(`eDEX-UI ${r.version} is available`, { level: "ok", timeout: 12000, action: { label: "Details", run: () => openUpdates({ result: r }) } });
  });
}
