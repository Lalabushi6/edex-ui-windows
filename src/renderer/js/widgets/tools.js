// Right-column widgets: network, notes, clipboard history, quick links.
import { h, setText, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import { onLive } from "../core/live.js";
import { Sparkline } from "../core/sparkline.js";
import * as fmt from "../core/format.js";
import * as settings from "../core/settings.js";
import { emit, on } from "../core/bus.js";
import { toast, contextMenu, prompt, confirm, copyText, cleanError } from "../core/ui.js";
import { defineWidget } from "./registry.js";

const api = window.edex;

function toolButton(name, title, onclick) {
  return h("button", { class: "icon-btn sm", type: "button", title, onclick }, icon(name));
}

// ── Network ─────────────────────────────────────────────────────────────────
defineWidget({
  id: "network",
  order: 1,
  title: "Network",
  column: "right",
  create(panel) {
    const refs = {};
    const grid = h("div", { class: "kv", style: { "--cols": 3 } });
    for (const [k, label] of [["state", "State"], ["ip", "IPv4"], ["ping", "Ping"]]) {
      refs[k] = h("span", { class: "v" }, "--");
      grid.append(h("div", null, h("span", { class: "label" }, label), refs[k]));
    }
    const canvas = h("canvas", { class: "spark tall" });
    const up = h("span");
    const down = h("span");
    const totals = h("div", { class: "net-graph-legend" });
    panel.body.append(grid, canvas, h("div", { class: "net-graph-legend" }, up, down), totals);
    const spark = new Sparkline(canvas, { mirror: true, series: 2, floor: 16384, points: 80 });
    const outTotal = h("span");
    const inTotal = h("span");
    totals.append(outTotal, inTotal);
    let online = true;

    const off = onLive(({ net: n }) => {
      online = n.online;
      setText(refs.state, n.online ? "ONLINE" : "OFFLINE");
      refs.state.classList.toggle("warn-text", !n.online);
      setText(refs.ip, n.ip4 || "--");
      panel.setSub(n.iface ? `${n.iface}${n.speed ? ` · ${n.speed >= 1000 ? `${n.speed / 1000} Gb/s` : `${n.speed} Mb/s`}` : ""}` : "no interface");
      if (!n.online) return;
      spark.push(n.txSec, n.rxSec);
      setText(up, `▲ ${fmt.bits(n.txSec)}`);
      setText(down, `▼ ${fmt.bits(n.rxSec)}`);
      setText(outTotal, `OUT ${fmt.bytes(n.tx)}`);
      setText(inTotal, `IN ${fmt.bytes(n.rx)}`);
    });
    const ping = poll(async () => {
      if (!online) { setText(refs.ping, "--"); return; }
      const ms = await api.net.latency();
      setText(refs.ping, ms === null ? (settings.get("allowNetworkGeolocation") ? "TIMEOUT" : "OFF") : `${Math.round(ms)} ms`);
    }, 30000);
    return { destroy() { off(); ping.stop(); spark.destroy(); } };
  }
});

// ── Notes ───────────────────────────────────────────────────────────────────
defineWidget({
  id: "notes",
  order: 3,
  title: "Notes",
  column: "right",
  create(panel) {
    let data = { notes: [], active: null };
    const select = h("select", { class: "input" });
    const area = h("textarea", { class: "input notes-area", spellcheck: false, placeholder: "Type anything — saved automatically." });
    panel.body.append(h("div", { class: "notes-bar" }, select), area);
    panel.tools.append(
      toolButton("plus", "New note", () => addNote()),
      toolButton("edit", "Rename note", () => renameNote()),
      toolButton("trash", "Delete note", () => deleteNote()));

    const current = () => data.notes.find((n) => n.id === data.active) || data.notes[0];
    const save = debounce(() => api.notes.save(data).catch((e) => toast(cleanError(e), { level: "warn" })), 500);
    const render = () => {
      select.replaceChildren(...data.notes.map((n) => h("option", { value: n.id }, n.title || "Untitled")));
      const note = current();
      if (note) {
        select.value = note.id;
        if (document.activeElement !== area) area.value = note.body;
        panel.setSub(note.updated ? fmt.relativeTime(note.updated) : "");
      }
    };
    const addNote = async () => {
      const title = await prompt({ title: "New note", placeholder: "Title", value: `Note ${data.notes.length + 1}` });
      if (!title) return;
      const note = { id: `n${Date.now()}`, title, body: "", updated: Date.now() };
      data.notes.push(note);
      data.active = note.id;
      render();
      save();
      area.focus();
    };
    const renameNote = async () => {
      const note = current();
      if (!note) return;
      const title = await prompt({ title: "Rename note", value: note.title });
      if (!title) return;
      note.title = title;
      render();
      save();
    };
    const deleteNote = async () => {
      const note = current();
      if (!note) return;
      if (note.body.trim() && !(await confirm({ title: "Delete note", message: `Delete "${note.title}"? This cannot be undone.`, confirmLabel: "Delete", danger: true }))) return;
      data.notes = data.notes.filter((n) => n !== note);
      if (!data.notes.length) data.notes.push({ id: `n${Date.now()}`, title: "Scratchpad", body: "", updated: Date.now() });
      data.active = data.notes[0].id;
      render();
      save();
    };
    select.addEventListener("change", () => { data.active = select.value; area.value = current()?.body || ""; render(); save(); });
    area.addEventListener("input", () => {
      const note = current();
      if (!note) return;
      note.body = area.value;
      note.updated = Date.now();
      save();
    });
    api.notes.load().then((d) => {
      data = d && Array.isArray(d.notes) && d.notes.length ? d : { notes: [{ id: "n1", title: "Scratchpad", body: "", updated: Date.now() }] };
      data.active = data.active || data.notes[0].id;
      render();
    });
    const offNew = on("new-note", ({ body = "", title } = {}) => {
      const note = { id: `n${Date.now()}`, title: title || `Clip ${new Date().toLocaleTimeString()}`, body, updated: Date.now() };
      data.notes.push(note);
      data.active = note.id;
      area.value = body;
      render();
      save();
      toast("Saved to notes", { level: "ok", timeout: 1500 });
    });
    return { destroy: offNew };
  }
});

// ── Clipboard history ───────────────────────────────────────────────────────
defineWidget({
  id: "clipboard",
  order: 4,
  title: "Clipboard",
  column: "right",
  create(panel) {
    const list = h("div", { class: "clip-list" });
    panel.body.append(list);
    panel.tools.append(toolButton("trash", "Clear history", () => api.clip.clear()));
    const render = (items) => {
      if (!settings.get("clipboardHistory")) {
        list.replaceChildren(h("div", { class: "empty" }, "Clipboard history is off (Settings → Privacy)"));
        panel.setSub("");
        return;
      }
      panel.setSub(items.length ? `${items.length} ITEMS` : "");
      if (!items.length) { list.replaceChildren(h("div", { class: "empty" }, "Copied text appears here")); return; }
      list.replaceChildren(...items.map((item) => h("button", {
        class: "clip-item", type: "button", title: item.text.slice(0, 600),
        onclick: () => copyText(item.text, "Copied back to clipboard"),
        oncontextmenu: (e) => contextMenu(e, [
          { label: "Copy", icon: "copy", run: () => copyText(item.text) },
          { label: "Paste into terminal", icon: "terminal", run: () => emit("terminal-input", { text: item.text }) },
          { label: "Save as note", icon: "note", run: () => emit("new-note", { body: item.text }) },
          { separator: true },
          { label: "Remove", icon: "trash", run: () => api.clip.remove(item.text) }
        ])
      },
      h("span", { class: "t" }, item.text.replace(/\s+/g, " ").trim()),
      h("span", { class: "when" }, fmt.relativeTime(item.at)))));
    };
    let items = [];
    const off = api.clip.onChange((next) => { items = next; render(items); });
    api.clip.list().then((next) => { items = next; render(items); });
    const unwatch = settings.watch("clipboardHistory", () => render(items));
    return { destroy() { off(); unwatch(); } };
  }
});

// ── Quick links ─────────────────────────────────────────────────────────────
export async function openTarget(target) {
  if (/^(https?|mailto):/i.test(target)) return api.shell.openExternal(target);
  try {
    const st = await api.fs.stat(target);
    if (st.isDir) emit("open-path", { path: st.path });
    else await api.fs.open(st.path);
  } catch (e) {
    toast(cleanError(e), { level: "warn" });
  }
}

defineWidget({
  id: "links",
  order: 5,
  title: "Quick Links",
  column: "right",
  create(panel) {
    const list = h("div", { class: "link-list" });
    panel.body.append(list);
    const edit = async (existing) => {
      const name = await prompt({ title: existing ? "Edit link" : "Add link", message: "A name for the link", value: existing?.name || "" });
      if (!name) return;
      const target = await prompt({ title: existing ? "Edit link" : "Add link", message: "A web address (https://…) or a file / folder path", value: existing?.target || "" });
      if (!target) return;
      const links = (settings.get("quickLinks") || []).filter((l) => l !== existing);
      links.push({ name, target: /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target) ? `https://${target}` : target });
      settings.set({ quickLinks: links });
    };
    panel.tools.append(toolButton("plus", "Add link", () => edit(null)));
    const render = () => {
      const links = settings.get("quickLinks") || [];
      if (!links.length) {
        list.replaceChildren(h("div", { class: "empty" }, "Add websites, folders or files you open often"));
        return;
      }
      list.replaceChildren(...links.map((link) => {
        const web = /^(https?|mailto):/i.test(link.target);
        return h("button", {
          class: "link-item", type: "button", title: link.target,
          onclick: () => openTarget(link.target),
          oncontextmenu: (e) => contextMenu(e, [
            { label: "Open", icon: "external", run: () => openTarget(link.target) },
            { label: "Copy address", icon: "copy", run: () => copyText(link.target) },
            { label: "Edit…", icon: "edit", run: () => edit(link) },
            { separator: true },
            { label: "Remove", icon: "trash", run: () => settings.set({ quickLinks: links.filter((l) => l !== link) }) }
          ])
        }, icon(web ? "globe" : "folder"), h("span", { class: "t" }, link.name), h("span", { class: "u" }, web ? link.target.replace(/^https?:\/\/(www\.)?/, "") : fmt.basename(link.target)));
      }));
    };
    render();
    const unwatch = settings.watch("quickLinks", render);
    return { destroy: unwatch };
  }
});
