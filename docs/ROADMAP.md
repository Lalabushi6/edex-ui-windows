# Road to 3.0: feature map

Drafted 30 Oct 2026 from the decision council's verdict (B first: stability,
speed and low-spec performance; new features only inside a measured budget;
distribution and money parked). Updated 31 Oct against 2.0.9, after the first
real benchmark report and the compare script.

**Goal:** an impeccable, light daily driver that revives older machines,
without becoming heavy, insecure or unmaintainable.

**Capacity:** about 13 weekly slots of 2-3 hours between now and the end of
January. Sizes below are in slots (S = a quarter, M = one, L = two) and are
rough guesses. The plan is built so the last items can be cut without
breaking the goal.

## Where things stand (2.0.9)

| | Done | Not yet |
|---|---|---|
| Measure | Benchmark in Settings → Performance: hardware, startup, idle CPU/RAM per process (your settings, calm and Eco), frame pacing, effect drawing, terminal throughput, helper round trip, what is open. Saves a no-personal-data JSON. `npm run bench:compare` lines reports up (median of repeated runs, change between two, budget check). First real report exists: 2.0.8 on a 12th-gen i5 with 16 GB and an SSD, 26% of a core and 1.39 GB idle. | Budget numbers. A report from an old laptop: the first one is from a modern machine, so it can't say whether the budget holds. Per-view cost (globe, visualizer, browser tab, explorer). Idle while hidden or covered. |
| Safety net | `npm run check`; `npm run smoke` (boots, every tab type, 14 settings pages, panels, workspaces, Ctrl+Tab, a quick benchmark); a release-checklist line in docs/PUBLISHING.md. | Smoke is informational in CI (`continue-on-error`), so a tag publishes either way. Smoke runs windowed with updates and screen saver off, so it never touches takeover, the taskbar, app tabs, live wallpaper or the updater. No beta channel: the updater reads `/releases/latest` and ignores pre-releases. |
| Weight | One shared scheduler, nothing refreshes while hidden, Eco profile, globe library loads on demand. 2.0.9, from that first report: calm when idle (the commit reports idle CPU 23.4% to 12.6% of a core on the Performance profile), background browser tabs unload, the slow-call helper stops when idle. | `main.js` imports about 40 modules eagerly (about 730 KB of renderer JS). No old-laptop numbers yet. |
| Platform | All native work goes through one `NativeBridge.call`. | About 86 spawn/helper call sites in 24 files talk to Windows directly. |

The council's "build the benchmark and `npm run smoke`" step was already done
by 30 Oct. **2.0.7 has no benchmark**; 2.0.8 is the first version with one and
2.0.9 (schema 2) is the baseline from here. A schema 1 report from 2.0.8 still
compares fine; it just has no "calm" number.

## The map

| Lane | P0 Baseline (to 9 Nov) | P1 Fix and instrument (to 6 Dec) | P2 Harden (Dec) | P3 Ship 3.0 (Jan) |
|---|---|---|---|---|
| **Measure** | M1 budget · M2 old-laptop baseline | M3 done · M4 per-view and hidden phases | M5 every release compared to the last | |
| **Safety net** | | S1 smoke blocks tags · S3 beta channel | S2 Windows-integration smoke | S4 copy diagnostics (stretch) |
| **Weight** | | W1 next rounds, driven by old-laptop data | W2 lazy-load feature modules | |
| **Visible wins** | | V4 pick features (30 Nov) | | V1 low-spec first run · V2 headline speed-up · V3 cost panel (stretch) |
| **Seams** | | | X1 native facade (opportunistic) | |
| **Gates** | G1 7 Nov · G2 9 Nov | G3 30 Nov | G4 kill check, mid-Dec | G5 release criteria |

## Items

Source says where an item came from: **council** (the verdict or an adviser),
or **gap** (something found in the code while mapping, not in the council text).

