# Playwright e2e tests

Real-browser tests that exercise what the in-app Browser pane can't: **held-key
input**, **real frame rate**, **live two-player rendering**, and **tilt**. They
run **headed** on Tim's X display so he can watch the car drive.

Design rationale and history: [`../docs/playwright-plan.md`](../docs/playwright-plan.md).

## Running

```bash
npm run test:e2e                       # all specs
npm run test:e2e -- solo.spec.js       # one file
npm run test:e2e -- -g "held keys"     # by title
```

Requirements (already set up on Tim's box):

- Node at `~/.local/node/bin`.
- Playwright browsers in `~/.cache/ms-playwright` — `playwright.config.js` sets
  `PLAYWRIGHT_BROWSERS_PATH` itself. If chromium is missing:
  `PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright npx playwright install chromium`.
- An X display. The config forces `DISPLAY=:0`.
- `playwright.config.js` auto-starts `npm run dev` (port 5173) and reuses one if
  already running. Tests need the **dev** build — the `window.__*` globals are
  stripped from prod.

Not CI. Needs a display + GPU; never wired into `npm run deploy`.

## Specs

| File | What it covers |
| --- | --- |
| `solo.spec.js` | Autopilot drives the 4 flowing tracks to the finish (completion + loose time band). Set-piece tracks (Stunt Park, Mission Impossible) get a "loads + first section drivable" smoke check only — their gaps need frame-perfect entry speed the real loop can't hold, so full completion is the offline harness's job. Plus a held-key drive/steer check (guards regression 91b9aea). |
| `multiplayer.spec.js` | Two browser contexts against the **deployed** relay: host + deep-link join, synced countdown, live opponent car on the other screen, gap HUD, head-to-head result, rematch. Spawns its own Vite server on 5273 with `VITE_PARTYKIT_HOST` set (a DEV build otherwise points the client at `127.0.0.1:1999`). |
| `perf.spec.js` | rAF frame-time stats (mean / p50 / p95 / p99 / long frames) on the heaviest track, single instance and two side-by-side. Soft gates; the logged numbers are the point — tune after a baseline on Tim's GPU. |
| `tilt.spec.js` | CDP device-orientation override: the tilt axis reaches `window.__input.axis` and tracks the gyro, and a held arrow key still overrides it (regression 91b9aea). |

## Helpers (`helpers.js`)

- `startSolo(page, trackId)` — menu → countdown → `window.__dbg.phase === 'racing'`.
- `injectAutopilot(page)` — loads `tools/autopilot.js` (as a classic script) and
  `install()`s it against the active track.
- `driveLoop` / `autopilotToFinish(page, {timeoutMs})` — run the autopilot on
  the **real** loop (no `frameloop:'never'`), poll to the finish.
- `hold(page, key, ms)` — real key press-hold-release. The thing the Browser
  pane can't do.
- `readHud` / `readDbg` / `readCar` — snapshot the mutable singletons.

## Gotchas

- `tools/autopilot.js` is an ES module; `injectAutopilot` strips `export` and
  injects it as a classic script so `window.__AP` is set synchronously.
- The autopilot's `begin()` (offline mode) stubs `performance.now` and
  `gl.render` and wants `st.advance()` in **seconds**. The Playwright helpers
  never call `begin()` — they call `control()` per frame and let the real loop
  run.
- Two `browser.newContext()`s share no `localStorage` — which is why distinct
  player names work in the multiplayer spec but not in two tabs of one browser.
