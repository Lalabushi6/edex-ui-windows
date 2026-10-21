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

xterm.js and its fit, search and WebGL addons (MIT), node-pty (MIT),
systeminformation (MIT), the Anthropic TypeScript SDK `@anthropic-ai/sdk`
(MIT, used only by the optional AI assistant) and Electron (MIT); see
`node_modules/*/LICENSE`.

## Data services

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0), used
only when outbound lookups are enabled.

Synced lyrics come from [LRCLIB](https://lrclib.net), a free, community-run
lyrics database with an open API, used only when outbound lookups are
enabled. Lyrics remain the property of their respective copyright owners;
eDEX shows them for personal use and caches them only on your PC.

Internet radio stations are listed by the community
[Radio Browser](https://www.radio-browser.info) directory, a free,
community-run station database. The streams themselves, station names and
logos belong to their stations.

Game names and cover art come from the Steam, Epic Games and Xbox
launchers installed on your PC (and, for art missing from their caches,
from Steam's and Epic's image servers). They are trademarks and artwork of
their respective owners; eDEX-UI isn't affiliated with Valve, Epic Games or
Microsoft.

The optional Spotify view uses the [Spotify Web API](https://developer.spotify.com/documentation/web-api)
with the user's own developer app, under the Spotify Developer Terms; cover
art and metadata are Spotify's and its licensors'. Spotify is a trademark of
Spotify AB. eDEX-UI isn't affiliated with or endorsed by Spotify.
