// Journal: one entry a day, saved as you type, with a searchable list of
// past entries.
import { h, setText } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import * as db from "../db.js";
import * as L from "../logic.js";
import * as U from "../ui.js";

const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function render(ctx) {
  const t = L.today();
  const key = db.selectedDate("journal", t) > t ? t : db.selectedDate("journal", t);
  const st = ctx.state;
  st.q = st.q || "";
  const entry = db.get("journal_entries", key);
  const go = (k) => db.setSelectedDate("journal", k > t ? t : k);

  const area = h("textarea", { class: "input tp-journal-text", placeholder: "Write your thoughts for the day…", spellcheck: true });
  area.value = entry?.content || "";
  const status = h("span", { class: "muted" }, entry ? `Saved · ${new Date(entry.updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "No content");
  const count = h("span", { class: "muted" }, `${words(area.value)} words`);
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = null;
    const content = area.value;
    // Saved without redrawing, so the caret stays where it is.
    db.quietly(() => {
      if (!content.trim() && !db.get("journal_entries", key)) return;
      if (!content.trim()) db.remove("journal_entries", key);
      else db.put("journal_entries", { dateKey: key, content, updatedAt: Date.now() });
    });
    setText(status, content.trim() ? "Saved" : "No content");
    paintList();
  };
  area.addEventListener("input", () => {
    setText(status, "Saving…");
    setText(count, `${words(area.value)} words`);
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
  area.addEventListener("blur", () => { if (timer) save(); });

  const listEl = h("div", { class: "tp-journal-list" });
  const search = h("input", { class: "input", placeholder: "Search entries…", value: st.q, spellcheck: false });
  search.addEventListener("input", () => { st.q = search.value; paintList(); });
  function paintList() {
    const q = st.q.trim().toLowerCase();
    const rows = [...db.all("journal_entries")].sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      .filter((e) => !q || e.content.toLowerCase().includes(q) || e.dateKey.includes(q)).slice(0, 120);
    listEl.replaceChildren(...(rows.length ? rows.map((e) => h("button", {
      class: `tp-journal-item${e.dateKey === key ? " active" : ""}`, type: "button", onclick: () => { if (timer) save(); go(e.dateKey); }
    }, h("b", null, L.shortDate(e.dateKey), " · ", L.dayName(e.dateKey)), h("span", { class: "ellipsis" }, e.content.replace(/\s+/g, " ").slice(0, 90))))
      : [h("div", { class: "muted tp-pad" }, q ? "No results found." : "No entries yet.")]));
  }
  paintList();

  const el = h("div", { class: "tp-page" },
    U.pageHead("Daily notes", "Journal", L.longDate(key)),
    h("div", { class: "tp-grid tp-journal-grid" },
      U.panel(null, { cls: "tp-journal-editor" },
        h("div", { class: "tp-journal-nav" },
          h("button", { class: "btn sm", type: "button", onclick: () => { if (timer) save(); go(L.addDays(key, -1)); } }, icon("back"), "Previous day"),
          h("div", { class: "tp-journal-date" }, h("b", null, L.longDate(key)), key === t && h("span", { class: "tp-badge ok" }, "Today")),
          h("button", { class: "btn sm", type: "button", disabled: key >= t, onclick: () => { if (timer) save(); go(L.addDays(key, 1)); } }, "Next day", icon("forward"))),
        area,
        h("div", { class: "tp-journal-foot" }, count, status)),
      U.panel("Recent entries", { sub: `${db.all("journal_entries").length}` }, search, listEl)));
  return { el, dispose: () => { if (timer) save(); }, focus: () => area.focus() };
}
