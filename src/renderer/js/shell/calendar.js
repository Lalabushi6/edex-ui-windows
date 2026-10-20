// Month calendar shown from the top-bar clock, with events: days that have
// one are marked, and clicking a day lists its events and adds new ones
// (with an optional reminder).
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { toast } from "../core/ui.js";
import { loadAgenda, events, eventsOn, addEvent, removeEvent, onAgenda, dayKey } from "./agenda.js";

const REMINDERS = [["", "No reminder"], ["0", "At the time"], ["5", "5 min before"], ["15", "15 min before"], ["30", "30 min before"], ["60", "1 hour before"], ["1440", "1 day before"]];

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ISO-8601 week number.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// First day of the week for the user's locale (Monday unless the locale says otherwise).
function firstDayOfWeek() {
  try {
    const loc = new Intl.Locale(navigator.language);
    const info = loc.getWeekInfo?.() || loc.weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
  } catch (_) {}
  return 1;
}

export function buildCalendar() {
  const today = new Date();
  let view = new Date(today.getFullYear(), today.getMonth(), 1);
  const first = firstDayOfWeek();
  const title = h("span", { class: "cal-title" });
  const grid = h("div", { class: "cal-grid" });
  const footer = h("div", { class: "cal-footer" });
  const dayPanel = h("div", { class: "cal-day-panel" });
  let selected = dayKey(today);

  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

  const render = () => {
    title.textContent = monthFmt.format(view).toUpperCase();
    const cells = [h("span", { class: "cal-wk head" }, "WK")];
    for (let i = 0; i < 7; i++) {
      const d = new Date(2024, 0, 7 + ((first + i) % 7)); // 2024-01-07 is a Sunday
      cells.push(h("span", { class: "cal-head" }, weekdayFmt.format(d)));
    }
    const offset = (view.getDay() - first + 7) % 7;
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - offset);
    const withEvents = new Set(events().map((e) => e.date));
    for (let week = 0; week < 6; week++) {
      const rowStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7);
      cells.push(h("span", { class: "cal-wk" }, String(isoWeek(rowStart))));
      for (let i = 0; i < 7; i++) {
        const d = new Date(rowStart.getFullYear(), rowStart.getMonth(), rowStart.getDate() + i);
        const key = dayKey(d);
        const cls = ["cal-day"];
        if (d.getMonth() !== view.getMonth()) cls.push("other");
        if (sameDay(d, today)) cls.push("today");
        if (d.getDay() === 0 || d.getDay() === 6) cls.push("weekend");
        if (withEvents.has(key)) cls.push("has-events");
        if (key === selected) cls.push("selected");
        cells.push(h("button", {
          class: cls.join(" "), type: "button",
          title: d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
          onclick: () => { selected = key; render(); }
        }, String(d.getDate())));
      }
    }
    grid.replaceChildren(...cells);
    renderDay();
    const start0 = new Date(today.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((today - start0) / 86400000) + 1;
    footer.textContent = `${today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · day ${dayOfYear} · week ${isoWeek(today)}`;
  };
  // Events of the selected day, and a form to add one.
  function renderDay() {
    const [y, m, d] = selected.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const list = eventsOn(selected);
    const titleInput = h("input", { class: "input", placeholder: "New event", spellcheck: false });
    const timeInput = h("input", { class: "input cal-time", type: "time", title: "Time (optional)" });
    const remind = h("select", { class: "input cal-remind", title: "Reminder" }, ...REMINDERS.map(([v, l]) => h("option", { value: v }, l)));
    const add = () => {
      const t = titleInput.value.trim();
      if (!t) { titleInput.focus(); return; }
      const time = timeInput.value || null;
      const r = remind.value === "" ? null : Number(remind.value);
      addEvent({ date: selected, time, title: t, remind: r });
      if (r != null) toast(`Reminder set for ${t}`, { level: "ok", timeout: 1800 });
    };
    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    timeInput.addEventListener("change", () => { if (timeInput.value && remind.value === "") remind.value = "0"; });
    dayPanel.replaceChildren(
      h("div", { class: "cal-day-title" }, date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()),
      ...(list.length ? list.map((ev) => h("div", { class: "cal-event" },
        h("span", { class: "cal-event-time" }, ev.time || "all day"),
        h("span", { class: "ellipsis", title: ev.title }, ev.title),
        ev.remind != null ? h("span", { class: "cal-event-bell", title: "Reminder set" }, icon("bell")) : null,
        h("button", { class: "icon-btn sm", type: "button", title: "Delete", onclick: () => removeEvent(ev.id) }, icon("close")))) : [h("div", { class: "muted cal-none" }, "No events")]),
      h("div", { class: "cal-add" }, titleInput, timeInput, remind,
        h("button", { class: "btn sm", type: "button", onclick: add }, icon("plus"))));
  }

  const shift = (n) => { view = new Date(view.getFullYear(), view.getMonth() + n, 1); render(); };

  const head = h("div", { class: "cal-headbar" },
    h("button", { class: "icon-btn sm", type: "button", title: "Previous month", onclick: () => shift(-1) }, icon("back")),
    title,
    h("button", { class: "btn sm", type: "button", title: "Back to this month", onclick: () => { view = new Date(today.getFullYear(), today.getMonth(), 1); selected = dayKey(today); render(); } }, "Today"),
    h("button", { class: "icon-btn sm", type: "button", title: "Next month", onclick: () => shift(1) }, icon("forward")));
  const root = h("div", { class: "calendar" }, head, grid, footer, dayPanel);
  grid.addEventListener("wheel", (e) => { e.preventDefault(); shift(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  const off = onAgenda(() => { if (root.isConnected) render(); else off(); });
  loadAgenda().then(render);
  render();
  return root;
}
