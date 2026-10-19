# eDEX-UI Theme Guide

Themes use the original [eDEX-UI](https://github.com/GitSquared/edex-ui)
theme format, so themes made for eDEX-UI work here too.

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
  "colors": {
    "r": 170, "g": 207, "b": 209,
    "black": "#000000",
    "light_black": "#05080d",
    "grey": "#262828"
  },
  "cssvars": {
    "font_main": "United Sans Medium",
    "font_main_light": "United Sans Light"
  },
  "terminal": {
    "fontFamily": "Fira Mono",
    "cursorStyle": "block",
    "foreground": "#aacfd1",
    "background": "#05080d",
    "cursor": "#aacfd1",
    "cursorAccent": "#aacfd1",
    "selection": "rgba(170,207,209,0.3)"
  },
  "globe": {
    "base": "#000000",
    "marker": "#aacfd1",
    "pin": "#aacfd1",
    "satellite": "#aacfd1"
  }
}
```

| Field | Used for |
|---|---|
| `colors.r/g/b` | The accent colour: text, rules, charts, highlights (0–255 each) |
| `colors.light_black` | Main background |
| `colors.grey` | The backdrop grid lines and secondary surfaces |
| `colors.black` | Deepest shade; also ANSI black in the terminal |
| `colors.red` … `colors.brightWhite` | Optional explicit 16-colour terminal palette (`red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white` and their `bright*` versions). Only used when `red` is present. |
| `terminal.foreground` / `background` / `cursor` / `cursorAccent` / `selection` | Terminal colours |
| `terminal.cursorStyle` | `block`, `bar` or `underline` (applies when Settings → Terminal → Cursor style is "From theme") |
| `terminal.fontFamily` | `Fira Mono` or `Fira Code` (applies when the terminal font setting is "From theme") |
| `terminal.colorFilter` | See below |
| `globe.base` / `marker` / `pin` / `satellite` | Colours of the world-view globe's land tiles, connection markers, pins and satellites |
| `cssvars` | Kept for compatibility; the interface always uses the bundled United Sans |

### Terminal colours and `colorFilter`

Like eDEX-UI, the terminal does not use a stock ANSI palette. Unless the
theme lists explicit colours, every ANSI colour is turned to greyscale and
then mixed 30% with the accent colour, so command output stays on-theme.

`colorFilter` replaces that default with your own chain of steps, applied to
each standard colour in order:

```json
"colorFilter": ["rotate(180)", "saturate(0.5)", "mix(0.7)"]
```

| Step | Effect |
|---|---|
| `grayscale()` / `negate()` | Desaturate fully / invert |
| `rotate(deg)` | Rotate the hue |
| `saturate(x)` / `desaturate(x)` | Scale saturation up / down by a ratio |
| `lighten(x)` / `darken(x)` | Scale lightness up / down by a ratio |
| `whiten(x)` / `blacken(x)` | Add white / black (HWB) |
| `mix(x)` | Blend `x` (0–1) of the accent colour into the result |

### Not supported

`injectCSS` from eDEX-UI themes is ignored: it targets the original app's
page layout, which is different here.

Values are validated; anything that is not a plain colour (for example
`url(...)` or text containing `;` or `{`) is ignored.

Themes are re-read about once a minute, so new files show up without a
restart. The older `styles` format (`"--color_r"`, `"--color_g"`,
`"--color_b"`, `"--color_light_black"`, `"--color_grey"`) is still accepted.
