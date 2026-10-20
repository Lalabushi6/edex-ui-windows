// Custom protocols.
//
//   app://edex/...        the renderer bundle (and whitelisted vendor files).
//                         A real origin means CSP 'self', ES modules and fetch
//                         all work, which file:// does not reliably allow.
//   localfile://f/<enc>   read-only access to a file on disk for previews and
//                         the media viewer, with HTTP range support so video
//                         seeking works. Credential stores and UNC paths are
//                         refused.
"use strict";

const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { protocol } = require("electron");
const { mimeFor } = require("./mime");
const { isPathInside, isSensitive, isUncPath } = require("./paths");

const APP_ORIGIN = "app://edex";
const RENDERER_DIR = path.join(__dirname, "..", "..", "renderer");

function packageDir(name) {
  return path.dirname(require.resolve(`${name}/package.json`));
}

const VENDOR_DIRS = {
  xterm: packageDir("@xterm/xterm"),
  "xterm-fit": packageDir("@xterm/addon-fit"),
  "xterm-webgl": packageDir("@xterm/addon-webgl"),
  "xterm-search": packageDir("@xterm/addon-search")
};

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    { scheme: "localfile", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ]);
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
}

function resolveAppPath(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const vendor = /^vendor\/([^/]+)\/(.+)$/.exec(clean);
  const base = vendor ? VENDOR_DIRS[vendor[1]] : RENDERER_DIR;
  if (!base) return null;
  const target = path.resolve(base, vendor ? vendor[2] : (clean || "index.html"));
  return isPathInside(base, target) ? target : null;
}

async function handleApp(request) {
  const url = new URL(request.url);
  if (url.host !== "edex") return notFound();
  const target = resolveAppPath(url.pathname);
  if (!target) return notFound();
  try {
    const body = await fs.promises.readFile(target);
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": mimeFor(target), "Cache-Control": "no-cache" }
    });
  } catch (_) {
    return notFound();
  }
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m) return null;
  let start = m[1] === "" ? null : Number(m[1]);
  let end = m[2] === "" ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) { start = Math.max(0, size - end); end = size - 1; }
  if (end === null || end >= size) end = size - 1;
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

async function handleLocalFile(request) {
  let filePath;
  try {
    const url = new URL(request.url);
    filePath = path.resolve(decodeURIComponent(url.pathname.replace(/^\/+/, "")));
  } catch (_) {
    return notFound();
  }
  if (isUncPath(filePath) || isSensitive(filePath)) {
    return new Response("Forbidden", { status: 403 });
  }

  let stat;
  try {
    const real = await fs.promises.realpath(filePath);
    // A link can point at a network share; refuse those like UNC paths.
    if (isSensitive(real) || isUncPath(real)) return new Response("Forbidden", { status: 403 });
    filePath = real;
    stat = await fs.promises.stat(filePath);
  } catch (_) {
    return notFound();
  }
  if (!stat.isFile()) return notFound();

  const headers = {
    "Content-Type": mimeFor(filePath),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    // The media player routes audio through a Web Audio analyser, which only
    // receives samples from CORS-enabled media. Page scripts still cannot
    // fetch() these URLs: the CSP's connect-src stays 'self'.
    "Access-Control-Allow-Origin": APP_ORIGIN
  };
  const range = parseRange(request.headers.get("Range"), stat.size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }
  if (range) {
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`
      }
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: { ...headers, "Content-Length": String(stat.size) }
  });
}

function registerHandlers() {
  protocol.handle("app", handleApp);
  protocol.handle("localfile", handleLocalFile);
}

module.exports = { APP_ORIGIN, registerSchemes, registerHandlers };
