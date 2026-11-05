# Security

## Reporting a problem

Please report security issues privately through the repository's
**Security → Report a vulnerability** page (GitHub private vulnerability
reporting) rather than in a public issue. Include what you found, how to
reproduce it, and the eDEX version.

## How eDEX is built to be safe

- The interface runs sandboxed with context isolation; it can only reach
  the system through the validated handlers in `src/main/ipc`, and only from
  the bundled `app://edex` origin. Navigation away, new windows, webviews,
  downloads and web permissions (camera, microphone, location, devices) are
  all refused.
- **Browser tabs** run web pages in a separate, persistent session
  (`persist:edex-browser`), each in a sandboxed view with no preload bridge,
  so a page can't call eDEX's handlers or reach `app://` / `localfile:`.
  Only `http(s)` pages load (mail links go to the mail app, other schemes
  are refused), pop-ups become new tabs (a few at a time) and load as links
  from the page that opened them, web permissions are
  refused apart from fullscreen and copying to the clipboard, client
  certificates are never offered on their own, WebRTC doesn't reveal local
  network addresses, and downloads are saved only where you choose in a Save
  dialog. Sites see an ordinary Chrome user agent.
- **App tabs** only move, minimise and restore another app's window (and
  take a picture of it for the tab); nothing is injected into it or
  re-parented, and the window goes back where it was when the tab closes or
  eDEX quits. "Open apps inside eDEX" only watches the list of top-level
  windows for new ones.
- **The live wallpaper** re-parents only eDEX's own wallpaper windows into
  Explorer's desktop layer (`Progman` / `WorkerW`, as every live-wallpaper
  app does). They take no focus or input, and are destroyed whenever eDEX is
  shown, quits or the setting is turned off; Explorer then repaints the
  normal wallpaper.
- **Internet radio** goes through the `edexradio:` protocol: the main
  process fetches the stream (http/https only), resolves `.pls` / `.m3u`
  links and strips the ICY title metadata before the audio reaches the
  interface, whose CSP stays closed to the internet. Station logos are
  fetched by the main process (images only, size-capped) and handed over as
  data URLs; game cover art is cached as local files. Addresses from a
  directory listing or a playlist file can't point at the local network: each
  one is checked as written and by what its name resolves to, on every
  redirect. A name could still change its answer between the check and the
  connection, so treat this as a strong filter rather than a hard boundary.
- **Lyrics, game art, the radio directory and calendar feeds** are plain
  HTTPS GETs from the main process; responses are parsed as data (JSON,
  iCalendar, images) and size-limited, never run. Calendar subscription
  links are secrets that grant read access to a calendar: they're stored in
  settings in plain text, and exporting settings asks whether to leave them
  out. Reading a feed runs in short slices with limits on its size and time,
  so a hostile one can't hold up the app.
- **The game library** reads the Steam, Epic and Xbox launchers' own
  manifest files and launches games only through the launchers' documented
  URIs (`steam://rungameid/…`, `com.epicgames.launcher://apps/…`) or the
  app's registered Xbox / Store identity; identifiers are checked against a
  strict pattern before use.
- Every file operation goes through one path policy (`src/main/lib/paths.js`):
  links are resolved before checks, credential stores and token files are
  never readable, system folders and network paths are never written. eDEX's
  own encrypted AI key, Spotify sign-in and browser-tab cookies are on that
  list too. Copying a folder that holds one of these leaves it behind and says
  so, and that folder can't be moved or renamed. This is a safeguard for the
  interface, not a wall: anything run in a terminal has your full access.
- Network paths aren't touched until you open that share yourself, by typing
  it in the file explorer or launcher or confirming a saved link, and that
  lasts for the session. Ones named by a file, by program output or by settings
  aren't followed (a shortcut's icon, a link to a share, a folder a command
  prints for the terminal to "follow", a restored tab): just looking at one
  would send the Windows sign-in hash to that server. Administrative shares
  like `C$` can't be opened this way.
- Windows' own programs are started by their full path and eDEX runs from
  System32, so a program planted in the folder it was started from can't run
  in their place.
- Opening anything that can run code from the file explorer asks first:
  programs and scripts, but also help files, web archives and disk images. Only
  shortcuts in the Start Menu, Quick Launch or on the Desktop open directly, so
  a program downloaded to the Desktop still asks. Ending a process asks too.
- Pasting into a terminal shows the text first if it holds line breaks or other
  control characters, since those can run commands straight away. A single line
  copied with its line ending doesn't run. There's no prompt when the program
  in the terminal has turned on bracketed paste, because it then takes the text
  as text, unless the text contains an escape that could end that mode.
- **The AI assistant** gets terminal output marked as untrusted data, in a
  delimiter the output can't close. A command in an answer runs only when you
  click, and once a conversation has read terminal output you confirm it in a
  dialog that shows the whole command. A model can still be misled by what it
  reads, so that dialog is the check that counts.
- A settings file can't start anything by itself: its command widgets and
  calendar links arrive switched off. A widget turns on only after you've
  reviewed its full command, with long blank stretches and invisible characters
  marked.
- Keyboard layouts can't type commands: a key may only send a single key press,
  and a layout that does more is refused.
- The Git widget won't inspect a repository whose own config could make Git
  start programs (filters, signature checks, lazy fetches, includes) or that
  points Git at a network path (a `.git` file, a worktree's `commondir`, any
  config value except remote addresses, object alternates). eDEX reads those
  files before it runs Git in the folder, and Git itself reads the config for
  this check, including a linked worktree's main repository. Submodules are
  left out.
- Clipboard history skips what password managers mark as private. System
  snapshots leave out the PC name, user name and network addresses.
- Network use is limited to the documented lookups (Settings → Privacy can
  turn them all off), pages you open in browser tabs, radio stations you
  play or search for, and, only if you set them up, the Claude API (your own
  key) and Spotify (your own Client ID).
  The API key and the Spotify refresh token are encrypted with your Windows
  account (DPAPI); Spotify sign-in uses PKCE, so no client secret exists.
- **Updates** come from this repository's GitHub releases page. A download
  must match the release file's size and the SHA-256 digest GitHub publishes
  for it before anything runs, is checked again just before it starts, and
  installing always asks first. A file with no digest isn't downloaded. The
  executables aren't code-signed, so the digest is the integrity check, and it
  comes from the same place as the download.
- **Release builds** pin their GitHub Actions to commits and build with a
  read-only token that the checkout doesn't keep on disk. Only a separate publish
  job can write to the repository, and it runs nothing from the repository.
- **Portable mode** keeps the data folder next to the `.exe`. Encrypted
  secrets in it only open on the Windows account that saved them, so a lost
  drive doesn't give away the AI key or Spotify sign-in (other data on the
  drive, like notes and settings, is not encrypted).
- Packaged builds disable Node inspection and `NODE_OPTIONS` and load code
  only from the app archive (Electron fuses). Two fuses stay at the less strict
  setting. `runAsNode` is on because node-pty starts a helper with Electron as
  Node. Asar integrity validation is off, so the archive isn't hash-checked at
  startup. Both only matter to something already running as you, and an
  integrity check adds little while the `.exe` itself isn't signed.
