// Month calendar shown from the top-bar clock.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";

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
    for (let week = 0; week < 6; week++) {
      const rowStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7);
      cells.push(h("span", { class: "cal-wk" }, String(isoWeek(rowStart))));
      for (let i = 0; i < 7; i++) {
        const d = new Date(rowStart.getFullYear(), rowStart.getMonth(), rowStart.getDate() + i);
        const cls = ["cal-day"];
        if (d.getMonth() !== view.getMonth()) cls.push("other");
        if (sameDay(d, today)) cls.push("today");
        if (d.getDay() === 0 || d.getDay() === 6) cls.push("weekend");
        cells.push(h("span", { class: cls.join(" "), title: d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) }, String(d.getDate())));
      }
    }
    grid.replaceChildren(...cells);
    const start0 = new Date(today.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((today - start0) / 86400000) + 1;
    footer.textContent = `${today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · day ${dayOfYear} · week ${isoWeek(today)}`;
  };
  const shift = (n) => { view = new Date(view.getFullYear(), view.getMonth() + n, 1); render(); };

  const head = h("div", { class: "cal-headbar" },
    h("button", { class: "icon-btn sm", type: "button", title: "Previous month", onclick: () => shift(-1) }, icon("back")),
    title,
    h("button", { class: "btn sm", type: "button", title: "Back to this month", onclick: () => { view = new Date(today.getFullYear(), today.getMonth(), 1); render(); } }, "Today"),
    h("button", { class: "icon-btn sm", type: "button", title: "Next month", onclick: () => shift(1) }, icon("forward")));
  const root = h("div", { class: "calendar" }, head, grid, footer);
  root.addEventListener("wheel", (e) => { e.preventDefault(); shift(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  render();
  return root;
}
