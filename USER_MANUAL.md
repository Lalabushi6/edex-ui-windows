# eDEX-UI Windows Edition — User Manual

## 1. What it is

eDEX-UI is a full-screen shell that sits on top of Windows. From it you can
launch any installed app, switch between open windows, manage files, run
terminals and monitor the machine, so you rarely need the Windows desktop or
taskbar.

## 2. Layout

```
┌──────────────────────── top bar: search · media · volume · status · ⚙ · ⏻ ┐
│ system widgets │        workspace tabs (terminal / files)      │ tools   │
│ clock, CPU,    │                                               │ network │
│ memory, GPU,   │                                               │ globe   │
│ storage, top,  │                                               │ weather │
│ timer          │                                               │ notes … │
└──────────────────────── dock: apps · open windows · tray ──────────────────┘
```

Drag a widget by its title bar to reorder it or move it to the other column.
Hide widgets or whole columns in Settings → Layout.

### Layout presets and regions

Settings → **Layout** rearranges the whole screen. Presets (also in the
launcher as "Layout: …"):

| Preset | Arrangement |
|---|---|
| **Shell** (default) | Top bar, dock, panels either side of the workspace |
| **Original eDEX-UI** | No top bar or dock; file browser and on-screen keyboard along the bottom |
| **Keyboard left** | The same with keyboard and file browser swapped |
| **Panels left / right** | Both panel columns together on one side with the file browser under them; terminal full height |
| **Focus** | Just the workspace, top bar and dock |

Then fine-tune each part: top bar, dock, left / right columns, keyboard, which
side the panel columns sit on, column width, the file browser (off, bottom
strip or under the panels) and its width, and the order of the bottom strip.
With the top bar and dock hidden, `Ctrl+Shift+Space` opens the launcher,
`Ctrl+,` settings and `Ctrl+Shift+A` switches windows.

**File browser panel** — eDEX-UI's filesystem module: it shows the active
terminal's folder (PowerShell and Command Prompt prompts, or shells that send
the standard current-directory sequences) and lists name, type, size and
date. Clicking a folder changes the terminal's directory when the shell is
waiting at a prompt (otherwise the panel browses on its own); clicking a
file previews or opens it. **Show drives** lists drives; the footer shows the
drive's usage and toggles for icon view, hidden files and following the
terminal. Right-click for more.

