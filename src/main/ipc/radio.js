// Internet radio.
//
// Streams reach the media player through the edexradio: protocol, which
// fetches the station in the main process and hands the audio on. That keeps
// the interface's CSP closed to the internet, gives the visualizer and the
// equalizer CORS-clean audio, resolves .pls / .m3u station links, and reads
// the "now playing" titles stations interleave (Icecast / Shoutcast ICY
// metadata) without passing them to the decoder.
//
// Station search uses the community Radio Browser directory
// (radio-browser.info), only when you search.
"use strict";

const { app, net, protocol } = require("electron");
const { handle } = require("./util");
const { APP_ORIGIN } = require("../lib/protocol");

const DIRECTORY = ["https://de1.api.radio-browser.info", "https://nl1.api.radio-browser.info", "https://at1.api.radio-browser.info"];
const isWeb = (u) => /^https?:\/\/\S+$/i.test(String(u || ""));

// Strips ICY metadata blocks out of the audio and reports StreamTitle.
function icyStream(body, metaint, onTitle) {
  const reader = body.getReader();
  let audioLeft = metaint;
  let metaLeft = -1; // -1: expecting the length byte next
  let meta = [];
  return new ReadableStream({
    async pull(ctrl) {
      // A pull that enqueues nothing isn't called again, so keep reading
      // until some audio comes out (a chunk can be all metadata).
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { ctrl.close(); return; }
        const out = strip(value);
        if (!out.length) continue;
        for (const chunk of out) ctrl.enqueue(chunk);
        return;
      }
    },
    cancel(reason) { return reader.cancel(reason); }
  });

  function strip(value) {
    const out = [];
    let i = 0;
    while (i < value.length) {
      if (audioLeft > 0) {
        const n = Math.min(audioLeft, value.length - i);
        out.push(value.subarray(i, i + n));
        audioLeft -= n;
        i += n;
      } else if (metaLeft === -1) {
        metaLeft = value[i] * 16;
        i += 1;
        meta = [];
        if (metaLeft === 0) { audioLeft = metaint; metaLeft = -1; }
      } else {
        const n = Math.min(metaLeft, value.length - i);
        meta.push(value.subarray(i, i + n));
        metaLeft -= n;
        i += n;
        if (metaLeft === 0) {
          const text = Buffer.concat(meta.map((m) => Buffer.from(m))).toString("utf8").replace(/\0+$/, "");
          const m = /StreamTitle='(.*?)';/s.exec(text);
          if (m) onTitle(m[1].trim());
          audioLeft = metaint;
          metaLeft = -1;
        }
      }
    }
    return out;
  }
}

