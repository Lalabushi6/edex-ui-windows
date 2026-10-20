// AI assistant panel (Claude): opened from the launcher ("? question"),
// Ctrl+Shift+J, or "Explain with Claude" on terminal output. Answers stream
// in; code blocks get Copy and Run-in-terminal buttons (running always needs
// the click). The conversation lasts until "New chat" or eDEX restarts.
import { h, setText } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as settings from "../core/settings.js";
import { on, emit } from "../core/bus.js";
import { openModal, toast, copyText, cleanError } from "../core/ui.js";

const api = window.edex;
let history = []; // { role, content, display? }
let panel = null; // the open panel's controller
const pending = new Map(); // request id -> { onChunk, onDone }

export function initAi() {
  api.ai.onChunk(({ id, text, reset, note }) => pending.get(id)?.onChunk(text, reset, note));
  api.ai.onDone((msg) => {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    p?.onDone(msg);
  });
  on("ai-ask", (opts) => openAiPanel(opts || {}));
}

// Minimal Markdown → DOM: fenced code, lists, paragraphs, `code`, **bold**.
function inline(text) {
  const out = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("`") ? h("code", null, t.slice(1, -1)) : h("b", null, t.slice(2, -2)));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function codeBlock(lang, code) {
  const shellish = !lang || /^(powershell|ps1?|pwsh|cmd|bat|batch|shell|sh|bash|console)$/i.test(lang);
  return h("div", { class: "ai-code" },
    h("div", { class: "ai-code-bar" }, h("span", { class: "muted" }, lang || "code"), h("span", { class: "grow" }),
      h("button", { class: "btn sm", type: "button", onclick: () => copyText(code, "Copied") }, icon("copy"), "Copy"),
      shellish ? h("button", { class: "btn sm", type: "button", title: "Paste into the active terminal and run it", onclick: () => { emit("terminal-run", { command: code.replace(/\n+$/, "").replace(/\n/g, "\r") }); toast("Sent to the terminal", { timeout: 1400 }); } }, icon("terminal"), "Run in terminal") : null),
    h("pre", null, code));
}

