# eDEX-UI Theme Guide

Themes use the original [eDEX-UI](https://github.com/GitSquared/edex-ui)
theme format, so themes made for eDEX-UI work here too.

## Quick way: the theme editor

Settings → Appearance → **Edit theme…** (or "Theme editor" in the launcher)
edits every part of a theme with a live preview: accent, backgrounds and grid
colour, the interface and terminal fonts, cursor, terminal colours and ANSI
palette filter, globe colours, layout hints and theme CSS. **Start from**
loads any theme as a starting point; hold **Peek** to see the whole interface
behind the dialog. **Save theme** writes it to `%APPDATA%\eDEX-UI\themes\`
and switches to it; Cancel puts your current theme back.

**Import…** copies eDEX-UI theme files in (they work as is); right-click a
theme in Settings → Appearance to export it, or delete one of your own (it
goes to the Recycle Bin).

For changes no theme field covers, Settings → Appearance → **Custom CSS**
applies your own stylesheet on top of every theme (see "Custom CSS" below).

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
| `terminal.fontFamily` | `Fira Mono`, `Fira Code`, `Cascadia Mono`, `Cascadia Code` or `Consolas` (applies when the terminal font setting is "From theme") |
| `terminal.colorFilter` | See below |
| `globe.base` / `marker` / `pin` / `satellite` | Colours of the world-view globe's land tiles, connection markers, pins and satellites |
| `cssvars.font_main` | Interface font: `United Sans Medium` (bundled, default), `Fira Mono`, `Fira Code`, or a Windows font — `Segoe UI`, `Bahnschrift`, `Consolas`, `Cascadia Mono`, `Cascadia Code`, `Courier New`, `Lucida Console`, `OCR A Extended` |
| `css` | *(this app)* A stylesheet applied while the theme is active, e.g. `".panel-title { letter-spacing: .2em; }"` — same hooks as Custom CSS |
| `layout` | *(this app)* Layout hints applied with the theme (see below) |

### Layout hints

A theme can move parts of the screen while it is active (users can turn this
off in Settings → Layout → "Themes can change the layout"):

```json
"layout": { "columnsSide": "left", "filesPanel": "column", "bottomOrder": "files-left" }
```

| Key | Values |
|---|---|
| `columnsSide` | `split` (panels either side), `left` or `right` (both panel columns together) |
| `filesPanel` | `off`, `bottom` (beside the keyboard) or `column` (under the panel columns) |
| `bottomOrder` | `files-left` or `keyboard-left` |

The bundled *disrupted*, *notype*, *typeleft* and *fulltype* themes use these
to reproduce the original's layout variants. Imported eDEX-UI themes that
only have `injectCSS` for those variants are recognised and translated.

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

### Custom CSS

Settings → Appearance → **Custom CSS** (or a theme's `css` field) can style
anything. Useful hooks:

| Hook | What |
|---|---|
| `--rgb` (accent as `r g b`), `--c`, `--c-70`, `--c-50`, `--c-20`, `--bg`, `--bg-deep`, `--grey`, `--font-ui`, `--font-mono`, `--col-w`, `--gap` | Theme variables |
| `#topbar`, `#col-left`, `#col-right`, `#work`, `#workspace`, `#bottom`, `#filepanel`, `#keyboard`, `#dock` | Screen regions |
| `.panel`, `.panel-title`, `#w-clock`, `#w-cpu`, `#w-globe` … | Widgets (one id per widget) |
| `.tab`, `.tab.active`, `.pane`, `.xterm` | Workspace tabs and terminals |
| `.kb-key`, `.kb-key.mod`, `.kb-key.space`, `.kb-key.down` | On-screen keyboard |
| `.fp-item`, `.fp-name`, `.fp-bar` | File browser |
| `#app[data-side=left]`, `#app[data-files=bottom]`, `html.eco` | Layout and performance state |

The editor previews as you type; if something breaks, clear it and save.

### Not supported

`injectCSS` from eDEX-UI themes is not injected: it targets the original
app's page, which is different here (its layout variants are translated into
layout hints instead, see above). `@import` is removed from theme and custom
CSS.

Colour values are validated; anything that is not a plain colour (for
example `url(...)` or text containing `;` or `{`) is ignored.

New theme files show up the next time the theme list is shown. The older
`styles` format (`"--color_r"`, `"--color_g"`, `"--color_b"`,
`"--color_light_black"`, `"--color_grey"`) is still accepted.