To get the classic orange look: pick the **Ember** theme (Settings →
Appearance) and the **Original eDEX-UI** preset. Themes marked with a layout
icon (the original's *disrupted*, *notype*, *typeleft*, *fulltype* variants)
also move the panels; turn that off with "Themes can change the layout".

## 3. Modes

| Mode | Behaviour |
|---|---|
| **Desktop** (default) | Covers the screen but stays *behind* other windows. Launch an app and it opens on top; close it and you are back in eDEX. |
| **Overlay** | Always on top. Summon it with the hotkey; it hides itself when it loses focus or after you launch something. |

Switch modes from the badge next to the logo, the tray menu, or Settings →
General. `Ctrl+`` ` shows or hides eDEX from any app; the tray icon does the same.
Closing the window (Alt+F4) hides it to the tray; quit from the power menu or
the tray.

### Desktop takeover

Settings → General → **Take over the desktop** (also in the tray menu and
the launcher, "Toggle desktop takeover") makes eDEX stand in for the Windows
desktop:

- eDEX fills the whole display, taskbar area included, right to the edges
  (Windows 11's rounded window corners and border are switched off for it);
  in Overlay mode it sits above everything.
- In Desktop mode the **Windows taskbar is hidden** while eDEX is on screen
  and set to auto-hide, so maximised apps use the full screen. eDEX's dock
  lists your windows instead.
- If **Show desktop** (Win+D) or **Minimise all** hides eDEX, it comes
  straight back, so you land on eDEX rather than the Windows desktop.
- With **Start with Windows** on, eDEX opens on screen at sign-in (not in the
  tray) while takeover is on.

The taskbar always comes back when you hide eDEX (`Ctrl+``), turn takeover
off or quit, with your own auto-hide setting restored — also when eDEX was
started from a console (`npm start`) and stopped with Ctrl+C or by closing
that console. If eDEX crashes, its helper restores the taskbar; if both are
killed, the next start of eDEX does. The Windows key, Start menu and
notification area keep working (pressing Win shows the taskbar until eDEX
hides it again a moment later), and the **taskbar button in the dock**
(next to the keyboard button) shows it for 15 seconds whenever you need the
tray icons. Settings → General shows the current status.

## 4. Launcher

Press `Ctrl+Shift+Space` (from anywhere in Windows) or click the search bar.

| Type | Result |
|---|---|
| an app name | Start-menu apps, Store apps, desktop shortcuts |
| a window title | switches to that window |
| a file name | recent files and your Desktop / Documents / Downloads / Pictures / Music / Videos, then **On this PC**: matches anywhere the Windows Search index covers |
| `"budget 2026"` (in quotes) | **Inside files**: documents containing those words (Windows Search index) |
| `? how do I find large files` | asks Claude (needs the AI assistant, see section 15) |
| `>` then text | commands (new tab, settings, themes, power, media …) |
| `=2*(3+4)^2` | calculator — Enter copies the result |
| `10 km to mi`, `72 f in c`, `5 gb to mib`, `90 kmh to mph` | unit conversion (length, mass, volume, area, speed, time, data, energy, power, temperature) — Enter copies |
| `timer 5m tea`, `remind 1h30m stretch`, `stopwatch` | starts the Timer widget's countdown (alarm + Windows notification) or stopwatch, even if the widget is hidden |
| `pomodoro`, `focus` | starts a focus session (the Timer widget's Focus mode) |
| `$ ipconfig /all` | runs the command in the active terminal (or a new one) |
| `C:\Users\` | browse paths; Tab completes the highlighted folder |
| `example.com` | opens in your browser |
| anything else | web search (engine set in Settings → General) |

`Enter` opens, `Ctrl+Enter` reveals the file location (or closes a window),
`Tab` cycles the All / Apps / Windows / Files / Commands filters, right-click a
result for more (pin to dock, run as administrator, open file location).

## 5. Dock

- **Apps button** opens the launcher on the app list.
- **Pinned apps**: pin from the launcher (right-click → Pin to dock).
- **Open windows**: click to switch; click the active one to minimize;
  middle-click to close; right-click for maximize / restore / close, **Snap
  left / right half**, or **Snap layouts…** (halves, quarters, thirds, two
  thirds, centre, maximise — on the monitor the window is on).
- **Tray**: on-screen keyboard, process manager, hide eDEX.

**Window arrangements** (launcher: "Window arrangements…", or the commands
"Windows: side by side / three columns / grid"): lay out the front-most
visible windows, or **Save current…** to remember where every window is.
Restoring an arrangement moves each window back, starts programs that
aren't running (Store apps are reported as not found) and minimises the
ones that were minimised.

## 6. Terminal

New tab: `Ctrl+Shift+T` (default shell) or the ⌄ menu for a specific shell.

| Action | Keys |
|---|---|
| Copy selection | `Ctrl+C` (with a selection) or `Ctrl+Shift+C` |
| Paste | `Ctrl+V` or `Ctrl+Shift+V` |
| Right-click | copy selection, or paste when nothing is selected |
| Terminal menu | `Shift`+right-click |
| Font size | `Ctrl+=`, `Ctrl+-`, `Ctrl+0` |
| Open a link | `Ctrl`+click |
| Find in the terminal | `Ctrl+Shift+F` (Enter / Shift+Enter for next / previous, Aa for match case, Esc to close). Outside a terminal the same keys find files. |
| Split pane right / down | `Alt+Shift+=` / `Alt+Shift+-` (or `Ctrl+Shift+D`), or Shift+right-click → Split |
| Move between panes | `Alt`+arrow keys, or click a pane |
| Close the focused pane | `Ctrl+Shift+W` (closes the tab when it has one pane) |
| Explain output with Claude | Shift+right-click → Explain with Claude (the selection, or the last screenful) |

A tab holds up to four panes (side by side, stacked, or 2 × 2), each with its
own shell starting in the same folder. Input, find, the on-screen keyboard
and the file browser panel follow the focused pane, which is outlined.

When a shell exits, press Enter in its tab to restart it. Double-click a tab to
rename it. Tabs (and their split panes) are restored the next time eDEX
starts.

## 7. File explorer

New tab: `Ctrl+Shift+E`.

| Action | Keys / mouse |
|---|---|
| Open | double-click or `Enter` (files open in their default app) |
| Quick preview | `Space` (← → step through files) |
| Rename | `F2` |
| Delete (Recycle Bin) | `Del` |
| Copy / cut / paste | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| New folder | `Ctrl+Shift+N` |
| Up / back / forward | `Backspace` / `Alt+←` / `Alt+→` |
| Type a path | `Ctrl+L` or click the empty part of the address bar |
| Filter | `Ctrl+F` or `/` |
| Select | click, `Ctrl`+click, `Shift`+click, `Ctrl+A` |
| Copy path | `Ctrl+Shift+C` |

Drag files out to other apps (email, chat, editors) or drop files in from
Windows Explorer. Dropping on the same drive moves; on another drive copies.
Hold `Ctrl` to force copy or `Shift` to force move.

Right-click for Open with…, Open terminal here, Pin to sidebar, Add to quick
links, Show in Windows Explorer and Properties.

In **grid view** pictures, videos and PDFs show a preview instead of an
icon. Previews come from Windows' own thumbnail cache, load only for the
items you scroll to, and are never made for network paths.

### Disk usage map

Right-click a folder (or empty space) → **Analyse disk usage**, the tab menu
(⌄ → Disk usage), or the launcher ("Disk usage map"). Pick a drive or a
folder; the scan runs in the background (a whole SSD takes a few seconds to
a minute) and then shows a sunburst: the centre is the current folder, each
ring a level deeper, sized by space used. Hover for name, size and share;
click a ring to drill in, the centre to go back up. The list beside it has
the largest folders and files; right-click for Open in explorer, Terminal
here or Copy path. Junctions and symbolic links aren't followed, so nothing
is counted twice.

## 8. Media player

Open it with `Ctrl+Shift+M`, the tab menu (⌄ → Media player), the launcher
("media player"), or the **Media** widget. Add music and video by:

- dragging files or folders onto the player,
- **Add files** / **Add folder** in the playlist header,
- right-clicking files in the explorer → **Play in media player** or
  **Add to playlist** (folders: **Play folder in media player**),
- the **Media player** button in the quick-look viewer.

| Action | Keys / mouse |
|---|---|
| Play / pause | `Space` or the ▶ button |
| Seek ±5 s | `←` / `→` (or drag the progress line) |
| Previous / next track | `Shift+←` / `Shift+→` |
| Volume | `↑` / `↓`, the volume wedge, or the mouse wheel over it |
| Mute | `M` |
| Fullscreen | `F` or double-click the picture |
| Equalizer | `E` or the equalizer button (three sliders) |
| Play a track | double-click it (or select and press `Enter`) |
| Remove a track | `Del`, or right-click → Remove |
| Reorder | drag tracks in the playlist |

The **equalizer** has ten bands (32 Hz – 16 kHz, ±12 dB) and presets (Bass
boost, Treble boost, Vocal, Rock, Electronic, Acoustic, Loudness, Late
night). Drag a slider to make your own curve, double-click one to reset it.
Boosts are balanced by lowering the overall level slightly, so loud tracks
don't distort. The button is lit while the equalizer is on.

Shuffle and repeat (off → all → one) are on the control bar. MP3 titles,
artists and cover art are read from the file's tags. The playlist, volume
and position are remembered; playback keeps going when you switch tabs or
close the player tab, and Windows' media keys and media overlay control it.
Formats are whatever Chromium plays: MP3, AAC/M4A, FLAC, WAV, Ogg/Opus,
MP4 (H.264), WebM and most MKV files.

## 9. On-screen keyboard

Show it with `Ctrl+Shift+K`, the keyboard button in the dock, or Settings →
Keyboard. It types into the focused text field (launcher, dialogs,
settings), otherwise into the active terminal, otherwise it sends key
presses to whatever has focus (explorer, process list). App shortcuts work
from it too: Shift+Ctrl+T opens a terminal, Fn+1 is F1 (help), and so on.

| Key | Behaviour |
|---|---|
| Shift / Ctrl / AltGr | Tap once for the next key, twice to lock (underlined), again to release |
| Caps | Toggles capitals for letters |
| Fn | Switches the number row to F1–F12 |
| Dead keys (e.g. `^` on French) | Accent the next letter: `^` then `e` → `ê`; twice types the accent itself |
| Hold a key | Repeats |

The bar above the keys shows the layout (click it to switch, open the
custom layouts folder or import a layout), a lock button for **password
mode** (no key highlights or sounds while you type a secret) and a close
button. Physical key presses light up the matching keys.

**Layouts**: all eDEX-UI layouts are included — English (US, UK, Dvorak,
Colemak, Workman, Norman), French (AZERTY, BÉPO), German, Spanish (Spain,
Latin America), Italian, Portuguese (Brazil), Dutch (Belgium), Danish,
Swedish, Hungarian and Turkish (F, Q). **Auto** picks the one matching your
Windows display language.

**Custom layouts**: put eDEX-UI layout files (`.json`) in
`%APPDATA%\eDEX-UI\keyboards` (Settings → Keyboard → Open, or Import…). A
file named like a built-in (`en-US.json`) replaces it; changes apply as soon
as the file is saved. Files that cannot be read are listed in Settings →
Keyboard with the reason. The format is the original's: rows `row_numbers`,
`row_1`, `row_2`, `row_3`, `row_space`; each key has `name` and `cmd` plus
optional `shift_`, `alt_`, `altshift_`, `fn_`, `ctrl_` and `capslck_`
variants; `~~~CTRLSEQ1~~~` is Esc; `ESCAPED|-- SHIFT: LEFT` (and CTRL, ALT,
FN, CAPSLCK) are modifiers; `ESCAPED|-- ICON: ARROW_UP` (DOWN, LEFT, RIGHT)
draws arrows; `ESCAPED|-- ACUTE` (GRAVE, CIRCUM, TREMA, TILDE, CEDILLA,
CARON, BREVE, MACRON, OVERRING, BAR, GREEK, IOTASUB) are dead keys. An
optional top-level `"name"` sets the name shown in the picker.

## 10. Boot logo and ASCII art

Settings → Appearance → **Boot logo** → **Edit…** opens the editor:

- Type a single line for a title, or paste **ASCII art** (several lines).
  Tabs, shared indentation and trailing spaces are cleaned up; the art is
  scaled to fit the screen, keeping every space.
- **Load file…** reads `.txt`, `.nfo`, `.ans`, `.asc` or `.diz` art; old DOS
  (code page 437) files and ANSI colour codes are converted.
- **Block letters…** turns text into big block-letter art (`\n` starts a
  second line); **Presets** has eDEX-UI, your PC name and your user name.
- **Preview boot** plays the title animation full-screen with the art.

Up to 120 lines × 240 columns. Leave it empty for the default logo.

## 11. Top bar and tools

- **Now playing**: when another app plays something (Spotify, YouTube in a
  browser, VLC, Media Player …), its title shows next to the media keys;
  click it for cover art, a seek bar and play / pause / skip. The **Media**
  widget shows the same when eDEX's own player is idle.
- **Volume mixer** (sliders icon next to the volume, or right-click the
  speaker): switch the output device (speakers, headphones, HDMI …) and set
  the volume or mute for each app that's using sound.
- **Bluetooth** (shown when the PC has Bluetooth): turn the radio on or off
  and see paired devices and which are connected. Pairing and connecting
  happen in Windows' Bluetooth settings (the panel links there).
- **Battery** (laptops): click it for charge, time left, battery saver and
  **health** — what the battery holds now against its design capacity, and
  its charge-cycle count, from Windows' battery report.
- **Network** (Wi-Fi / LAN): click it for the Wi-Fi panel — the current
  connection (band, security, speed) with Disconnect, nearby networks with
  signal and security, **Connect** for saved networks and **Join…** (Windows
  Wi-Fi settings) for new ones that need a password. Windows 11 may ask for
  location access before it lists networks; the panel links to that setting.
- **Clock**: click it for a month calendar with ISO week numbers (scroll or
  use the arrows to change month, **Today** to jump back). Days with events
  have a dot; click a day to see its events and add one, with an optional
  time and reminder (at the time, 5 / 15 / 30 / 60 minutes or a day before).
- **Brightness** (☀, laptop screens only): click for a slider, or scroll over
  the icon to step by 5%. External monitors don't expose brightness to
  Windows, so the icon is hidden on them.
- **Screen snip** (✂-style corner icon): opens the Windows snipping overlay,
  same as `Win+Shift+S`; the capture goes to the clipboard.
- **Weather** widget: current conditions and a four-day forecast for your
  approximate location (from the public-IP lookup). Uses the temperature unit
  from Settings → Appearance. Needs outbound lookups (Settings → Privacy).
- **Timer** widget: a countdown (presets 1 / 5 / 10 / 25 minutes, or **…**
  for a custom duration such as `90`, `12:30` or `1:00:00`, optionally
  followed by a label: `25 Focus`) and a stopwatch with laps. A finished
  countdown plays the alarm sound and shows a Windows notification, even
  when eDEX is hidden. Right-click the widget to copy laps.
- **Focus** (pomodoro) in the Timer widget: 25-minute focus sessions with
  5-minute breaks and a 15-minute break after every fourth session. When a
  focus session ends the break starts on its own; when a break ends, click
  **Start focus** on the notice (or Start in the widget). **Skip** moves to
  the next phase; the dots show progress towards the long break. Right-click
  → **Focus lengths…** to change the times (e.g. `50/10/20/3`).
- **Screen time** widget: how long each program has been the focused window
  today, and a bar for each day of the past week; the arrow button switches
  between today and yesterday. Idle time (2 minutes without input) and the lock screen aren't
  counted. Only program names and durations are stored, on this PC, for two
  weeks; Settings → Privacy turns it off or clears it. Right-click an app →
  **Daily limit…** for a once-a-day notice when it passes that much time (the
  bar shows the limit; the app turns amber past it).
- **Tasks** widget: today's calendar events, then your to-do list. Type a
  time to get a reminder — `call mum at 6pm`, `report in 2h`, `dentist
  tomorrow 9:30`, `gym friday` — with the alarm sound and a Windows
  notification even while eDEX is hidden (reminders missed while eDEX was
  closed show once when it starts). Tick tasks off; done ones fold away.
- **Git** widget: the branch, commits to push / pull, staged / changed / new
  file counts, the last commit and the changed files for the folder the
  active terminal is in (click a file to show it in the explorer). Needs Git
  on the PATH.
- **Command widgets** (Settings → Layout → Command widgets, or the launcher
  "New command widget…"): any PowerShell or cmd command's output as a panel,
  refreshed every few seconds to once a day while eDEX is on screen (disk
  space, uptime, a status API, `git log` …). Commands run as you, in your
  home folder, with a 20-second limit. Right-click one to edit or remove it.

**Alerts** (Settings → General → Alerts): eDEX warns once when the battery
drops below the level you choose (20% by default) and again at half that,
and when a fixed drive has less than the free-space limit left (5 GB, or 10%
on small drives). The warning appears in eDEX and, if eDEX is hidden, as a
Windows notification. Plugging in or freeing space re-arms it.

New widgets appear at the end of their column; drag them where you want them
or hide them in Settings → Layout.

**Multi-monitor HUD** (Settings → General → Other displays): every display
except the main one shows eDEX's telemetry panels, the globe and a large
clock. It sits behind your windows on that display like the desktop does,
and hides and returns with eDEX.

**Idle screen** (Settings → General → Idle screen): after the minutes you
choose without typing or clicking — and only when eDEX is the window in
front — eDEX switches to an animated screen (matrix rain, hex grid,
starfield or globe) with the clock, date and weather. Any input brings it
back. **Animated background** (Settings → Appearance) draws the same effects
faintly behind the panels.

## 12. Performance

eDEX is built to stay out of the way:

- System readings come from one long-lived native helper; no processes are
  launched while it runs.
- All panels refresh from one shared timer, and every reading is fetched
  once and shared by the widgets that show it.
- While eDEX is hidden, minimised or completely covered by other windows,
  nothing refreshes and nothing animates.

Settings → **Performance**:

| Setting | Effect |
|---|---|
| **Performance profile** | *Performance*: fastest refresh, 30 fps globe. *Balanced*: the default on mains power. *Eco*: slower refresh, 10 fps animations, decorative transitions off, globe at 1× resolution. *Auto* (default) uses Balanced on mains power and Eco on battery or when Windows battery saver is on. |
| **Slow down in the background** | Halves refresh rates and lowers animation frame rates while another app has focus. |
| **GPU-accelerated terminal** | Draws terminals with WebGL — far faster for heavy output. Turn it off if terminal text renders incorrectly on your graphics driver. |

The page also shows eDEX's own CPU and memory use per process (interface,
GPU process, native helper …), refreshed every two seconds. The launcher has
**Cycle performance profile** for switching quickly.

## 13. Global shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Shift+Space` | Launcher (works from any app) |
| ``Ctrl+` `` | Show / hide eDEX (works from any app) |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+A` | Switch window |
| `Ctrl+Shift+T` / `Ctrl+Shift+E` | New terminal / explorer tab |
| `Ctrl+Shift+W` | Close tab |
| `Ctrl+Tab`, `Ctrl+1…9` | Switch tabs |
| `Ctrl+Shift+F` | Find files |
| `Ctrl+Shift+K` | On-screen keyboard |
| `Ctrl+Shift+M` | Media player |
| `Ctrl+Shift+J` | Ask Claude (AI assistant) |
| `Ctrl+Shift+S` | Export a system snapshot (JSON, saved to Documents) |
| `Ctrl+,` | Settings |
| `F1` | Shortcut sheet |

The two global hotkeys can be changed in Settings → General. If another app
already owns one, eDEX shows a notice at startup.

## 14. Settings

Open with `Ctrl+,` or the gear icon. Changes apply immediately.

- **General**: mode, taskbar coverage, overlay behaviour, close-to-tray, start
  with Windows, desktop takeover, hotkeys, web search engine, sounds,
  multi-monitor HUD, idle screen, battery and disk alerts.
- **Appearance**: themes, the theme editor (every colour, fonts, terminal
  palette, globe, layout hints and theme CSS, with live preview), theme
  import / export, custom CSS, interface scale, clock format, temperature
  unit, boot screen and boot logo / ASCII art (see section 10). Details in
  [THEME_GUIDE.md](THEME_GUIDE.md).
- **Terminal**: default shell, font size, cursor, scrollback, copy on select.
- **Keyboard**: on-screen keyboard, layout, custom layouts folder and import,
  password mode (see section 9).
- **Layout**: presets, every region, panel side and widths, file browser,
  widgets and command widgets (see section 2).
- **Files**: hidden items, delete confirmation, default view, whole-PC
  search, history.
- **Performance**: profile, background slow-down, GPU terminal, eDEX's own
  resource use (see section 12).
- **Privacy**: outbound network lookups, screen time and daily limits, the AI
  assistant, clipboard history.
- **About**: version, **Back up settings** (Export… / Import… — every setting,
  your own themes and keyboard layouts in one `.json` file), developer tools.

Settings live in `%APPDATA%\eDEX-UI\settings.json`. Settings from the
previous version (`%USERPROFILE%\.edex-ui-settings.json`) are imported on first
run.

## 15. Privacy and network

With **Outbound lookups** on (Settings → Privacy), eDEX contacts:

| Feature | Destination | When |
|---|---|---|
| World-view location | ipapi.co, falling back to ipinfo.io | at most every 15 minutes |
| World-view latency | 12 public sites (BBC, NYT, ABC …) | every 2 minutes while visible |
| Network ping | google.com | every 30 seconds while visible |
| Weather | api.open-meteo.com (approximate coordinates only) | at most every 20 minutes |

Turn it off and eDEX makes no outbound requests. Clipboard history is kept in
memory only and can be disabled.

**AI assistant** (off until you turn it on in Settings → Privacy and add
your own Anthropic API key from console.anthropic.com): the key is
encrypted with your Windows account and never shown again. Only what you
ask — plus terminal text you choose to include with "Explain with Claude" —
is sent to Anthropic's Claude API (api.anthropic.com), and only when you
ask. Pick Claude Opus 5.5 (best answers), Sonnet 5.5 or Haiku 5.5 (faster,
cheaper); usage is billed to your API account. If Opus or Sonnet declines a
request, the API retries it on a fallback model automatically. Commands in
answers run in the terminal only when you click **Run in terminal**.

Whole-PC search, the disk map, Bluetooth, Now playing and the mixer all work
locally through Windows; they send nothing anywhere.

## 16. Troubleshooting

- **A hotkey does nothing**: another app owns it — pick a new one in Settings → General.
- **Everything refreshes slowly**: you are probably on battery, where the
  Auto profile switches to Eco. Pick Balanced or Performance in Settings →
  Performance.
- **Terminal text looks garbled or blurry**: turn off **GPU-accelerated
  terminal** in Settings → Performance.
- **No timer notification**: allow notifications for eDEX-UI in Windows
  Settings → System → Notifications (the alarm sound and in-app toast still
  play).
- **Dock shows "Window list unavailable"**: the native helper uses Windows
  PowerShell 5.1; make sure `powershell.exe` is not blocked by policy.
- **CPU temperature shows N/A**: Windows only exposes it to elevated apps on
  most hardware.
- **Something looks wrong**: power menu → Reload interface, or Settings →
  About → Toggle DevTools.
