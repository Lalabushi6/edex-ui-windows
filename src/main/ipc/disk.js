// Disk usage map: the secondary native helper walks a drive or folder on a
// background thread; the renderer polls progress and then asks for the
// sizes of one folder at a time (a few levels deep) as you drill down.
"use strict";

const { handle, asString } = require("./util");
const paths = require("../lib/paths");

function registerDisk({ aux }) {
  handle("disk:scan", async (_e, target) => {
    const p = await paths.forRead(asString(target, "path"));
    if (paths.isUncPath(p)) throw new Error("Network folders can't be scanned");
    return aux.call("diskScan", { path: p }, 8000);
  });
  handle("disk:progress", () => aux.call("diskProgress", {}, 5000));
  handle("disk:node", (_e, target, depth = 3) => aux.call("diskNode", { path: asString(target, "path"), depth: Math.max(1, Math.min(4, Number(depth) || 3)) }, 15000));
  handle("disk:cancel", () => aux.call("diskCancel", {}, 8000));
  handle("disk:clear", () => aux.call("diskClear", {}, 8000));
}

module.exports = { registerDisk };
