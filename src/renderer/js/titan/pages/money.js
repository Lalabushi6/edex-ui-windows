// Money engine tools: cashflow (expenses, income, loans), deep work
// earnings and monthly budgets.
import { h } from "../../core/dom.js";
import { confirm, toast } from "../../core/ui.js";
import * as db from "../db.js";
import * as L from "../logic.js";
import * as U from "../ui.js";
import { SUBTABS } from "./engine.js";

const head = (ctx, page, title, sub, ...right) => [U.pageHead("Money engine", title, sub, ...right), U.tabs(SUBTABS.money, page, (id) => ctx.go(id))];
const cur = () => db.pref("currency", "USD");
const fmt = (n, opts) => L.money(n, cur(), opts);
const CATEGORY_OPTIONS = [{ group: "Needs", options: L.NEEDS }, { group: "Wants", options: L.WANTS }];
const bucketOf = (c) => (L.WANTS.includes(c) ? "want" : "need");

// Expense / income / borrowed, new or edited.
export async function txDialog(type, { dateISO = L.today(), tx = null, loan = null } = {}) {
  const editing = !!(tx || loan);
  const title = { expense: "Expense", income: "Income", borrowed: "Borrowed money" }[type];
  await U.formDialog({
    title: `${editing ? "Edit" : "Add"} ${title.toLowerCase()}`,
    submitLabel: editing ? "Save" : `Add ${type === "borrowed" ? "loan" : type}`,
    fields: [
      { name: "amount", label: `Amount (${L.CURRENCY[cur()]})`, type: "number", min: 0, step: 0.01, value: tx?.amount ?? loan?.amount ?? "", required: true, half: true },
      { name: "dateISO", label: type === "borrowed" ? "Borrowed date" : "Date", type: "date", value: tx?.dateISO ?? loan?.dateISO ?? dateISO, required: true, half: true },
      type === "expense" && { name: "category", label: "Category", type: "select", value: tx?.category || "Food", options: CATEGORY_OPTIONS,
        onChange: (v, inputs) => { inputs.bucket.value = bucketOf(v); } },
      type === "expense" && { name: "bucket", label: "Bucket", type: "seg", value: tx?.bucket || bucketOf(tx?.category || "Food"), options: [{ value: "need", label: "Need" }, { value: "want", label: "Want" }] },
      type === "income" && { name: "category", label: "Category", type: "select", value: tx?.category || "Salary", options: L.INCOME.filter((c) => c !== "Borrowed") },
      type === "borrowed" && { name: "lender", label: "Lender", value: loan?.lender || "", placeholder: "Who lent it", half: true },
      type === "borrowed" && { name: "dueISO", label: "Due date (optional)", type: "date", value: loan?.dueISO || "", half: true },
      { name: "note", label: "Note", value: tx?.note || "", placeholder: "Optional" }
    ],
    onSubmit: (v) => {
      const amount = U.num(v.amount);
      if (!(amount > 0)) return "Amount must be a valid number.";
      if (!L.isKey(v.dateISO)) return "Date must be valid.";
      if (type === "borrowed") {
        if (loan) {
          db.update("money_loans", loan.id, { amount, dateISO: v.dateISO, lender: v.lender.trim() || null, dueISO: L.isKey(v.dueISO) ? v.dueISO : null });
          const btx = db.all("money_tx").find((x) => x.loanId === loan.id && x.type === "borrowed");
          if (btx) db.update("money_tx", btx.id, { amount, dateISO: v.dateISO, note: v.note.trim() || null });
        } else L.addBorrowed({ amount, dateISO: v.dateISO, lender: v.lender.trim(), dueISO: L.isKey(v.dueISO) ? v.dueISO : null, note: v.note.trim() });
        return;
      }
      const patch = { amount, dateISO: v.dateISO, category: v.category || null, note: v.note.trim() || null };
      if (type === "expense") patch.bucket = v.bucket || bucketOf(v.category);
      if (tx) db.update("money_tx", tx.id, patch);
      else if (type === "expense") L.addExpense(patch);
      else L.addIncome(patch);
    }
  });
}

function txLabel(t) {
  if (t.type === "borrowed") return `Borrowed${db.get("money_loans", t.loanId)?.lender ? ` from ${db.get("money_loans", t.loanId).lender}` : ""}`;
  if (t.type === "repayment") return t.note || "Debt repayment";
  return t.category || (t.type === "income" ? "Income" : "Expense");
}

