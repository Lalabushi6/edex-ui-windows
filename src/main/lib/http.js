"use strict";

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

module.exports = { readCapped };
