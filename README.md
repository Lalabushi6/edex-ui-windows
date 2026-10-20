<p align="center">
  <br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/logo-dark.svg">
    <img alt="eDEX-UI Windows Edition" src="media/logo-light.svg" width="560">
  </picture>
  <br><br>
  <a href="https://github.com/Lalabushi6/edex-ui-windows/actions/workflows/build.yml"><img alt="Build" src="https://github.com/Lalabushi6/edex-ui-windows/actions/workflows/build.yml/badge.svg"></a>
  <a href="https://github.com/Lalabushi6/edex-ui-windows/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Lalabushi6/edex-ui-windows?label=release&color=aacfd1"></a>
  <a href="https://github.com/Lalabushi6/edex-ui-windows/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/Lalabushi6/edex-ui-windows/total?color=aacfd1"></a>
  <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue"></a>
  <br>
  <img alt="Windows 10 / 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white">
  <img alt="Electron 41" src="https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white">
  <img alt="64-bit" src="https://img.shields.io/badge/arch-x64-555">
  <br>
  <a href="https://github.com/Lalabushi6/edex-ui-windows/releases/latest/download/eDEX-UI-Setup.exe"><img alt="Download the Windows installer" src="https://badgen.net/badge/Windows/Installer%20(.exe)/blue?icon=windows"></a>
  <a href="https://github.com/Lalabushi6/edex-ui-windows/releases/latest/download/eDEX-UI-Portable.exe"><img alt="Download the portable exe" src="https://badgen.net/badge/Windows/Portable%20(.exe)/cyan?icon=windows"></a>
  <br>
  <a href="https://github.com/GitSquared/edex-ui"><strong><i>(A Windows desktop-shell rebuild of GitSquared's eDEX-UI, archived Oct. 18th 2021)</i></strong></a>
  <br><br><br>
</p>

**eDEX-UI Windows Edition** is a fullscreen, sci-fi **desktop shell for Windows**:
a launcher, a window dock, tabbed terminals with split panes, a file explorer,
a media player and live system telemetry, all on one surface in the style of
[eDEX-UI](https://github.com/GitSquared/edex-ui). You launch apps, switch
windows, browse and open files, play media, run terminals and watch your system
without ever dropping back to the Windows desktop. It can even **take over the
desktop** completely, hiding the taskbar while it's on screen.

It keeps everything that made the original special: the grid backdrop, the
"PANEL / SYSTEM" captions, the kernel-log boot sequence, the ENCOM globe, the
on-screen keyboard, the sound design and all the themes. Like the original, it's
heavily inspired by the *TRON Legacy* movie effects and Seena's
[DEX-UI](https://github.com/seenaburns/dex-ui). On top of that it's rebuilt from
scratch as something you can use every day on Windows, light on resources and
locked down.

<p align="center">
  <img alt="eDEX-UI Windows Edition: Tron theme, split terminal, telemetry panels" src="media/screenshot_default.png">
</p>

<p align="center">
  <em>Jump to: <br>
    <a href="#features">Features</a>
    — <a href="#screenshots">Screenshots</a>
    — <a href="#keyboard-shortcuts">Keyboard shortcuts</a>
    — <a href="#questions--answers">Questions &amp; Answers</a>
    — <a href="#download">Download</a>
    — <a href="#useful-commands-for-the-nerds">Commands for the nerds</a>
    — <a href="#security-model">Security</a>
    — <a href="#credits">Credits</a>
  </em>
</p>

## Features

### A desktop shell, not just a terminal
- **Two modes.** *Desktop*: full screen and sitting *behind* your apps, so it
  acts as your desktop; launch an app and it opens on top, close it and you're
  back in eDEX. *Overlay*: an always-on-top HUD you summon and dismiss with the
  global hotkey (`` Ctrl+` ``); it can hide itself when it loses focus or after
  launching something.
- **Desktop takeover.** eDEX fills the whole screen edge to edge (square
  corners, no border, exact physical pixels at any display scaling) and stands
  in for the Windows desktop. In Desktop mode the Windows taskbar is hidden
  while eDEX is showing and set to auto-hide, so maximised apps use the full
  screen; eDEX's dock lists your windows instead. *Show desktop* (Win+D) and
  *Minimise all* bring you back to eDEX. The taskbar is always restored when you
  hide eDEX, turn takeover off or quit, even after a crash or Ctrl+C in the
  console that started it. A dock button shows the taskbar for 15 seconds
  whenever you need the tray icons.
- **Launcher** (`Ctrl+Shift+Space`, works from any app): installed apps (Start
  menu, Store apps, desktop shortcuts), open windows, recent and indexed files,
  commands, themes, Windows Settings pages, plus:

  | Type | Result |
  |---|---|
  | an app / window / file name | Start-menu apps, Store apps, desktop shortcuts, open windows, recent files and your user folders |
  | any name | **On this PC**: matches anywhere the Windows Search index covers |
  | `"budget 2026"` (in quotes) | **Inside files**: documents containing those words |
  | `>` then text | commands (new tab, settings, themes, layouts, power, media …) |
  | `=2*(3+4)^2` | calculator (Enter copies the result) |
  | `10 km to mi`, `72 f in c`, `5 gb to mib`, `90 kmh to mph` | unit conversion: length, mass, volume, area, speed, time, data, energy, power, temperature |
  | `timer 5m tea`, `remind 1h30m stretch`, `stopwatch` | starts the Timer widget's countdown (alarm + Windows notification) or stopwatch |
  | `pomodoro`, `focus` | starts a focus session |
  | `$ ipconfig /all` | runs the command in the active terminal (or a new one) |
  | `? how do I find large files` | asks Claude (optional AI assistant) |
  | `C:\Users\` | browse paths; Tab completes the highlighted folder |
  | `example.com` | opens in your browser |
  | anything else | web search (engine set in Settings) |

  `Enter` opens, `Ctrl+Enter` reveals the file location (or closes a window),
  `Tab` cycles the All / Apps / Windows / Files / Commands filters, right-click
  a result to pin it to the dock, run as administrator or open its location.
  Frequently used results rank higher.
- **Dock**: an apps button, pinned apps, and every open window (click to
  switch, click the active one to minimise, middle-click to close,
  right-click to maximise, close or **snap**: left/right half, or **Snap
  layouts…** with halves, quarters, thirds, two-thirds, centre and maximise on
  the monitor the window is on).
- **Window arrangements**: lay out the front-most visible windows *side by
  side*, in *three columns* or a *grid*, or **save an arrangement** that
  remembers where every window is. Restoring it moves each window back, starts
  programs that aren't running and re-minimises the ones that were minimised.
- **Multi-monitor HUD**: every display except the main one shows eDEX's
  telemetry panels, the globe and a large clock. It sits behind your windows
  on that display like a desktop does, and hides and returns with eDEX.
- Tray icon, single instance, start with Windows (straight onto the screen
  when it has taken over the desktop), session restore of tabs and split
  panes, close-to-tray.

### Terminal
- **Tabs** for PowerShell, PowerShell 7, Command Prompt, WSL and Git Bash
  (whichever are installed), via `node-pty` and `xterm.js`, drawn on the GPU
  (WebGL) for fast output, with the terminal colours tinted to the theme.
- **Split panes**: up to four per tab (side by side, stacked, or 2 × 2), each
  with its own shell starting in the same folder. `Alt+Shift+=` / `Alt+Shift+-`
  (or `Ctrl+Shift+D`) split, `Alt`+arrows move between panes, `Ctrl+Shift+W`
  closes the focused pane. Input, find, the on-screen keyboard and the file
  browser follow the focused pane.
- **Find in terminal** (`Ctrl+Shift+F`, Enter / Shift+Enter, match case),
  clickable links (`Ctrl`+click), Windows Terminal-style copy / paste
  (right-click copies a selection or pastes), font zoom (`Ctrl+=` / `Ctrl+-` /
  `Ctrl+0`), restart a shell that exited with Enter, rename tabs.
- **Explain with Claude**: Shift+right-click → send the selection or the last
  screenful of output to the AI assistant.
- The shell's working directory is tracked (OSC 7 / OSC 9;9 or the prompt), so
  the file browser panel and the Git widget follow it.

### Files
- **File explorer tabs**: list and grid views (with **picture, video and PDF
  thumbnails** from Windows' own thumbnail cache), sorting, filter,
  breadcrumbs, type-a-path, copy / cut / paste, rename in place, drag files out
  to other apps or in from Windows Explorer (same drive moves, other drive
  copies; Ctrl / Shift to force), Recycle Bin deletes, pins, recents, "Open
  with…", "Open terminal here" and the Windows Properties sheet.
- **Quick-look viewer** (`Space`): images, audio, video, PDF and text, with
  in-place editing of text files (`Ctrl+S`), ← → to step through a folder.
- **eDEX file browser panel**: the original's filesystem panel, in the bottom
  strip beside the keyboard or under the panel columns, following the
  terminal's folder (and changing the shell's directory when it's at a
  prompt).
- **Whole-PC search** through the Windows Search index, by name or text inside
  documents, right in the launcher.
- **Disk usage map**: scan a drive or folder (on a background thread; a whole
  SSD takes seconds to a minute) and see a sunburst of what fills it: hover for
  size and share, click a ring to drill in, the centre to go back up, plus a
  list of the largest folders and files. Junctions and symlinks aren't
  followed, so nothing is counted twice.
- **Process manager**: name, PID, CPU, memory, threads and path, sortable and
  filterable; open a process's file location, copy its name or path, or end
  it (with confirmation; critical system processes are refused).

### System monitoring
- **Telemetry widgets**: clock with world clocks, system (host, OS, model,
  chassis, power), CPU (per-core load, speed, temperature where readable),
  memory and swap, GPU utilisation and memory, drives and disk I/O, top
  processes and network traffic.
- **World view**: the original ENCOM hex-tile globe with orbiting satellites,
  your location pin and connection arcs to reference cities (with latency);
  falls back to a canvas globe without WebGL.
- **Top bar**: what's playing, media keys, master volume with a **per-app
  volume mixer and output-device switch**, display brightness (laptop panels),
  screen snip, **Bluetooth** (radio on/off, paired devices and which are
  connected), network with a **Wi-Fi panel** (current connection, nearby
  networks, connect / disconnect), battery with **health** (capacity against
  design, charge cycles, chemistry), a clock with a month calendar and
  **events with reminders**, settings and a power menu (lock, sleep, sign out,
  restart, shut down).
- **Alerts**: low battery (and again at half that level) and low disk space,
  shown in eDEX and as Windows notifications while it's hidden.

### Media
- **Media player** (`Ctrl+Shift+M`): playlists with drag-to-reorder, shuffle
  and repeat, MP3 tags and cover art, video playback, a spectrum visualizer,
  resume where you left off, Windows media keys, and a "Now playing" widget.
  Playback continues when the tab is closed. Plays MP3, AAC/M4A, FLAC, WAV,
  Ogg/Opus, MP4 (H.264), WebM and most MKV files.
- **10-band equalizer** (32 Hz to 16 kHz, ±12 dB) with presets (Bass boost,
  Treble boost, Vocal, Rock, Electronic, Acoustic, Loudness, Late night) and
  your own curves; boosts are balanced so loud tracks don't distort.
- **System-wide Now playing**: whatever Spotify, a browser, VLC or any other
  app reports to Windows (title, artist, cover art, play / pause / skip and
  seek) in the Media widget and the top bar.

### Productivity tools
- **Tasks** with reminders written in plain words: `call mum at 6pm`,
  `report in 2h`, `dentist tomorrow 9:30`, `gym friday`. Reminders ring and
  notify even while eDEX is hidden; ones missed while it was closed show once
  at startup.
- **Calendar events** with optional reminders (at the time, 5 / 15 / 30 /
  60 minutes or a day before), marked on the calendar and listed in the Tasks
  widget on the day.
- **Timer, stopwatch (with laps) and a pomodoro focus timer** (25 / 5 / 15
  minutes, configurable; breaks start on their own). A finished countdown
  plays the alarm and shows a Windows notification, even while eDEX is
  hidden.
- **Screen time**: how long each program has been the focused window today and
  over the past week, with optional daily limits that nudge you once a day.
  Kept on this PC only, for two weeks.
- **Git widget**: branch, commits to push / pull, staged / changed / new file
  counts, the last commit and the changed files for the terminal's folder.
- **Command widgets**: any PowerShell or cmd command's output as a panel,
  refreshed on a schedule (disk space, uptime, a status API, `git log` …).
- **AI assistant** (optional, your own Anthropic API key): ask Claude from the
  launcher (`? question`), with `Ctrl+Shift+J`, or "Explain with Claude" on
  terminal output. Answers stream in; commands in them run in the terminal
  with one click. Choose Claude Opus 5.5, Sonnet 5.5 or Haiku 5.5.
- **Weather** with a four-day forecast, **notes** (auto-saved), **clipboard
  history** (memory only, never written to disk) and **quick links**.

### Look and feel
- **The eDEX-UI look**: the original's grid backdrop, "PANEL / SYSTEM"
  captions, ruled modules, slanted shell tabs, clipped-corner frames, logo,
  kernel-log boot sequence with the glitching title, and sound effects.
- **25 themes** from the original (with their globe colours and colour
  filters): Apollo, Blade, Chalkboard, Cyberpunk Red, Cyborg, Default,
  Interstellar, Matrix, Navy, Nord, Red, Tron, Worldview v2 and their
  *disrupted / notype / typeleft / fulltype / focus / ligatures / colorfilter*
  variants, plus the bundled **Ember** theme for the classic orange look.
- **Theme editor** with live preview (every colour, interface and terminal
  fonts, terminal palette, globe, layout hints, theme CSS), import / export of
  eDEX-UI theme files, and a **custom CSS** stylesheet with documented hooks
  (see [THEME_GUIDE.md](THEME_GUIDE.md)).
- **Layout presets**: *Shell* (top bar, dock, both columns), *Original
  eDEX-UI* (no top bar or dock; file browser and keyboard along the bottom),
  *Keyboard left*, *Panels left / right* and *Focus*. Every region can be shown,
  hidden or moved, both panel columns can sit on one side, widgets drag to
  reorder.
- **On-screen keyboard** with all 19 eDEX-UI layouts: English (US, UK,
  Dvorak, Colemak, Workman, Norman), French (AZERTY, BÉPO), German, Spanish
  (Spain, Latin America), Italian, Portuguese (Brazil), Dutch (Belgium),
  Danish, Swedish, Hungarian and Turkish (F, Q), plus your own custom layouts:
  Shift / Caps / Ctrl / AltGr / Fn layers, dead keys for accents, password
  mode. It types into the terminal, any text field, or triggers app shortcuts.
- **Boot logo**: your own title or ASCII art (pasted, loaded from .txt / .nfo /
  .ans, or generated as block letters), scaled to fit the screen.
- **Idle screen and animated backgrounds**: matrix rain, hex grid, starfield
  or globe, in the theme colour.
- Interface scaling, 12 / 24-hour clock, Celsius / Fahrenheit.

### Light on resources
- System readings come from **one long-lived native helper** (no process
  launches while running); a second helper handles slow calls (media
  sessions, Bluetooth, search, disk scans) so the panels never wait.
- Every panel refreshes from **one shared scheduler**, and **nothing runs while
  eDEX is hidden**, minimised or covered.
- **Performance profiles** (Auto / Performance / Balanced / Eco; Auto switches
  to Eco on battery or battery saver) set refresh rates and animation frame
  rates; Settings → Performance shows eDEX's own CPU and memory use.

### Settings backup
- Export / import every setting, your custom themes and keyboard layouts as
  one file, to keep or move to another PC. Importing a file that contains
  command widgets asks before allowing them.

## Screenshots

![Default screenshot](media/screenshot_default.png)

<p align="center"><i>Tron theme (default): a terminal split in two between the system panels (clock, CPU, memory, GPU) and the network, world view, media and weather panels.</i></p>

![Original layout screenshot](media/screenshot_classic.png)

<p align="center"><i>The "Original eDEX-UI" layout preset in the Blade theme: no top bar or dock, the file browser and on-screen keyboard along the bottom.</i></p>

![Disk usage screenshot](media/screenshot_disk.png)

<p align="center"><i>The disk usage map in the Ember theme: drill into what's filling a drive.</i></p>

![Launcher screenshot](media/screenshot_launcher.png)

<p align="center"><i>The launcher in command mode (Nord theme): apps, windows, files, commands, settings, conversions and more from one box.</i></p>

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Shift+Space` | Launcher (works from any app) |
| `` Ctrl+` `` | Show / hide eDEX (works from any app) |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+A` | Switch window |
| `Ctrl+Shift+T` / `Ctrl+Shift+E` | New terminal / explorer tab |
| `Ctrl+Shift+W` | Close tab (or the focused split pane) |
| `Ctrl+Tab`, `Ctrl+1…9` | Switch tabs |
| `Alt+Shift+=` / `Alt+Shift+-` / `Ctrl+Shift+D` | Split the terminal right / down |
| `Alt`+arrows | Move between split panes |
| `Ctrl+Shift+F` | Find in terminal (or find files outside a terminal) |
| `Ctrl+Shift+K` | On-screen keyboard |
| `Ctrl+Shift+M` | Media player |
| `Ctrl+Shift+J` | Ask Claude (AI assistant) |
| `Ctrl+Shift+S` | Export a system snapshot (JSON, saved to Documents) |
| `Ctrl+,` | Settings |
| `F1` | Shortcut sheet |

The two global hotkeys can be changed in Settings → General. The full list,
including the explorer, media player and keyboard keys, is in
[USER_MANUAL.md](USER_MANUAL.md).

## Questions & Answers

#### How do I get it?
Download the installer or the portable `.exe` from the
[Releases](https://github.com/Lalabushi6/edex-ui-windows/releases/latest) page
(see [Download](#download) below), or build it yourself from source
([Useful commands for the nerds](#useful-commands-for-the-nerds)).

#### Can I use it as my actual desktop?
Yes, that's the point. Settings → General → **Take over the desktop** (also in
the tray menu and the launcher) makes eDEX fill the whole display and hide the
Windows taskbar while it's on screen. Turn on **Start with Windows** and it
opens straight onto the screen at sign-in. Your taskbar always comes back when
you hide eDEX (`` Ctrl+` ``), turn takeover off or quit.

#### The taskbar stayed hidden after eDEX crashed. What do I do?
Start eDEX again: it notices and puts the taskbar back. (eDEX's helper process
also restores it when eDEX dies, so this should be rare.)

#### Windows SmartScreen says the app is unrecognised.
The executables aren't code-signed (that needs a paid certificate), so
SmartScreen warns the first time. Click **More info → Run anyway**. The builds
are made in the open by GitHub Actions from this repository's source.

#### Can you disable the keyboard / the file browser / the top bar?
Yes. Settings → Layout shows, hides or moves every region (top bar, dock, both
panel columns, on-screen keyboard, file browser) and every widget, or pick a
preset. `Ctrl+Shift+K` toggles the keyboard. With the top bar and dock hidden,
`Ctrl+Shift+Space` still opens the launcher and `Ctrl+,` the settings.

#### How do I switch themes and layouts?
Settings → Appearance for themes (or type `>theme` in the launcher), Settings →
Layout for layout presets (or `>layout`). Some of the original's themes
(*disrupted*, *notype*, *typeleft*, *fulltype*) also move panels around; turn
that off with "Themes can change the layout".

#### Does it send anything over the internet?
Only if you let it. With **Outbound lookups** on (the default), the world-view
globe looks up your approximate location from your public IP and checks
latency to a few public sites, and the weather widget fetches a forecast.
Turn it off under Settings → Privacy and eDEX makes no outbound requests at
all. The AI assistant is off until you add your own API key, and only sends
what you ask. Whole-PC search, the disk map, Bluetooth, Now playing and the
mixer work locally through Windows. See [Security model](#security-model).

#### What does the AI assistant cost, and is my key safe?
It uses your own Anthropic API key (console.anthropic.com), billed to your
API account. The key is encrypted with your Windows account (DPAPI), never
shown again, and only sent to Anthropic's API (api.anthropic.com) when you
ask something. Pick Claude Opus 5.5 for the best answers, or Sonnet 5.5 /
Haiku 5.5 for faster, cheaper ones. If Opus or Sonnet declines a
request, the API retries it on a fallback model automatically. Commands in
answers only run when you click **Run in terminal**.

#### How heavy is it on my PC?
Light for what it shows: telemetry comes from one long-lived helper, every
panel shares one refresh timer, and nothing refreshes or animates while eDEX is
hidden, minimised or covered. On battery the Auto profile switches to Eco.
Settings → Performance shows eDEX's own CPU and memory use per process. The
download is about 100 MB (most of it is the Electron runtime).

#### Where are my settings? Can I move them to another PC?
In `%APPDATA%\eDEX-UI` (settings, notes, tasks, themes, keyboard layouts,
screen time). Settings → About → **Back up settings** exports everything to
one file and imports it elsewhere. Settings from the original eDEX-UI
(`%USERPROFILE%\.edex-ui-settings.json`) are imported on first run.

#### Does it run on Windows 10, ARM, macOS or Linux?
Windows 10 (version 1809 or newer) and Windows 11, 64-bit (x64); there's no
native ARM64 build. The shell
features talk to Windows directly (window management, the taskbar, Core Audio,
media sessions, Windows Search), so there's no macOS or Linux build; the
[original eDEX-UI](https://github.com/GitSquared/edex-ui) still runs there.

#### Is this the official eDEX-UI?
No. The original by GitSquared was archived on October 18th, 2021. This is an
independent rebuild for Windows that reuses its look, themes, keyboard layouts,
sounds and globe (GPL-3.0) and adds the desktop-shell features.

#### I have a problem!
Check the troubleshooting section of [USER_MANUAL.md](USER_MANUAL.md), then
open an issue with what happened and your Windows version. For security
problems, see [SECURITY.md](SECURITY.md) instead.

#### How did you make this?
Electron, xterm.js and node-pty for the terminals, plain ES modules for the
interface (no framework), and a long-lived PowerShell helper that compiles a
small C# library on first run to reach Win32, Core Audio, WinRT and Windows
Search without spawning processes. The globe is the original's ENCOM globe.

#### This is so cool.
Thanks! Most of the credit for the look goes to the original
[eDEX-UI](https://github.com/GitSquared/edex-ui).

## Download

Grab the latest build from the
[Releases](https://github.com/Lalabushi6/edex-ui-windows/releases/latest)
page:

| File | What it is |
|---|---|
| [`eDEX-UI-Setup.exe`](https://github.com/Lalabushi6/edex-ui-windows/releases/latest/download/eDEX-UI-Setup.exe) | Installer: per user, no admin rights, choose the folder, Start menu and desktop shortcuts, uninstaller (your settings are kept). |
| [`eDEX-UI-Portable.exe`](https://github.com/Lalabushi6/edex-ui-windows/releases/latest/download/eDEX-UI-Portable.exe) | A single file that runs without installing; settings go to `%APPDATA%\eDEX-UI` like the installed version. |

Requirements: Windows 10 (1809) or 11, 64-bit. The executables aren't
code-signed, so SmartScreen may warn the first time: **More info → Run
anyway**. Every push also produces test builds under the repository's
**Actions** tab (see [Getting the bleeding edge](#getting-the-bleeding-edge)).

Read [USER_MANUAL.md](USER_MANUAL.md) for everything eDEX can do, and
[THEME_GUIDE.md](THEME_GUIDE.md) to make your own themes.

## Useful commands for the nerds

**IMPORTANT NOTE:** You need [Node.js](https://nodejs.org) 20 or newer and Git.
No Developer Mode, admin rights or code-signing certificate is needed.

#### Starting from source:

```bash
git clone https://github.com/Lalabushi6/edex-ui-windows.git
```

```bash
cd edex-ui-windows
```

```bash
npm install
```

```bash
npm start
```

Or double-click [`launch.bat`](launch.bat), which runs `npm start` from the
project folder (handy for a desktop shortcut).

Environment variables for development:

| Variable | Effect |
|---|---|
| `EDEX_DEV_WINDOWED=1` | Run in a normal resizable window instead of full screen (what `npm run dev` sets) |
| `EDEX_HUD_PREVIEW=1` | With `EDEX_DEV_WINDOWED=1` on a single-monitor PC, opens the multi-monitor HUD as a window so you can see it |

#### Building:

| Command | What it does |
|---|---|
| `npm start` | Run eDEX from source (full screen) |
| `npm run dev` | Run it in a resizable window |
| `npm run check` | Static checks (syntax, imports, themes, keyboard layouts) |
| `npm run dist` | Build the installer and portable `.exe` into `dist/` |
| `npm run dist:dir` | Build just the unpacked app (`dist/win-unpacked/eDEX-UI.exe`) |

How the build works:
- [electron-builder](https://www.electron.build) packages the app into
  `app.asar` and makes an NSIS installer (`eDEX-UI-Setup.exe`) and a portable
  executable (`eDEX-UI-Portable.exe`).
- The icon and version details are stamped onto `eDEX-UI.exe` by
  [`build/afterPack.js`](build/afterPack.js) with `rcedit`. electron-builder's
  own executable editing (`win.signAndEditExecutable`) is off because its
  helper bundle can't be unpacked without Windows Developer Mode.
- The packaged app is hardened with **Electron fuses**: no `--inspect`, no
  `NODE_OPTIONS`, code loads only from the app archive, cookies are encrypted.
  (`runAsNode` stays on because node-pty needs it.)
- Unneeded dependency files (sources, docs, tests, other platforms' binaries)
  are left out of the package.

#### Getting the bleeding edge:

**GitHub Actions** ([`.github/workflows/build.yml`](.github/workflows/build.yml))
builds both executables on every push and pull request. Open the
[Actions](https://github.com/Lalabushi6/edex-ui-windows/actions) tab → the
latest **Build** run → **Artifacts** → `eDEX-UI-windows` (kept for 90 days).

#### Releasing:

```bash
npm version patch
```

```bash
git push --follow-tags
```

Pushing a version tag (`v2.0.1`) makes the workflow publish a GitHub Release
with both executables and generated release notes. See
[docs/PUBLISHING.md](docs/PUBLISHING.md) for putting the project on GitHub,
cutting releases and fixing common problems.

#### Project layout:

```
src/main/            Electron main process
  main.js            lifecycle, single instance, hotkeys, IPC registration
  window.js          desktop / overlay window modes
  hud.js             multi-monitor HUD windows
  settings.js        typed settings schema, validation, v1 migration
  tray.js            tray icon and menu
  preload.js         the renderer's only bridge (window.edex)
  ipc/               terminal, system, files, desktop (apps/windows/media keys/power), media player,
                     audio mixer, now playing, Bluetooth, disk usage, window arrangements,
                     tools (command widgets, git, battery health, tasks, settings backup), AI, extras
  lib/               protocols, path policy, cache, JSON store, telemetry, icon service,
                     takeover, screen time, alerts
  native/bridge.ps1  long-lived PowerShell helper for Win32 / Core Audio / WinRT / Windows Search;
                     a second instance handles slow calls (media sessions, Bluetooth, search, disk scans)
src/renderer/        UI (ES modules served from app://edex)
  js/core/           DOM builder, settings, theme, commands/hotkeys, scheduler,
                     shared telemetry feeds, UI kit
  js/widgets/        side-column widgets (incl. tasks, git, command widgets)
  js/workspace/      tabs: terminal (split panes), explorer, process manager, media player, disk usage
  js/shell/          top bar, dock, launcher, settings, viewer, keyboard, boot, mixer, Bluetooth,
                     battery, now playing, window arrangements, agenda, AI panel, idle screen, effects
  js/media/          media player engine
  lib/encom-globe.js the ENCOM globe (from eDEX-UI)
themes/              built-in themes (JSON, eDEX-UI format)
keyboards/           on-screen keyboard layouts (JSON, eDEX-UI format)
build/               app icon and the afterPack hook (rcedit)
scripts/             check.js
media/               README logo and screenshots
docs/                PUBLISHING.md (GitHub and releases)
.github/workflows/   build.yml (installer + portable exe, releases)
```

#### Documentation:

| File | What's in it |
|---|---|
| [USER_MANUAL.md](USER_MANUAL.md) | Everything eDEX does: layout, modes, launcher, dock, terminal, explorer, media, keyboard, tools, settings, privacy, troubleshooting |
| [THEME_GUIDE.md](THEME_GUIDE.md) | Making and editing themes, custom CSS hooks |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | Putting the project on GitHub, automatic builds, releases |
| [SECURITY.md](SECURITY.md) | Reporting security problems, how eDEX is built to be safe |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Credits and licences of included work |

## Security model

- **Renderer**: `contextIsolation`, `sandbox`, no Node integration, strict CSP
  (scripts only from the bundle), served from a custom `app://` origin.
  Navigation, new windows and `<webview>` are blocked, and so are downloads and
  web permission requests (camera, microphone, location, devices); only
  fullscreen is granted.
- **IPC**: every handler checks that the calling frame is the bundled UI and
  validates its arguments; settings are coerced against a typed schema.
- **Paths** are resolved through symlinks/junctions before any check.
  Credential stores and token files (`.ssh`, `.aws`, `.gnupg`, `.azure`,
  `.kube`, `.docker`, `.git-credentials`, `.npmrc`, `.netrc`, the GitHub CLI
  login, browser profiles, the Windows credential vault and DPAPI keys, eDEX's
  own encrypted API key …) are never readable. Writes are refused in Windows,
  Program Files, ProgramData, on drive roots and on network paths.
- **Deleting** moves items to the Recycle Bin.
- **Confirmations the UI can't fake**: running an executable from the explorer
  outside the Start menu / Desktop, ending a process and power actions are
  confirmed by the main process; critical system processes are refused
  outright. Importing a settings file that contains command widgets lists
  their commands and asks first.
- **Local files** reach the UI only through the read-only `localfile:`
  protocol (images and media), which refuses credential stores and anything
  that resolves to a network share; page scripts can't `fetch` them.
- **The Git widget** won't inspect a repository whose own config would make Git
  start programs (fsmonitor, clean/smudge filters, includes).
- **Packaged builds** disable Node inspection and `NODE_OPTIONS` and load code
  only from the app archive (Electron fuses).

**Privacy:** the world-view globe looks up your public IP location (ipapi.co,
falling back to ipinfo.io) and checks latency to google.com and twelve public
sites; the weather widget fetches a forecast for that approximate location
from open-meteo.com. Turn all of this off under Settings → Privacy. Clipboard
history is never written to disk. Screen time stores only program names and
durations, on this PC, for two weeks. The AI assistant is off until you add
your own key and sends only what you ask. Report problems as described in
[SECURITY.md](SECURITY.md).

## Credits

The look, themes, keyboard layouts, logo and icons, interface sounds, fonts,
boot log and globe come from [eDEX-UI](https://github.com/GitSquared/edex-ui)
by Gabriel "Squared" SAILLARD ([@GitSquared](https://github.com/GitSquared))
and contributors (GPL-3.0), whose sound effects were composed by IceWolf. The
globe is their fork of Rob Scanlon's
[ENCOM Globe](https://github.com/arscan/encom-globe) (MIT), bundled with
three.js r66, tween.js, quadtree2 and pusher's vec2 helpers (all MIT). The
fonts are United Sans (from eDEX-UI) and Fira Mono / Fira Code (SIL Open Font
License 1.1). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This Windows edition, its desktop-shell features and the rebuild are by
[Lalabushi6](https://github.com/Lalabushi6).

## Thanks

To [GitSquared](https://github.com/GitSquared) and everyone who worked on
eDEX-UI, which this project rebuilds for Windows, and to
[Seena](https://github.com/seenaburns), whose
[DEX-UI](https://github.com/seenaburns/dex-ui) (first shared on
[r/unixporn](https://reddit.com/r/unixporn)) inspired the original.

And to the open-source projects eDEX runs on (the full list is in
[package.json](package.json)):
[Electron](https://github.com/electron/electron),
[electron-builder](https://github.com/electron-userland/electron-builder),
[xterm.js](https://github.com/xtermjs/xterm.js) and its fit, search and WebGL
addons, [node-pty](https://github.com/microsoft/node-pty),
[systeminformation](https://github.com/sebhildebrandt/systeminformation),
[rcedit](https://github.com/electron/node-rcedit), the
[ENCOM Globe](https://github.com/arscan/encom-globe), the
[Fira](https://github.com/mozilla/Fira) and
[Fira Code](https://github.com/tonsky/FiraCode) fonts,
[Open-Meteo](https://open-meteo.com) for the weather data (CC BY 4.0), and
Anthropic's [TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
behind the optional AI assistant.

## Licensing

Licensed under the [GPLv3.0](https://github.com/Lalabushi6/edex-ui-windows/blob/main/LICENSE),
because it includes code and assets from the original eDEX-UI (GPL-3.0). See
[LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
