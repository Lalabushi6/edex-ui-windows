// Bluetooth panel: radio on/off and paired devices with their connection
// state. Windows has no public API to connect a paired device, so the panel
// links to Bluetooth settings for that.
"use strict";

const { handle } = require("./util");
const { cached } = require("../lib/cache");

function registerBluetooth({ aux }) {
  const status = cached(() => aux.call("bluetooth", {}, 25000), 10000);
  handle("bt:status", (_e, opts = {}) => {
    if (opts.fresh) status.invalidate();
    return status();
  });
  handle("bt:radio", async (_e, on) => {
    const s = await aux.call("bluetoothRadio", { on: !!on }, 20000);
    status.invalidate();
    return s;
  });
}

module.exports = { registerBluetooth };
