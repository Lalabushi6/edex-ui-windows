# Road to 3.0: feature map

Drafted 30 Oct 2026 from the decision council's verdict (B first: stability,
speed and low-spec performance; new features only inside a measured budget;
distribution and money parked). Rewritten 5 Nov 2026, updated the same day for
2.0.13 and on 9 Nov for 2.0.14: `main` at `d568e9e`, no pull requests open.

**Goal:** an impeccable, light daily driver that revives older machines,
without becoming heavy, insecure or unmaintainable.

**Capacity:** about 12 weekly slots of 2-3 hours left between now and the end
of January. There were 13 on 31 Oct; the first week went on the security pass
and the Electron move, neither of which was on the map. Sizes below are in
slots (S = a quarter, M = one, L = two) and are rough guesses.

## What changed since the 31 Oct map

- **2.0.10 and 2.0.11 are out** (2.0.11 on 2 Nov): the way eDEX calls Windows
  tools and reaches local files was hardened, plus bug fixes and removal of
  dead code.
- **2.0.12 is out** (5 Nov), with pull requests #1 to #4 in. It moves to
  Electron 45, so browser tabs get Chromium security fixes again, and switches
  to the async `safeStorage` API. It also fixes how pop-ups open in browser
  tabs and ships the rest of the security review: imports can't start anything,
  network shares aren't touched unasked, calendar feeds have limits, radio
  checks, risky pastes shown first, AI terminal-output handling, and
  unverifiable updates refused.
- **2.0.13 is out** (5 Nov), on the same Electron. It closes the last two review
  findings (U2), makes Spotify calls at the same moment share one token refresh,
  and removes the blank-page fallback for pop-ups. The Spotify changes have only
  run against a mock, not the real service.
- **2.0.14 is out** (9 Nov), on the same Electron. Screen time now counts only
  while someone is at the PC: it stops at the last input when you step away,
  lock or sleep, saves when Windows shuts down, and keeps counting a video, call
  or game that keeps the screen on and plays sound. The helper no longer caches
  program paths by process ID, which could give a new process a closed
  program's name. It adds no timer; the only new helper calls come while you're
  away (2 a minute) or watching something. Locking, sleep and Modern Standby
  were simulated, not done for real.
- **The new release workflow has run for real.** On the 2.0.12 tag, the
  read-only build, the cache hand-over and the separate publish job all worked.
- **`npm audit` is down to 6 moderate findings**, all in development tools,
  with none in the shipped dependencies (33 findings before the 4 Nov update).
- **2.0.12 was tagged before GE's laptop runs.** The check behind the tag was
  one PC, on battery: three full benchmark runs of each packaged build, in
  turn, showed no slowdown in startup, idle CPU or idle memory. A profile
  upgraded from a 2.0.11 build also kept its saved key, settings and browser
  cookie. The oldest laptop hasn't run it yet, so GE is still open, and it now
  runs on 2.0.14, the version eDEX offers. 2.0.13 had no benchmark comparison
  of its own: it only changed tab icon, pop-up and Spotify code. 2.0.14 was
  compared with 2.0.13 on one PC only, from source, so M5 wasn't met for it.
- **`scripts/bench-budget.json` is still empty**, and the only report from an
  installed copy is still the 2.0.8 one from 30 Oct.
- **Smoke passed 12 of 12 on the 2.0.12, 2.0.13 and 2.0.14 release runs**, which
  answers the open question under S1. It now also checks pop-ups, local audio and an encrypted
  key.

## This week

1. **Thu 5 and Fri 6 Nov:** install 2.0.11 on each test laptop and run the
   benchmark twice, the oldest laptop first (M2). Don't take the update it
   offers until the runs are done.
2. **Sat 7 Nov, G1:** the reports are in.
3. **Mon 9 Nov, G2:** read the old laptop's numbers and write the budget (M1).
4. **By Fri 13 Nov, GE:** update those laptops to 2.0.14, run the benchmark
   again and compare with the 2.0.11 reports. Trying the update from inside
   eDEX here also gives the first real run of the update path from 2.0.11.

## Where things stand (5 Nov)

