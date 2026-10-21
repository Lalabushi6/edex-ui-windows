// Tasks widget: today's calendar events plus a to-do list. Typing a time
// sets a reminder: "call mum at 6pm", "report in 2h", "dentist tomorrow 9:30".
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { contextMenu } from "../core/ui.js";
import { loadAgenda, tasks, eventsOn, onAgenda, addTask, toggleTask, removeTask, clearDone, removeEvent, dayKey, dueLabel } from "../shell/agenda.js";
import { defineWidget } from "./registry.js";

defineWidget({
  id: "tasks",
  order: 7.5,
  title: "Tasks",
  column: "left",
  create(panel) {
    const input = h("input", { class: "input tasks-input", spellcheck: false, placeholder: "Add a task — “call mum at 6pm”, “report in 2h”" });
    const today = h("div", { class: "tasks-today" });
    const list = h("div", { class: "tasks-list" });
    const doneToggle = h("button", { class: "tasks-done-toggle", type: "button" });
    const doneList = h("div", { class: "tasks-list done", hidden: true });
    panel.body.append(today, input, list, doneToggle, doneList);
    let showDone = false;

    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      e.preventDefault();
      addTask(input.value);
      input.value = "";
    });
    doneToggle.addEventListener("click", () => { showDone = !showDone; render(); });

    const row = (t) => {
      const overdue = !t.done && t.due && t.due < Date.now();
      return h("div", { class: `task${t.done ? " is-done" : ""}${overdue ? " overdue" : ""}` },
        h("button", { class: "task-check", type: "button", title: t.done ? "Mark not done" : "Mark done", onclick: () => toggleTask(t.id) }, t.done ? icon("check") : null),
        h("span", { class: "task-text", title: t.text }, t.text),
        t.due ? h("span", { class: "task-due", title: new Date(t.due).toLocaleString() }, icon("bell"), dueLabel(t.due)) : null,
        h("button", { class: "icon-btn sm task-del", type: "button", title: "Delete", onclick: () => removeTask(t.id) }, icon("close")));
    };

    function render() {
      const evs = eventsOn(dayKey());
      today.hidden = !evs.length;
      today.replaceChildren(...evs.map((ev) => h("div", { class: `tasks-event${ev.readOnly ? " feed" : ""}`, title: [ev.title, ev.location, ev.feed].filter(Boolean).join(" · "), style: ev.readOnly ? { "--feed": ev.color } : undefined },
        h("span", { class: "tasks-event-time" }, ev.time || "all day"),
        h("span", { class: "ellipsis" }, ev.title),
        ev.readOnly ? null : h("button", { class: "icon-btn sm task-del", type: "button", title: "Delete event", onclick: () => removeEvent(ev.id) }, icon("close")))));
      const all = tasks();
      const open = all.filter((t) => !t.done).sort((a, b) => (a.due || Infinity) - (b.due || Infinity) || b.created - a.created);
      const done = all.filter((t) => t.done);
      list.replaceChildren(...(open.length ? open.slice(0, 30).map(row) : [h("div", { class: "empty" }, "Nothing to do")]));
      doneToggle.hidden = !done.length;
      setText(doneToggle, `${showDone ? "▾" : "▸"} ${done.length} done`);
      doneList.hidden = !showDone || !done.length;
      doneList.replaceChildren(...done.slice(0, 30).map(row));
      const dueSoon = open.filter((t) => t.due && t.due - Date.now() < 86400000).length;
      panel.setSub(open.length ? `${open.length} OPEN${dueSoon ? ` · ${dueSoon} DUE` : ""}` : "");
    }

    panel.el.addEventListener("contextmenu", (e) => contextMenu(e, [
      { label: "Clear done tasks", icon: "trash", disabled: !tasks().some((t) => t.done), run: () => clearDone() }
    ]));
    const off = onAgenda(render);
    loadAgenda().then(render);
    render();
    // Due labels ("tomorrow" → time) and overdue marks move with the clock.
    const timer = setInterval(render, 60000);
    return { destroy() { off(); clearInterval(timer); } };
  }
});