export function cashflow(ctx) {
  const t = L.today();
  const st = ctx.state;
  const key = db.selectedDate("money", t) > t ? t : db.selectedDate("money", t);
  const dayTx = L.txOn(key);
  const day = L.cashSummary(dayTx);
  const month = L.cashSummary(L.txInMonth(key));
  const loans = db.all("money_loans").filter((l) => l.status === "unpaid").sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const owed = loans.reduce((s, l) => s + l.amount, 0);
  const cats = Object.entries(month.categories).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const nw = month.needs + month.wants;
  const shown = st.cat ? dayTx.filter((x) => x.category === st.cat) : dayTx;
  const currency = h("select", { class: "input tp-currency", title: "Currency" }, ...Object.entries(L.CURRENCY).map(([c, sym]) => h("option", { value: c }, `${c} (${sym})`)));
  currency.value = cur();
  currency.addEventListener("change", () => db.setPrefs({ currency: currency.value }));
  const sumRows = (s) => h("div", { class: "tp-kv" },
    h("span", null, "Spent"), h("b", null, fmt(s.spent)),
    h("span", null, "Income"), h("b", null, fmt(s.income)),
    h("span", null, "Net"), h("b", { class: s.net < 0 ? "tp-neg" : "tp-pos" }, fmt(s.net)));
  return h("div", { class: "tp-page" },
    ...head(ctx, "money/cashflow", "Cashflow", "Track every transaction. Own your financial picture.", currency, U.datePill(key, (k) => db.setSelectedDate("money", k > t ? t : k), { max: t })),
    h("div", { class: "tp-actions-row" },
      U.btn("Add expense", () => txDialog("expense", { dateISO: key }), { kind: "primary", iconName: "plus" }),
      U.btn("Add income", () => txDialog("income", { dateISO: key }), { iconName: "plus" }),
      U.btn("Add borrowed", () => txDialog("borrowed", { dateISO: key }), { iconName: "plus" })),
    h("div", { class: "tp-grid" },
      U.panel("Day summary", { sub: L.shortDate(key) }, sumRows(day)),
      U.panel("Month summary", { sub: L.monthLabel(key) }, sumRows(month)),
      U.panel("Outstanding borrowed", { sub: "unpaid loans" }, h("div", { class: "tp-bignum sm" }, fmt(owed)), h("div", { class: "muted" }, `${loans.length} loan${loans.length === 1 ? "" : "s"}`)),
      U.panel("Needs vs wants", { sub: "this month" },
        nw ? [h("div", { class: "tp-split-bar" }, h("i", { class: "need", style: { width: `${(month.needs / nw) * 100}%` } }), h("i", { class: "want", style: { width: `${(month.wants / nw) * 100}%` } })),
          h("div", { class: "tp-kv" }, h("span", null, "Needs"), h("b", null, `${fmt(month.needs)} · ${Math.round((month.needs / nw) * 100)}%`), h("span", null, "Wants"), h("b", null, `${fmt(month.wants)} · ${Math.round((month.wants / nw) * 100)}%`))]
          : U.empty("No spending yet.")),
      U.panel("Top categories", { sub: "this month" },
        cats.length ? h("div", { class: "tp-list" }, ...cats.map(([c, v]) => h("button", { class: `tp-row tp-link-row${st.cat === c ? " active" : ""}`, type: "button", title: "Filter the day's transactions", onclick: () => { st.cat = st.cat === c ? null : c; ctx.redraw(); } },
          h("span", { class: "tp-row-title" }, c), h("span", { class: "tp-rel-bar" }, U.progress((v / cats[0][1]) * 100, { color: L.WANTS.includes(c) ? "var(--t-general)" : "var(--t-money)" })), h("b", null, fmt(v)))))
          : U.empty("No spending yet.")),
      U.panel("Transactions", { cls: "tp-span-all", sub: `${st.cat ? `Filtered by ${st.cat} · ` : ""}Total: ${fmt(shown.reduce((s, x) => s + (x.type === "expense" || x.type === "repayment" ? -x.amount : x.amount), 0))}`,
        tools: st.cat && U.btn("Clear filter", () => { st.cat = null; ctx.redraw(); }, { kind: "sm" }) },
        shown.length ? h("div", { class: "tp-list" }, ...shown.map((x) => h("div", { class: "tp-row" },
          U.badge(x.type, { cls: x.type === "expense" || x.type === "repayment" ? "neg" : "pos" }),
          h("span", { class: "tp-row-title ellipsis" }, txLabel(x)),
          x.bucket && U.badge(x.bucket),
          x.note && x.type !== "repayment" && h("span", { class: "muted ellipsis tp-grow", title: x.note }, x.note),
          h("b", { class: x.type === "expense" || x.type === "repayment" ? "tp-neg" : "tp-pos" }, `${x.type === "expense" || x.type === "repayment" ? "−" : "+"}${fmt(x.amount, { cents: true })}`),
          (x.type === "expense" || x.type === "income" || x.type === "borrowed") && U.iconBtn("edit", x.type === "borrowed" ? "Edit loan" : "Edit transaction", () => (x.type === "borrowed" ? txDialog("borrowed", { loan: db.get("money_loans", x.loanId), tx: null }) : txDialog(x.type, { tx: x }))),
          U.iconBtn("trash", "Delete", async () => {
            const msg = x.type === "borrowed" ? "The loan and its repayment go too." : "";
            if (await confirm({ title: x.type === "borrowed" ? "Delete this loan and related transactions?" : "Delete this transaction?", message: msg, confirmLabel: "Delete", danger: true })) L.deleteTx(x.id);
          }, { danger: true }))))
          : U.empty("No transactions for this day.")),
      U.panel("Borrowed", { cls: "tp-span-all", sub: "Unpaid loans" },
        loans.length ? h("div", { class: "tp-list" }, ...loans.map((l) => {
          const overdue = l.dueISO && l.dueISO < t;
          return h("div", { class: `tp-row${overdue ? " overdue" : ""}` },
            h("span", { class: "tp-row-title" }, l.lender || "Unknown lender"),
            h("span", { class: "muted" }, `Borrowed ${L.shortDate(l.dateISO)}${l.dueISO ? ` · due ${L.shortDate(l.dueISO)}` : ""}`),
            overdue && U.badge("overdue", { cls: "neg" }),
            h("b", null, fmt(l.amount, { cents: true })),
            U.btn("Mark as repaid", async () => { if (await confirm({ title: "Mark as repaid?", message: `Records a ${fmt(l.amount, { cents: true })} repayment today.`, confirmLabel: "Repaid" })) L.repayLoan(l.id); }, { kind: "sm" }),
            U.iconBtn("edit", "Edit loan", () => txDialog("borrowed", { loan: l })),
            U.iconBtn("trash", "Delete loan", async () => { if (await confirm({ title: "Delete this loan and related transactions?", confirmLabel: "Delete", danger: true })) L.deleteLoan(l.id); }, { danger: true }));
        })) : U.empty("No borrowed balances."))));
}

