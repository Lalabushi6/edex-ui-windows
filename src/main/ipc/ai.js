// Optional AI assistant (Claude). Off until the user saves an API key; the
// key is encrypted with Windows DPAPI (Electron safeStorage) and never
// reaches the interface. Only what the user asks, plus any terminal text
// they explicitly choose to include, is sent. Answers stream back as text.
"use strict";

const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const sdk = require("@anthropic-ai/sdk");
const { handle } = require("./util");

const Anthropic = sdk.Anthropic || sdk.default || sdk;
const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
// Server-side refusal fallbacks exist for Opus and Sonnet, not Haiku.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
const SYSTEM = [
  "You are the assistant built into eDEX-UI, a sci-fi desktop shell for Windows.",
  "Answer concisely and practically; the answer is shown in a small panel.",
  "When a command helps, give it in a fenced code block, using PowerShell unless the user asks for another shell; the user can run it with one click, so make each block a complete command.",
  "When asked to explain terminal output or an error, say what it means and how to fix it."
].join(" ");

function registerAi({ settings }) {
  const keyFile = path.join(app.getPath("userData"), "ai-key.bin");
  const active = new Map(); // request id -> stream

  const readKey = () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(fs.readFileSync(keyFile));
    } catch (_) { return null; }
  };

  // A key saved on another PC or Windows account (a portable drive) exists
  // but can't be decrypted here.
  handle("ai:status", () => ({
    configured: !!readKey(),
    unreadable: fs.existsSync(keyFile) && !readKey(),
    encryption: safeStorage.isEncryptionAvailable(),
    enabled: !!settings.get("aiEnabled"),
    model: settings.get("aiModel")
  }));

  handle("ai:setKey", async (_e, key) => {
    if (key === "" || key === null) {
      await fs.promises.rm(keyFile, { force: true });
      return { configured: false };
    }
    if (typeof key !== "string" || key.length < 20 || key.length > 400 || /\s/.test(key.trim())) throw new Error("That doesn't look like an API key");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't encrypt the key on this account");
    await fs.promises.writeFile(keyFile, safeStorage.encryptString(key.trim()));
    return { configured: true };
  });

  // messages: [{ role: "user" | "assistant", content: string }], oldest first.
  handle("ai:ask", async (event, id, messages) => {
    if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id)) throw new Error("Invalid request");
    if (!settings.get("aiEnabled")) throw new Error("The AI assistant is turned off (Settings → Privacy)");
    const apiKey = readKey();
    if (!apiKey) throw new Error("Add an API key in Settings → Privacy → AI assistant");
    if (!Array.isArray(messages) || !messages.length || messages.length > 40) throw new Error("Invalid conversation");
    let total = 0;
    const clean = messages.map((m) => {
      const content = String(m?.content ?? "").slice(0, 60000);
      total += content.length;
      return { role: m?.role === "assistant" ? "assistant" : "user", content };
    }).filter((m) => m.content);
    if (!clean.length || clean[0].role !== "user" || clean[clean.length - 1].role !== "user") throw new Error("Invalid conversation");
    if (total > 200000) throw new Error("That conversation is too long; start a new one");

    const model = MODELS.has(settings.get("aiModel")) ? settings.get("aiModel") : "claude-opus-5-5";
    const send = (channel, payload) => { if (!event.sender.isDestroyed()) event.sender.send(channel, { id, ...payload }); };
    const client = new Anthropic({ apiKey, maxRetries: 2 });
    const params = {
      model,
      max_tokens: 64000,
      system: SYSTEM,
      output_config: { effort: "medium" },
      messages: clean
    };
    if (FALLBACK_MODELS.has(model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    (async () => {
      const stream = client.beta.messages.stream(params);
      active.set(id, stream);
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_start" && ev.content_block?.type === "fallback") {
            // A declined answer continues on another model: start over.
            send("ai:chunk", { reset: true, note: `Continued on ${ev.content_block.to?.model || "another model"}` });
          } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            send("ai:chunk", { text: ev.delta.text });
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") send("ai:done", { error: "Claude declined to answer this one." });
        else send("ai:done", { stop: final.stop_reason, model: final.model });
      } catch (e) {
        let msg = e?.message || String(e);
        if (e instanceof Anthropic.AuthenticationError) msg = "The API key was rejected — check it in Settings → Privacy";
        else if (e instanceof Anthropic.PermissionDeniedError) msg = "This API key can't use that model";
        else if (e instanceof Anthropic.RateLimitError) msg = "Rate limited — try again in a moment";
        else if (e instanceof Anthropic.APIConnectionError) msg = "Couldn't reach the Claude API — check your connection";
        else if (e instanceof Anthropic.APIUserAbortError || stream.aborted) msg = null;
        send("ai:done", msg ? { error: msg } : { stop: "cancelled" });
      } finally {
        active.delete(id);
      }
    })();
    return true;
  });

  handle("ai:cancel", (_e, id) => {
    const s = active.get(id);
    if (s) s.abort();
    return !!s;
  });

  return { stop: () => { for (const s of active.values()) s.abort(); active.clear(); } };
}

module.exports = { registerAi };