| | Done | Not yet |
|---|---|---|
| Measure | Benchmark in Settings → Performance (schema 2: idle, calm and Eco CPU/RAM per process, frame pacing, effect drawing, terminal throughput, helper round trip). Saves a no-personal-data JSON. `npm run bench:compare` lines reports up. One PC comparison of packaged 2.0.11 and 2.0.12 code, on battery, median of 3: startup 1.2 s to 0.8 s, idle CPU 17.7% of a core on both, Eco 13.8% to 11.4%, idle memory 798 MB to 808 MB, terminal 5.2 to 6.9 MB/s, interface lag p95 8.6 ms to 10.8 ms. One PC comparison of 2.0.13 and 2.0.14 code from source, on battery, median of 5: idle CPU 16.3% and 16.8% of a core, Eco 14.6% and 14.5%, idle memory 801 MB and 802 MB, all within noise. | Nothing from an old laptop, and none of these numbers came from one. No installed 2.0.9 to 2.0.14 reports. No budget numbers. No per-view or hidden-idle phases. The 2.0.8 report (a 12th-gen i5 with 16 GB, 26% of a core and 1.39 GB idle) is still the only one run by hand from an installed copy. |
| Safety net | `npm run check`; `npm run smoke` (12 checks, passed on the 2.0.12, 2.0.13 and 2.0.14 release runs). Release builds use a read-only token and a separate publish job, proven on the 2.0.12 tag and used again for 2.0.13 and 2.0.14. The updater refuses a release with no SHA-256 digest. | Smoke is still `continue-on-error`, so a tag publishes either way. Locally it hangs about 2 runs in 5 at its benchmark when the window is covered. No beta channel: the updater reads `/releases/latest` and ignores pre-releases. A real update from 2.0.11 hasn't been run: the updater has been seen to offer 2.0.13, but not to download and install it. |
| Weight | One shared scheduler, nothing refreshes while hidden, Eco profile, globe library loads on demand. 2.0.9: calm when idle, background browser tabs unload, the idle helper stops. 2.0.11 removed unused IPC channels and dead code. | `main.js` still imports 40 modules eagerly. The 2.0.9 calm-when-idle gain (23.4% to 12.6% of a core, from the commit message) hasn't been re-measured. No old-laptop numbers. |
| Security and upkeep | 2.0.12 shipped on Electron 45.2.2. Review findings E-1 to E-13 are handled and released, and 2.0.13 closed the two smaller ones left (U2). Dependencies are updated, with nothing from `npm audit` in the shipped ones. | One AI check has only been tested with a stand-in, and 2.0.13's Spotify changes with a mock. Details stay out of this file because the repository is public. |
| Platform | All native work goes through one `NativeBridge.call`. 2.0.11 added `lib/sysexe.js`, which finds Windows tools by full path. | About 86 spawn and helper call sites in 24 files (counted 30 Oct, before 2.0.11). Recount before X1. |

## The map

| Lane | P0 Settle (to 9 Nov) | P1 Fix and instrument (to 6 Dec) | P2 Harden (Dec) | P3 Ship 3.0 (Jan) |
|---|---|---|---|---|
| **Measure** | M1 budget · M2 baseline on 2.0.11 | M3 done · M4 per-view and hidden phases | M5 every release compared to the last | |
| **Upkeep** | U1 done | U2 done · U4 done · U5 Electron cadence · U6 audit routine | | |
| **Safety net** | | S1 smoke blocks tags · S3 beta channel | S2 Windows-integration smoke (manual script) | S4 copy diagnostics (stretch) |
| **Weight** | | W1 next rounds, driven by old-laptop data | W2 lazy-load feature modules (stretch) | |
| **Visible wins** | | V4 pick features (30 Nov) | | V1 low-spec first run · V2 headline speed-up · V3 cost panel (stretch) |
| **Palace** | | PL1 anchors and rooms (after G2) | PL2 review loop, beta channel · PL3 cost guard | PL4 globe anchors · PL5 later views (stretch) |
| **Daily use** | | | | F2 quick capture · F1 recall search, F3 due cards on idle, F4 terminal history, F5 study session (stretch) |
| **Seams** | | | X1 native facade, building on `sysexe.js` (stretch) | |
| **Gates** | G1 7 Nov · G2 9 Nov | GE 13 Nov · G3 30 Nov · GP1 30 Nov | G4 kill check, mid-Dec · GP2 after G4 | G5 release criteria |

## Items

Source says where an item came from: **council** (the verdict or an adviser),
**gap** (something found in the code while mapping), or **review** (the
security review and the Electron move, 2-4 Nov).

