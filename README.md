# Speed Racer

A Trackmania-style time-attack racer for the browser. Grind a track until you
own the record. 3D, behind-the-car camera, instant restart, your ghost racing
alongside you.

Five tracks, picked on the menu:

- **Test Pad** — wide and forgiving, for dialling in the car.
- **Slipstream** — 993 m point-to-point, corners 60–110 m radius so it can be
  driven nearly flat.
- **Qiddiya Rush** — 893 m, a homage to the Trackmania map of that name (its
  character, not its layout — and without the banked wall, which the track DSL
  can't express yet).
- **Freefall** — 2390 m with 80 m of vertical. Four ~22° kickers, each launching
  onto a road that falls away faster than the car does (2.0–2.6 s airborne), and
  a final **edge**: a jump with a *negative* rise, so the road stays flat then
  pitches down to ~42° and drops out from under you — 1.45 s of air, 72 m, a 25 m
  fall, without losing speed.
- **Stunt Park** — 2144 m of set pieces rather than a circuit, built around
  **gaps**: five real holes where the road stops and there is nothing
  underneath. A rhythm section of five whoops, a table-top whose roof just ends,
  three descending stairs, a double, and the **Leap of Faith** — a 40 m void
  with a 16 m drop. 32% of the lap is spent airborne. Miss one and you fall out
  of the world.

**Corner radius is the design constraint.** The car's turn rate is capped at
`BASE_YAW * YAW_REF_SPEED / speed`, so the tightest radius holdable at speed `v`
is `v^2 / 20.8` — 120 m at 180 km/h, 77 m at 144, 43 m at 108. A track built
with 20 m corners cannot be driven above ~90 km/h no matter how it's tuned.

## Play Now

🎮 **Play the game:** https://timothyoverton.github.io/speed-racer/
_(after the repo + GitHub Pages are set up — see Deploy)_

## How to Play

1. Enter a name, hit **DRIVE**.
2. `↑`/`W` throttle · `↓`/`S` brake / reverse · `←`/`→` or `A`/`D` steer ·
   `Space` handbrake (for drifting corners) · `Del`/`Backspace` drops you back
   at the last checkpoint · `C` cycles chase / close / wide / bumper cameras ·
   `Q` quits to the menu · `M` mutes.
   On a phone it switches to touch automatically: **GO** and **BRAKE** thumb pads
   with **DRIFT** beside the brake, and steering by tilting the handset (tap once
   to grant motion access — iOS only allows it from a gesture). **Centre**
   re-zeros straight-ahead to however you're holding it; **Invert** flips the
   direction. Menu has Auto / Touch / Keys if the detection guesses wrong.
3. Clear all the **checkpoints** in order, then cross the finish line.
4. `R` restarts instantly, from anywhere, any time — no menus. This is the
   whole game: fail fast, go again.
5. Beat the medal times — **Bronze → Silver → Gold → Author**. Every track's
   medals are derived from a measured reference lap, so they mean the same
   thing on all four (Author is ~58% off a perfect centreline lap). Your best run is
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
- **[`@react-three/drei`](https://github.com/pmndrs/drei)** — `<Sky>`, plus
  `<Environment>`/`<Lightformer>` for image-based lighting.

### Looks

Everything is generated at runtime — there are no textures, models or HDRs to
download, so the whole game is JS.

- **Lighting**: ACES filmic tone mapping, a low warm sun with soft (PCF) 2k
  shadows, and a small **environment map built in-engine** from a sky sphere and
  a few `<Lightformer>` panels. That env map is what the car's clear-coated
  paint, glass and chrome actually reflect — without it, metal reads as flat
  grey. (`@react-three/postprocessing` was tried for bloom and dropped: with this
  three.js version its composer double-encodes sRGB and washes the whole image
  out. Emissive materials plus tone mapping get most of the way there.)
- **Textures** (`src/game/textures.js`): asphalt (with a matching **normal map**
  derived from the same noise, so tarmac catches the low sun), grass with mown
  stadium stripes, kerb stripes, concrete, checkerboard and a smoke puff — all
  drawn into `<canvas>` once and cached.
- **The circuit is instanced** (`src/game/trackVisuals.js` + `Boxes.jsx`): road,
  lane lines, kerbs, barriers, sponsor bands and marker posts are flattened into
  a handful of `InstancedMesh`es built once at module load, so a restart costs
  nothing and the whole track is ~10 draw calls. Scenery (treeline, grandstands
  with crowds, floodlight pylons, distant hills) is instanced the same way.
- **The car** (`CarModel.jsx`) is procedural geometry: the body is a plan-view
  outline **extruded and bevelled**, with a canopy, splitter, diffuser, rear
  wing, and lathed tyres on chromed rims. It's animated from telemetry —
  wheels steer and spin, the chassis rolls and dives on its springs, and the
  brake discs and tail light glow under braking.
- **Effects** (`Effects.jsx`): tyre smoke (a 200-particle `Points` pool with a
  custom shader) and skid marks (a 420-quad instanced ring buffer) spawn from
  the rear contact patches whenever the car is sliding.
- **Where the car is on the road** (`src/game/trackQuery.js`): a uniform grid
  over the tiles, built once, giving signed distance from the centreline in a
  few dot products per frame. Drives the kerb rumble — riding a kerb costs grip,
  buzzes the camera and opens up the road-roar filter — and is what a racing
  line or track-progress metric would build on.
- **Feel**: the chase camera pulls back and widens its lens with speed, rolls
  against cornering load and shakes on a heavy landing; the HUD adds a rev bar,
  a gear indicator and a vignette that closes in as you get quick.
- **Audio** (`src/game/audio.js`): fully synthesised — detuned oscillators
  through a resonant lowpass for the engine (pitch follows a fake 6-speed
  gearbox), filtered noise for wind, road roar and tyre screech, plus countdown
  blips and a landing thud. Starts on the DRIVE click (browsers require a
  gesture); `M` or the HUD button mutes, and the choice is remembered.

### Building a jump you can actually land

Jump geometry is ballistics, not taste, and the numbers are unforgiving. A
kicker of `jump(dist, rise)` leaves at `atan(2*rise/dist)`; with gravity at 22
the range onto a landing `drop` metres below the lip is

```
vx * (vy + sqrt(vy^2 + 2*22*drop)) / 22
```

Two rules came out of getting this wrong on Stunt Park:

- **A landing shelf has to be LONGER than the flight off the shelf above it.**
  The stairs first used a 22 m shelf behind a kicker that throws the car 41 m at
  racing speed, so you landed *on the next kicker* and got fired sideways into
  the void — at 100 km/h in testing it looked perfect, and it only broke at
  speed.
- **Height costs the speed you need to clear the gap.** The Leap of Faith first
  climbed 15 m into its kicker; the car arrived too slow to climb it at all, let
  alone jump, and sat at the bottom bouncing. The gap was never the problem — it
  clears from 100 km/h. The drama should come from the drop, not the climb.

Check a new jump across the whole speed range it'll actually be taken at, not
just the one you had in mind.

### Measuring a reference lap

Medal times aren't guessed — each track's come from `medalsFor(refLapSec)` in
`track.js`, where the reference lap is measured by driving the real physics with
an autopilot. To re-measure after changing a layout:

1. Open the dev server, pick the track, hit DRIVE, and let the countdown finish.
2. Drive the sim yourself, stepping it by hand at a fixed 1/60:

```js
st.setFrameloop('never')
let sec = st.clock.elapsedTime          // SECONDS, not milliseconds
for (;;) { control(); sec += 1/60; st.advance(sec) }
```

The autopilot steers at a lookahead point on the centreline and brakes whenever
a corner inside its scan needs a speed it can't decelerate to, using the game's
own `v^2/20.8` radius rule. Lap time is the step count over 60. It's repeatable
to ~0.2%.

**Pass `advance()` a timestamp in SECONDS.** Under `frameloop: 'never'` R3F
computes `delta = timestamp - clock.elapsedTime`, and `elapsedTime` is in
seconds. Hand it `performance.now()` milliseconds and the delta is enormous,
Rapier clamps it to 0.5s and substeps **30 physics steps per frame** — the car
covers 76m in a "second", trips the stuck-respawn, and the lap time is fiction.
Nothing warns you. Verify by counting `world.step` calls per `advance()`: it
must be exactly 1.

Also note the in-game timer is `performance.now()` wall-clock, so a hand-stepped
lap needs `performance.now` stubbed to sim time or the recorded time is the
wall-clock duration of your loop, not the lap.

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
  downward `castRay` (sensors excluded) is the grounded check. Lateral grip
  scales with speed (**downforce**), so fast sweepers stay planted while slow
  corners stay playful, and there's reduced-authority **air steering** to line
  up a landing. Respawn triggers: fell off the world, stuck (trying to move but
  under 2 m/s for 2 s), or airborne > 1.8 s.
- **Friction circle**: grip spent cornering isn't available to accelerate,
  scaled by `(latG / 2.2)^2` against a 25% floor. Straight-line acceleration is
  untouched; at 160 km/h on full lock the car scrubs speed rather than gaining
  it. Without it you could pull 2 g and still accelerate at ~90% of the
  straight-line rate.
- **The car lies along the road.** The body is locked to yaw, so the ground
  probe resolves the surface normal into pitch and roll in the car's own axes
  and the *model* is laid along it — otherwise the car stays dead level going
  over a crest. Purely visual; the physics body is untouched.
- **The car's collider is a ROUNDED box, and that matters.** The body is locked
  to yaw so it cannot tilt onto a slope — it climbs bodily. With a sharp-edged
  box the front bottom edge stubs into a ramp face and the car stops dead
  (measured: 187 km/h → 0 on a 22° kicker). A border radius of 0.25 m lets it
  roll on instead. Don't "simplify" this back to a plain cuboid.
- **`ramp` vs `jump`**: a ramp eases at both ends (a hill — smooth on, smooth
  off), a jump eases on at the bottom and leaves at full slope so it launches
  you. Easing both ends is exactly what stops a ramp launching you, which is
  worth knowing before "fixing" one into the other.
- **Pitch is applied about the road's own lateral axis** (YXZ euler, negated).
  In three's default XYZ order the pitch term is applied last, about the *world*
  X axis, which tilts a road by `-cos(yaw) * sin(pitch)` — inverted, and scaled
  by heading. That produced a sawtooth surface with ~1 m steps on any track not
  running along +Z.
- **Telemetry bus** (`src/game/carState.js`): a plain mutable object the physics
  loop fills each frame — steering, throttle, brake, slip, body g-forces, wheel
  rotation, gear/rpm, world transform. The car model, the particle effects and
  the audio engine all read from it, so none of them need React or their own
  physics queries.
- **Dev helpers** (dev builds only): `window.__dbg` (per-frame car state),
  `window.__car`, `window.__hud`, `window.__input`, `window.__progress`,
  `window.__three` (the R3F state), and `window.__freecam = true` to release the
  chase camera so you can fly around and inspect things.
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