export function renderMarkdown(src) {
  const root = h("div", { class: "ai-md" });
  const parts = src.split(/^```/m);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf("\n");
      const lang = nl >= 0 ? part.slice(0, nl).trim() : "";
      const code = nl >= 0 ? part.slice(nl + 1) : "";
      root.append(codeBlock(lang, code.replace(/\n$/, "")));
      return;
    }
    for (const block of part.split(/\n{2,}/)) {
      const lines = block.split("\n").filter((l) => l.trim());
      if (!lines.length) continue;
      if (lines.every((l) => /^\s*([-*]|\d+[.)])\s+/.test(l))) {
        const ordered = /^\s*\d/.test(lines[0]);
        root.append(h(ordered ? "ol" : "ul", null, ...lines.map((l) => h("li", null, ...inline(l.replace(/^\s*([-*]|\d+[.)])\s+/, ""))))));
      } else if (/^#{1,4}\s/.test(lines[0])) {
        root.append(h("div", { class: "ai-h" }, ...inline(lines[0].replace(/^#+\s*/, ""))));
        if (lines.length > 1) root.append(h("p", null, ...inline(lines.slice(1).join("\n"))));
      } else {
        root.append(h("p", null, ...inline(lines.join("\n"))));
      }
    }
  });
  return root;
}

export async function openAiPanel({ prompt = "", context = "" } = {}) {
  if (panel) {
    panel.ask(prompt, context);
    return;
  }
  let status = null;
  try { status = await api.ai.status(); } catch (_) {}
  openModal((close) => {
    const log = h("div", { class: "ai-log" });
    const input = h("textarea", { class: "input ai-input", rows: 2, spellcheck: false, placeholder: "Ask anything — Enter to send, Shift+Enter for a new line" });
    const sendBtn = h("button", { class: "btn primary", type: "button" }, "Ask");
    const stopBtn = h("button", { class: "btn", type: "button", hidden: true }, "Stop");
    const model = h("span", { class: "muted ai-model" });
    let busy = null; // request id while streaming

    const ready = status?.enabled && status?.configured;
    const setup = h("div", { class: "ai-setup" },
      icon("ai"),
      h("p", null, !status?.enabled ? "The AI assistant is off." : "Add your Anthropic API key to use the assistant."),
      h("p", { class: "muted" }, "It sends only what you ask (plus terminal text you choose to include) to Anthropic's Claude API, using your own API key."),
      h("button", { class: "btn primary", type: "button", onclick: () => { close(); emit("open-settings", { page: "privacy" }); } }, icon("gear"), "Set up in Settings"));

    const bubble = (m) => {
      if (m.role === "user") {
        return h("div", { class: "ai-msg user" },
          h("div", { class: "ai-text" }, m.display || m.content),
          m.context ? h("details", { class: "ai-context" }, h("summary", null, `Terminal output (${m.context.split("\n").length} lines)`), h("pre", null, m.context)) : null);
      }
      const body = h("div", { class: "ai-msg assistant" }, renderMarkdown(m.content));
      if (m.content) body.append(h("div", { class: "ai-msg-tools" }, h("button", { class: "icon-btn sm", type: "button", title: "Copy answer", onclick: () => copyText(m.content, "Answer copied") }, icon("copy"))));
      return body;
    };
    const renderLog = () => {
      log.replaceChildren(...(history.length ? history.map(bubble) : [h("div", { class: "ai-empty muted" },
        "Ask about Windows, commands, errors, code… Answers can include commands you can run with one click.")]));
      log.scrollTop = log.scrollHeight;
    };

    const ask = (text, context = "") => {
      const q = String(text || "").trim();
      if (!q || busy) return;
      if (!ready) { toast("Set up the AI assistant first", { level: "warn" }); return; }
      const content = context ? `${q}\n\n\`\`\`\n${context}\n\`\`\`` : q;
      history.push({ role: "user", content, display: q, context: context || undefined });
      const answer = { role: "assistant", content: "" };
      history.push(answer);
      renderLog();
      const live = log.lastElementChild;
      live.classList.add("streaming");
      const id = `q${Date.now().toString(36)}`;
      busy = id;
      sendBtn.hidden = true;
      stopBtn.hidden = false;
      let paintQueued = false;
      const paint = () => {
        paintQueued = false;
        live.replaceChildren(renderMarkdown(answer.content || "…"));
        log.scrollTop = log.scrollHeight;
      };
      pending.set(id, {
        onChunk(chunk, reset, note) {
          if (reset) answer.content = note ? `(${note})\n\n` : "";
          if (chunk) answer.content += chunk;
          if (!paintQueued) { paintQueued = true; requestAnimationFrame(paint); }
        },
        onDone(msg) {
          busy = null;
          sendBtn.hidden = false;
          stopBtn.hidden = true;
          if (msg.error) {
            if (!answer.content) history.splice(history.indexOf(answer), 1);
            toast(msg.error, { level: "warn", timeout: 6000 });
          } else if (msg.stop === "cancelled" && !answer.content) {
            history.splice(history.indexOf(answer), 1);
          }
          if (msg.model) setText(model, msg.model);
          renderLog();
          input.focus();
        }
      });
      const messages = history.filter((m) => m !== answer && m.content).map((m) => ({ role: m.role, content: m.content }));
      api.ai.ask(id, messages).catch((e) => pending.get(id)?.onDone({ id, error: cleanError(e) }));
    };

    sendBtn.addEventListener("click", () => { const t = input.value; input.value = ""; ask(t); });
    stopBtn.addEventListener("click", () => { if (busy) api.ai.cancel(busy).catch(() => {}); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
    });
    panel = { ask: (p, c) => { if (p) ask(p, c); else input.focus(); } };
    setText(model, settings.get("aiModel") || "");
    renderLog();
    setTimeout(() => { input.focus(); if (prompt && ready) ask(prompt, context); }, 0);
    return h("div", { class: "dialog ai-dialog" },
      h("div", { class: "ai-head" }, icon("ai"), h("h2", { class: "dialog-title" }, "Claude"), model, h("span", { class: "grow" }),
        h("button", { class: "btn sm", type: "button", title: "Start over", onclick: () => { if (busy) api.ai.cancel(busy).catch(() => {}); history = []; renderLog(); input.focus(); } }, icon("plus"), "New chat"),
        h("button", { class: "icon-btn sm", type: "button", title: "Close (Esc)", onclick: () => close() }, icon("close"))),
      ready ? log : setup,
      ready ? h("div", { class: "ai-compose" }, input, sendBtn, stopBtn) : null);
  }, { className: "ai-modal", label: "Claude", onClose: () => { panel = null; } });
}