### Measure
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| M1 | **Write the budget** for your oldest laptop: idle CPU %, idle RAM MB, startup seconds, plus the same in Eco. Pick the numbers yourself and put them in `scripts/bench-budget.json` (the compare script reads it) and the README. | S | council | Blocks the budget checks below. Template at the end of this file. Do it on 9 Nov after the first old-laptop data. |
| M2 | **Baseline runs** on the installed 2.0.11 on every test laptop, the oldest first, 2 runs each, keeping the JSONs somewhere durable. List each laptop's specs. Repeat once on 2.0.14 (GE). | S, then S | council | The report records the hardware. Run it soon after starting eDEX so startup numbers count. Use an installed build: runs from source (`npm start`) aren't comparable, so the compare script keeps them in their own column. The baseline moved from 2.0.9 to 2.0.11, the last Electron 41 release, so the move to 45 can be measured. |
| M3 | **Compare script.** Done: `npm run bench:compare -- <files or folders> [--budget scripts/bench-budget.json] [--detail]`. | done | gap | Pools runs of the same PC, version and kind of build into a median; two columns get a change column with better/worse; a budget gives exit code 1 when a limit is exceeded. First used across two versions on 5 Nov, on one PC. GE is its first use on the laptops. |
| M4 | **More phases in the benchmark.** Left to add: CPU/RAM with the globe, visualizer, a browser tab, the explorer with thumbnails and the live wallpaper each running; frame rate in all four profiles; and **idle while eDEX is hidden or covered**, driven from the main process because the dialog needs eDEX in front. | M | council + gap | 2.0.9 already added the idle-calm phase and per-process-kind breakdowns. Hidden-idle matters most for a shell left running behind your apps, and the README's "nothing runs while hidden" claim has no number yet. A covered window also makes smoke's benchmark hang (S1), so this work helps both. |
| M5 | Release rule: benchmark the oldest laptop against the last release with the compare script, and put the difference in the release notes. | S | council | Already a checklist line in docs/PUBLISHING.md. |

### Upkeep
Work that keeps the app safe to run. It wasn't on the first map and it took
most of the first week, so it now has a lane and a budget.

| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| U1 | **Land the open pull requests.** Done 5 Nov: #1 to #4 are merged. | done | review | The async `safeStorage` work in #3 was needed before Electron 46. With #2 and #4 both in, the blank-page branch in `openPopup` could go; 2.0.13 removed it. |
| U2 | **Close the two open review findings** (one in browser tabs, one in the Spotify sign-in). Done 5 Nov, released in 2.0.13. | done | review | The details are in the private security notes, not here. One visible cost: a site that only serves its icon to signed-in visitors now shows the usual tab icon. |
| U4 | **Tag 2.0.12.** Done 5 Nov, before GE's laptop runs. | done | review | The read-only build, the cache hand-over and the publish job all passed on their first real run. Releases are immutable, so if GE finds a slowdown the fix goes in 2.0.15. |
| U5 | **Electron cadence rule:** check the supported versions once a month and stay inside the newest three majors (45, 44 and 43 today). | S each time | review | Electron 41's last release was 25 Aug, so it stopped getting Chromium fixes without any warning in the app. Electron 46 removes the sync `safeStorage` calls, which is why #3 exists. |
| U6 | **Audit step in the release checklist:** `npm audit` before each tag, with the result in the notes. | S | review | On 5 Nov: 6 moderate, all in development tools, and none in the shipped dependencies (`npm audit --omit=dev`). Add the line to docs/PUBLISHING.md. |

### Safety net
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| S1 | **Make smoke block tags.** Remove `continue-on-error` from the release path, with one automatic retry. | S | council | Smoke passed 12 of 12 on the 2.0.12 release run, so the old question is answered. The catch is the local hang at the benchmark when the window is covered (2 in 5 runs); retry covers it until M4 fixes the cause. |
| S2 | **Windows-integration smoke** in a second mode that is not windowed: takeover on, kill eDEX, taskbar comes back; an app tab with Notepad moves and restores the window; live wallpaper attaches to and leaves the desktop; the updater against a mock server (`EDEX_UPDATE_API`); screen saver starts and stops. | M (was L) | council | Now planned as a manual script on a real desktop or a VM, not CI. That is what pays for the Upkeep lane. |
| S3 | **Beta channel**: a Settings → About choice between Stable and Beta; `v3.0.0-beta.N` tags published as GitHub pre-releases; the updater reads `/releases` for Beta. | M | council | More valuable than before: the Electron move and the Palace both want a buffer in front of everyone. The updater now also refuses a release with no digest, so beta releases need one too. |
| S4 | **Copy diagnostics**: version, a trimmed settings list, helper health, recent errors, no personal data. | S | gap | Answers "a tester reports something I can't reproduce". |

