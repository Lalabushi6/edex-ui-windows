// Process manager tab: sortable, filterable live process table.
import { h, setText, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { poll } from "../core/poll.js";
import * as fmt from "../core/format.js";
import { emit } from "../core/bus.js";
import { toast, contextMenu, copyText, cleanError } from "../core/ui.js";

const api = window.edex;
const COLUMNS = [
  { key: "name", label: "Name", width: "auto" },
  { key: "pid", label: "PID", width: "6rem", num: true },
  { key: "cpu", label: "CPU", width: "7rem", num: true },
  { key: "mem", label: "Memory", width: "8rem", num: true },
  { key: "threads", label: "Threads", width: "6rem", num: true },
  { key: "path", label: "Path", width: "34%" }
];

export class ProcessesTab {
  constructor(ws) {
    this.ws = ws;
    this.type = "processes";
    this.label = "Processes";
    this.sort = "cpu";
    this.desc = true;
    this.filter = "";
    this.selectedPid = null;
    this.list = [];
    this.el = h("div", { class: "pane" });
  }

  serialize() {
    return { type: "processes" };
  }

  async mount() {
    this.filterInput = h("input", { class: "input", spellcheck: false, placeholder: "Filter by name, PID or path" });
    this.filterInput.addEventListener("input", debounce(() => { this.filter = this.filterInput.value.trim().toLowerCase(); this.render(); }, 100));
    this.stats = h("span", { class: "pm-stats" });
    this.endBtn = h("button", { class: "btn danger", type: "button", disabled: true, onclick: () => this.end() }, icon("close"), "End process");
    const toolbar = h("div", { class: "pm-toolbar" }, this.filterInput, this.endBtn,
      h("button", { class: "btn", type: "button", onclick: () => api.shell.taskManager().catch((e) => toast(cleanError(e), { level: "warn" })) }, icon("external"), "Task Manager"),
      this.stats);
    this.thead = h("thead");
    this.tbody = h("tbody");
    const colgroup = h("colgroup", null, ...COLUMNS.map((c) => h("col", { style: { width: c.width } })));
    const table = h("table", { class: "pm-table" }, colgroup, this.thead, this.tbody);
    this.el.append(h("div", { class: "pm" }, toolbar, h("div", { class: "pm-table-wrap" }, table)));
    this.renderHead();
    this.tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      this.selectedPid = Number(tr.dataset.pid);
      this.paintSelection();
    });
    this.tbody.addEventListener("contextmenu", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      this.selectedPid = Number(tr.dataset.pid);
      this.paintSelection();
      const p = this.list.find((x) => x.pid === this.selectedPid);
      if (!p) return;
      contextMenu(e, [
        { label: `End ${p.name}`, icon: "close", danger: true, run: () => this.end() },
        p.path && { label: "Open file location", icon: "folder", run: () => emit("open-path", { path: fmt.dirname(p.path), select: p.path, newTab: true }) },
        { label: "Copy name", icon: "copy", run: () => copyText(p.name) },
        p.path && { label: "Copy path", icon: "link", run: () => copyText(p.path) },
        { label: "Search the web", icon: "globe", run: () => api.shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(`${p.name} process`)}`) }
      ]);
    });
    this.poller = poll(() => this.refresh(), 3000, { immediate: true });
  }

  renderHead() {
    this.thead.replaceChildren(h("tr", null, ...COLUMNS.map((c) => h("th", {
      class: c.num ? "num" : "",
      onclick: () => {
        if (this.sort === c.key) this.desc = !this.desc;
        else { this.sort = c.key; this.desc = c.num; }
        this.renderHead();
        this.render();
      }
    }, c.label, this.sort === c.key ? (this.desc ? " ▼" : " ▲") : ""))));
  }

  async refresh() {
    if (!this.el.classList.contains("active")) return;
    const data = await api.sys.processes({ paths: true });
    this.list = data.list.filter((p) => p.pid !== 0);
    setText(this.stats, `${this.list.length} processes${data.threads ? ` · ${data.threads.toLocaleString()} threads` : ""}`);
    this.render();
  }

  // Rows are keyed by PID and reused between refreshes: only changed text is
  // written and existing rows are moved, never rebuilt.
  row(p) {
    let r = this.rows.get(p.pid);
    if (!r) {
      const cells = [h("td"), h("td", { class: "num" }, String(p.pid)), h("td", { class: "num pm-heat" }), h("td", { class: "num" }), h("td", { class: "num" }), h("td", { class: "muted" })];
      r = { tr: h("tr", { dataset: { pid: p.pid } }, ...cells), cells, heat: -1 };
      this.rows.set(p.pid, r);
    }
    const [name, , cpu, mem, threads, path] = r.cells;
    setText(name, p.name);
    setText(cpu, `${p.cpu.toFixed(1)}%`);
    const heat = Math.min(100, Math.round(p.cpu));
    if (heat !== r.heat) { r.heat = heat; cpu.style.setProperty("--w", `${heat}%`); }
    setText(mem, p.memBytes ? fmt.bytes(p.memBytes) : `${p.mem.toFixed(1)}%`);
    setText(threads, p.threads ?? "");
    setText(path, p.path || "");
    if (r.tr.title !== (p.path || "")) r.tr.title = p.path || "";
    r.tr.classList.toggle("sel", p.pid === this.selectedPid);
    return r.tr;
  }

  render() {
    const f = this.filter;
    const rows = this.list.filter((p) => !f || p.name.toLowerCase().includes(f) || String(p.pid) === f || (p.path || "").toLowerCase().includes(f));
    const dir = this.desc ? -1 : 1;
    rows.sort((a, b) => {
      const va = a[this.sort] ?? "", vb = b[this.sort] ?? "";
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
    });
    this.rows ||= new Map();
    const shown = rows.slice(0, 400);
    const live = new Set(shown.map((p) => p.pid));
    for (const pid of this.rows.keys()) if (!live.has(pid)) this.rows.delete(pid);
    const trs = shown.map((p) => this.row(p));
    const kids = this.tbody.children;
    const same = kids.length === trs.length && trs.every((tr, i) => kids[i] === tr);
    if (!same) this.tbody.replaceChildren(...trs);
    this.endBtn.disabled = !this.list.some((p) => p.pid === this.selectedPid);
  }

  paintSelection() {
    for (const tr of this.tbody.children) tr.classList.toggle("sel", Number(tr.dataset.pid) === this.selectedPid);
    this.endBtn.disabled = !this.selectedPid;
  }

  async select(pid) {
    this.selectedPid = pid;
    this.filterInput.value = "";
    this.filter = "";
    if (!this.list.length) await this.refresh().catch(() => {});
    this.render();
    requestAnimationFrame(() => this.tbody.querySelector(`tr[data-pid="${pid}"]`)?.scrollIntoView({ block: "center" }));
  }

  sortBy(key) {
    this.sort = key;
    this.desc = true;
    this.renderHead();
    this.render();
  }

  async end() {
    const p = this.list.find((x) => x.pid === this.selectedPid);
    if (!p) return;
    try {
      if (await api.sys.kill(p.pid)) {
        toast(`Ended ${p.name}`, { level: "ok" });
        this.list = this.list.filter((x) => x.pid !== p.pid);
        this.render();
      }
    } catch (e) {
      toast(cleanError(e), { level: "warn" });
    }
  }

  activate() {
    this.poller?.kick();
    requestAnimationFrame(() => this.filterInput?.focus());
  }

  focus() {
    this.filterInput?.focus();
  }

  dispose() {
    this.poller?.stop();
  }
}
