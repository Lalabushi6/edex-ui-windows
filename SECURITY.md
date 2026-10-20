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
- Every file operation goes through one path policy (`src/main/lib/paths.js`):
  links are resolved before checks, credential stores and token files are
  never readable, system folders and network paths are never written.
- Running a program from the file explorer, ending a process and importing
  command widgets from a settings file all ask first.
- The Git widget won't inspect a repository whose own config would make Git
  start programs (fsmonitor, filters, includes).
- Network use is limited to the documented lookups (Settings → Privacy can
  turn them all off) and, only if you enable it with your own key, the
  Claude API. The API key is encrypted with your Windows account.
- Packaged builds disable Node inspection and `NODE_OPTIONS` and load code
  only from the app archive (Electron fuses).
