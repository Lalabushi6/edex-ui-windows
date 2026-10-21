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
  are refused), pop-ups become new tabs, web permissions are refused apart
  from fullscreen and copying to the clipboard, and downloads are saved only
  where you choose in a Save dialog. Sites see an ordinary Chrome user agent.
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
  data URLs; game cover art is cached as local files.
- **Lyrics, game art, the radio directory and calendar feeds** are plain
  HTTPS GETs from the main process; responses are parsed as data (JSON,
  iCalendar, images) and size-limited, never run. Calendar subscription
  links are secrets that grant read access to a calendar: they're stored in
  settings (and therefore in settings backups) in plain text, so share
  backups accordingly.
- **The game library** reads the Steam, Epic and Xbox launchers' own
  manifest files and launches games only through the launchers' documented
  URIs (`steam://rungameid/…`, `com.epicgames.launcher://apps/…`) or the
  app's registered Xbox / Store identity; identifiers are checked against a
  strict pattern before use.
- Every file operation goes through one path policy (`src/main/lib/paths.js`):
  links are resolved before checks, credential stores and token files are
  never readable, system folders and network paths are never written. eDEX's
  own encrypted AI key and Spotify sign-in are on that list too.
- Running a program from the file explorer, ending a process and importing
  command widgets from a settings file all ask first.
- The Git widget won't inspect a repository whose own config would make Git
  start programs (fsmonitor, filters, includes).
- Network use is limited to the documented lookups (Settings → Privacy can
  turn them all off), pages you open in browser tabs, radio stations you
  play or search for, and, only if you set them up, the Claude API (your own
  key) and Spotify (your own Client ID).
  The API key and the Spotify refresh token are encrypted with your Windows
  account (DPAPI); Spotify sign-in uses PKCE, so no client secret exists.
- **Updates** come from this repository's GitHub releases page. A download
  must match the release file's size and the SHA-256 digest GitHub publishes
  for it before anything runs, and installing always asks first. The
  executables aren't code-signed, so the digest is the integrity check.
- **Portable mode** keeps the data folder next to the `.exe`. Encrypted
  secrets in it only open on the Windows account that saved them, so a lost
  drive doesn't give away the AI key or Spotify sign-in (other data on the
  drive, like notes and settings, is not encrypted).
- Packaged builds disable Node inspection and `NODE_OPTIONS` and load code
  only from the app archive (Electron fuses).
