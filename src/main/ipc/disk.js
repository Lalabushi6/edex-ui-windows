// Disk usage map: the secondary native helper walks a drive or folder on a
// background thread; the renderer polls progress and then asks for the
// sizes of one folder at a time (a few levels deep) as you drill down.
"use strict";

const { handle, asString } = require("./util");
const paths = require("../lib/paths");

// The scan's results live in the helper, so it's kept running (not stopped
// when idle) while they're there. Closing the disk tab keeps them for ten
// minutes (reopening it shows them again, and a running scan carries on),
// then frees them.
const RELEASE_AFTER_MS = 10 * 60 * 1000;

function registerDisk({ aux }) {
  let releaseTimer = null;
  const busy = () => clearTimeout(releaseTimer);
  const clear = async () => {
    busy();
    aux.hold?.("disk", false);
    if (!aux.proc) return true; // nothing held if the helper isn't running
    return aux.call("diskClear", {}, 8000);
  };

  handle("disk:scan", async (_e, target) => {
    busy();
    const p = await paths.forRead(asString(target, "path"));
    if (paths.isUncPath(p)) throw new Error("Network folders can't be scanned");
    aux.hold?.("disk", true);
    return aux.call("diskScan", { path: p }, 8000);
  });
  handle("disk:progress", () => { busy(); return aux.proc || aux.holds?.has("disk") ? aux.call("diskProgress", {}, 5000) : null; });
  handle("disk:node", (_e, target, depth = 3) => { busy(); return aux.call("diskNode", { path: asString(target, "path"), depth: Math.max(1, Math.min(4, Number(depth) || 3)) }, 15000); });
  handle("disk:cancel", () => aux.call("diskCancel", {}, 8000));
  handle("disk:clear", () => clear());
  // The disk tab closed.
  handle("disk:release", () => {
    busy();
    releaseTimer = setTimeout(() => {
      // A scan still running when the time is up gets its own ten minutes.
      aux.call("diskProgress", {}, 5000).then((p) => (p && !p.done && p.running ? handleLater() : clear())).catch(() => clear());
    }, RELEASE_AFTER_MS);
    const handleLater = () => { releaseTimer = setTimeout(() => clear().catch(() => {}), RELEASE_AFTER_MS); };
    return true;
  });
}

module.exports = { registerDisk };
