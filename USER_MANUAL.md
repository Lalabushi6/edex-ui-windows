# eDEX-UI Windows Edition — User Manual

## 1. What it is

eDEX-UI is a full-screen shell that sits on top of Windows. From it you can
launch any installed app, switch between open windows (or keep them in
tabs), manage files, run terminals, browse the web, play music and video
(Spotify included) and monitor the machine, so you rarely need the Windows
desktop or taskbar.

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

## 4. Workspaces

A workspace is a named setup — *Work*, *Gaming*, *Study* — with its own tabs.
Everyone starts in **Main**. Switch with the workspace name next to the logo
(click it for the list), the launcher (type the name: "Workspace: Gaming"),
a hotkey of the workspace's own, or automatically at a time of day.

- **New workspace…** (the same menu, or the launcher) asks for a name, whether
  to start with a copy of the tabs open now (otherwise one terminal), and
  what it should remember: the **theme**, the **layout** (regions, columns,
  widgets) and **where your app windows are**.
- **Tabs** belong to the workspace they were opened in. The other
  workspaces' tabs keep running in the background (terminals keep their
  programs going, downloads continue) and come back exactly as they were.
  App tabs made automatically by "Show every open window as a tab" show in
  every workspace.
- **Theme and layout**: switching to a workspace that remembers them brings
  them back; switching to one that doesn't restores the look you had before.
  **Save the current setup** (the menu, or Settings → Workspaces → Save
  current) stores what you have now.
- **App windows**: a workspace that remembers them saves a window arrangement
  ("Workspace · name", section 6) and restores it when you switch there:
  windows move back, programs that aren't running start.
- Settings → **Workspaces** sets each one's **hotkey** (works from any app
  and brings eDEX up in that workspace), its **switch time** and days, what
  it remembers, and renames or deletes it (deleting closes its tabs).

## 5. Launcher

Press `Ctrl+Shift+Space` (from anywhere in Windows) or click the search bar.

