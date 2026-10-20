// Volume mixer (from the top bar): the output device, and a volume slider
// and mute button for every app currently using the speakers.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { popover, toast, cleanError } from "../core/ui.js";
import { exeIcons } from "./launcher.js";

const api = window.edex;

export function openMixer(anchor) {
  if (anchor.classList.contains("open")) return;
  anchor.classList.add("open");
  let timer = null;
  popover(anchor, (close) => {
    const devices = h("div", { class: "mix-devices" });
    const apps = h("div", { class: "mix-apps" }, h("div", { class: "empty" }, "Loading…"));
    const rows = new Map(); // pid -> { slider, label, muteBtn }
    let dragging = null;

    const loadDevices = async () => {
      let list = [];
      try { list = await api.mixer.devices(); } catch (e) { devices.replaceChildren(h("div", { class: "empty" }, cleanError(e))); return; }
      devices.replaceChildren(...list.map((d) => h("button", {
        class: `mix-device${d.default ? " active" : ""}`, type: "button", title: d.default ? "Current output" : "Switch output to this device",
        onclick: async () => {
          if (d.default) return;
          try { await api.mixer.setDefault(d.id); toast(`Output: ${d.name}`, { level: "ok", timeout: 1600 }); } catch (e) { toast(cleanError(e), { level: "warn" }); }
          loadDevices();
          loadApps();
        }
      }, icon(d.default ? "volume" : "audio"), h("span", { class: "ellipsis" }, d.name || "Unknown device"))));
    };

    const setRow = (r, s) => {
      if (dragging !== s.pid) r.slider.value = String(s.level);
      setText(r.label, s.muted ? "MUTE" : `${s.level}%`);
      r.muteBtn.replaceChildren(icon(s.muted ? "mute" : "volume"));
      r.el.classList.toggle("muted", s.muted);
      r.el.classList.toggle("idle", !s.active);
      r.state = s;
    };

    const loadApps = async () => {
      let list = [];
      try { list = await api.mixer.list(); } catch (e) { apps.replaceChildren(h("div", { class: "empty" }, cleanError(e))); return; }
      list.sort((a, b) => (a.pid === -1) - (b.pid === -1) || b.active - a.active || a.name.localeCompare(b.name));
      if (!list.length) { apps.replaceChildren(h("div", { class: "empty" }, "No apps are using audio")); rows.clear(); return; }
      const seen = new Set();
      const order = [];
      for (const s of list) {
        seen.add(s.pid);
        let r = rows.get(s.pid);
        if (!r) {
          const iconBox = h("span", { class: "mix-icon" }, icon(s.pid === -1 ? "bell" : s.own ? "audio" : "app"));
          const slider = h("input", { class: "mix-slider", type: "range", min: 0, max: 100, step: 1, "aria-label": `${s.name} volume` });
          const label = h("span", { class: "mix-level" });
          const muteBtn = h("button", { class: "icon-btn sm", type: "button", title: "Mute / unmute" });
          const el = h("div", { class: "mix-row" }, iconBox, h("span", { class: "mix-name ellipsis", title: s.exe || s.name }, s.name), muteBtn, slider, label);
          r = { el, slider, label, muteBtn, state: s };
          slider.addEventListener("input", () => {
            dragging = s.pid;
            setText(label, `${slider.value}%`);
            api.mixer.set(s.pid, { level: Number(slider.value) }).catch(() => {});
          });
          slider.addEventListener("change", () => { dragging = null; });
          muteBtn.addEventListener("click", async () => {
            try { const res = await api.mixer.set(s.pid, { muted: !r.state.muted }); const me = res.find((x) => x.pid === s.pid); if (me) setRow(r, me); } catch (e) { toast(cleanError(e), { level: "warn" }); }
          });
          if (s.exe) exeIcons([s.exe]).then((m) => { if (m[s.exe]) iconBox.replaceChildren(h("img", { src: m[s.exe], alt: "" })); });
          rows.set(s.pid, r);
        }
        setRow(r, s);
        order.push(r.el);
      }
      for (const pid of [...rows.keys()]) if (!seen.has(pid)) rows.delete(pid);
      apps.replaceChildren(...order);
    };

    loadDevices();
    loadApps();
    timer = setInterval(loadApps, 2500);
    return h("div", { class: "mix-panel" },
      h("div", { class: "mix-title" }, icon("mixer"), h("span", { class: "grow" }, "VOLUME MIXER")),
      h("div", { class: "mix-section" }, "OUTPUT"), devices,
      h("div", { class: "mix-section" }, "APPS"), apps,
      h("div", { class: "mix-foot" },
        h("button", { class: "btn sm", type: "button", onclick: () => { close(); api.shell.openSettings("ms-settings:sound").catch(() => {}); } }, icon("gear"), "Sound settings")));
  }, { className: "mix-pop", onClose: () => { anchor.classList.remove("open"); clearInterval(timer); } });
}
