# eDEX-UI — Windows Edition

A full-screen, sci-fi desktop shell for Windows in the style of
[eDEX-UI](https://github.com/GitSquared/edex-ui). Launch apps, switch windows,
browse and open files, play media, run terminals and watch live system
telemetry from one surface — without dropping back to the Windows desktop.

## Features

- **Launcher** (`Ctrl+Shift+Space`, works from any app): installed apps (Start
  menu, Store apps, desktop shortcuts), open windows, recent and indexed files,
  commands, themes, Windows Settings pages, a calculator (`=2*(3+4)`), path
  browsing with Tab completion (`C:\Users\`) and web search.
- **Dock**: pinned apps plus every open window — click to switch, click again
  to minimize, right-click to maximize or close.
- **Terminal tabs**: PowerShell, PowerShell 7, Command Prompt, WSL and Git Bash
  (whichever are installed) via `node-pty` + `xterm.js`. Clickable links,
  copy/paste, font zoom, restart on exit.
- **File explorer tabs**: list/grid views, sorting, filter, breadcrumbs,
  copy/cut/paste, rename in place, drag files out to other apps or in from
  them, Recycle Bin deletes, pins, recents, "Open with…", Windows Properties.
- **Quick-look viewer**: images, audio, video, PDF and text, with in-place
  editing of text files (`Ctrl+S`).
- **Process manager**: sortable, filterable, end process.
- **The eDEX-UI look**: the original's grid backdrop, "PANEL / SYSTEM"
  captions, ruled modules, slanted shell tabs, clipped-corner frames, logo,
  kernel-log boot sequence with the glitching title, and terminal colours
  tinted to the theme.
- **World view**: the original ENCOM hex-tile globe with orbiting satellites,
  your location pin and connection arcs to reference cities (with latency);
  falls back to a canvas globe without WebGL.
- **Media player** (`Ctrl+Shift+M`): playlist with drag-to-reorder, shuffle
  and repeat, MP3 tags and cover art, video playback, spectrum visualizer,
  resume where you left off, Windows media keys, and a "Now playing" widget.
  Playback continues when the tab is closed.
- **Telemetry widgets**: clock with world clocks, system, CPU (per core), memory,
  GPU utilisation, drives and disk I/O, top processes and network traffic.
- **Tools**: notes (auto-saved), clipboard history (memory only), quick links.
- **Top bar**: media keys, master volume slider, network, battery, clock,
  settings and power menu (lock, sleep, sign out, restart, shut down).
- **Two modes**: *Desktop* (full screen, sits behind your apps, so it acts as
  your desktop) and *Overlay* (always on top, summoned and dismissed by hotkey).
- Tray icon, single instance, start with Windows, session restore of tabs,
  the original eDEX-UI themes (with globe colours and colour filters) plus your\n  own, drag-to-reorder widgets, interface scaling.

## Getting started

```bash
npm install
```

```bash
npm start
```

`npm run dev` starts it in a resizable window instead of full screen.
`npm run check` runs the static checks. `npm run build` produces an installer
and a portable `.exe` in `dist/`.

The build config sets `win.signAndEditExecutable: false` because
electron-builder's executable-editing tool cannot be unpacked without Windows
Developer Mode (symlink privilege). The app still shows its icon in the
taskbar, tray and installer; to embed the icon in `eDEX-UI.exe` itself, turn
on Developer Mode and remove that flag.

See [USER_MANUAL.md](USER_MANUAL.md) for usage and shortcuts, and
[THEME_GUIDE.md](THEME_GUIDE.md) to make themes.

## Project layout

```
src/main/            Electron main process
  main.js            lifecycle, single instance, hotkeys, IPC registration
  window.js          desktop / overlay window modes
  settings.js        typed settings schema, validation, v1 migration
  tray.js            tray icon and menu
  preload.js         the renderer's only bridge (window.edex)
  ipc/               terminal, system, files, desktop (apps/windows/media keys/power), media player, extras
  lib/               protocols, path policy, cache, JSON store, icon lookup
  native/bridge.ps1  long-lived PowerShell helper for Win32 APIs
src/renderer/        UI (ES modules served from app://edex)
  js/core/           DOM builder, settings, theme, commands/hotkeys, polling, UI kit
  js/widgets/        side-column widgets
  js/workspace/      tabs: terminal, explorer, process manager, media player
  js/shell/          top bar, dock, launcher, settings, viewer, keyboard, boot
  js/media/          media player engine
  lib/encom-globe.js the ENCOM globe (from eDEX-UI)
themes/              built-in themes (JSON, eDEX-UI format)
scripts/             check.js
```

## Security model

- Renderer: `contextIsolation`, `sandbox`, no Node integration, strict CSP
  (scripts only from the bundle), served from a custom `app://` origin.
  Navigation, new windows and `<webview>` are blocked.
- Every IPC handler checks the calling frame is the bundled UI and validates
  its arguments; settings are coerced against a typed schema.
- Paths are resolved through symlinks/junctions before any check. Credential
  stores (`.ssh`, `.aws`, `.gnupg`, browser profiles, Windows credential vault,
  …) are never readable. Writes are refused in Windows, Program Files,
  ProgramData, on drive roots and on network paths.
- Deleting moves items to the Recycle Bin.
- Running an executable from the explorer outside the Start menu / Desktop
  needs a main-process confirmation the UI cannot fake. Ending a process and
  power actions are confirmed the same way; critical system processes are
  refused outright.
- Local files reach the UI only through the read-only `localfile:` protocol
  (images and media); page scripts cannot `fetch` them.

**Privacy:** the world-view globe looks up your public IP location (ipapi.co,
falling back to ipinfo.io) and checks latency to google.com and twelve public
sites. Turn this off under Settings → Privacy. Clipboard history is never
written to disk.

## Credits and license

The look, themes, logo, boot sequence and globe come from
[eDEX-UI](https://github.com/GitSquared/edex-ui) by Gabriel "Squared" SAILLARD
and contributors (GPL-3.0); the globe is their fork of Rob Scanlon's ENCOM
Globe (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This project is licensed under the GNU General Public License v3.0 — see
[LICENSE](LICENSE).