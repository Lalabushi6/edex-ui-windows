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
const { handle } = require("./util");

const REFRESH_MS = 30 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

function registerCalendarFeeds({ settings, windows }) {
  const dir = path.join(app.getPath("userData"), "calendars");
  const cache = new Map(); // feed id -> { events, fetchedAt, error }

  const feeds = () => (settings.get("calendarFeeds") || []).filter((f) => f.enabled !== false);
  const fileFor = (id) => path.join(dir, `${id.replace(/[^\w-]/g, "_")}.ics`);

  function load(feed) {
    let c = cache.get(feed.id);
    if (c) return c;
    c = { events: [], fetchedAt: 0, error: null };
    try {
      const text = fs.readFileSync(fileFor(feed.id), "utf8");
      c.events = parseIcs(text);
      c.fetchedAt = fs.statSync(fileFor(feed.id)).mtimeMs;
    } catch (_) {}
    cache.set(feed.id, c);
    return c;
  }

  async function refresh(feed) {
    const c = load(feed);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      let res;
      try { res = await net.fetch(feed.url, { headers: { Accept: "text/calendar, */*", "User-Agent": `eDEX-UI/${app.getVersion()}` }, signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? "The calendar link was refused (check it's the secret iCal address)" : `The calendar server answered ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error("That calendar is too large");
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link isn't an iCalendar (.ics) feed");
      c.events = parseIcs(text);
      c.fetchedAt = Date.now();
      c.error = null;
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(fileFor(feed.id), text, "utf8");
    } catch (e) {
      c.error = e.name === "AbortError" ? "The calendar server didn't answer" : (e.message || "Couldn't download the calendar");
    }
    return c;
  }

  async function refreshAll({ force = false } = {}) {
    const list = feeds();
    if (!force && settings.get("allowNetworkGeolocation") === false) return [];
    const results = [];
    for (const f of list) {
      const c = load(f);
      if (force || Date.now() - c.fetchedAt > REFRESH_MS) await refresh(f);
      results.push({ id: f.id, name: f.name, ok: !c.error, error: c.error, count: c.events.length, fetchedAt: c.fetchedAt });
    }
    windows.send("calfeeds:changed", {});
    return results;
  }

  // Occurrences in [from, to] for every enabled feed.
  handle("calfeeds:events", (_e, range = {}) => {
    const now = Date.now();
    const from = Number(range.from) || now - 35 * 86400000;
    const to = Math.min(Number(range.to) || now + 180 * 86400000, from + 400 * 86400000);
    const out = [];
    for (const f of feeds()) {
      const c = load(f);
      for (const o of expand(c.events, from, to)) {
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

  handle("calfeeds:status", () => feeds().map((f) => {
    const c = load(f);
    return { id: f.id, ok: !c.error, error: c.error, count: c.events.length, fetchedAt: c.fetchedAt };
  }));

  // Refresh pressed: downloads even with outbound lookups off.
  handle("calfeeds:refresh", () => refreshAll({ force: true }));

  // Removed feeds' copies are deleted; new (or re-pointed) ones download
  // right away; a colour or name change just redraws.
  const urls = new Map((settings.get("calendarFeeds") || []).map((f) => [f.id, f.url]));
  settings.on("change", (changed) => {
    if (!("calendarFeeds" in changed)) return;
    const all = settings.get("calendarFeeds") || [];
    const ids = new Set(all.map((f) => f.id));
    for (const id of [...urls.keys()]) {
      if (ids.has(id)) continue;
      urls.delete(id);
      cache.delete(id);
      fs.promises.rm(fileFor(id), { force: true }).catch(() => {});
    }
    const fresh = all.filter((f) => urls.get(f.id) !== f.url);
    for (const f of fresh) {
      if (urls.has(f.id)) fs.rmSync(fileFor(f.id), { force: true });
      urls.set(f.id, f.url);
      cache.delete(f.id);
    }
    Promise.all(fresh.filter((f) => f.enabled !== false).map(refresh))
      .catch(() => {})
      .finally(() => windows.send("calfeeds:changed", {}));
  });

  const timer = setInterval(() => refreshAll().catch(() => {}), 5 * 60 * 1000);
  setTimeout(() => refreshAll().catch(() => {}), 30000);
  return { stop: () => clearInterval(timer) };
}

module.exports = { registerCalendarFeeds };