// ── Deep work ─────────────────────────────────────────────────────────────
export function deepWork(ctx) {
  const t = L.today();
  const tasks = [...db.all("deep_work_tasks")].sort((a, b) => a.createdAt - b.createdAt);
  const logs = new Map(db.all("deep_work_logs").filter((l) => l.dateKey === t).map((l) => [l.taskId, l]));
  const doneToday = tasks.filter((x) => logs.get(x.id)?.completed).length;
  const ws = L.weekStart(t);
  const toggle = (task) => {
    const log = logs.get(task.id);
    if (log) db.update("deep_work_logs", log.id, { completed: !log.completed });
    else db.insert("deep_work_logs", { taskId: task.id, dateKey: t, completed: true, earningsToday: 0 });
  };
  const add = () => U.formDialog({
    title: "Add deep work task", submitLabel: "Add task",
    fields: [
      { name: "taskName", label: "Task name", placeholder: "e.g. Study algorithms", required: true },
      { name: "category", label: "Category", type: "select", value: "Main Job / College", options: L.DEEP_WORK_CATEGORIES, hint: "Side Hustle and Freelance tasks can record what they earned each day." }
    ],
    onSubmit: (v) => { db.insert("deep_work_tasks", { taskName: v.taskName.trim().slice(0, 200), category: v.category, createdAt: Date.now() }); }
  });
  return h("div", { class: "tp-page" },
    ...head(ctx, "money/deep-work", "Deep work", "Focused work blocks — and what the side projects earned today.", U.btn("Add task", add, { kind: "primary", iconName: "plus" })),
    h("div", { class: "tp-grid" },
      U.panel(null, { cls: "tp-span-all" }, h("div", { class: "tp-metrics" },
        U.metric("Today's earnings", fmt(L.earnings(t, t), { cents: true })),
        U.metric("Weekly earnings", fmt(L.earnings(ws, L.addDays(ws, 6)), { cents: true })),
        U.metric("Completed today", `${doneToday} / ${tasks.length}`))),
      U.panel("Tasks", { cls: "tp-span-all", sub: L.longDate(t) },
        tasks.length ? h("div", { class: "tp-list" }, ...tasks.map((task) => {
          const log = logs.get(task.id);
          const earn = L.EARNING_CATEGORIES.has(task.category) && log;
          let input = null;
          if (earn) {
            input = h("input", { class: "input tp-num-input", type: "number", min: 0, step: 0.01, placeholder: "0.00", value: log.earningsToday || "", title: "Earned today", "data-keep": `earn-${log.id}` });
            input.addEventListener("change", () => { const v = U.num(input.value); if (v >= 0) db.update("deep_work_logs", log.id, { earningsToday: v }); else toast("Enter an amount", { level: "warn" }); });
          }
          return U.checkRow({
            title: task.taskName, done: !!log?.completed, onToggle: () => toggle(task),
            meta: [U.badge(task.category), input && h("span", { class: "muted" }, L.CURRENCY[cur()]), input].filter(Boolean),
            menu: () => [{ label: "Delete task", icon: "trash", danger: true, run: async () => {
              if (!await confirm({ title: "Delete this task and all its logs?", confirmLabel: "Delete", danger: true })) return;
              db.removeWhere("deep_work_logs", (l) => l.taskId === task.id);
              db.remove("deep_work_tasks", task.id);
            } }]
          });
        })) : U.empty('No deep work tasks yet. Add tasks like "Work on business" to track your focused work.', U.btn("Add task", add, { kind: "sm" })))));
}

