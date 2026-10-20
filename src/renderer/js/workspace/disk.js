// Disk usage tab: scans a drive or folder (in the native helper, on a
// background thread), then shows a sunburst of what fills it — click a ring
// to drill in, the centre to go back up — beside a list of the largest items.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { accent } from "../core/theme.js";
import * as fmt from "../core/format.js";
import { emit } from "../core/bus.js";
import { toast, contextMenu, prompt, cleanError } from "../core/ui.js";

const api = window.edex;
const join = (dir, name) => `${dir.replace(/\\+$/, "")}\\${name}`;

export class DiskTab {
  constructor(ws, { cwd } = {}) {
    this.ws = ws;
    this.type = "disk";
    this.label = "Disk usage";
    this.el = h("div", { class: "pane" });
    this.target = cwd || null;
    this.root = null;      // scanned root path
    this.path = null;      // node being shown
    this.node = null;
    this.segments = [];
    this.hover = null;
  }

  serialize() {
    return { type: "disk" };
  }

  async mount() {
    this.drives = h("div", { class: "du-drives" });
    this.crumbs = h("div", { class: "du-crumbs" });
    this.status = h("div", { class: "du-status muted" });
    const tool = (name, title, onclick) => h("button", { class: "icon-btn", type: "button", title, onclick }, icon(name));
    this.upBtn = tool("up", "Up one level", () => this.up());
    const bar = h("div", { class: "du-bar" }, this.drives,
      h("button", { class: "btn sm", type: "button", onclick: () => this.pickFolder() }, icon("folder"), "Folder…"),
      h("span", { class: "grow" }), this.upBtn,
      tool("refresh", "Scan again", () => this.root && this.scan(this.root)));
    this.canvas = h("canvas", { class: "du-canvas" });
    this.info = h("div", { class: "du-info" });
    this.list = h("div", { class: "du-list" });
    this.progress = h("div", { class: "du-progress", hidden: true });
    this.intro = h("div", { class: "du-intro" }, icon("disk"), h("div", null, "Pick a drive or folder to see what's taking up space."));
    this.chart = h("div", { class: "du-chart" }, this.canvas, this.info);
    this.body = h("div", { class: "du-body", hidden: true }, this.chart, h("div", { class: "du-side" }, this.crumbs, this.list));
    this.el.append(h("div", { class: "du" }, bar, this.intro, this.progress, this.body, this.status));

    this.canvas.addEventListener("mousemove", (e) => this.onMove(e));
    this.canvas.addEventListener("mouseleave", () => { this.hover = null; this.draw(); this.showInfo(); });
    this.canvas.addEventListener("click", (e) => this.onClick(e));
    this.canvas.addEventListener("contextmenu", (e) => { const s = this.hit(e); if (s?.path) this.itemMenu(e, s.path, s.node.dir); });
    this.resize = new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.draw());
    });
    this.resize.observe(this.chart);

    const drives = await api.sys.drives().catch(() => []);
    this.drives.replaceChildren(...drives.map((d) => h("button", {
      class: "btn sm du-drive", type: "button", title: `${fmt.bytes(d.size - d.used)} free of ${fmt.bytes(d.size)}`,
      onclick: () => this.scan(`${d.mount}\\`)
    }, icon("drive"), d.mount, h("span", { class: "muted" }, ` ${Math.round(d.use)}%`))));
    // Resume a scan that finished while the tab was closed, else start one
    // that was asked for (Analyze from the explorer).
    const p = await api.disk.progress().catch(() => null);
    if (this.target) this.scan(this.target);
    else if (p?.done && p.root) { this.root = p.root; this.open(p.root); }
  }

  async pickFolder() {
    const path = await prompt({ title: "Analyse a folder", message: "Folder path:", value: this.path || "C:\\Users" });
    if (path) this.scan(path);
  }

  async scan(path) {
    clearTimeout(this.pollTimer);
    this.intro.hidden = true;
    this.body.hidden = true;
    this.progress.hidden = false;
    this.progress.replaceChildren(h("div", { class: "empty" }, "Starting…"));
    try { await api.disk.scan(path); } catch (e) { this.progress.replaceChildren(h("div", { class: "empty" }, cleanError(e))); return; }
    const cancel = h("button", { class: "btn sm", type: "button", onclick: () => api.disk.cancel().catch(() => {}) }, "Cancel");
    const head = h("div", { class: "du-scan-head" });
    const cur = h("div", { class: "du-scan-cur muted ellipsis" });
    this.progress.replaceChildren(h("div", { class: "du-scan" }, icon("disk"), head, cur, cancel));
    const tick = async () => {
      let p;
      try { p = await api.disk.progress(); } catch (_) { this.pollTimer = setTimeout(tick, 800); return; }
      setText(head, `SCANNING ${p.root} · ${p.files.toLocaleString()} files · ${fmt.bytes(p.bytes)} · ${p.seconds}s`);
      setText(cur, p.current || "");
      if (p.running) { this.pollTimer = setTimeout(tick, 400); return; }
      this.progress.hidden = true;
      if (!p.done) { this.intro.hidden = false; setText(this.status, "Scan cancelled"); return; }
      this.root = p.root;
      setText(this.status, `${p.files.toLocaleString()} files in ${p.dirs.toLocaleString()} folders · ${fmt.bytes(p.bytes)} · ${p.seconds}s${p.denied ? ` · ${p.denied} folders not readable` : ""}`);
      this.open(p.root);
    };
    tick();
  }

  async open(path) {
    let node;
    try { node = await api.disk.node(path, 3); } catch (e) { toast(cleanError(e), { level: "warn" }); return; }
    if (!node) { toast("That folder isn't in the scan", { level: "warn" }); return; }
    this.path = path;
    this.node = node;
    this.hover = null;
    this.intro.hidden = true;
    this.body.hidden = false;
    this.upBtn.disabled = fmt.pathsEqual(path, this.root);
    this.label = `Disk: ${fmt.basename(path.replace(/\\+$/, "")) || path}`;
    this.ws.updateTab(this);
    this.renderCrumbs();
    this.renderList();
    this.draw();
    this.showInfo();
  }

  up() {
    if (!this.path || fmt.pathsEqual(this.path, this.root)) return;
    const parent = fmt.dirname(this.path.replace(/\\+$/, ""));
    this.open(parent.length < this.root.length ? this.root : parent);
  }

  renderCrumbs() {
    const parts = [];
    let p = this.path.replace(/\\+$/, "");
    const rootTrim = this.root.replace(/\\+$/, "");
    while (p.length >= rootTrim.length) {
      parts.unshift(p);
      if (fmt.pathsEqual(p, rootTrim)) break;
      const parent = fmt.dirname(p);
      if (parent === p) break;
      p = parent;
    }
    this.crumbs.replaceChildren(...parts.map((full, i) => h("button", {
      class: `du-crumb${i === parts.length - 1 ? " current" : ""}`, type: "button",
      onclick: () => this.open(i === 0 ? this.root : full)
    }, fmt.basename(full) || full)));
  }

  renderList() {
    const total = this.node.size || 1;
    const items = (this.node.children || []).filter((c) => !c.rest);
    this.list.replaceChildren(...items.map((c) => {
      const full = join(this.path, c.name);
      return h("button", {
        class: `du-row${c.dir ? " dir" : ""}`, type: "button", title: full,
        onclick: () => (c.dir ? this.open(full) : emit("open-path", { path: this.path, select: full })),
        oncontextmenu: (e) => this.itemMenu(e, full, c.dir)
      },
      icon(c.dir ? "folder" : "file"),
      h("span", { class: "du-name ellipsis" }, c.name),
      h("span", { class: "du-size" }, fmt.bytes(c.size)),
      h("span", { class: "du-pct" }, h("i", { style: { width: `${(c.size / total) * 100}%` } })));
    }));
  }

  itemMenu(e, full, isDir) {
    contextMenu(e, [
      isDir && { label: "Drill in", icon: "forward", run: () => this.open(full) },
      { label: isDir ? "Open in explorer" : "Show in folder", icon: "folder", run: () => emit("open-path", isDir ? { path: full } : { path: fmt.dirname(full), select: full }) },
      isDir && { label: "Terminal here", icon: "terminal", run: () => emit("open-terminal", { cwd: full }) },
      { label: "Copy path", icon: "copy", run: () => api.clip.copy(full) }
    ]);
  }

  // ── Sunburst ─────────────────────────────────────────────────────────────
  draw() {
    if (!this.node || this.body.hidden) return;
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const r = this.chart.getBoundingClientRect();
    const size = Math.max(120, Math.min(r.width, r.height));
    c.style.width = c.style.height = `${size}px`;
    c.width = c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2;
    const R = size / 2 - 6;
    const core = R * 0.26;
    const ring = (R - core) / 3;
    this.geom = { cx, cy, core };
    this.segments = [];
    // Segments are outlined in the background colour so neighbours stay
    // distinct on light accents too.
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#000";
    ctx.strokeStyle = bg;
    ctx.lineWidth = 1.5;
    const walk = (node, path, depth, a0, a1) => {
      const kids = node.children || [];
      const total = node.size || 1;
      let a = a0;
      kids.forEach((k, i) => {
        const span = ((a1 - a0) * k.size) / total;
        const r0 = core + depth * ring, r1 = r0 + ring - 1.5;
        const full = k.rest ? null : join(path, k.name);
        if (span > 0.004) {
          const seg = { r0, r1, a0: a, a1: a + span, node: k, path: full, depth };
          this.segments.push(seg);
          const on = this.hover === seg || (this.hover?.path && full && this.hover.path.startsWith(`${full}\\`));
          const base = k.rest ? 0.06 : k.dir ? (0.62 - depth * 0.14) * (i % 2 ? 0.72 : 1) : 0.18;
          ctx.beginPath();
          ctx.arc(cx, cy, r1, a, a + span);
          ctx.arc(cx, cy, r0, a + span, a, true);
          ctx.closePath();
          ctx.fillStyle = accent(on ? Math.min(1, base + 0.35) : base);
          ctx.fill();
          ctx.stroke();
          if (k.dir && depth < 2 && k.children) walk(k, full, depth + 1, a, a + span);
        }
        a += span;
      });
    };
    walk(this.node, this.path, 0, -Math.PI / 2, Math.PI * 1.5);
    ctx.beginPath();
    ctx.arc(cx, cy, core - 3, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = accent(0.6);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = accent(1);
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.max(11, core * 0.22)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText(fmt.bytes(this.node.size), cx, cy + 4);
    ctx.font = `${Math.max(9, core * 0.13)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillStyle = accent(0.7);
    const name = fmt.basename(this.path.replace(/\\+$/, "")) || this.path;
    ctx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, cx, cy - core * 0.22);
    if (!fmt.pathsEqual(this.path, this.root)) ctx.fillText("▲ up", cx, cy + core * 0.42);
  }

  hit(e) {
    if (!this.geom) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left - this.geom.cx, y = e.clientY - r.top - this.geom.cy;
    const d = Math.hypot(x, y);
    if (d < this.geom.core) return { center: true };
    let a = Math.atan2(y, x);
    if (a < -Math.PI / 2) a += Math.PI * 2;
    return this.segments.find((s) => d >= s.r0 && d <= s.r1 && a >= s.a0 && a <= s.a1) || null;
  }

  onMove(e) {
    const s = this.hit(e);
    const seg = s && !s.center ? s : null;
    this.canvas.style.cursor = s?.center ? (fmt.pathsEqual(this.path, this.root) ? "default" : "pointer") : seg?.node.dir ? "pointer" : "default";
    if (seg === this.hover) return;
    this.hover = seg;
    this.draw();
    this.showInfo(seg);
  }

  onClick(e) {
    const s = this.hit(e);
    if (!s) return;
    if (s.center) this.up();
    else if (s.node.dir && s.path) this.open(s.path);
    else if (s.path) emit("open-path", { path: fmt.dirname(s.path), select: s.path });
  }

  showInfo(seg = null) {
    const n = seg?.node || this.node;
    if (!n) return;
    const pct = seg ? ((n.size / (this.node.size || 1)) * 100).toFixed(1) : null;
    this.info.replaceChildren(
      h("b", { class: "ellipsis" }, seg ? (n.rest ? "Smaller items" : n.name) : this.path),
      h("span", null, `${fmt.bytes(n.size)}${pct ? ` · ${pct}%` : ""}${n.files ? ` · ${n.files.toLocaleString()} files` : ""}`));
  }

  activate() { requestAnimationFrame(() => this.draw()); }
  deactivate() {}
  focus() {}
  dispose() {
    clearTimeout(this.pollTimer);
    cancelAnimationFrame(this.resizeFrame);
    this.resize?.disconnect();
  }
}
