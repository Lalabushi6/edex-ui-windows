// Updates from the project's GitHub releases page.
//
// Checks the latest release (api.github.com), and on request downloads the
// matching executable: the installer for an installed copy, the portable
// .exe for the portable build. Downloads are checked against the size and the
// SHA-256 digest GitHub publishes for each release file before anything runs.
// Automatic checks happen at most once a day, only with outbound lookups on.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { app, dialog, net, shell } = require("electron");
const { handle } = require("./util");
const portable = require("../lib/portable");

const DAY = 24 * 60 * 60 * 1000;
const MAX_BYTES = 400 * 1024 * 1024;
const ASSET = { installer: "eDEX-UI-Setup.exe", portable: "eDEX-UI-Portable.exe" };

// "owner/repo" from package.json's repository field.
function repoSlug() {
  let pkg = {};
  try { pkg = require(path.join(app.getAppPath(), "package.json")); } catch (_) {}
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || "";
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function newer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function registerUpdates({ settings, windows, notices }) {
  const slug = repoSlug();
  // Development runs can point at a test server; packaged builds never can.
  const apiBase = (!app.isPackaged && process.env.EDEX_UPDATE_API) || "https://api.github.com";
  const devKind = !app.isPackaged && ["installer", "portable"].includes(process.env.EDEX_UPDATE_KIND) ? process.env.EDEX_UPDATE_KIND : null;
  const kind = portable.state().portable ? "portable" : app.isPackaged ? "installer" : devKind;
  let latest = null;   // last successful check
  let download = null; // { version, file, verified }
  let busy = null;

  async function check() {
    if (!slug) throw new Error("This build doesn't know its GitHub repository");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await net.fetch(`${apiBase}/repos/${slug}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": `eDEX-UI/${app.getVersion()}` },
        signal: ctrl.signal
      });
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "GitHub didn't answer in time" : "Couldn't reach GitHub — check your connection");
    } finally { clearTimeout(timer); }
    if (res.status === 404) throw new Error("No published release found (a private repository can't be checked)");
    if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit reached — try again in an hour");
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const r = await res.json();
    if (r.draft || r.prerelease) throw new Error("The latest release is a pre-release");
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const wanted = kind ? assets.find((a) => a?.name === ASSET[kind]) : null;
    const expected = `/${slug}/releases/download/`;
    let asset = null;
    if (wanted && typeof wanted.browser_download_url === "string") {
      const u = new URL(wanted.browser_download_url);
      const testServer = apiBase !== "https://api.github.com" && u.origin === new URL(apiBase).origin;
      if ((u.protocol === "https:" && u.hostname === "github.com" && u.pathname.startsWith(expected)) || testServer) {
        const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(wanted.digest || ""));
        asset = { name: wanted.name, size: Number(wanted.size) || 0, url: u.href, sha256: digest ? digest[1].toLowerCase() : null };
      }
    }
    latest = {
      current: app.getVersion(),
      version: String(r.tag_name || r.name || "").replace(/^v/i, "").slice(0, 32),
      name: String(r.name || r.tag_name || "").slice(0, 120),
      notes: String(r.body || "").slice(0, 20000),
      url: /^https:\/\/github\.com\//.test(r.html_url) ? r.html_url : `https://github.com/${slug}/releases/latest`,
      published: r.published_at || null,
      asset: asset && { name: asset.name, size: asset.size, verified: !!asset.sha256 },
      kind,
      _asset: asset
    };
    latest.newer = newer(latest.version, latest.current);
    return latest;
  }

  const view = (r) => r && Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")));

  // Background check: once a day, after startup settles.
  async function autoCheck() {
    if (!settings.get("updateCheck") || settings.get("allowNetworkGeolocation") === false || !app.isPackaged) return;
    const last = Number(settings.get("updateLastCheck")) || 0;
    if (Date.now() - last < DAY) return;
    try {
      const r = await check();
      settings.set({ updateLastCheck: Date.now() });
      if (r.newer && r.version !== settings.get("updateSkip")) {
        windows.send("updates:available", view(r));
        notices?.add({ level: "ok", kind: "update", title: `eDEX-UI ${r.version} is available`, body: "See what's new and install it from here.", action: { type: "updates" } }, { toast: false, system: "hidden" });
      }
    } catch (_) {}
  }
  const startTimer = setTimeout(autoCheck, 45000);
  const dailyTimer = setInterval(autoCheck, 6 * 60 * 60 * 1000);

  handle("updates:info", () => ({ repo: slug, kind, current: app.getVersion(), latest: view(latest), downloaded: download?.version || null }));
  handle("updates:check", async () => view(await check()));

  handle("updates:download", async (event) => {
    if (busy) return busy;
    const r = latest || (await check());
    if (!r.newer) throw new Error("You already have the latest version");
    const asset = r._asset;
    if (!asset) throw new Error(kind ? `The release has no ${ASSET[kind]}` : "Development runs can't install updates");
    if (asset.size > MAX_BYTES) throw new Error("The update file is unexpectedly large");
    const send = (p) => { if (!event.sender.isDestroyed()) event.sender.send("updates:progress", p); };
    busy = (async () => {
      const dir = path.join(app.getPath("temp"), "eDEX-UI-update");
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${r.version}-${asset.name}`);
      const part = `${file}.part`;
      const res = await net.fetch(asset.url, { headers: { "User-Agent": `eDEX-UI/${app.getVersion()}` } });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
      const total = asset.size || Number(res.headers.get("content-length")) || 0;
      const hash = crypto.createHash("sha256");
      const out = fs.createWriteStream(part);
      let got = 0;
      let lastSent = 0;
      try {
        for await (const chunk of res.body) {
          got += chunk.length;
          if (got > MAX_BYTES) throw new Error("The update file is unexpectedly large");
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise((ok) => out.once("drain", ok));
          if (Date.now() - lastSent > 200) { lastSent = Date.now(); send({ got, total }); }
        }
        await new Promise((ok, fail) => out.end((e) => (e ? fail(e) : ok())));
      } catch (e) {
        out.destroy();
        await fs.promises.rm(part, { force: true });
        throw e;
      }
      const digest = hash.digest("hex");
      if ((asset.size && got !== asset.size) || (asset.sha256 && digest !== asset.sha256)) {
        await fs.promises.rm(part, { force: true });
        throw new Error("The download doesn't match the release (damaged or tampered) — nothing was installed");
      }
      await fs.promises.rename(part, file);
      send({ got, total: got, done: true });
      download = { version: r.version, file, verified: !!asset.sha256 };
      return { version: r.version, verified: download.verified };
    })().finally(() => { busy = null; });
    return busy;
  });

  // Installer: started after eDEX quits; it remembers the install folder.
  // Portable: the new .exe replaces the old one once eDEX (and its launcher)
  // have exited, then starts.
  handle("updates:install", async () => {
    if (!download || !fs.existsSync(download.file)) throw new Error("Download the update first");
    const { response } = await windows.withDialog((win) => dialog.showMessageBox(win, {
      type: "question", buttons: ["Cancel", "Install and restart"], defaultId: 1, cancelId: 0, noLink: true,
      message: `Install eDEX-UI ${download.version}?`,
      detail: kind === "portable"
        ? "eDEX closes, the new version replaces the portable .exe on this drive, and it starts again. Your data folder is kept."
        : "eDEX closes and the installer starts. Your settings are kept."
    }));
    if (response !== 1) return false;
    if (kind === "portable") {
      const target = portable.state().exe;
      if (!target) throw new Error("Can't find the portable .exe to replace");
      const script = [
        "$src = $env:EDEX_UPDATE_SRC; $dst = $env:EDEX_UPDATE_DST",
        "for ($i = 0; $i -lt 120; $i++) {",
        "  try { Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop; $ok = $true; break } catch { Start-Sleep -Milliseconds 500 }",
        "}",
        "if ($ok) { Remove-Item -LiteralPath $src -ErrorAction SilentlyContinue }",
        "Start-Process -FilePath $dst"
      ].join("\n");
      spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script], {
        detached: true, stdio: "ignore", windowsHide: true,
        env: { ...process.env, EDEX_UPDATE_SRC: download.file, EDEX_UPDATE_DST: target }
      }).unref();
    } else {
      spawn(download.file, [], { detached: true, stdio: "ignore" }).unref();
    }
    setTimeout(() => app.quit(), 300);
    return true;
  });

  handle("updates:skip", (_e, version) => {
    settings.set({ updateSkip: typeof version === "string" ? version.slice(0, 32) : "" });
    return true;
  });

  handle("updates:openPage", async () => {
    windows.yieldFocus();
    await shell.openExternal(latest?.url || (slug ? `https://github.com/${slug}/releases/latest` : "https://github.com"));
    return true;
  });

  return { stop: () => { clearTimeout(startTimer); clearInterval(dailyTimer); } };
}

module.exports = { registerUpdates, newer, parseVersion };