// ── Budgets ───────────────────────────────────────────────────────────────
export function budgets(ctx) {
  const t = L.today();
  const rows = L.budgetStatus(t).sort((a, b) => b.percent - a.percent);
  const total = rows.reduce((s, r) => s + r.budget.monthlyLimit, 0);
  const spent = rows.reduce((s, r) => s + r.spent, 0);
  const dialog = (b = null) => U.formDialog({
    title: b ? `Edit budget · ${b.category}` : "Set a monthly spending limit", submitLabel: b ? "Save" : "Add budget",
    fields: [
      !b && { name: "category", label: "Category", placeholder: "e.g. Food", list: "tp-budget-cats", required: true },
      { name: "limit", label: `Monthly limit (${L.CURRENCY[cur()]})`, type: "number", min: 0, step: 1, value: b?.monthlyLimit ?? "", required: true }
    ],
    onSubmit: (v) => {
      const limit = U.num(v.limit);
      if (!(limit >= 0)) return "Enter a limit.";
      if (b) { db.update("budgets", b.id, { monthlyLimit: limit }); return; }
      const cat = v.category.trim().slice(0, 80);
      if (db.all("budgets").some((x) => x.category.toLowerCase() === cat.toLowerCase())) return "That category already has a budget.";
      db.insert("budgets", { category: cat, monthlyLimit: limit, createdAt: Date.now() });
    }
  });
  return h("div", { class: "tp-page" },
    h("datalist", { id: "tp-budget-cats" }, ...[...L.NEEDS, ...L.WANTS].map((c) => h("option", { value: c }))),
    ...head(ctx, "money/budgets", "Budgets", "Set monthly spending limits per category.", U.btn("Add budget", () => dialog(), { kind: "primary", iconName: "plus" })),
    h("div", { class: "tp-grid" },
      U.panel("Monthly overview", { cls: "tp-span-all", sub: L.monthLabel(t) },
        h("div", { class: "tp-metrics" },
          U.metric("Budget", fmt(total)),
          U.metric("Spent", fmt(spent)),
          U.metric("Remaining", fmt(Math.max(0, total - spent))),
          U.metric("Used", `${total ? Math.round((spent / total) * 100) : 0}%`)),
        U.progress(total ? (spent / total) * 100 : 0, { state: spent > total ? "red" : spent > total * 0.8 ? "yellow" : "green" })),
      U.panel("Budget categories", { cls: "tp-span-all", tools: U.iconBtn("plus", "Add budget", () => dialog()) },
        rows.length ? h("div", { class: "tp-list" }, ...rows.map((r) => h("div", { class: `tp-row tp-budget${r.over ? " overdue" : ""}` },
          h("span", { class: "tp-row-title" }, r.budget.category),
          h("span", { class: "tp-rel-bar wide" }, U.progress(r.percent, { state: r.over ? "red" : r.percent >= 80 ? "yellow" : "green" })),
          h("span", { class: "muted" }, `${fmt(r.spent)} / ${fmt(r.budget.monthlyLimit)}`),
          h("b", { class: r.over ? "tp-neg" : "" }, r.over ? `${fmt(r.over)} over` : `${fmt(r.remaining)} left`),
          U.iconBtn("edit", "Edit limit", () => dialog(r.budget)),
          U.iconBtn("trash", "Delete budget", async () => { if (await confirm({ title: `Delete the ${r.budget.category} budget?`, confirmLabel: "Delete", danger: true })) db.remove("budgets", r.budget.id); }, { danger: true }))))
          : U.empty("No budgets yet. Add one for a category you spend on.", U.btn("Add budget", () => dialog(), { kind: "sm" })))));
}
