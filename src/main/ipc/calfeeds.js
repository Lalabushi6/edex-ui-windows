// Calendar subscriptions: read-only Google / Outlook / iCloud calendars from
// their secret .ics (or webcal://) links, shown beside the events you add in
// eDEX. Each feed is downloaded about every 30 minutes while outbound lookups
// are on (or when you press Refresh) and kept in calendars/ so events show
// at startup and offline. Treat those links like passwords: anyone who has
// one can read that calendar.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, net } = require("electron");
const { parseIcs, expand } = require("../lib/ics");
const { readCapped } = require("../lib/http");
const { handle } = require("./util");

const REFRESH_MS = 30 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

function registerCalendarFeeds({ settings, windows }) {
  const dir = path.join(app.getPath("userData"), "calendars");
  const cache = new Map(); // feed id -> promise of { events, fetchedAt, error, partial }
  const PARTIAL = "This calendar is too large or complicated to show in full";

  const feeds = () => (settings.get("calendarFeeds") || []).filter((f) => f.enabled !== false);
  const fileFor = (id) => path.join(dir, `${id.replace(/[^\w-]/g, "_")}.ics`);

  function load(feed) {
    let pending = cache.get(feed.id);
    if (pending) return pending;
    pending = (async () => {
      const c = { events: [], fetchedAt: 0, error: null, partial: false };
      try {
        const file = fileFor(feed.id);
        Object.assign(c, await parseIcs(await fs.promises.readFile(file, "utf8")));
        c.fetchedAt = (await fs.promises.stat(file)).mtimeMs;
      } catch (_) {}
      return c;
    })();
    cache.set(feed.id, pending);
    return pending;
  }

  async function refresh(feed) {
    const c = await load(feed);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      let text;
      try {
        const res = await net.fetch(feed.url, { headers: { Accept: "text/calendar, */*", "User-Agent": `eDEX-UI/${app.getVersion()}` }, signal: ctrl.signal });
        if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? "The calendar link was refused (check it's the secret iCal address)" : `The calendar server answered ${res.status}`);
        text = (await readCapped(res, MAX_BYTES)).toString("utf8");
      } finally { clearTimeout(timer); }
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link isn't an iCalendar (.ics) feed");
      Object.assign(c, await parseIcs(text));
      c.fetchedAt = Date.now();
      c.error = null;
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(fileFor(feed.id), text, "utf8");
    } catch (e) {
      c.error = e.name === "AbortError" ? "The calendar server didn't answer"
        : e.code === "ETOOLARGE" ? "That calendar is too large" : (e.message || "Couldn't download the calendar");
    }
    return c;
  }

  async function refreshAll({ force = false } = {}) {
    const list = feeds();
    if (!force && settings.get("allowNetworkGeolocation") === false) return [];
    const results = [];
    for (const f of list) {
      const c = await load(f);
      if (force || Date.now() - c.fetchedAt > REFRESH_MS) await refresh(f);
      results.push({ id: f.id, name: f.name, ok: !c.error, error: c.error, count: c.events.length, fetchedAt: c.fetchedAt });
    }
    windows.send("calfeeds:changed", {});
    return results;
  }

  // Occurrences in [from, to] for every enabled feed.
  handle("calfeeds:events", async (_e, range = {}) => {
    const now = Date.now();
    const from = Number(range.from) || now - 35 * 86400000;
    const to = Math.min(Number(range.to) || now + 180 * 86400000, from + 400 * 86400000);
    const out = [];
    for (const f of feeds()) {
      const c = await load(f);
      const { occurrences, partial } = await expand(c.events, from, to);
      c.partial = c.partial || partial;
      for (const o of occurrences) {
        out.push({
          id: crypto.createHash("sha1").update(`${f.id}|${o.uid}|${o.start}`).digest("hex").slice(0, 16),
          feedId: f.id, feed: f.name, color: f.color, remind: f.remind,
          title: o.title.slice(0, 200), location: o.location.slice(0, 200),
          start: o.start, end: o.end, allDay: o.allDay, wall: o.wall, days: o.durDays
        });
      }
    }
    return out;
  });

  handle("calfeeds:status", () => Promise.all(feeds().map(async (f) => {
    const c = await load(f);
    return { id: f.id, ok: !c.error && !c.partial, error: c.error || (c.partial ? PARTIAL : null), count: c.events.length, fetchedAt: c.fetchedAt };
  })));

  // Refresh pressed: downloads even with outbound lookups off.
  handle("calfeeds:refresh", () => refreshAll({ force: true }));

  // Removed feeds' copies are deleted; new (or re-pointed) ones and ones just
  // switched on download right away; a colour or name change just redraws.
  const urls = new Map((settings.get("calendarFeeds") || []).map((f) => [f.id, f.url]));
  const wereOn = new Map((settings.get("calendarFeeds") || []).map((f) => [f.id, f.enabled !== false]));
  settings.on("change", (changed) => {
    if (!("calendarFeeds" in changed)) return;
    const all = settings.get("calendarFeeds") || [];
    const ids = new Set(all.map((f) => f.id));
    for (const id of [...urls.keys()]) {
      if (ids.has(id)) continue;
      urls.delete(id);
      wereOn.delete(id);
      cache.delete(id);
      fs.promises.rm(fileFor(id), { force: true }).catch(() => {});
    }
    const fresh = all.filter((f) => urls.get(f.id) !== f.url);
    for (const f of fresh) {
      if (urls.has(f.id)) fs.rmSync(fileFor(f.id), { force: true });
      urls.set(f.id, f.url);
      cache.delete(f.id);
    }
    const download = all.filter((f) => f.enabled !== false && (fresh.includes(f) || wereOn.get(f.id) === false));
    for (const f of all) wereOn.set(f.id, f.enabled !== false);
    Promise.all(download.map(refresh))
      .catch(() => {})
      .finally(() => windows.send("calfeeds:changed", {}));
  });

  const timer = setInterval(() => refreshAll().catch(() => {}), 5 * 60 * 1000);
  setTimeout(() => refreshAll().catch(() => {}), 30000);
  return { stop: () => clearInterval(timer) };
}

module.exports = { registerCalendarFeeds };
