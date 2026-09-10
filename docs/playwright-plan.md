# Playwright test harness — implementation plan

Status: **implemented** (2026-09-11). Lives in `tests/` — see
[`../tests/README.md`](../tests/README.md) for how to run it and what each spec
covers. This file is kept for the design rationale below.

Goal: overcome the Browser-pane testing limits (rAF throttled to ~4 fps, only
one tab renders, held keys don't work, pane wedges). Runs locally on Tim's
machine, headed on his real display so he can watch. Not CI.

## What changed from the plan during implementation

- **The set-piece tracks don't complete under the real loop.** Stunt Park and
  Mission Impossible need frame-perfect entry speed at their gaps; at the
  sub-60fps the headed browser runs, the autopilot wedges (Stunt Park always,
  Mission Impossible ~half the time). `solo.spec.js` runs the full
  drive-to-finish check on the 4 flowing tracks only; the set-piece tracks get
  a "loads + opening section drivable" smoke check. Deterministic completion for
  those stays with the offline `tools/autopilot.js` harness — as this doc
  already said it should.
- `tools/autopilot.js` is injected as a **classic script** with `export`
  stripped (it's an ES module), so `window.__AP` is set synchronously.
- Autopilot in Playwright never calls `AP.begin()`/`AP.end()` — those are the
  offline `frameloop:'never'` path. The helper calls `AP.control()` once per
  animation frame and lets the real loop run.
- `tilt.spec.js` drives the gyro via CDP `DeviceOrientation.setDeviceOrientationOverride`.

## Decisions already made

- Browsers installed to `~/.cache/ms-playwright` (persistent; the `/tmp` wipes
  that keep killing the `/tmp` Node install would nuke browser binaries too).
  Node lives at `~/.local/node/bin` (+ symlinks in `~/.local/bin`).
- `@playwright/test` as a **devDependency**. New `tests/` dir + root
  `playwright.config.js`. Never in the game bundle.
- **Headed**, `headless: false`, launched with `DISPLAY=:0` in the env so a
  Chromium window appears on Tim's desktop. He watches; I verify via
  `page.screenshot()` files (Read them back) + `page.evaluate()` reads.
- Tests run against the **dev build** (`npm run dev`) — they depend on the dev
  globals (`window.__three __input __dbg __car __hud __net __track`), which are
  stripped from prod (`import.meta.env.DEV`).
- `playwright.config.js` `webServer` auto-starts `npm run dev` on 5173.
- **Multiplayer tests hit the DEPLOYED relay** `speed-racer.timothyoverton.partykit.dev`
  — always up, free-tier quota is a non-issue, and it sidesteps the
  background-process SIGTERM problem that keeps killing local `partykit dev`.
  (If we ever need the local relay, start it inside global-setup and tear down
  in global-teardown, all one foreground process.)

## Keep the fixed-step harness too

The manual `st.setFrameloop('never')` + `st.advance(sec)` loop stays the right
tool for deterministic physics/geometry measurement (exact lap times, jump
ballistics, "is this ramp climbable"). Playwright running the real loop has
frame jitter and is *less* repeatable for that. Playwright is for: real fps,
real held-key input, live 2-player rendering, tilt, and regression.

## Files to create

```
playwright.config.js          webServer: npm run dev @ 5173; use: { headless:false,
                              baseURL:'http://localhost:5173' }; testDir:'tests'
tests/helpers.js              hold(page, key, ms), driveForward(page, ms),
                              waitForPhase(page, 'racing'), readHud(page),
                              startSolo(page, trackId), injectAutopilot(page)
tests/solo.spec.js
tests/multiplayer.spec.js
tests/perf.spec.js
tests/tilt.spec.js
```

Add to package.json scripts: `"test:e2e": "playwright test"`,
`"test:e2e:headed": "playwright test --headed"` (redundant if config sets it,
but explicit is fine).

## Helper details

- `hold(page, 'ArrowLeft', 800)` → `keyboard.down` / `waitForTimeout` /
  `keyboard.up`. This is the thing the Browser pane can't do.
- `startSolo(page, trackId)`:
  `page.evaluate` to set `localStorage['speed-racer:track']` + `touch-mode=off`,
  reload, click DRIVE, `waitForFunction(() => window.__dbg?.phase === 'racing')`.
- `readHud(page)` → `page.evaluate(() => ({ ...window.__hud }))`.
- `injectAutopilot(page)`: `page.addScriptTag({ path: 'tools/autopilot.js' })`
  then `page.evaluate` the `AP.install()/begin()/chunk()` loop — but for
  Playwright let the REAL loop run (`AP` without the `setFrameloop('never')`
  hack) and poll `AP.cursor` / `window.__dbg.phase` until `finished`.

## Scenarios

**tests/solo.spec.js**
- For each track id: `startSolo`, `injectAutopilot`, drive to finish (poll,
  ~120 s timeout), assert `phase === 'finished'`, assert reported time within a
  sane band of the reference lap in track.js. This is the "AI completes every
  track" regression.
- One hand-driven test: `startSolo('test-pad-0')`, `hold('ArrowUp', 2000)`,
  assert `__hud.speedKmh > 60`; then `hold('ArrowLeft', 600)` while holding up,
  assert the car yaw changed (`__car.fwd` rotated) — guards the tilt/keyboard
  steering regression.

**tests/multiplayer.spec.js**
- `browser.newContext()` x2 (Alice, Bob), set distinct names in localStorage.
- Alice: menu → "Race a friend" → read `.mp-code`.
- Bob: `page.goto('/?join=CODE&track=test-pad-0')`, wait for lobby with 2
  players.
- Both click ready → `waitForFunction` both hit `phase === 'racing'`.
- Assert both timers advance and are within ~150 ms of each other.
- Drive Alice forward a few seconds; assert Bob's page shows
  `window.__net.netState.opp` populated and the RemoteCar group is visible
  (`page.evaluate` walk the scene for a second CarModel, or check
  `netState.opp.p` changed).
- Assert the gap HUD element (`.opp-gap`) is visible and non-empty on at least
  one side.
- Finish both (autopilot or teleport-to-finish), assert Result shows a winner
  and both times.
- Rematch → both back to lobby.

**tests/perf.spec.js**
- `startSolo('mission-impossible-5')` (heaviest track), `injectAutopilot`, let
  it drive.
- `page.evaluate` a rAF sampler: collect `performance.now()` deltas for ~3 s,
  return `{ mean, p50, p95, p99, longFrames: count > 20ms }`.
- Assert `p95 < 22` (ms) as a soft gate — tune after first real run. Headed +
  real GPU so the number means something.
- Second pass with two contexts both driving to measure the side-by-side case
  Tim reported as jerky.

**tests/tilt.spec.js**
- CDP session: `Emulation.setDeviceOrientationOverride({ alpha, beta, gamma })`.
- `startSolo` with `touch-mode=on`, tap "Tap to steer by tilting", wait for
  `tilt.active`.
- Sweep gamma/beta, assert `window.__input.axis` tracks sign and magnitude, and
  that a held ArrowLeft still overrides it (the fix from commit 91b9aea).

## Gotchas to remember

- Dev globals only exist on `npm run dev`. A `vite build` + `vite preview` will
  NOT have them.
- `st.advance()` wants SECONDS. Not relevant if letting the real loop run, but
  the autopilot's manual mode still needs it.
- The car's collider (RoundCuboid, halfExtents 0.6/0.17/1.6) shows up in
  downward raycasts — exclude it when probing surfaces.
- Two contexts share nothing (separate localStorage) — good, that's why names
  work in tests but not in two tabs of one browser.
- Headed window steals focus. Fine for watching, annoying if Tim's mid-task.
- Don't wire this into `npm run deploy` — it needs a display + GPU.
