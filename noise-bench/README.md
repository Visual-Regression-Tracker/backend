# Rendering-noise bench

The stand behind `npm run test:noise` (see the end of this file). It shows on a few
hundred screenshots what Visual Regression Tracker 6.0's rendering-noise filter
does. The suite screenshots the VRT UI itself, in light and dark mode, under
several render environments (the same page drawn by differently configured
Chromium), with and without injected regressions, and sends every screenshot,
byte for byte the same, to these VRT projects:

| Project                        | Comparison                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `Noise demo · no filter`       | pixelmatch, defaults: the control                                                                                  |
| `Noise demo · tolerance`       | the same, but every screenshot is tracked with `diffTollerancePercent` = the largest diff the noise runs produced |
| `Noise demo · filter + DINOv2` | pixelmatch with "Ignore rendering noise": the blur filter, with DINOv2 confirming each pass                        |
| `Noise demo · own baseline`    | pixelmatch defaults, but tracked with `browser` = the environment, so every environment has its own baseline         |
| `Noise demo · own baseline + ignore areas` | the same, with ignore areas (`ownIgnoreAreas` in `demo.config.json`) on the spots that differ between two renders in one environment |

The report then counts, per project, the false alarms on noise-only
screenshots and the regressions caught or missed, by severity and category.

## Prerequisites

- VRT 6.0 running: UI on http://localhost:8080, API on http://localhost:4200
  (change them in `demo.config.json` or with `VRT_UI_URL` / `VRT_API_URL`);
  for the DINOv2 project, the API needs `DINOV2_URL`.
- The four projects above and the frozen `Showcase` project, created by
  `npm run demo:setup` (`scripts/setup-projects.mjs`).
- Node 22.12+, then `npm install` and `npx playwright install chromium`.
- The noise environments need Google Chrome (`chrome`) and two older
  Playwright browsers (macOS arm64 paths in `src/environments.ts`):
  `npx playwright@1.57.0 install chromium-headless-shell` (Chromium 143) and
  `npx playwright@1.50.1 install chromium` (Chromium 133).
- A `.env.local` here (git-ignored), or any file named by `DEMO_ENV_FILE`:

  ```
  VRT_DEMO_EMAIL=...
  VRT_DEMO_PASSWORD=...
  VRT_DEMO_API_KEY=...
  ```

## Reproduce

```sh
npm run demo:all      # baseline + approve, calibration, noise runs, bug runs, report
open results/report.md
```

`demo:all` takes a run id (`DEMO_RUN`, a timestamp by default) that prefixes
every build it makes, and reports on that run only. With baselines already
approved, `DEMO_SKIP_BASELINE=1 npm run demo:all` reuses them.

The steps one by one:

| Command                                      | What it does                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run demo:verify-bugs [-- <env>]`        | dry run, nothing sent: renders every screen clean twice and once per bug; writes `results/bug-check-<env>.json`                        |
| `npm run demo:baseline`                      | `reference` env, no bugs, into all four projects, then approves those builds through the API                                         |
| `npm run demo:own`                          | every environment in `ownBaselineEnvironments` into the two own-baseline projects, approved; then the ignore areas                    |
| `npm run demo:calibrate [-- <env> ...]`      | noise runs into `no filter` only; the largest diff, rounded up to `toleranceStep`, becomes the tolerance (`results/demo-state.json`) |
| `npm run demo:noise -- <env>`                | one environment, no bugs, into all four projects                                                                                     |
| `npm run demo:change -- <env> <bugs>`        | one environment with a bug set (`set1`…`set5`) or comma-separated bug ids                                                            |
| `npm run demo:report [-- --run <run id>]`    | `results/report.json` and `results/report.md` from the manifests and the API                                                          |
| `npm run bench:export -- --run <run id>`    | the run's pairs, labels and DINOv2 patch distances into `../test_noise/fixtures` (needs `DINOV2_URL`); see below                     |

`DEMO_TOLERANCE` overrides the calibrated tolerance. `DEMO_SCREENS` and
`DEMO_THEMES` (comma-separated) narrow a run while trying things out;
`DEMO_WORKERS` sets the parallelism (2 by default: more workers make a few
screens differ by ±1 colour levels between two renders even in one
environment).

## How it is put together

- **Screens** (`src/screens.ts`): 14 screens of the VRT UI, each in light and
  dark (the app follows `prefers-color-scheme` until a user picks a mode, so
  the context's `colorScheme` sets it): login (empty and filled), register,
  and pages of the `Showcase` project, whose ids are looked up by name before
  each run: a build with mixed statuses as table, grid and filtered by status,
  a passed build, the test run dialog (unresolved with diff, without diff, ok),
  baselines, one baseline's history, the project settings form (the dialog
  only, not the project list behind it) and the user list. Never the profile
  page, which shows an API key, nor anything of the demo projects. The clock
  is frozen, transitions, animations, ripples and the caret are off, and a
  screenshot waits for the network, fonts and every image, canvas ones
  included, to be decoded. 1280×800, `en-US`, UTC, `--lang=en-US` (number
  inputs format with the browser's own locale).
- **Environments** (`src/environments.ts`): named Playwright launch/context
  options. `reference` is Playwright's default headless shell and makes the
  baselines; `demo.config.json` → `noiseEnvironments` lists the ones
  `demo:all` uses, `calibrationEnvironments` the ones the tolerance is
  calibrated on (`chromium-133` is left out: a stale browser is a stress
  case, not everyday noise) and `changeEnvironments` the one each bug set
  renders in.
- **Bugs** (`src/bugs.ts`): 60 realistic regressions, 27 obvious and 33
  subtle, 3–5 per screen, injected in the test browser only, right before the
  screenshot: missing buttons and icons, overlaps, changed text and digits,
  truncation, colours, borders, spacing, duplicates, wrong images. Every bug
  is checked to change pixels (`demo:verify-bugs`). `bugSets()` splits them
  into five sets with at most one bug per screen; a screen without a bug in a
  build is a noise-only data point.
- **One image, four projects** (`src/tracker.ts`): one sdk-js
  `VisualRegressionTracker` per project, all in builds with the same
  `ciBuildId`. Each screenshot is taken once and the same `Buffer` is tracked
  into every project (multipart `imageBuffer`), with retries off (`track(…, 0)`:
  a retry re-sends the same image) and soft assert on, so a diff never fails
  the suite. Only `Noise demo · tolerance` gets a non-zero
  `diffTollerancePercent`: VRT takes it per track call, not per project. The
  browser, viewport and name of a screenshot are the same in every
  environment, so each run compares against the reference baseline.
- **Ground truth**: every build writes `results/manifest-<build>.json`:
  per screenshot its screen, theme, environment, bug (id, category, severity)
  or none, the image's SHA-256, and the test run each project returned.

## The fixtures of `npm run test:noise`

`test_noise/` in the backend replays the filter on screenshot pairs from one
run of this stand, without a database or DINOv2: every change shot, and the
noise of one calibrated environment per screen. `bench:export` downloads each
pair through the API, stores the PNGs once by content hash, and records
DINOv2's patch distances for every patch with a changed pixel (the gate can
mark no other); the PNGs are then recompressed losslessly
(`oxipng -o 4 --strip safe test_noise/fixtures/images/*.png`). Run it against the stack the run went to, with `DINOV2_URL`
pointing at the same `dinov2` image the backend pins.

A filter change that catches a listed miss makes its `it.failing` test fail:
take the case off `test_noise/known-misses.ts`. A new miss or false alarm
fails its test too; list it there only with the reason it cannot be told
apart.