// .pls / .m3u station links -> the first stream URL in them.
function firstStream(text) {
  const pls = /^File\d+\s*=\s*(https?:\/\/\S+)/im.exec(text);
  if (pls) return pls[1];
  if (/#EXT-X-/i.test(text)) return null; // HLS isn't supported
  const m3u = text.split(/\r?\n/).map((l) => l.trim()).find((l) => isWeb(l));
  return m3u || null;
}

function registerRadio({ windows }) {
  const ua = `eDEX-UI/${app.getVersion()}`;
  const icons = new Map();

  async function open(url, signal, depth = 0) {
    const res = await net.fetch(url, { headers: { "Icy-MetaData": "1", "User-Agent": ua }, signal });
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (depth < 2 && (/scpls|mpegurl|x-scpls|audio\/x-mpegurl|text\/plain|text\/html/.test(type) || /\.(pls|m3u8?)(\?|$)/i.test(url)) && !/audio\/(mpeg|aac|aacp|ogg|opus|flac)/.test(type)) {
      const text = (await res.text()).slice(0, 65536);
      const next = firstStream(text);
      if (!next) throw Object.assign(new Error(/#EXT-X-/i.test(text) ? "HLS streams aren't supported" : "Not a radio stream"), { status: 415 });
      return open(next, signal, depth + 1);
    }
    return { res, url };
  }

  // edexradio://stream/<encoded URL>
  protocol.handle("edexradio", async (request) => {
    let target;
    try {
      const u = new URL(request.url);
      target = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    } catch (_) { return new Response("Bad request", { status: 400 }); }
    if (!isWeb(target)) return new Response("Only http(s) streams", { status: 400 });
    const ctrl = new AbortController();
    request.signal?.addEventListener?.("abort", () => ctrl.abort());
    try {
      const { res, url } = await open(target, ctrl.signal);
      if (!res.ok || !res.body) return new Response("Station unavailable", { status: 502 });
      const metaint = Number(res.headers.get("icy-metaint")) || 0;
      const station = res.headers.get("icy-name") || "";
      if (station) windows.send("radio:meta", { url: target, station });
      const body = metaint > 0
        ? icyStream(res.body, metaint, (title) => windows.send("radio:meta", { url: target, title, station }))
        : res.body;
      let type = (res.headers.get("content-type") || "audio/mpeg").split(";")[0];
      if (!/^(audio|application\/ogg|video)/i.test(type)) type = "audio/mpeg";
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": type, "Cache-Control": "no-store", "Access-Control-Allow-Origin": APP_ORIGIN, "X-Edex-Stream": url }
      });
    } catch (e) {
      return new Response(e.message || "Station unavailable", { status: e.status || 502 });
    }
  });

  async function directory(pathAndQuery) {
    let last = null;
    for (const base of DIRECTORY) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await net.fetch(`${base}${pathAndQuery}`, { headers: { "User-Agent": ua, Accept: "application/json" }, signal: ctrl.signal }).finally(() => clearTimeout(timer));
        if (res.ok) return await res.json();
        last = new Error(`Radio directory answered ${res.status}`);
      } catch (e) { last = e; }
    }
    throw new Error(last?.name === "AbortError" ? "The radio directory didn't answer" : "Couldn't reach the radio directory — check your connection");
  }

  // { q, tag, country } -> stations.
  handle("radio:search", async (_e, opts = {}) => {
    const q = String(opts.q || "").trim().slice(0, 80);
    const tag = String(opts.tag || "").trim().slice(0, 40);
    const params = new URLSearchParams({ limit: "40", hidebroken: "true", order: "clickcount", reverse: "true" });
    if (q) params.set("name", q);
    if (tag) params.set("tag", tag);
    if (!q && !tag) params.set("order", "votes");
    const list = await directory(`/json/stations/search?${params}`);
    return (Array.isArray(list) ? list : []).filter((s) => isWeb(s.url_resolved || s.url)).map((s) => ({
      name: String(s.name || "").trim().slice(0, 80) || "Station",
      url: String(s.url_resolved || s.url).slice(0, 1024),
      favicon: isWeb(s.favicon) ? String(s.favicon).slice(0, 1024) : "",
      tags: String(s.tags || "").split(",").slice(0, 4).join(", ").slice(0, 120),
      country: String(s.countrycode || "").slice(0, 8),
      codec: String(s.codec || "").slice(0, 12),
      bitrate: Number(s.bitrate) || 0
    }));
  });

  // Station logos as data URLs (the interface allows no remote images).
  handle("radio:icon", async (_e, url) => {
    if (!isWeb(url) || url.length > 1024) return null;
    if (icons.has(url)) return icons.get(url);
    let data = null;
    try {
      const res = await net.fetch(url, { headers: { "User-Agent": ua } });
      const type = (res.headers.get("content-type") || "").split(";")[0];
      if (res.ok && /^image\//.test(type)) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length <= 300 * 1024) data = `data:${type};base64,${buf.toString("base64")}`;
      }
    } catch (_) {}
    icons.set(url, data);
    while (icons.size > 200) icons.delete(icons.keys().next().value);
    return data;
  });
}

module.exports = { registerRadio, firstStream, icyStream };
