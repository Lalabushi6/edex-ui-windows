"use strict";

const { ipcMain } = require("electron");
const { APP_ORIGIN } = require("../lib/protocol");

// Only frames served from the bundled renderer may call into the main process.
function isTrustedSender(event) {
  const url = event.senderFrame?.url || "";
  return url === APP_ORIGIN || url.startsWith(`${APP_ORIGIN}/`);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error("Untrusted sender");
    return fn(event, ...args);
  });
}

function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) return;
    fn(event, ...args);
  });
}

function asString(value, name, max = 4096) {
  if (typeof value !== "string" || !value || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
}

function asStringList(value, name, maxItems = 500) {
  if (!Array.isArray(value) || !value.length || value.length > maxItems) throw new Error(`Invalid ${name}`);
  return value.map((v) => asString(v, name));
}

module.exports = { handle, on, asString, asStringList };
