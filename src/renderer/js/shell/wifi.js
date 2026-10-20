// Wi-Fi panel shown from the top bar's network item: the current connection,
// nearby networks (signal, security, saved), connect / disconnect.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { popover, toast, cleanError } from "../core/ui.js";

const api = window.edex;

function bars(signal) {
  const level = signal == null ? 0 : signal >= 80 ? 4 : signal >= 60 ? 3 : signal >= 40 ? 2 : signal > 0 ? 1 : 0;
  return h("span", { class: "wifi-bars", title: signal == null ? "" : `${signal}%` },
    ...[1, 2, 3, 4].map((i) => h("i", { class: i <= level ? "on" : "" })));
}

export function openWifiPanel(anchor) {
  if (anchor.classList.contains("open")) return;
  anchor.classList.add("open");
  popover(anchor, (close) => {
    const head = h("div", { class: "wifi-head" });
    const list = h("div", { class: "wifi-list" }, h("div", { class: "wifi-empty" }, "Looking for networks…"));
    const refreshBtn = h("button", { class: "icon-btn sm", type: "button", title: "Refresh" }, icon("refresh"));
    const settingsBtn = h("button", { class: "btn sm", type: "button", onclick: () => { close(); api.shell.openSettings("ms-settings:network-wifi").catch(() => {}); } }, icon("gear"), "Wi-Fi settings");

    const act = async (fn, okMsg) => {
      try {
        await fn();
        if (okMsg) toast(okMsg, { level: "ok", timeout: 1800 });
        setTimeout(() => load(true), 1500);
      } catch (e) { toast(cleanError(e), { level: "warn", timeout: 5000 }); }
    };

    async function load(fresh = false) {
      let s;
      try { s = await api.wifi.status({ fresh }); } catch (e) { s = { error: cleanError(e) }; }
      if (s.error === "nowifi") {
        head.replaceChildren(h("div", { class: "wifi-empty" }, "No Wi-Fi adapter found (or the WLAN service is off)."));
        list.replaceChildren();
        return;
      }
      const iface = s.iface || {};
      head.replaceChildren(iface.connected
        ? h("div", { class: "wifi-current" },
          bars(iface.signal),
          h("div", { class: "wifi-cur-text" }, h("b", null, iface.ssid), h("span", null, [iface.band, iface.auth, iface.rate && `${iface.rate} Mb/s`].filter(Boolean).join(" · "))),
          h("button", { class: "btn sm", type: "button", onclick: () => act(() => api.wifi.disconnect(), "Disconnected") }, "Disconnect"))
        : h("div", { class: "wifi-empty" }, "Not connected to Wi-Fi"));
      if (s.error === "location") {
        list.replaceChildren(h("div", { class: "wifi-empty" },
          "Windows needs location access to list nearby networks. ",
          h("button", { class: "btn sm", type: "button", onclick: () => { close(); api.shell.openSettings("ms-settings:privacy-location").catch(() => {}); } }, "Location settings")));
        return;
      }
      const nets = (s.networks || []).filter((n) => !n.connected);
      if (!nets.length) {
        list.replaceChildren(h("div", { class: "wifi-empty" }, "No other networks in range"));
        return;
      }
      list.replaceChildren(...nets.map((n) => h("div", { class: "wifi-row" },
        bars(n.signal),
        h("span", { class: "wifi-ssid", title: n.auth || "" }, n.ssid),
        n.secure ? h("span", { class: "wifi-lock", title: n.auth || "Secured" }, icon("lock")) : h("span", { class: "wifi-open" }, "open"),
        n.saved
          ? h("button", { class: "btn sm", type: "button", onclick: () => act(() => api.wifi.connect(n.ssid), `Connecting to ${n.ssid}…`) }, "Connect")
          : h("button", { class: "btn sm", type: "button", title: "New networks need a password — opens Windows Wi-Fi settings", onclick: () => { close(); api.shell.openSettings("ms-settings:network-wifi").catch(() => {}); } }, "Join…"))));
    }

    refreshBtn.addEventListener("click", () => {
      list.replaceChildren(h("div", { class: "wifi-empty" }, "Refreshing…"));
      load(true);
    });
    load();
    return h("div", { class: "wifi-panel" },
      h("div", { class: "wifi-title" }, icon("wifi"), h("span", { class: "grow" }, "WI-FI"), refreshBtn),
      head, list,
      h("div", { class: "wifi-foot" }, settingsBtn));
  }, { className: "wifi-pop", onClose: () => anchor.classList.remove("open") });
}
