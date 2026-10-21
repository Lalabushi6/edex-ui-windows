// iCalendar (.ics) reading for calendar subscriptions: events with their
// time zones (IANA names, or the Windows names Outlook writes), all-day
// events, and recurrence (RRULE daily / weekly / monthly / yearly with
// INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH), EXDATE exceptions and
// moved instances (RECURRENCE-ID). Expanded into concrete occurrences for a
// date range.
"use strict";

const WIN_TZ = {
  "Dateline Standard Time": "Etc/GMT+12", "Hawaiian Standard Time": "Pacific/Honolulu", "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles", "US Mountain Standard Time": "America/Phoenix", "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago", "Central Standard Time (Mexico)": "America/Mexico_City", "Canada Central Standard Time": "America/Regina",
  "Eastern Standard Time": "America/New_York", "SA Pacific Standard Time": "America/Bogota", "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns", "E. South America Standard Time": "America/Sao_Paulo", "Argentina Standard Time": "America/Buenos_Aires",
  "Pacific SA Standard Time": "America/Santiago", "SA Western Standard Time": "America/La_Paz", "Venezuela Standard Time": "America/Caracas",
  "UTC": "UTC", "Coordinated Universal Time": "UTC", "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin", "Central Europe Standard Time": "Europe/Budapest", "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw", "W. Central Africa Standard Time": "Africa/Lagos", "GTB Standard Time": "Europe/Bucharest",
  "E. Europe Standard Time": "Europe/Chisinau", "FLE Standard Time": "Europe/Kiev", "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg", "Israel Standard Time": "Asia/Jerusalem", "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow", "Arab Standard Time": "Asia/Riyadh", "Arabian Standard Time": "Asia/Dubai", "Iran Standard Time": "Asia/Tehran",
  "Afghanistan Standard Time": "Asia/Kabul", "Pakistan Standard Time": "Asia/Karachi", "West Asia Standard Time": "Asia/Tashkent",
  "India Standard Time": "Asia/Kolkata", "Sri Lanka Standard Time": "Asia/Colombo", "Nepal Standard Time": "Asia/Kathmandu",
  "Bangladesh Standard Time": "Asia/Dhaka", "Myanmar Standard Time": "Asia/Yangon", "SE Asia Standard Time": "Asia/Bangkok",
  "N. Central Asia Standard Time": "Asia/Novosibirsk", "China Standard Time": "Asia/Shanghai", "Singapore Standard Time": "Asia/Singapore",
  "Taipei Standard Time": "Asia/Taipei", "W. Australia Standard Time": "Australia/Perth", "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul", "Cen. Australia Standard Time": "Australia/Adelaide", "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane", "AUS Eastern Standard Time": "Australia/Sydney", "Tasmania Standard Time": "Australia/Hobart",
  "New Zealand Standard Time": "Pacific/Auckland", "Tonga Standard Time": "Pacific/Tongatapu"
};
const DAY_NAMES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY = 86400000;

const formatters = new Map();
function zoneOk(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (_) { return false; }
}
function normalizeZone(tzid) {
  if (!tzid) return null;
  const t = String(tzid).replace(/^"|"$/g, "").replace(/^\/+/, "").trim();
  const mapped = WIN_TZ[t] || t;
  return zoneOk(mapped) ? mapped : null;
}
function offsetAt(ts, tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ts;
}
// Wall-clock fields in a zone (null = the PC's local time) -> epoch ms.
function wallToEpoch(w, tz) {
  if (w.utc || tz === "UTC") return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  if (!tz) return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime();
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  let ts = guess - offsetAt(guess, tz);
  const o2 = offsetAt(ts, tz);
  if (guess - o2 !== ts) ts = guess - o2;
  return ts;
}

// ── Parsing ─────────────────────────────────────────────────────────────────
function unescapeText(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function parseLine(line) {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ":" && !inQuote) { colon = i; break; }
  }
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