| Type | Result |
|---|---|
| an app name | Start-menu apps, Store apps, desktop shortcuts |
| a window title | switches to that window |
| a file name | recent files and your Desktop / Documents / Downloads / Pictures / Music / Videos, then **On this PC**: matches anywhere the Windows Search index covers |
| `"budget 2026"` (in quotes) | **Inside files**: documents containing those words (Windows Search index) |
| `? how do I find large files` | asks Claude (needs the AI assistant, see section 19) |
| `>` then text | commands (new tab, settings, themes, power, media …) |
| `=2*(3+4)^2` | calculator — Enter copies the result |
| `10 km to mi`, `72 f in c`, `5 gb to mib`, `90 kmh to mph` | unit conversion (length, mass, volume, area, speed, time, data, energy, power, temperature) — Enter copies |
| `timer 5m tea`, `remind 1h30m stretch`, `stopwatch` | starts the Timer widget's countdown (alarm + Windows notification) or stopwatch, even if the widget is hidden |
| `pomodoro`, `focus` | starts a focus session (the Timer widget's Focus mode) |
| `$ ipconfig /all` | runs the command in the active terminal (or a new one) |
| `C:\Users\` | browse paths; Tab completes the highlighted folder |
| `google.com` | opens in your browser (or an eDEX browser tab, with "Open web links in eDEX" on) |
| anything else | web search (engine set in Settings → General) |

`Enter` opens, `Ctrl+Enter` reveals the file location (or closes a window),
`Tab` cycles the All / Apps / Games / Windows / Files / Commands filters,
right-click a result for more (pin to dock, run as administrator, open file
location). Games show with their cover art; workspaces show as "Workspace:
name".

## 6. Dock

- **Apps button** opens the launcher on the app list; the **games button**
  next to it opens the game library.
- **Pinned apps** and **pinned games**: pin from the launcher or the game
  library (right-click → Pin to dock).
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

## 7. Games

**Game library**: `Ctrl+Shift+G`, the dock's games button, or the launcher
("Games"). It finds the games installed through **Steam**, the **Epic Games
Launcher** and the **Xbox app** (PC Game Pass and Microsoft Store games),
with their cover art, in a full-screen grid: type to search, filter by
store, click to play (each game starts through its own launcher, so
sign-in, updates and cloud saves work as usual). Right-click a game to pin
it to the dock, open its install folder or rescan. Recently played games
come first. Cover art comes from the launchers' own caches; art that isn't
cached is downloaded once from Steam's or Epic's image servers while
Outbound lookups are on.

**Game mode** (Settings → Games): while a game is in front — one from the
library, or anything else Windows reports as running full-screen on
Direct3D — eDEX rests:

- panel refreshes and animations stop (the globe, the visualizer, effects);
- the multi-monitor HUD hides;
- the screen saver and the live wallpaper hold back;
- notifications go quietly into the notification centre instead of popping
  up (turn that off with **Quiet notifications in game mode**).

A **GAME MODE** badge shows in the top bar while it's on. *Automatic* is the
default; *On* keeps eDEX resting, *Off* never does. It ends a few seconds
after the game closes or leaves the foreground.

## 8. Terminal

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

## 9. Browser tabs

New browser tab: `Ctrl+Shift+B`, the ⌄ tab menu → **Browser**, or the
launcher ("New browser tab"). With Settings → Web & apps → **Open web links
in eDEX** on, links from the launcher, quick links, the terminal (Ctrl+click)
and the explorer's address bar open here instead of your default browser
(right-click a web result in the launcher to pick either way).

| Action | Keys / mouse |
|---|---|
| Address or search | type in the address bar and press Enter (`Ctrl+L` focuses it); text that isn't an address searches with the engine from Settings → General |
| Back / forward | `Alt+←` / `Alt+→`, or the arrows |
| Reload / stop | `F5` or `Ctrl+R` |
| Zoom | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` (a badge shows the zoom; click it to reset) |
| Find in page | `Ctrl+F` (Enter / Shift+Enter for next / previous, Esc to close) |
| New tab / close tab | `Ctrl+T` / `Ctrl+W` |
| Open in your browser | the ↗ button, or right-click the page |

Right-click a page for back / forward / reload, open a link in a new tab or
in your browser, copy a link, save an image, or inspect. Links that open a
new window (target=_blank, pop-ups) open as new eDEX browser tabs.
Downloads ask where to save, and a notice offers to show the file. eDEX's
own shortcuts (Ctrl+Shift+…, Ctrl+Tab, Ctrl+1…9, Ctrl+, and F1) keep
working while a page has focus. An empty tab shows your web quick links.
Browser tabs and their pages come back the next time eDEX starts.

Pages run in their own session: sign-ins and cookies are separate from your
usual browser and kept until you clear them (Settings → Web & apps →
Browsing data, or the tab's ⋯ menu). Pages can't reach your files or eDEX
itself, and requests for the camera, microphone, location, notifications or
USB devices are refused. While an eDEX menu or dialog is open, the page
waits behind a still picture of itself. Some sites (Google sign-in, for
one) refuse embedded browsers: use **Open in your browser** for those.

## 10. App tabs

Any open window can live in a workspace tab:

- right-click it in the dock, or among the launcher's open windows → **Show
  as a tab in eDEX**;
- the ⌄ tab menu → **App window…** (or the launcher, "Show a window as a
  tab…") and pick it;
- or Settings → Web & apps → **Show every open window as a tab**: every
  open window gets a tab of its own automatically.

Activating the tab moves the window into the tab's area and brings it
forward, so it works like part of eDEX (it keeps its own title bar).
Switching to another tab minimises it; going back restores it. Clicking
eDEX elsewhere puts the window behind eDEX, and the tab then shows a
picture of it — click the picture (or the tab) to bring the window back. If
you move, maximise or minimise the window yourself, the tab shows a card
offering to put it back in. Right-click the tab for **Show window**,
**Close window** (closes the app's window) and **Close tab** (puts the
window back where it was; the app keeps running). Quitting eDEX puts every
tabbed window back. A tab whose window closes goes away by itself.

The next / previous tab hotkeys (`Ctrl+Tab` / `Ctrl+Shift+Tab` unless you
change them in Settings → General → **Tab switching**) switch eDEX's tabs
even while a tabbed app is the window in front: eDEX borrows those keys only
then, so other apps keep their own. If another program already holds them
system-wide, or they're one of eDEX's own hotkeys, eDEX says so and uses
`Ctrl+PageDown` / `Ctrl+PageUp` there instead (or `Ctrl+Alt+PageDown` /
`Ctrl+Alt+PageUp` if those are taken too). Turn the borrowing off with
Settings → Web & apps → **Tab hotkeys work from app tabs** if you'd rather
the app got the keys.

App tabs work best in Desktop mode: in Overlay mode eDEX hides itself when
it shows a tabbed window.

**Open apps inside eDEX** (Settings → Web & apps) goes one step further:
every app window that opens from then on — from the launcher, the dock, the
Start menu, a file you double-click, anywhere — becomes a tab and is shown
inside the workspace (straight away while eDEX is on screen; otherwise its
tab waits for you). Windows that were already open are left as they are,
dialogs and tool windows aren't picked up, and games (from the library, or
anything that goes full screen) are left alone.

## 11. File explorer

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

## 12. Media player

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
| Lyrics | `L` or the lyrics button |
| Play a track | double-click it (or select and press `Enter`) |
| Remove a track | `Del`, or right-click → Remove |
| Reorder | drag tracks in the playlist |

The **equalizer** has ten bands (32 Hz – 16 kHz, ±12 dB) and presets (Bass
boost, Treble boost, Vocal, Rock, Electronic, Acoustic, Loudness, Late
night). Drag a slider to make your own curve, double-click one to reset it.
Boosts are balanced by lowering the overall level slightly, so loud tracks
don't distort. The button is lit while the equalizer is on.

Shuffle and repeat (off → all → one) are on the control bar. Titles,
artists, albums and cover art are read from the file's tags (MP3, FLAC,
Ogg / Opus and M4A). The playlist, volume
and position are remembered; playback keeps going when you switch tabs or
close the player tab, and Windows' media keys and media overlay control it.
Formats are whatever Chromium plays: MP3, AAC/M4A, FLAC, WAV, Ogg/Opus,
MP4 (H.264), WebM and most MKV files.

### Visualizer

`V` or the visualizer button (the bars icon on the control bar) opens the
visualizer panel; Settings → Media has the same options:

| Option | Choices |
|---|---|
| Style | Bars, Mirrored, LED blocks, Dots, Spectrum line, Waveform (the sound wave itself), Radial |
| Bars | 16–128 bands |
| Colour | theme colour, theme gradient, rainbow, or a custom colour |
| Peak caps / Reflection | on or off |
| Smoothing | higher is calmer, lower reacts faster |
| Sensitivity | 50–200 % |

Changes show at once, even while paused; **Reset** returns to the default
look.

The **Now playing | Library | Radio** bar at the top of the player switches
the main area between the visualizer, your music library and internet radio.

### Music library

The **Library** view lists the music in your music folders (your Windows
*Music* folder to begin with; **Folders** adds or removes others, Settings →
Media has the same list) by **Albums** (a grid of covers), **Artists** and
**Songs**, with a search box. Cover art comes from a `cover.jpg`,
`folder.jpg` or similar image in the album's folder, or from the art inside
the files. Click an artist for their albums and an album for its tracks,
with **Play**, **Shuffle** and **Add to playlist**; double-click a song to
play it, or right-click it to add it to the playlist or show it in the
explorer. The index is kept between runs and only files that changed are
read again; the ⟳ button rescans.

### Synced lyrics

`L` (or the lyrics button) shows the words over the visualizer, the current
line highlighted and scrolling in time with the song; the **Lyrics** widget
(Settings → Layout → widgets) shows them in a side column. They work for
your files, internet radio (from the station's *now playing* title), the
Spotify view and whatever another app reports in *Now playing*.

A `.lrc` file with the same name next to a song is used first. Otherwise
eDEX asks [LRCLIB](https://lrclib.net), a free community lyrics database,
by title, artist, album and length — only while Outbound lookups are on
(Settings → Privacy) — and remembers the answer. Songs without timed lyrics
show plain lyrics, and instrumentals say so. Settings → Media → **Synced
lyrics** turns the feature off.

### Internet radio

The **Radio** view finds stations in the community
[Radio Browser](https://www.radio-browser.info) directory: search by name or
pick a genre (lofi, jazz, rock, news …). While Outbound lookups are on the
most popular stations show when you open it. Double-click a station (or ▶)
to play it; ★ keeps it in your **Favourites**. **Add URL…** adds any station
by its stream address — `.pls` and `.m3u` links work, HLS (`.m3u8`) streams
don't.

A playing station is a playlist entry like a song, so the visualizer, the
equalizer, media keys and the Media widget all work with it; the progress
bar shows **● LIVE**, and the station's *now playing* title (when it sends
one) shows as the track. Streams are fetched by eDEX itself, so station
pages and adverts never load.

### Spotify

The **Files | Spotify** switch above the playlist shows Spotify instead of
your files.

- **Without an account**: whatever the Spotify app on this PC is playing
  (cover art, title, progress), with play / pause / skip and seek, through
  Windows' media controls.
- **With your account connected**: what's playing on your account and on
  which device; your **Playlists**, **Liked** songs, **Recent** tracks and
  **Search** (songs, albums, playlists); a device picker (**Play on…**: this
  PC, your phone, a speaker); shuffle, repeat, volume and seek. Double-click
  a playlist or song to play it; click one of your own playlists to see its
  songs (Spotify only lists the songs of playlists you own or collaborate
  on — others still play). Right-click for Open in Spotify or copy link. If
  no device is active, eDEX wakes the first available one.

Spotify plays the music itself (its app, your phone, a speaker) and eDEX
tells it what to play, so the equalizer and visualizer don't apply to it.

To connect (once, a few minutes):

1. Open [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard),
   sign in and choose **Create app** (any name and description).
2. Add the Redirect URI `http://127.0.0.1:43821/callback`, tick **Web API**
   and save.
3. Copy the app's **Client ID** into the Spotify view (or Settings → Media)
   and click **Connect**. Spotify's sign-in page opens in your browser;
   approve, and come back.

Spotify's rules for these personal apps: the app's owner needs Premium,
controlling playback needs Premium, and up to five people can use one app.
The sign-in is encrypted with your Windows account and never includes your
password; **Disconnect** (the ⋯ menu or Settings → Media) removes it.

## 13. On-screen keyboard

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

## 14. Boot logo, ASCII art and wallpaper

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

### ASCII wallpaper

A workspace tab that shows ASCII art large, in the theme colour, in place of
a terminal: the ⌄ tab menu → **ASCII wallpaper**, or the launcher
("ASCII wallpaper tab"). Double-click it (or right-click → **Edit ASCII
art…**) for the same editor as the boot logo: paste art, load a `.txt` /
`.nfo` / `.ans` file or make block letters. Left empty it uses your boot
logo art, or eDEX in block letters. Right-click for the **animation**
(Still, Scanline, Glitch, Typing, Pulse), what's **behind it** (nothing,
matrix rain, hex grid, starfield) and the **clock**; Settings → Appearance →
ASCII wallpaper has the same options. The Eco profile keeps it still.

The wallpaper is also an idle style (it takes the terminal's place while
you're away) and an idle-screen / screen-saver effect (section 15).

### Live wallpaper

Settings → Appearance → **Live wallpaper** makes eDEX your actual Windows
desktop background while it's hidden: matrix rain, hex grid, starfield, the
globe, your ASCII wallpaper or the telemetry panels keep running behind the
desktop icons, which stay clickable. It appears when you hide eDEX
(`` Ctrl+` ``, the tray, or launching an app in Overlay mode) and goes away
when eDEX comes back, so the two never run at once.

- **Displays**: every display, or only the main one.
- **Pause when it can't be seen** (on by default): it stops drawing behind
  maximised or full-screen windows and on battery (unless the performance
  profile is Performance). It also rests while game mode is on.
- Turning it off (or quitting eDEX) brings your normal wallpaper back. If
  Explorer restarts, the live wallpaper sets itself up again.

It uses the same desktop layer as other live-wallpaper apps; run only one of
them at a time.

## 15. Top bar and tools

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
  Events from calendar subscriptions (below) show too, in their calendar's
  colour.
- **Notifications** (the bell): see *Notification centre* below.
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

### Notification centre

Everything eDEX tells you — reminders, timers and focus sessions, battery
and disk alerts, finished downloads, screen-time limits, update notices —
also goes into the notification centre: click the **bell** in the top bar
(a number shows how many are new). Notifications are grouped by day and kept
for two weeks; click one that has an action (a download, an update) to open
it, × to dismiss it, **Clear** to empty the list.

**Do not disturb** (the switch in the panel, Settings → General →
Notifications, or the launcher "Do not disturb") stops pop-ups,
alarm sounds and Windows notifications from eDEX; everything still collects
in the list and the bell shows a moon. A critically low battery still
warns. **Hold notifications during games** does the same automatically
while game mode is on.

### Calendar subscriptions

Settings → **Calendar** (or **Calendar subscriptions…** under the top-bar
calendar) shows read-only calendars from Google, Outlook, iCloud or
anything else with an iCal (`.ics`) link next to your own events, in the
top-bar calendar and the Tasks widget.

1. Copy the calendar's secret iCal address:
   - **Google Calendar** (on the web): Settings → your calendar → *Integrate
     calendar* → *Secret address in iCal format*.
   - **Outlook.com / Microsoft 365**: Settings → Calendar → *Shared
     calendars* → *Publish a calendar* → pick the calendar and *Can view all
     details* → *Publish* → copy the **ICS** link.
   - **iCloud**: share the calendar as a *Public Calendar* and copy the
     `webcal://` link.
2. Paste it with a name and click **Add**.

Each calendar gets a colour (click it to change), optional reminders (at the
time, or 5 minutes to an hour before), and an on / off switch; repeating
events, exceptions, time zones and all-day events are handled. eDEX
downloads each calendar about every 30 minutes while Outbound lookups are on
(or when you click **Refresh**) and keeps a copy, so events still show at
startup and offline. Events can't be edited from eDEX. Treat these links
like passwords: anyone who has one can read that calendar (remove it in the
calendar's own settings to revoke it).

New widgets appear at the end of their column; drag them where you want them
or hide them in Settings → Layout.

**Multi-monitor HUD** (Settings → General → Other displays): every display
except the main one shows eDEX's telemetry panels, the globe and a large
clock. It sits behind your windows on that display like the desktop does,
and hides and returns with eDEX.

**Idle screen** (Settings → General → Idle screen): after the minutes you
choose without typing or clicking — and only when eDEX is the window in
front — eDEX switches to an animated screen (matrix rain, hex grid,
starfield, globe or your ASCII wallpaper) with the clock, date and weather.
With the **Wallpaper pane** style only the workspace changes: your ASCII
wallpaper takes the active tab's place while the panels keep running. Any
input brings it back (the key or click that wakes it isn't passed on to the
terminal). **Animated background** (Settings → Appearance) draws the same
effects faintly behind the panels.

**Screen saver** (Settings → General → Screen saver; also the tray menu
and the launcher, "Start screen saver"): a system-wide screen saver. After
the minutes you choose without any input anywhere, eDEX covers every
display (or just the main one) with its effect — above all apps, even while
eDEX is hidden in the tray. Any key, click or mouse movement ends it, and
**Lock Windows when it ends** works like Windows' "On resume, display logon
screen". It holds back while Windows reports a full-screen app (a game, a
full-screen video, a presentation — Windows also counts a borderless window
that fills the screen) or a program keeps the display on (video playback,
calls); turn **Not during videos or full-screen apps** off if it never
starts. Starting it by hand (Preview, the tray, the launcher) never locks.

## 16. Performance

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

### Benchmark

Settings → Performance → **Run benchmark…** (or "Run benchmark" in the
launcher) measures how eDEX runs on this PC, in about 45 seconds. Keep eDEX
in front and leave the PC alone while it runs; for meaningful startup times,
run it soon after starting eDEX.

| Measured | What it tells you |
|---|---|
| Startup | Seconds from launching eDEX to being usable (and to the end of the boot animation) |
| Idle CPU and memory | eDEX's processes and native helpers while it sits on screen with your settings, then in the Eco profile, split by process kind (main, interface, GPU, helpers) |
| Smoothness | Frame pacing (95th-percentile frame time, long frames) and how late timers fire |
| Effect drawing | Milliseconds to draw one frame of the matrix effect |
| Terminal | How fast a terminal fills with coloured output (WebGL or the plain renderer) |
| Native helper | Round-trip time of the helper that reads system information |

It also records the hardware (CPU, cores, RAM, GPU, disk type, display,
battery), the Windows build and the settings that affect speed. The summary
shows on screen (**Copy summary** copies it); **Save report** writes the full
results as a `.json` file to `Documents\eDEX benchmarks`, named after the
eDEX version, the CPU and the RAM. Reports contain no PC or user name, no
paths and no network addresses, and nothing is sent anywhere: share the file
yourself if you want to compare PCs.

## 17. Global shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Shift+Space` | Launcher (works from any app) |
| ``Ctrl+` `` | Show / hide eDEX (works from any app) |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+A` | Switch window |
| `Ctrl+Shift+T` / `Ctrl+Shift+E` | New terminal / explorer tab |
| `Ctrl+Shift+B` | New browser tab |
| `Ctrl+Shift+W` | Close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab, also from an app tab's window (changeable in Settings → General → Tab switching) |
| `Ctrl+1…9` | Go to tab 1–9 |
| `Ctrl+Shift+F` | Find files |
| `Ctrl+Shift+K` | On-screen keyboard |
| `Ctrl+Shift+M` | Media player |
| `Ctrl+Shift+G` | Game library |
| `Ctrl+Shift+J` | Ask Claude (AI assistant) |
| `Ctrl+Shift+S` | Export a system snapshot (JSON, saved to Documents) |
| `Ctrl+,` | Settings |
| `F1` | Shortcut sheet |

The two global hotkeys and the next / previous tab keys can be changed in
Settings → General (click a field, press the new combination; Backspace
clears it), and each workspace can have a global hotkey of its own (Settings
→ Workspaces). If another app already owns one, eDEX shows a notice; for the
tab keys it also picks a free stand-in (see section 10).

## 18. Settings

Open with `Ctrl+,` or the gear icon. Changes apply immediately.

- **General**: mode, taskbar coverage, overlay behaviour, close-to-tray, start
  with Windows, desktop takeover, hotkeys (show / hide, launcher, next /
  previous tab), web search engine, sounds,
  notifications (Do not disturb, hold during games), multi-monitor HUD, idle
  screen (style and effect), screen saver, battery and disk alerts.
- **Appearance**: themes, the theme editor (every colour, fonts, terminal
  palette, globe, layout hints and theme CSS, with live preview), theme
  import / export, custom CSS, interface scale, animated background, clock
  format, temperature unit, the ASCII wallpaper, the live wallpaper, boot
  screen and boot logo / ASCII art (see section 14). Details in
  [THEME_GUIDE.md](THEME_GUIDE.md).
- **Terminal**: default shell, font size, cursor, scrollback, copy on select.
- **Keyboard**: on-screen keyboard, layout, custom layouts folder and import,
  password mode (see section 13).
- **Layout**: presets, every region, panel side and widths, file browser,
  widgets and command widgets (see section 2).
- **Workspaces**: each workspace's hotkey, switch time and days, what it
  remembers, rename and delete (see section 4).
- **Media**: the visualizer (style, bars, colours, peaks, reflection,
  smoothing, sensitivity), the Spotify connection, synced lyrics and the
  music library's folders (see section 12).
- **Games**: game mode (Automatic / On / Off), holding notifications during
  games, and rescanning the library (see section 7).
- **Calendar**: calendar subscriptions (see section 15).
- **Web & apps**: opening web links in eDEX, clearing browsing data, app
  tabs and opening apps inside eDEX (see sections 9 and 10).
- **Files**: hidden items, delete confirmation, default view, whole-PC
  search, history.
- **Performance**: profile, background slow-down, GPU terminal, the
  benchmark, eDEX's own resource use (see section 16).
- **Privacy**: outbound network lookups, screen time and daily limits, the AI
  assistant, clipboard history.
- **About**: version, data folder (portable or this PC), updates, **Back up
  settings** (Export… / Import… — every setting, your own themes and keyboard
  layouts in one `.json` file), developer tools.

Settings live in `%APPDATA%\eDEX-UI\settings.json`. Settings from the
previous version (`%USERPROFILE%\.edex-ui-settings.json`) are imported on first
run.

## 19. Privacy and network

With **Outbound lookups** on (Settings → Privacy), eDEX contacts:

| Feature | Destination | When |
|---|---|---|
| World-view location | ipapi.co, falling back to ipinfo.io | at most every 15 minutes |
| World-view latency | 12 public sites (BBC, NYT, ABC …) | every 2 minutes while visible |
| Network ping | google.com | every 30 seconds while visible |
| Weather | api.open-meteo.com (approximate coordinates only) | at most every 20 minutes |
| Update check | api.github.com (this project's latest release) | at most once a day, if "Check automatically" is on |
| Synced lyrics | lrclib.net (title, artist, album and length of the song) | once per song while lyrics are shown; answers are remembered |
| Game cover art | Steam's (steamstatic.com) and Epic's image servers | once per game whose art isn't in its launcher's cache |
| Radio: popular stations | radio-browser.info | when you open the Radio view |
| Calendar subscriptions | the links you added | about every 30 minutes |

Turn it off and eDEX makes no outbound requests of its own. Clipboard history
is kept in memory only and can be disabled.

Things you use yourself go online regardless: pages you open in **browser
tabs** (in their own session, with their own cookies and sign-ins, cleared
in Settings → Web & apps), **Check now** for updates, **radio** stations you
play and station searches (radio-browser.info; station logos come from each
station's site), calendar **Refresh**, and **Spotify** once you connect it
(accounts.spotify.com and api.spotify.com, plus Spotify's image servers for
cover art; only while the Spotify view is open).

**AI assistant** (off until you turn it on in Settings → Privacy and add
your own Anthropic API key from console.anthropic.com): the key is
encrypted with your Windows account and never shown again. Only what you
ask — plus terminal text you choose to include with "Explain with Claude" —
is sent to Anthropic's Claude API (api.anthropic.com), and only when you
ask. Pick Claude Opus 5.5 (best answers), Sonnet 5.5 or Haiku 5.5 (faster,
cheaper); usage is billed to your API account. If Opus or Sonnet declines a
request, the API retries it on a fallback model automatically. Commands in
answers run in the terminal only when you click **Run in terminal**.

Whole-PC search, the disk map, Bluetooth, Now playing, the mixer, the game
library (read from the launchers' files on this PC) and the music library
all work locally; they send nothing anywhere. The notification history
(notifications.json, two weeks) stays in eDEX's data folder.

## 20. Updates and portable use

### Updates

Settings → About → **Check now** (or the launcher: "Check for updates")
looks at this project's GitHub releases page. When there's a newer version
you see its release notes and **Download and install**: the file downloads,
is checked against its size and the SHA-256 digest GitHub publishes for it,
and — after you confirm — eDEX closes and the installer starts (your
settings stay). The portable build downloads the new portable `.exe`,
replaces itself on the drive and starts again. **Skip this version** stops
that version being offered automatically; **Check automatically** (on by
default) checks once a day while Outbound lookups (Settings → Privacy) are
on. Checks only work while the GitHub repository is public.

### Portable use (USB drives)

The portable build (`eDEX-UI-Portable.exe`) keeps everything it remembers —
settings, notes, tasks, themes, keyboard layouts, screen time, browser-tab
sign-ins, the Spotify sign-in — in an **`eDEX-UI Data`** folder next to the
`.exe`, so it travels with the drive and leaves the PC's own profile alone.
Settings → About → **Data folder** shows where (**Open** shows it in
Explorer).

- The first time it runs on a PC where eDEX is also installed, it offers to
  copy that installation's settings, notes, tasks, themes and keyboard
  layouts to the drive.
- On a read-only drive it uses the PC's profile instead (Settings → About
  says so).
- The AI key and the Spotify sign-in are encrypted with the Windows account
  that saved them: on another PC, paste the key and connect Spotify again.
- **Start with Windows** in the portable build starts the `.exe` on the
  drive, so it only works while the drive is plugged in.

## 21. Troubleshooting

- **A hotkey does nothing**: another app owns it — pick a new one in Settings → General.
- **The screen saver never starts**: Windows thinks a full-screen app is
  running (it also counts a borderless window that fills the screen) or a
  program keeps the display on (a browser playing video, a call). Turn off
  "Not during videos or full-screen apps" in Settings → General.
- **A website says the browser isn't supported, or won't let you sign in**:
  some sites (Google sign-in among them) refuse embedded browsers — use the
  ↗ button (Open in your browser).
- **Spotify says "Playback control needs Spotify Premium"**: Spotify only
  allows controlling playback with Premium; browsing still works.
- **Spotify says "Port 43821 is in use"**: another program holds the
  sign-in port; close it and click Connect again.
- **Updates say "No published release found"**: the repository is private
  or has no releases yet.
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
- **The live wallpaper doesn't show, or the desktop turns black**: another
  live-wallpaper app (Wallpaper Engine, Lively …) may own the desktop layer —
  run one at a time. Turning the live wallpaper off and on, or restarting
  Explorer, rebuilds it; turning it off always brings your wallpaper back.
- **Game mode doesn't start for a game**: games outside Steam, Epic and the
  Xbox app are only noticed when they run full-screen on Direct3D. Use the
  launcher's "Game mode: on / auto" to turn it on by hand.
- **No lyrics found**: lyrics need Outbound lookups (Settings → Privacy),
  and LRCLIB doesn't have every song; a `.lrc` file next to the song always
  works.
- **A radio station won't play**: some stations only offer HLS (`.m3u8`)
  streams, which aren't supported; try the station's MP3 or AAC stream
  address.
- **A calendar says the link was refused**: use the *secret* iCal address
  (not the public web link), and check it hasn't been reset in the
  calendar's settings.
- **Repeated "Hotkey unavailable" notices**: another app (or a second copy
  of eDEX) owns the hotkey; pick another in Settings.
- **CPU temperature shows N/A**: Windows only exposes it to elevated apps on
  most hardware.
- **Something looks wrong**: power menu → Reload interface, or Settings →
  About → Toggle DevTools.