### Weight
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| W1 | **Fix the worst things the data shows.** First round shipped in 2.0.9. Further rounds follow the old-laptop data. | M more | council | In the first report the GPU process was the largest single piece of CPU (13.8 of 26.4 points of a core, before calm) and the interface renderers the largest memory (450 MB). What drives the GPU number is a guess until measured per view (M4). Electron 45 barely moved these on the one PC measured so far; GE shows whether that holds on the old laptop, so it comes first. |
| W2 | **Lazy-load feature modules** with dynamic `import()`: theme studio, arrangements, games, AI, benchmark, settings, updates, and the Spotify, disk and process views. | M | council | Stretch since 31 Oct. Also gated on startup data: about 730 KB of JS may be small next to Chromium itself (the first report: 2.0 s to usable). Drop it if so. |

### Visible wins
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| V1 | **Low-spec first run**: use the hardware facts the benchmark already collects (low RAM, HDD, no usable WebGL, few cores) to start in Eco with heavy effects off, and say what was changed and how to undo it. | M | gap | The most direct way to deliver "revives old laptops" without the user hunting through Settings. |
| V2 | **Headline speed-up**: whichever number moves most in W1/W2 becomes the 3.0 headline, with before/after in the notes. | S | council | The Chairman's guard against an optimisation-only release feeling dull. Calm-when-idle is a candidate if it holds on the old laptop. |
| V3 | **Cost panel** in Settings → Performance: each heavy feature with its measured cost and a switch. | M | council (shrunk) | The cheap version of the Expansionist's modular core: no plugin API, just honest numbers on features that exist. |
| V4 | **Choose 3.0's new features on 30 Nov**, from the data. Each must ship with either a benchmark phase or an "off unless used" guarantee. | S | council | The Palace is already chosen. The Daily use lane holds the other candidates; more come from you. |

### Palace
A spatial memory palace for studying, recall and finding your own things,
and the headline feature of the 2.x line. The best-supported part is spaced
retrieval (cards you are quizzed on at growing intervals); space is a memory
cue on top of it. So the plan builds the cards and anchors first and treats
each view (Explorer, globe, later others) as a skin over one data store. Rules
from the council: opt-in and off by default, nothing loaded or running when
closed, data that cannot be silently lost, and no globe work until you have
used the folder version for 10 days.

| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| PL1 | **Anchors and rooms.** One JSON file in the profile folder (id, kind folder or place, ref, front, back, due, interval), written atomically with a rolling backup, plus repair when an anchored folder is moved or deleted. First view is Explorer: the current folder is the room and "Add card here" pins a card to it. | M | council (31 Oct) | Start after G2 (9 Nov) and only if the oldest laptop leaves room. Before coding, run your own two-week test: 30 real cards, half anchored and half in a plain list, recall tested at day 7 and day 14. The Upkeep lane is competing for the same weeks, so this is the first thing to slip. |
| PL2 | **Review loop.** Due cards are counted when eDEX opens (no timer), shown as "3 due" in the launcher, and walked through room by room. Simple spacing (for example 1, 3, 7, 21 days) you can tune. | M | council (31 Oct) | Needs the beta channel (S3) first: it ships there, not to everyone. |
| PL3 | **Cost guard.** A benchmark phase for the Palace (idle with it off, idle with it open, review with 500 cards) and the rule that off means off: no module loaded, no poller. | S | council (31 Oct) | Must be green before anything reaches Stable (GP2). |
| PL4 | **Globe anchors.** Pin a card to a place on the globe and plan a journey through places. Same store, new skin. | M | council (31 Oct) | Starts only after 10 days of your own use of PL1 and PL2 and a passing PL3. The globe is the likeliest GPU cost, so measure it per view (M4) first. |
| PL5 | **After 3.0:** walk mode, a 2D floor plan, exporting and importing a palace as a file, optional card drafting with the existing AI module on your own key (off by default). | M each | council (31 Oct) | Stretch. Each is a separate skin or integration, one per release. |

### Daily use
Small features that are useful even to a few people. None adds a background
poller.

| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| F1 | **Recall search.** One box across notes, tasks, calendar and files (the Windows Search helper already exists); a result can be pinned to a Palace room. | M | council (31 Oct) | Stretch. The "finding your own stuff" half of the Palace goal. |
| F2 | **Quick capture.** A hotkey drops selected text or the current browser tab into a note or the room you are in. | S | council (31 Oct) | Should. Runs only when pressed. |
| F3 | **Due cards on the idle screen.** The idle screen shows what is due instead of decoration. | S | council (31 Oct) | Stretch. Needs PL2. |
| F4 | **Terminal history recall.** Search commands across sessions with the folder each ran in. | S | council (31 Oct) | Stretch. The terminal must record history, so it is opt-in and measured. |
| F5 | **Study session.** A timer, a saved arrangement and muted notices behind one switch. | S | council (31 Oct) | Stretch. Reuses arrangements and notices. |