### Measure
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| M1 | **Write the budget** for your oldest laptop: idle CPU %, idle RAM MB, startup seconds, plus the same in Eco. Pick the numbers yourself and put them in `scripts/bench-budget.json` (the compare script reads it) and the README. | S | council | Blocks the budget checks below. Template at the end of this file. |
| M2 | **Baseline runs**: the 2.0.9 benchmark on every test laptop, the oldest first, 2 runs each, keeping the JSONs somewhere durable (not a temp folder). List each laptop's specs. | S | council | The report records the hardware. Run it soon after starting eDEX so startup numbers count. Use an installed build: runs from source (`npm start`) aren't comparable, so the compare script keeps them in their own column. |
| M3 | **Compare script.** Done: `npm run bench:compare -- <files or folders> [--budget scripts/bench-budget.json] [--detail]`. | done | gap | Pools runs of the same PC, version and kind of build into a median; two columns get a change column with better/worse; a budget gives exit code 1 when a limit is exceeded. Tested on your real report and on made-up ones; not yet on a second real PC. |
| M4 | **More phases in the benchmark.** Left to add: CPU/RAM with the globe, visualizer, a browser tab, the explorer with thumbnails and the live wallpaper each running; frame rate in all four profiles; and **idle while eDEX is hidden or covered**, driven from the main process because the dialog needs eDEX in front. | M | council + gap | 2.0.9 already added the idle-calm phase and per-process-kind breakdowns. Hidden-idle is the number that matters most for a shell left running behind your apps, and the README's "nothing runs while hidden" claim has no number yet. |
| M5 | Release rule: benchmark the oldest laptop against the last release with the compare script, and put the difference in the release notes. | S | council | Already a checklist line in docs/PUBLISHING.md. |

### Safety net
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| S1 | **Make smoke block tags.** Check recent CI runs first; if it is green, remove `continue-on-error` from the release path. | S | council | Not checked: whether smoke currently passes on the GitHub runner. |
| S2 | **Windows-integration smoke** in a second mode that is not windowed: takeover on, kill eDEX, taskbar comes back; an app tab with Notepad moves and restores the window; live wallpaper attaches to and leaves the desktop; the updater against a mock server (`EDEX_UPDATE_API`); screen saver starts and stops. | L | council | These are the parts the Contrarian said break first and make a laptop feel broken. Run on a real desktop or a VM; it can be a manual-trigger script rather than CI. |
| S3 | **Beta channel**: a Settings → About choice between Stable and Beta; `v3.0.0-beta.N` tags published as GitHub pre-releases; the updater reads `/releases` for Beta. | M | council | The auto-updater sends every regression to everyone. This puts a buffer in front of it. |
| S4 | **Copy diagnostics**: version, a trimmed settings list, helper health, recent errors, no personal data (same rules as the benchmark report). | S | gap | Answers "a tester reports something I can't reproduce", one of the Contrarian's warning signs. |

### Weight
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| W1 | **Fix the worst things the data shows.** First round shipped in 2.0.9 (calm when idle, unloading background browser tabs, stopping the idle helper). Further rounds follow the old-laptop data. | M more | council | In the first report the GPU process was the largest single piece of CPU (13.8 of 26.4 points of a core, before calm) and the interface renderers the largest memory (450 MB, then 301 MB GPU, 264 MB utility, 234 MB helpers). What drives the GPU number is a guess until measured per view (M4): effects, the globe and the WebGL terminal are the candidates. |
| W2 | **Lazy-load feature modules** with dynamic `import()`: theme studio, arrangements, games, AI, benchmark, settings, updates, and the Spotify, disk and process views. | M | council | Gated on startup data. About 730 KB of JS may turn out to be a small part of startup next to Chromium itself (the first report: 2.0 s to usable); if so, drop this. |

