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
│ storage, top   │                                               │ notes … │
└──────────────────────── dock: apps · open windows · tray ──────────────────┘
```

Drag a widget by its title bar to reorder it or move it to the other column.
Hide widgets or whole columns in Settings → Layout.

## 3. Modes

| Mode | Behaviour |
|---|---|
| **Desktop** (default) | Covers the screen but stays *behind* other windows. Launch an app and it opens on top; close it and you are back in eDEX. |
| **Overlay** | Always on top. Summon it with the hotkey; it hides itself when it loses focus or after you launch something. |

Switch modes from the badge next to the logo, the tray menu, or Settings →
General. `Ctrl+`` ` shows or hides eDEX from any app; the tray icon does the same.
Closing the window (Alt+F4) hides it to the tray; quit from the power menu or
the tray.

## 4. Launcher

Press `Ctrl+Shift+Space` (from anywhere in Windows) or click the search bar.

| Type | Result |
|---|---|
| an app name | Start-menu apps, Store apps, desktop shortcuts |
| a window title | switches to that window |
| a file name | recent files and your Desktop / Documents / Downloads / Pictures / Music / Videos |
| `>` then text | commands (new tab, settings, themes, power, media …) |
| `=2*(3+4)^2` | calculator — Enter copies the result |
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
  middle-click to close; right-click for maximize / restore / close.
- **Tray**: on-screen keyboard, process manager, hide eDEX.

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

When a shell exits, press Enter in its tab to restart it. Double-click a tab to
rename it. Tabs are restored the next time eDEX starts.

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
| Play a track | double-click it (or select and press `Enter`) |
| Remove a track | `Del`, or right-click → Remove |
| Reorder | drag tracks in the playlist |

Shuffle and repeat (off → all → one) are on the control bar. MP3 titles,
artists and cover art are read from the file's tags. The playlist, volume
and position are remembered; playback keeps going when you switch tabs or
close the player tab, and Windows' media keys and media overlay control it.
Formats are whatever Chromium plays: MP3, AAC/M4A, FLAC, WAV, Ogg/Opus,
MP4 (H.264), WebM and most MKV files.

## 9. Global shortcuts

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
| `Ctrl+Shift+S` | Export a system snapshot (JSON, saved to Documents) |
| `Ctrl+,` | Settings |
| `F1` | Shortcut sheet |

The two global hotkeys can be changed in Settings → General. If another app
already owns one, eDEX shows a notice at startup.

## 10. Settings

Open with `Ctrl+,` or the gear icon. Changes apply immediately.

- **General**: mode, taskbar coverage, overlay behaviour, close-to-tray, start
  with Windows, hotkeys, web search engine, sounds.
- **Appearance**: themes, custom accent colour (saved as your own theme),
  interface scale, clock format, temperature unit, boot screen.
- **Terminal**: default shell, font size, cursor, scrollback, copy on select.
- **Layout**: columns, widgets, on-screen keyboard.
- **Files**: hidden items, delete confirmation, default view, history.
- **Privacy**: outbound network lookups, clipboard history.

Settings live in `%APPDATA%\eDEX-UI\settings.json`. Settings from the
previous version (`%USERPROFILE%\.edex-ui-settings.json`) are imported on first
run.

## 11. Privacy and network

With **Outbound lookups** on (Settings → Privacy), eDEX contacts:

| Feature | Destination | When |
|---|---|---|
| World-view location | ipapi.co, falling back to ipinfo.io | at most every 15 minutes |
| World-view latency | 12 public sites (BBC, NYT, ABC …) | every 2 minutes while visible |
| Network ping | google.com | every 30 seconds while visible |

Turn it off and eDEX makes no outbound requests. Clipboard history is kept in
memory only and can be disabled.

## 12. Troubleshooting

- **A hotkey does nothing**: another app owns it — pick a new one in Settings → General.
- **Dock shows "Window list unavailable"**: the native helper uses Windows
  PowerShell 5.1; make sure `powershell.exe` is not blocked by policy.
- **CPU temperature shows N/A**: Windows only exposes it to elevated apps on
  most hardware.
- **Something looks wrong**: power menu → Reload interface, or Settings →
  About → Toggle DevTools.