### Seams
| ID | Item | Size | Source | Notes |
|---|---|---|---|---|
| X1 | **Native facade**: group helper calls by capability (windows, audio, media session, Bluetooth, search, disk, wallpaper) under `src/main/platform/`. New code uses it; old code migrates when touched. | S now, more later | council | Stretch. Build on `lib/sysexe.js`, which 2.0.11 added, rather than beside it. No big-bang refactor. Keeps a future port possible without promising one. |

### Gates
| ID | When | Check | If it fails |
|---|---|---|---|
| G1 | Sat 7 Nov | 2.0.11 benchmark JSONs from every test laptop, the oldest included. | Run fewer laptops rather than slip. |
| G2 | Mon 9 Nov | Top problems identified from the old laptop's data, and the budget written (M1). If the laptop already meets its budget with room to spare, move toward features sooner. | |
| GE | Fri 13 Nov | **Electron 45 check:** an installed 2.0.14 against the 2.0.11 reports with `npm run bench:compare` shows no worse startup, idle CPU or idle RAM beyond run-to-run noise. Passed on one PC on 5 Nov, with 2.0.12 code; the old laptop is what counts. | 2.0.14 is already out, so find out why and fix it in 2.0.15. Weigh any slowdown against running browser tabs on an engine that no longer gets security fixes. |
| G3 | Mon 30 Nov | 3.0 feature set chosen from data (V4). | |
| GP1 | Mon 30 Nov | **Palace use check:** your own log shows you used the Palace on at least 7 of the 14 test days. | Demote the Palace to stretch. |
| G4 | Mid-Dec | **Kill check:** oldest laptop meets the budget in Eco after the fixes. | Rethink the low-spec promise or the runtime before adding anything else. |
| GP2 | After G4 | The Palace goes to Stable only if G4 passed, PL3 shows no measurable idle cost with it off, and there has been no card-loss incident. | It stays on the beta channel. |
| Standing | Any time | Bug reports outnumber fixes for a month. | Freeze features. |
| G5 | Release | Budget met on the oldest laptop; smoke green; the compare against 2.0.11 shows no regression; Electron on a supported major; `npm audit` reviewed; at least one beta cycle. | 3.0 slips. It ships when these hold, not on a date. |

## What fits

| Tier | Items | Slots |
|---|---|---|
| Must | M1 M2 M4 (rest) W1 (next rounds) S1 S3 S2 (as a manual script), U5 U6, PL1 PL2 PL3, beta cycles and laptop re-runs, release | about 9.5 |
| Should (if data supports) | V1, V2, PL4, F2 | about 2.5 |
| Stretch (only if something finishes early) | W2, V3, S4, X1, PL5, F1, F3, F4, F5 | about 5 |

Must alone fills most of the 12 slots left, and Must plus Should is about 12.
Shrinking S2 from two slots to one is what paid for the Upkeep lane. If G2
shows trouble, cut in this order: PL4, F2, V2, then PL1.

## Parked (C), with what unlocks each

| Item | Unlocks when | First step |
|---|---|---|
| Sponsors or a supporter theme pack | 3.0 has shipped and held its budget for a release, and people other than you are using it | Nothing to build yet |
| Code signing (SmartScreen currently warns) | There is a real audience asking for it | Find out the actual price and whether an individual in India can get a certificate before spending anything |
| Charging for builds | After licensing advice | The code is GPL-3.0 through eDEX-UI; talk to someone who knows open-source licensing |
| Public compatibility table | Several reports from machines that aren't yours | `npm run bench:compare` gives the format |
| macOS and Linux | The native facade exists and the Windows core is stable | The native layer is Windows-only today |
| Clipboard history | The budget table exists and a clipboard watcher can be shown to cost close to nothing | It needs a background watcher, which the plan rules out for now |
| Syncing or sharing palaces between devices | Palace export and import work, and people other than you ask for it | Define the export file format in PL5 |

## Not planned
- A plugin API.
- Replacing Electron, unless G4 trips.
- Anything that adds a background poller before the budget table exists.

## Budget template (for M1)

Copy the numbers into `scripts/bench-budget.json`. The keys are the names the
compare script prints; `null` means no limit.

| Measure | Key | Oldest laptop budget | Measured (2.0.11) |
|---|---|---|---|
| Startup to usable, seconds | `startupToUsableSec` | | |
| Idle CPU, % of one core | `idleCpuPctOfCore` | | |
| Idle CPU in Eco | `ecoIdleCpuPctOfCore` | | |
| Idle RAM, all eDEX processes, MB | `idleMemoryMB` | | |
| Idle while hidden, CPU % and RAM MB | not measured yet (M4) | | |