// "20261021" | "20261021T090000" | "20261021T090000Z"
function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const allDay = !m[4] || params?.VALUE === "DATE";
  return {
    y: +m[1], m: +m[2], d: +m[3], h: allDay ? 0 : +m[4], mi: allDay ? 0 : +m[5], s: allDay ? 0 : +(m[6] || 0),
    utc: !!m[7], allDay, tz: m[7] ? "UTC" : normalizeZone(params?.TZID)
  };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || "").trim());
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * DAY) + ((+m[3] || 0) * DAY) + ((+m[4] || 0) * 3600000) + ((+m[5] || 0) * 60000) + ((+m[6] || 0) * 1000);
  return m[1] === "-" ? -ms : ms;
}

function parseIcs(text) {
  const lines = String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  let depth = 0;
  for (const raw of lines) {
    if (!raw) continue;
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === "BEGIN") {
      if (line.value.toUpperCase() === "VEVENT" && !cur) { cur = { exdates: [] }; depth = 0; }
      else if (cur) depth++;
      continue;
    }
    if (line.name === "END") {
      if (cur && depth > 0) { depth--; continue; }
      if (cur && line.value.toUpperCase() === "VEVENT") { events.push(cur); cur = null; }
      continue;
    }
    if (!cur || depth > 0) continue; // nested VALARM etc.
    switch (line.name) {
      case "UID": cur.uid = line.value.trim(); break;
      case "SUMMARY": cur.title = unescapeText(line.value).trim(); break;
      case "LOCATION": cur.location = unescapeText(line.value).trim(); break;
      case "STATUS": cur.status = line.value.trim().toUpperCase(); break;
      case "DTSTART": cur.start = parseDate(line.value, line.params); break;
      case "DTEND": cur.end = parseDate(line.value, line.params); break;
      case "DURATION": cur.duration = parseDuration(line.value); break;
      case "RRULE": cur.rrule = line.value.trim(); break;
      case "RECURRENCE-ID": cur.recurrenceId = parseDate(line.value, line.params); break;
      case "EXDATE":
        for (const v of line.value.split(",")) { const d = parseDate(v, line.params); if (d) cur.exdates.push(d); }
        break;
      default: break;
    }
  }
  return events.filter((e) => e.start && e.status !== "CANCELLED");
}

// ── Recurrence ──────────────────────────────────────────────────────────────
function parseRule(rule) {
  const r = {};
  for (const part of String(rule || "").split(";")) {
    const [k, v] = part.split("=");
    if (k && v) r[k.toUpperCase()] = v;
  }
  return {
    freq: r.FREQ,
    interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL ? parseDate(r.UNTIL, {}) : null,
    byday: r.BYDAY ? r.BYDAY.split(",").map((s) => { const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(s.trim()); return m ? { n: m[1] ? +m[1] : 0, wd: DAY_NAMES.indexOf(m[2].toUpperCase()) } : null; }).filter(Boolean) : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number).filter((n) => n && Math.abs(n) <= 31) : null,
    bymonth: r.BYMONTH ? r.BYMONTH.split(",").map(Number).filter((n) => n >= 1 && n <= 12) : null
  };
}

// Calendar arithmetic on dates (no times), via UTC midnights.
const dnum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY);
const fromDnum = (n) => { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() }; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Day numbers in a month matching BYDAY (with ordinals) / BYMONTHDAY.
function monthDays(y, m, rule, startDay) {
  const out = [];
  const dim = daysInMonth(y, m);
  if (rule.bymonthday) for (const md of rule.bymonthday) { const d = md > 0 ? md : dim + md + 1; if (d >= 1 && d <= dim) out.push(dnum(y, m, d)); }
  if (rule.byday) {
    for (const { n, wd } of rule.byday) {
      const matches = [];
      for (let d = 1; d <= dim; d++) if (fromDnum(dnum(y, m, d)).wd === wd) matches.push(dnum(y, m, d));
      if (!n) out.push(...matches);
      else { const pick = n > 0 ? matches[n - 1] : matches[matches.length + n]; if (pick !== undefined) out.push(pick); }
    }
  }
  if (!rule.bymonthday && !rule.byday) { const d = Math.min(startDay, dim); out.push(dnum(y, m, d)); }
  return [...new Set(out)].sort((a, b) => a - b);
}

