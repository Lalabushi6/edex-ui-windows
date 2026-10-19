# eDEX-UI Theme Guide

## Quick way

Settings → Appearance → **Custom accent**: pick a colour and click
**Save as theme**. It is stored in `%APPDATA%\eDEX-UI\themes\` and
appears in the theme list immediately.

## Theme files

A theme is one JSON file. Built-in themes live in `themes/` in the app folder;
your own go in `%APPDATA%\eDEX-UI\themes\` (a user theme never
replaces a built-in one with the same file name). The file name without
`.json` is the theme id.

```json
{
  "name": "My Theme",
  "author": "You",
  "description": "Optional one-liner.",
  "colors": {
    "r": 0, "g": 210, "b": 190,
    "black": "#020c10",
    "light_black": "#041e2b",
    "grey": "#0a3545"
  },
  "terminal": {
    "foreground": "#00d2be",
    "background": "#041e2b",
    "cursor": "#00ffea",
    "cursorStyle": "bar",
    "selectionBackground": "rgba(0,210,190,0.25)"
  }
}
```

| Field | Used for |
|---|---|
| `colors.r/g/b` | The accent colour: text, lines, charts, highlights (0–255 each) |
| `colors.light_black` | Main background |
| `colors.black` | Deepest background (boot screen) |
| `colors.grey` | Secondary surfaces |
| `terminal.*` | Optional [xterm.js theme](https://xtermjs.org/docs/api/terminal/interfaces/itheme/) keys: `foreground`, `background`, `cursor`, `selectionBackground`, and ANSI colours such as `red`, `brightGreen` … |

The older format with a `styles` object (`"--color_r"`, `"--color_g"`,
`"--color_b"`, `"--color_light_black"`, `"--color_grey"`) is still accepted.

Values are validated: anything that is not a plain colour (for example
`url(...)` or text containing `;` or `{`) is ignored. Terminal font choices
come from Settings → Terminal, not from themes.

Themes are re-read about once a minute, so new files show up without a restart.
