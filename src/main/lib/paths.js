// Path policy for every filesystem operation the renderer can request.
//
//  - Paths are resolved through symlinks/junctions before any check, so an
//    alias cannot redirect an operation somewhere the policy forbids.
//  - Credential stores are never readable or listable.
//  - Writes are refused in OS-owned locations and on network (UNC) paths.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const canonicalHomePromise = fs.promises.realpath(HOME).catch(() => HOME);

function normalizeKey(p) {
  const n = path.normalize(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

function isPathInside(parentPath, childPath) {
  const parent = normalizeKey(parentPath);
  const child = normalizeKey(childPath);
  if (!parent || !child) return false;
  return child === parent || child.startsWith(parent + path.sep);
}

function isUncPath(p) {
  return /^\\\\/.test(p) || /^\/\//.test(p);
}

function isDriveRoot(p) {
  const resolved = path.resolve(p);
  return normalizeKey(resolved) === normalizeKey(path.parse(resolved).root);
}

// Credential stores and token files (directories or single files).
const SENSITIVE_PATHS = [
  ".ssh", ".aws", ".gnupg", ".azure", ".kube", ".docker", ".password-store",
  ".git-credentials", ".netrc", "_netrc", ".npmrc", ".pypirc",
  path.join(".config", "gcloud"), path.join(".config", "gh"),
  path.join("AppData", "Local", "Microsoft", "Credentials"),
  path.join("AppData", "Roaming", "Microsoft", "Credentials"),
  path.join("AppData", "Local", "Microsoft", "Vault"),
  path.join("AppData", "Roaming", "Microsoft", "Protect"),
  path.join("AppData", "Roaming", "Microsoft", "Crypto"),
  path.join("AppData", "Roaming", "GitHub CLI"),
  path.join("AppData", "Local", "Google", "Chrome", "User Data"),
  path.join("AppData", "Local", "Microsoft", "Edge", "User Data"),
  path.join("AppData", "Local", "BraveSoftware", "Brave-Browser", "User Data"),
  path.join("AppData", "Local", "Vivaldi", "User Data"),
  path.join("AppData", "Roaming", "Opera Software"),
  path.join("AppData", "Roaming", "Mozilla", "Firefox", "Profiles")
].map((rel) => path.join(HOME, rel));

// Files the app itself keeps secret (e.g. the encrypted AI key), added at
// startup once userData is known.
function addSensitive(p) {
  if (typeof p === "string" && p) SENSITIVE_PATHS.push(p);
}

const systemDrive = `${process.env.SystemDrive || "C:"}\\`;
const PROTECTED_WRITE_ROOTS = [
  process.env.WINDIR || path.join(systemDrive, "Windows"),
  process.env.ProgramFiles || path.join(systemDrive, "Program Files"),
  process.env["ProgramFiles(x86)"] || path.join(systemDrive, "Program Files (x86)"),
  process.env.ProgramData || path.join(systemDrive, "ProgramData"),
  path.join(systemDrive, "$Recycle.Bin"),
  path.join(systemDrive, "System Volume Information"),
  path.join(systemDrive, "Recovery")
];

function isSensitive(p) {
  return SENSITIVE_PATHS.some((blocked) => isPathInside(blocked, p));
}

// Resolves `target` to its canonical form. realpath() throws on a missing
// leaf, so the deepest existing ancestor is resolved and the tail re-joined.
async function canonicalize(target) {
  if (typeof target !== "string" || !target.trim()) throw new Error("A path is required");
  let input = target.trim();
  if (/^[A-Za-z]:$/.test(input)) input += "\\";
  const absolute = path.resolve(input);
  if (/[<>"|?*\u0000-\u001F]/.test(absolute.slice(path.parse(absolute).root.length))) {
    throw new Error("Path contains invalid characters");
  }

  let probe = absolute;
  for (;;) {
    try {
      const real = await fs.promises.realpath(probe);
      const tail = path.relative(probe, absolute);
      return tail ? path.join(real, tail) : real;
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
      const parent = path.dirname(probe);
      if (parent === probe) throw new Error("Path has no existing ancestor");
      probe = parent;
    }
  }
}

async function forRead(target) {
  const p = await canonicalize(target);
  if (isSensitive(p)) throw new Error("Access denied: protected credential directory");
  return p;
}

async function forWrite(target, { allowRoot = false } = {}) {
  const p = await canonicalize(target);
  if (isUncPath(p)) throw new Error("Network paths cannot be modified");
  if (isSensitive(p)) throw new Error("Access denied: protected credential directory");
  if (PROTECTED_WRITE_ROOTS.some((root) => root && isPathInside(root, p))) {
    throw new Error("Access denied: system folders are read-only here");
  }
  if (!allowRoot && isDriveRoot(p)) throw new Error("Refusing to modify a drive root");
  return p;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function validateEntryName(name) {
  const next = String(name ?? "").trim();
  if (!next) throw new Error("Name is required");
  if (next === "." || next === "..") throw new Error("Invalid name");
  if (next.length > 255) throw new Error("Name is too long");
  if (/[\\/]/.test(next)) throw new Error("Name cannot contain path separators");
  if (/[<>:"|?*\u0000-\u001F]/.test(next)) throw new Error("Name contains characters Windows does not allow");
  if (/[. ]$/.test(next)) throw new Error("Name cannot end with a space or period");
  if (WINDOWS_RESERVED.test(next)) throw new Error("That name is reserved by Windows");
  return next;
}

// Picks "name - Copy.ext", "name - Copy (2).ext", ... that does not exist yet.
async function uniqueDestination(dir, baseName, { copySuffix = false } = {}) {
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  const exists = (p) => fs.promises.access(p).then(() => true, () => false);
  const first = path.join(dir, baseName);
  if (!copySuffix && !(await exists(first))) return first;
  for (let i = 1; i < 1000; i++) {
    const label = copySuffix ? (i === 1 ? " - Copy" : ` - Copy (${i})`) : ` (${i + 1})`;
    const candidate = path.join(dir, `${stem}${label}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Could not find a free name");
}

module.exports = {
  HOME,
  canonicalHomePromise,
  isPathInside,
  isUncPath,
  isDriveRoot,
  isSensitive,
  addSensitive,
  canonicalize,
  forRead,
  forWrite,
  validateEntryName,
  uniqueDestination
};