### Visible wins
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| V1 | **Low-spec first run**: use the hardware facts the benchmark already collects (low RAM, HDD, no usable WebGL, few cores) to start in Eco with heavy effects off, and say what was changed and how to undo it. | M | gap | The most direct way to deliver "revives old laptops" without the user hunting through Settings. |
| V2 | **Headline speed-up**: whichever number moves most in W1/W2 becomes the 3.0 headline, with before/after in the notes. | S | council | The Chairman's guard against an optimisation-only release feeling dull. 2.0.9's calm-when-idle is a candidate if it holds on the old laptop. |
| V3 | **Cost panel** in Settings → Performance: each heavy feature with its measured cost and a switch. | M | council (shrunk) | The cheap version of the Expansionist's modular core: no plugin API, just honest numbers on features that exist. |
| V4 | **Choose 3.0's new features on 30 Nov**, from the data. Each must ship with either a benchmark phase or an "off unless used" guarantee. | S | council | Candidates come from you; none are assumed here. |

### Seams
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| X1 | **Native facade**: group helper calls by capability (windows, audio, media session, Bluetooth, search, disk, wallpaper) under `src/main/platform/`. New code uses it; old code migrates when touched. | S now, more later | council | No big-bang refactor. Keeps a future port possible without promising one. |

### Gates
| ID | When | Check | If it fails |
|---|---|---|---|
| G1 | Sat 7 Nov | 2.0.9 benchmark JSONs from every test laptop, the oldest included. | Run fewer laptops rather than slip. |
| G2 | Mon 9 Nov | Top problems identified from the old laptop's data. If it already meets its budget with room to spare, move toward features sooner. | |
| G3 | Mon 30 Nov | 3.0 feature set chosen from data (V4). | |
| G4 | Mid-Dec | **Kill check:** oldest laptop meets the budget in Eco after the fixes. | Rethink the low-spec promise or the runtime before adding anything else. |
| Standing | Any time | Bug reports outnumber fixes for a month. | Freeze features. |
| G5 | Release | Budget met on the oldest laptop; smoke green; the compare against 2.0.9 shows no regression; at least one beta cycle. | 3.0 slips. It ships when these hold, not on a date. |

## What fits

| Tier | Items | Slots |
|---|---|---|
| Must | M1 M2 M4 (rest) W1 (next rounds) S1 S3 S2, beta cycles and laptop re-runs, release | about 8 |
| Should (if data supports) | W2, V1, V2 | about 2 |
| Stretch (cut first) | V3, S4, X1 | about 2 |

About 12 slots against about 13 available. The stretch tier is the buffer.

## Parked (C), with what unlocks each

| Item | Unlocks when | First step |
|---|---|---|
| Sponsors or a supporter theme pack | 3.0 has shipped and held its budget for a release, and people other than you are using it | Nothing to build yet |
| Code signing (SmartScreen currently warns) | There is a real audience asking for it | Find out the actual price and whether an individual in India can get a certificate before spending anything |
| Charging for builds | After licensing advice | The code is GPL-3.0 through eDEX-UI; talk to someone who knows open-source licensing |
| Public compatibility table | Several reports from machines that aren't yours | `npm run bench:compare` gives the format |
| macOS and Linux | The native facade exists and the Windows core is stable | The native layer is Windows-only today |

## Not planned
- A plugin API.
- Replacing Electron, unless G4 trips.
- Anything that adds a background poller before the budget table exists.

## Budget template (for M1)

Copy the numbers into `scripts/bench-budget.json`. The keys are the names the
compare script prints; `null` means no limit.

| Measure | Key | Oldest laptop budget | Measured (2.0.9) |
|---|---|---|---|
| Startup to usable, seconds | `startupToUsableSec` | | |
| Idle CPU, % of one core | `idleCpuPctOfCore` | | |
| Idle CPU in Eco | `ecoIdleCpuPctOfCore` | | |
| Idle RAM, all eDEX processes, MB | `idleMemoryMB` | | |
| Idle while hidden, CPU % and RAM MB | not measured yet (M4) | | |
