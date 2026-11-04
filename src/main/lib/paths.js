// Path policy for every filesystem operation the renderer can request.
//
//  - Paths are resolved through symlinks/junctions before any check, so an
//    alias cannot redirect an operation somewhere the policy forbids.
//  - Credential stores are never readable or listable.
//  - Writes are refused in OS-owned locations and on network (UNC) paths.
//  - Network paths aren't touched at all until the user has opened that share
//    themselves: looking at one sends this PC's sign-in hash to the server.
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

// Windows reads any two leading slashes, in either direction, as a network path.
function isUncPath(p) {
  return /^[\\/]{2}/.test(p);
}

// Shares opened this session: by hand (see allowNetworkShare), or a mapped
// drive that resolved to one.
const openShares = new Set();

function shareOf(p) {
  // Not \\?\ or \\.\, which are local device paths under another name.
  const m = /^\\\\([^\\?.][^\\]*)\\([^\\]+)/.exec(path.resolve(p));
  return m ? `\\\\${m[1]}\\${m[2]}`.toLowerCase() : null;
}

function isShareOpen(p) {
  return openShares.has(shareOf(p));
}

// For a network path the user asked for themselves (typed it, or confirmed
// it). Never call this for a path that came from a file or from settings.
function allowNetworkShare(p) {
  const share = shareOf(p);
  // "C$" and the like are whole drives under a network name, which the
  // credential-store checks below can't see through.
  if (!share || /\\(?:[a-z]\$|admin\$|ipc\$)$/.test(share)) return false;
  openShares.add(share);
  return true;
}

function networkRefused() {
  return Object.assign(new Error("Network paths have to be opened by typing them in the file explorer's address bar"), { code: "ENETWORK" });
}

// Whether following the links along a path reaches a share that isn't open.
// Walked one step at a time, because realpath() would already contact it.
async function linksToNetwork(target, depth = 0) {
  if (depth > 32) return true;
  const { root } = path.parse(target);
  const parts = target.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let link = null;
    try {
      if ((await fs.promises.lstat(current)).isSymbolicLink()) link = await fs.promises.readlink(current);
    } catch (_) {
      return false; // missing or unreadable: there's nothing further to follow
    }
    if (link === null) continue;
    const next = path.resolve(path.dirname(current), link);
    if (isUncPath(next)) return !isShareOpen(next);
    return linksToNetwork(path.join(next, ...parts.slice(i + 1)), depth + 1);
  }
  return false;
}

function isDriveRoot(p) {
  const resolved = path.resolve(p);
  return normalizeKey(resolved) === normalizeKey(path.parse(resolved).root);
}

// Credential stores and token files (directories or single files).
const SENSITIVE_PATHS = [
  ".ssh", ".aws", ".gnupg", ".azure", ".kube", ".docker", ".password-store",
  ".git-credentials", ".netrc", "_netrc", ".npmrc", ".pypirc", ".pgpass", ".vault-token",
  path.join(".cargo", "credentials"), path.join(".cargo", "credentials.toml"),
  path.join(".gem", "credentials"), path.join(".terraform.d", "credentials.tfrc.json"),
  path.join(".config", "gcloud"), path.join(".config", "gh"), path.join(".config", "hub"),
  path.join("AppData", "Roaming", "postgresql", "pgpass.conf"),
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
  path.join("AppData", "Local", "Chromium", "User Data"),
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

// Whether a protected location sits inside this folder. Moving or renaming the
// folder would carry it out from under the check above.
function holdsSensitive(p) {
  return SENSITIVE_PATHS.some((blocked) => isPathInside(p, blocked) && fs.existsSync(blocked));
}

// Resolves `target` to its canonical form. realpath() throws on a missing
// leaf, so the deepest existing ancestor is resolved and the tail re-joined.
async function canonicalize(target) {
  if (typeof target !== "string" || !target.trim()) throw new Error("A path is required");
  let input = target.trim();
  if (/^[A-Za-z]:$/.test(input)) input += "\\";
  const absolute = path.resolve(input);
  // Decided here, before anything below touches the path.
  const network = isUncPath(input) || isUncPath(absolute);
  if (network && !isShareOpen(absolute)) throw networkRefused();
  if (/[<>"|?*\u0000-\u001F]/.test(absolute.slice(path.parse(absolute).root.length))) {
    throw new Error("Path contains invalid characters");
  }
  if (!network && await linksToNetwork(absolute)) throw networkRefused();

  let probe = absolute;
  for (;;) {
    try {
      const real = await fs.promises.realpath(probe);
      const tail = path.relative(probe, absolute);
      const result = tail ? path.join(real, tail) : real;
      // Links were ruled out above, so this is a mapped drive reporting its
      // address. The user set that up, and the listing's paths will use it.
      if (!network && isUncPath(result) && shareOf(result)) openShares.add(shareOf(result));
      return result;
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
  canonicalHomePromise,
  isPathInside,
  isUncPath,
  isShareOpen,
  allowNetworkShare,
  linksToNetwork,
  isSensitive,
  holdsSensitive,
  addSensitive,
  forRead,
  forWrite,
  validateEntryName,
  uniqueDestination
};
