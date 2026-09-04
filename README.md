# Speed Racer

A Trackmania-style time-attack racer for the browser. Grind a track until you
own the record. 3D, behind-the-car camera, instant restart, your ghost racing
alongside you.

Currently ships with **Track 0 "Test Pad"** — a wide, forgiving loop (long
straight, two big sweepers, a gentle jump) for dialling in the car. The real
track, **Stadium Sprint**, is built and waiting as `TRACKS[1]` in
`src/game/track.js`; change the `TRACK` export there to switch.

## Play Now

🎮 **Play the game:** https://timothyoverton.github.io/speed-racer/
_(after the repo + GitHub Pages are set up — see Deploy)_

## How to Play

1. Enter a name, hit **DRIVE**.
2. `↑`/`W` throttle · `↓`/`S` brake / reverse · `←`/`→` or `A`/`D` steer ·
   `Space` handbrake (for drifting corners).
3. Clear all **3 checkpoints** in order, then cross the finish line.
4. `R` restarts instantly, from anywhere, any time — no menus. This is the
   whole game: fail fast, go again.
5. Beat the medal times — **Bronze → Silver → Gold → Author**. Your best run is
   saved as a **ghost**; the next run it drives beside you and the HUD shows
   whether you're ahead (green) or behind (red) it.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

```bash
npm run deploy
```

Builds and pushes `dist/` to the `gh-pages` branch (same flow as `maze-car` /
`noughts-and-crosses`). Requires a GitHub repo named **`speed-racer`** with Pages
set to serve from the `gh-pages` branch. `vite.config.js` sets
`base: '/speed-racer/'` for production builds only.

## Architecture / Notes

Same **React + Vite** base as the other games, plus a 3D stack:

- **[`@react-three/fiber`](https://github.com/pmndrs/react-three-fiber)** — React
  renderer for three.js. The `<Canvas>` in `src/components/Scene.jsx` owns the
  scene, lights, sky and the render loop.
- **[`@react-three/rapier`](https://github.com/pmndrs/react-three-rapier)** —
  Rapier 3D physics (WASM). The `<Physics>` world holds the car body, the track
  colliders and the checkpoint/finish sensors.
- **[`@react-three/drei`](https://github.com/pmndrs/drei)** — just `<Sky>` for now.

### Key ideas

- **React only renders the shell.** Menu, HUD, countdown, result screen. The
  60 fps stuff never touches React state:
  - `src/game/hud.js` is a plain mutable object the physics loop writes every
    frame; `src/components/Hud.jsx` reads it on its own `requestAnimationFrame`
    and paints straight into refs. Zero re-renders while driving.
  - `src/game/store.js` is a tiny `useSyncExternalStore` for coarse state only
    (`phase`, `runId`, `result`).
- **Arcade car handling** (`src/components/Car.jsx`): one dynamic `RigidBody`,
  **frictionless collider**, pitch/roll locked so it can't flip. All handling is
  done in code as mass-scaled impulses — engine (tapering to `MAX_SPEED`), drag,
  and lateral **grip** (handbrake cuts grip → drift) — so Rapier's own collision
  response still bounces the car off the barriers (which have `restitution`).
  Steering makes the car's **heading chase its velocity direction** plus a slip
  angle: it self-centres, so a knock or a slide reorients the car to face where
  it's going instead of spinning out. Max turn rate tapers with speed. A
  downward `castRay` (sensors excluded) is the grounded check. Respawn triggers:
  fell off the world, stuck (<2 m/s for 2 s), or airborne > 1.8 s.
- **The track is generated, but fixed** (`src/game/track.js`). A "turtle" walks a
  ribbon of road tiles from a `course` list of `straight` / `turn` / `ramp` /
  `checkpoint` commands; corners are short straight chords. Consecutive
  same-orientation tiles are then **merged into single long collider slabs** so
  straights have no seams for the frictionless car to trip on; lone arc chords
  get padded colliders to keep the surface continuous through a corner. Visual
  meshes still come from the individual tiles. `buildTrack()` takes a config, so
  adding a track is one object in `TRACKS`.
- **Ghost** (`src/game/ghost.js`): records transform keyframes (pos + quaternion)
  at 50 Hz during a run; saved to `localStorage` only when the run is a new PB.
  Playback interpolates (lerp + slerp) against the race clock. Transform
  keyframes always play back cleanly — no determinism needed.
- **Timer** (`src/game/timing.js`) is wall-clock (`performance.now()`) for now.
  ⚠️ Not deterministic across machines — see Phase 2.
- **Leaderboard** (`src/game/leaderboard.js`): `localStorage` PB + local top-8
  per track, keyed by track id. Medal thresholds are defined on the track.

### Roadmap

- **Phase 2 — global leaderboard (Azure).** Frontend stays on GitHub Pages; it
  calls an **Azure Functions** HTTP API (Consumption plan, 1M free/month) with
  CORS for the Pages origin. Runs stored in **Cosmos DB** lifetime free tier
  (1000 RU/s, 25 GB). Switch the timer to counting fixed physics steps so a run
  is reproducible, record the **input stream** alongside the ghost, and have the
  function re-simulate the inputs server-side to verify the time before it's
  accepted (anti-cheat). Tim to create the Cosmos account + Function App on his
  Azure sub; the function code + client live in this repo.
- **Phase 3** — more tracks, track-of-the-day (shared seed), maybe a block editor.

### Environment gotchas (from `maze-car`)

- **No Node on the normal PATH.** Node 22 lives at
  `/tmp/node-v22.12.0-linux-x64/bin` and is added to `PATH` in
  `.claude/run-dev.sh`. That `/tmp` install may not survive a machine restart —
  re-download it first thing if `node` is missing.
- The Claude Code preview tool cached `maze-car`'s launch config for this
  workspace; `.claude/launch.json` here is named `speed-racer` to avoid the
  clash. If the preview still opens the wrong project, run `npm run dev`
  directly.