// Occurrence dates (day numbers) of a rule from its first date, ascending.
function* occurrenceDays(rule, first, lastDay) {
  const s = fromDnum(first);
  const freq = rule.freq;
  let guard = 0;
  if (freq === "DAILY") {
    for (let n = first; n <= lastDay && guard++ < 5000; n += rule.interval) yield n;
  } else if (freq === "WEEKLY") {
    const days = rule.byday?.length ? [...new Set(rule.byday.map((b) => b.wd))] : [s.wd];
    const weekStart = first - ((s.wd + 6) % 7); // Monday of the first week
    for (let w = weekStart; w <= lastDay && guard++ < 2000; w += 7 * rule.interval) {
      for (const wd of days.map((x) => (x + 6) % 7).sort((a, b) => a - b)) {
        const n = w + wd;
        if (n >= first && n <= lastDay) yield n;
      }
    }
  } else if (freq === "MONTHLY") {
    for (let i = 0; guard++ < 600; i += rule.interval) {
      const y = s.y + Math.floor((s.m - 1 + i) / 12);
      const m = ((s.m - 1 + i) % 12) + 1;
      if (dnum(y, m, 1) > lastDay) break;
      if (rule.bymonth && !rule.bymonth.includes(m)) continue;
      for (const n of monthDays(y, m, rule, s.d)) if (n >= first && n <= lastDay) yield n;
    }
  } else if (freq === "YEARLY") {
    for (let y = s.y; guard++ < 200; y += rule.interval) {
      if (dnum(y, 1, 1) > lastDay) break;
      const months = rule.bymonth || [s.m];
      for (const m of months) {
        const r = rule.byday || rule.bymonthday ? rule : { ...rule, bymonthday: [s.d] };
        for (const n of monthDays(y, m, r, s.d)) if (n >= first && n <= lastDay) yield n;
      }
    }
  }
}

// Concrete occurrences between from and to (epoch ms).
// Returns [{ uid, title, location, start, end, allDay, days? }].
function expand(events, from, to) {
  const out = [];
  const moved = new Set();
  for (const e of events) if (e.recurrenceId && e.uid) moved.add(`${e.uid}|${occKey(e.recurrenceId, e.recurrenceId.tz ?? e.start.tz)}`);
  const lastDay = Math.floor(to / DAY) + 2;

  for (const e of events) {
    const st = e.start;
    const tz = st.tz;
    const firstEpoch = wallToEpoch(st, tz);
    let dur = 0;
    if (e.end) dur = wallToEpoch(e.end, e.end.tz ?? tz) - firstEpoch;
    else if (e.duration != null) dur = e.duration;
    else if (st.allDay) dur = DAY;
    dur = Math.max(0, Math.min(dur, 366 * DAY));
    const push = (wall) => {
      const start = wallToEpoch(wall, tz);
      const end = start + dur;
      if (end < from || start > to) return;
      out.push({ uid: e.uid || "", title: e.title || "(no title)", location: e.location || "", start, end, allDay: !!st.allDay, wall: st.allDay ? { y: wall.y, m: wall.m, d: wall.d } : null, durDays: st.allDay ? Math.max(1, Math.round(dur / DAY)) : 0 });
    };
    if (!e.rrule || e.recurrenceId) { push(st); continue; }
    const rule = parseRule(e.rrule);
    if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.freq)) { push(st); continue; }
    const ex = new Set(e.exdates.map((d) => occKey(d, d.tz ?? tz)));
    const untilEpoch = rule.until ? wallToEpoch(rule.until, rule.until.tz ?? (rule.until.allDay ? tz : "UTC")) + (rule.until.allDay ? DAY - 1 : 0) : Infinity;
    let count = 0;
    for (const n of occurrenceDays(rule, dnum(st.y, st.m, st.d), lastDay)) {
      const dd = fromDnum(n);
      const wall = { ...st, y: dd.y, m: dd.m, d: dd.d };
      const epoch = wallToEpoch(wall, tz);
      if (epoch > untilEpoch) break;
      if (rule.count !== null && count >= rule.count) break;
      count++;
      const key = occKey(wall, tz);
      if (ex.has(key) || (e.uid && moved.has(`${e.uid}|${key}`))) continue;
      if (epoch > to) break;
      push(wall);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// One key per occurrence: the day for all-day events, else the minute.
function occKey(d, tz) {
  if (d.allDay) return `${d.y}-${d.m}-${d.d}`;
  return String(Math.round(wallToEpoch(d, tz) / 60000));
}

module.exports = { parseIcs, expand, normalizeZone, wallToEpoch };
