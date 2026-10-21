// Portable mode: the portable build (eDEX-UI-Portable.exe) keeps everything
// it remembers in an "eDEX-UI Data" folder beside the .exe, so settings,
// notes, tasks, themes and sign-ins travel with a USB drive instead of
// staying in %APPDATA% on whichever PC it last ran on.
//
// electron-builder's portable launcher unpacks the app to a temporary folder
// and sets PORTABLE_EXECUTABLE_DIR / PORTABLE_EXECUTABLE_FILE to where the
// .exe really is. Development runs can try it with EDEX_PORTABLE_DIR.
"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DATA_DIR = "eDEX-UI Data";
// Files worth carrying over from this PC's profile on a first portable run.
// Chromium state, caches and the compiled helper are rebuilt on their own;
// encrypted keys only open on the Windows account that saved them.
const CARRY = ["settings.json", "notes.json", "tasks.json", "arrangements.json", "screentime.json", "themes", "keyboards"];

let state = { portable: false, dir: null, exe: null, fresh: false, reason: null };

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

// Must run before anything reads userData (the single-instance lock does).
function apply() {
  const devDir = !app.isPackaged ? process.env.EDEX_PORTABLE_DIR : "";
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || devDir || "";
  if (!exeDir) return state;
  const dir = path.join(exeDir, DATA_DIR);
  if (!writable(dir)) {
    // A read-only drive or folder: fall back to this PC's profile.
    state = { ...state, reason: "The drive is read-only, so settings are kept on this PC" };
    return state;
  }
  const fresh = !fs.existsSync(path.join(dir, "settings.json"));
  app.setPath("userData", dir);
  // Flash drives are slow and wear with writes: keep Chromium's disk cache
  // (web pages in browser tabs, GPU shaders) small.
  app.commandLine.appendSwitch("disk-cache-size", String(64 * 1024 * 1024));
  state = { portable: true, dir, exe: process.env.PORTABLE_EXECUTABLE_FILE || null, fresh, reason: null };
  return state;
}

// %APPDATA%\eDEX-UI — where the installed version keeps its data.
function pcProfileDir() {
  return path.join(app.getPath("appData"), app.getName() || "eDEX-UI");
}

function hasPcProfile() {
  const dir = pcProfileDir();
  return state.portable && path.resolve(dir) !== path.resolve(state.dir) && fs.existsSync(path.join(dir, "settings.json"));
}

// Copies the installed version's settings and personal files to the drive.
function copyFromPc() {
  const from = pcProfileDir();
  let copied = 0;
  for (const name of CARRY) {
    const src = path.join(from, name);
    if (!fs.existsSync(src)) continue;
    try {
      fs.cpSync(src, path.join(state.dir, name), { recursive: true, force: true, errorOnExist: false });
      copied++;
    } catch (_) {}
  }
  return copied;
}

module.exports = { apply, state: () => ({ ...state }), hasPcProfile, copyFromPc, DATA_DIR };
