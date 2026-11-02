"use strict";

const { Readable } = require("stream");
const { net } = require("electron");

// Reads a fetch() response body, refusing anything larger than maxBytes.
// res.text() / res.arrayBuffer() would buffer a response of any size (an
// endless radio stream mislabelled as a playlist, a huge "favicon"); this
// checks the declared length first and stops reading once the cap is passed.
const tooLarge = () => Object.assign(new Error("Response is too large"), { code: "ETOOLARGE" });

async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  // Throwing out of the loop cancels the underlying stream.
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// One request that doesn't follow a redirect, so the caller can check where it
// leads first. Resolves to { redirect: url } or { res: a fetch Response }.
// (net.fetch can't do this: with redirect "manual" it only throws.)
function requestOnce(url, { headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const aborted = () => Object.assign(new Error("Aborted"), { name: "AbortError" });
    if (signal?.aborted) { reject(aborted()); return; }
    const req = net.request({ url, redirect: "manual", credentials: "omit" });
    for (const [name, value] of Object.entries(headers)) req.setHeader(name, value);
    signal?.addEventListener("abort", () => { req.abort(); reject(aborted()); }, { once: true });
    req.on("redirect", (_status, _method, redirectUrl) => { resolve({ redirect: redirectUrl }); });
    req.on("response", (msg) => {
      try {
        const list = Object.entries(msg.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : String(value)]);
        const body = [101, 204, 205, 304].includes(msg.statusCode) ? null : Readable.toWeb(msg);
        // Dropping the body doesn't end the request by itself, and a radio
        // stream would go on downloading after the player has stopped.
        msg.once("close", () => req.abort());
        resolve({ res: new Response(body, { status: msg.statusCode, headers: list }) });
      } catch (e) { reject(e); }
    });
    // Also how a redirect that wasn't followed ends, by which time this is settled.
    req.on("error", reject);
    req.end();
  });
}

module.exports = { readCapped, requestOnce };
