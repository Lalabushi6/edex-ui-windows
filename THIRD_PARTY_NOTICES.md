# Third-party notices

eDEX-UI Windows Edition builds on the following work.

## eDEX-UI

- Source: https://github.com/GitSquared/edex-ui
- Copyright © Gabriel "Squared" SAILLARD and contributors
- License: GNU General Public License v3.0

Used here: the theme files in `themes/` (colour, font, terminal and globe
values), the on-screen keyboard layouts in `keyboards/` (by eDEX-UI and its
contributors; `en-WORKMAN.json` had its missing closing brace restored), the
keyboard's dead-key tables and arrow icons, the logo and application icons (`build/icon.*`,
`src/main/assets/icon.png`, `src/main/assets/tray.png`, and the logo drawn
in `src/renderer/js/core/icons.js`), the boot log text
(`src/renderer/assets/misc/boot_log.txt`), the globe tile grid
(`src/renderer/assets/misc/grid.json`), the interface sounds and fonts in
`src/renderer/assets/`, and its fork of the ENCOM globe
(`src/renderer/lib/encom-globe.js`). The visual design (grid backdrop,
section captions, module rules, slanted shell tabs, boot sequence and media
controls) follows eDEX-UI.

Because GPL-3.0 code and assets are included, this project as a whole is
licensed under the GPL-3.0 (see `LICENSE`).

## ENCOM Globe

- Source: https://github.com/arscan/encom-globe
- Copyright © Rob Scanlon
- License: MIT

Bundled (via eDEX-UI's fork) in `src/renderer/lib/encom-globe.js`, together
with three.js r66 (MIT, © three.js authors), tween.js (MIT), quadtree2 (MIT)
and pusher's vec2 helpers (MIT); their notices are retained in that file.

## Fonts

- United Sans — bundled with eDEX-UI.
- Fira Mono and Fira Code — SIL Open Font License 1.1, © Mozilla Foundation /
  The Fira Code Project Authors.

## Runtime dependencies

xterm.js and its fit and WebGL addons (MIT), node-pty (MIT), systeminformation
(MIT) and Electron (MIT); see `node_modules/*/LICENSE`.

## Data services

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0), used
only when outbound lookups are enabled.
