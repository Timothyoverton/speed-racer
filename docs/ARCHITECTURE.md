# Speed Racer — Architecture

A browser Trackmania-style time-attack racer. React 19 + Vite render the shell;
three.js via `@react-three/fiber` (R3F) draws the world; `@react-three/rapier`
(Rapier WASM) runs the physics; a PartyKit relay in `party/` carries two-player
races.

The rule that shows up everywhere: **React renders the shell once per phase
change; the 60 fps simulation never touches React state.** Per-frame values live
in plain mutable singletons — `src/game/carState.js`, `src/game/hud.js`,
`src/game/progress.js`, `src/game/net.js` — that the loop writes and everything
else reads. React's only store is the coarse phase machine in
`src/game/store.js`.

---

## 1. Render loop & frame flow

### The Canvas

`src/components/Scene.jsx` owns the single R3F `<Canvas>`
(`src/components/Scene.jsx:49-62`): `shadows`, `dpr={[1, dprMax]}` where
`dprMax` is React state starting at 1.5 (`src/components/Scene.jsx:46`), a 62°
camera, ACES tone mapping.

Adaptive resolution sits on top: `<PerformanceMonitor>` drops `dprMax` to 1 on
sustained frame-rate decline and back to 1.5 on recovery, with a 0.75 floor via
`onFallback` (`src/components/Scene.jsx:63-68`); `<AdaptiveDpr pixelated>` lowers
the internal render buffer while the frame rate is bad
(`src/components/Scene.jsx:69`). This is the one place a runtime condition feeds
back into React state — deliberately coarse.

### Fixed-timestep physics

`<Physics timeStep={1/60} gravity={[0,-22,0]} interpolate>` wraps the whole race
(`src/components/Scene.jsx:153-155`). Rapier steps at a fixed 1/60 s regardless
of display refresh; `interpolate` interpolates the rendered transforms between
the two most recent fixed steps, so a 144 Hz monitor is smooth and a 30 Hz one
doesn't change the simulation. `<Race key={runId}>` is the only child — bumping
`runId` remounts the entire race subtree (`src/components/Scene.jsx:154`, §3).

### useFrame callers

R3F runs every `useFrame` callback once per rendered frame at the default
priority (0), in mount order. Only `Car` matters; the rest are display:

1. `SkyDome` (`src/components/SkyDome.jsx:51`) — pins the sky sphere to the
   camera.
2. `SunFollow` (`src/components/Scene.jsx:27-37`) — moves the shadow light to
   track `carState.pos` (last frame's, since `Car` runs later).
3. `Track`'s `Sharks` + `WaterMotion` (`src/components/Track.jsx:37`,
   `src/components/Track.jsx:64`) — instanced fins, scrolling water UVs.
4. `Ghost` (`src/components/Ghost.jsx:13`) — samples the PB keyframe recording
   at `elapsedMs()`, poses a collider-less car.
5. `RemoteCar` (`src/components/RemoteCar.jsx:22`, MP only) — poses the opponent
   from the interpolated telemetry buffer.
6. **`Car` (`src/components/Car.jsx:129`) — the driver.** All physics impulses,
   the chase camera, `carState` and `hud` writes, telemetry send.
7. `CarModel` (`src/components/CarModel.jsx:352`) — visual only: body roll/dive,
   wheel steer/spin, brake glow, laying the model along
   `carState.groundPitch/Roll`. `if (!live) return`
   (`src/components/CarModel.jsx:353`) so ghost/remote instances skip it.
8. `Effects` (`src/components/Effects.jsx:134`) — tyre smoke, dust, skid marks;
   fixed-size `Float32Array` pools advected from `carState`, after `Car` so it
   reads this frame's telemetry.

### Car.jsx's frame

Per frame (`src/components/Car.jsx:129-520`), `dt` clamped to 1/30
(`src/components/Car.jsx:132`): one-shot inputs
(`:136-160`) → read body transform, derive horizontal `fwd`/`right` (`:162-169`)
→ ground probe (`:180-196`) → kerb query (`:199-201`) → boost pads (`:207-227`)
→ longitudinal + lateral impulses via `applyImpulse` (`:263-306`) → steering by
setting `angvel.y` (`:308-347`) → write `carState` (`:351-407`) → respawn check
(`:418-430`) → write `hud`, ghost delta, recorder sample, MP telemetry
(`:433-465`) → chase camera (`:483-519`).

### The HUD does not use useFrame

`src/components/Hud.jsx` runs its own `requestAnimationFrame` loop
(`src/components/Hud.jsx:25-84`) and writes `textContent` / `style` straight
into refs from the `hud` bag. It never calls `setState` except for the mute
toggle — the DOM HUD is entirely off React's render path.

---

## 2. Collision & physics system

The handling model is almost entirely hand-coded. Rapier provides rigid-body
integration, collision detection, and barrier bounce — not tyre physics.

### The car body

One dynamic `RigidBody` (`src/components/Car.jsx:523-534`):

```jsx
<RigidBody mass={1} linearDamping={0} angularDamping={0.6}
  enabledRotations={[false, true, false]} canSleep={false} ccd>
  <RoundCuboidCollider args={[0.6, 0.17, 1.6, 0.25]} friction={0} restitution={0.2} />
```

- **Yaw-locked.** `enabledRotations={[false, true, false]}` freezes pitch and
  roll; the body only spins about vertical (`src/components/Car.jsx:531`). The
  whole arcade model — grip, slip-angle steering, friction circle — assumes the
  car stays flat; let it tilt and that math stops being stable
  (`src/components/Car.jsx:174-176`). The visible lean is faked on the *model*
  only, never the body.
- **Rounded collider.** `RoundCuboidCollider`, 0.25 m border radius subtracted
  from the half-extents. It matters *because* the body is yaw-locked: a sharp
  front edge stubs into a ramp face and the car stops dead; a rounded edge rolls
  up onto the slope (`src/components/Car.jsx:535-539` — a real "impassable ramp"
  bug).
- **Frictionless.** `friction={0}`; all drive, braking, rolling resistance and
  lateral grip are impulses computed in `Car.jsx`.
- `ccd` stops tunnelling through thin slabs at speed; `canSleep={false}` keeps
  input responsive at rest.

### Building the track surface — `src/game/track.js`

A `Turtle` (`src/game/track.js:24`) walks a `course` — command tuples like
`['straight', 100]`, `['jump', 24, 2.0]`, `['turn', 120, 48]` — laying down road
**tiles**. `buildTrack` dispatches each command to a turtle method
(`src/game/track.js:268-289`). Commands: `straight`, `ramp`, `jump`, `gap`,
`turn`, `wall`, `boost`, `stuntramp`, `pool`, `waterfall`, `checkpoint`,
`start`, `finish`. Six tracks are defined this way; the active one is picked
from `localStorage` at module load and switching reloads the page, because every
downstream derivation (colliders, meshes, texture repeats, shadow bounds) is
computed once.

**`_placeTile(len, pitch, curve)`** (`src/game/track.js:43-71`) pushes one tile
with `rot: [-pitch, heading, 0]` (YXZ) and a `size` length of `len/cos(pitch)`
(the *slope* length, so pitched slices don't fall short of each other). The
non-obvious bit: the tile is dropped by **half its thickness measured
perpendicular to the road**, `cy = y + rise/2 - ROAD_THICK/2/cosP`
(`src/game/track.js:52`), not vertically, so the top face lands exactly on the
intended line instead of ~1.5 cm proud.

Turtle methods:

- **`straight`** — flat 6 m tiles (`src/game/track.js:74`).
- **`ramp(dist, rise)`** — elevation change with a **smoothstep** height
  profile: dead flat at both ends, steepest in the middle, so a hill has no kink
  to catch at the base or crest (`src/game/track.js:88-103`).
- **`jump(dist, rise)`** — a kicker: quadratic `h = rise·t²`, eased in at the
  bottom but leaving at **full slope** at the lip so the car takes off
  (`src/game/track.js:105-118`).
- **`gap(dist, drop)`** — the turtle walks forward and lays **nothing**: no
  surface, no barrier, no collider, a real void. `drop` lowers the far side to
  buy fall-time. Throws if `dist < 5` (`src/game/track.js:123-134`).
- **`turn(angleDeg, radius)`** — an arc of short straight chords, capped by
  chord length *and* `MAX_CHORD_ANGLE` (5°) (`src/game/track.js:135-152`).
- **`wall(lateral, width, height, thickness)`** — a solid block sitting *on* the
  road, offset from the centreline (`src/game/track.js:154-168`). Rendered as a
  `CuboidCollider` with `restitution={0.05}`
  (`src/components/Track.jsx:134-143`) — hitting one ends your run, it doesn't
  fling you.
- **`stuntRamp(lateral, width, len, rise)`** — a launch wedge over part of the
  road width. Rapier has no wedge primitive, so it's a **tilted slab** climbed
  like a ramp. The comment at `src/game/track.js:178-189` describes two fixes:
  (1) sink the slab by half its thickness measured *perpendicular to the slope*
  so the top face passes through road level, and (2) start it **3 m buried**
  (`BURIED = 3`, `src/game/track.js:190`) inside the road so its leading face
  emerges as a feather edge with no lip. This was the "impassable stunt ramp"
  bug — a yaw-locked car cannot climb a 17 cm step.
- **`pool` / `waterfall` / `boost` / `checkpoint`** — `pool` is a `gap` plus a
  water box (`src/game/track.js:223-235`); physics is identical to a plain void.

### Merging tiles into collider slabs — `mergeTiles` / `padSlabs`

Road *visuals* are per-tile, but per-tile *colliders* leave seams a frictionless
car trips on. `slabs: padSlabs(mergeTiles(t.tiles))` (`src/game/track.js:293`).

**`mergeTiles`** (`src/game/track.js:307-380`) fuses consecutive tiles that (a)
have the same orientation (equal pitch and yaw to 1e-6) and (b) actually
**touch**. Touching is a separate test: two straights either side of a `gap` are
perfectly parallel, and merging them would span the void with one long invisible
floor. `touching` compares one tile's end to the next tile's start with a
deliberately loose `JOINED = 1.0` m tolerance (`src/game/track.js:324`) —
corner chords are straight lines across an arc and their ends splay by up to
~0.2 m, so a tight tolerance would read every corner chord as a gap and strip
the overlap that keeps corners seamless; a real gap is ≥ 5 m, so 1 m sits
safely between. Each slab carries `span` (tile count), `pitch`, and `atGap`
(`src/game/track.js:372`).

**`padSlabs`** (`src/game/track.js:384-395`) stretches each flat slab along its
length to overlap its neighbours (`pad` 2.2 m for lone arc chords, 0.8 m
otherwise) — free, because flat neighbours sit at the same height. But `pad = 0`
for any slab that is pitched, **abuts** a pitched slab, or sits at a gap:
stretching into a slope pokes the collider through the road beyond it (a 9 cm
lip at the top of every rise), and stretching over a void hangs an invisible
ledge where you'd catch a wheel on take-off.

`src/components/Track.jsx` turns every slab into one road `CuboidCollider` plus
two side rails, all in one `type="fixed"` body
(`src/components/Track.jsx:93-118`); rails `restitution={0.55}`, road
`friction={0} restitution={0}`. Stunt ramps and walls are separate colliders in
the same body (`src/components/Track.jsx:120-143`).

### How "climbability" is decided

**There is no explicit "can I climb this?" test.** The car is yaw-locked, so it
never tilts onto a slope — it climbs *bodily*, pushed up the incline by its
forward impulse while the rounded collider rolls onto the face. A step taller
than the collider's rounded edge just stops the car (the stunt-ramp bug).

What *is* computed each frame is a **grounded check + surface normal**, from one
short downward ray (`src/components/Car.jsx:180-196`):

```js
const ray = new rapier.Ray({ x, y: y + 0.3, z }, { x: 0, y: -1, z: 0 })
const hit = world.castRayAndGetNormal(ray, 1.0, true, NO_SENSORS, ..., b)
grounded = !!hit
```

- Length **1.0 m**, `NO_SENSORS` (`QueryFilterFlags.EXCLUDE_SENSORS`,
  `src/components/Car.jsx:171`) so checkpoint gates aren't ground; the car's own
  body is excluded.
- `grounded` gates all drive, braking, lateral grip and grounded steering.
- The hit normal is decomposed against `fwd`/`right` into `surfacePitch` /
  `surfaceRoll` (`src/components/Car.jsx:189-192`) and written to
  `carState.groundPitch` / `groundRoll` (`src/components/Car.jsx:385-392`) —
  these lean the car **model** only, never the body. Airborne they ease toward
  level.
- If the ray call throws (older Rapier), it falls back to `t.y < 1.4`
  (`src/components/Car.jsx:194-195`).

**Respawn conditions** (`src/components/Car.jsx:418-430`), any one triggers
`placeAt(progress.respawn)`:

- `t.y < RESPAWN_Y` where `RESPAWN_Y = GROUND_Y - 5`
  (`src/components/Car.jsx:80`) — off the world, relative to the track floor.
- `stuckTimer > STUCK_TIME` (2.0 s, `src/components/Car.jsx:81`) — grounded,
  `speed < 2`, holding throttle or brake (`src/components/Car.jsx:356`); idling
  on the grid is not stuck.
- `airTimer > MAX_AIR_TIME` (5.0 s, `src/components/Car.jsx:65`) — long enough
  that Freefall's real flights don't trip it; falling off the map is caught by
  `RESPAWN_Y` anyway.

### Grip, friction circle, kerbs, boost

- **Lateral grip** (`src/components/Car.jsx:294-300`): kills sideways velocity
  `vRight` at rate `GRIP` (12/s), scaled up with speed by `AERO_GRIP` (0.75) so
  fast sweepers stay planted and slow hairpins stay loose; drops to
  `GRIP_HANDBRAKE` (1.4) under the handbrake, and by `KERB_GRIP` (0.72) on a
  kerb.
- **Friction circle** (`src/components/Car.jsx:271-278`): one grip budget,
  cornering spends it, so engine force is scaled by
  `gripLeft = clamp(1 - (latG / LAT_G_LIMIT)², 0, 1)`,
  `LAT_G_LIMIT = 2.2` (`src/components/Car.jsx:40`), floored at
  `MIN_CORNER_THROTTLE = 0.25`.
- **Steering** (`src/components/Car.jsx:308-347`): heading chases *velocity
  direction plus a slip-angle offset*, so a knock or slide self-corrects. Target
  yaw rate `err · STEER_SNAP`, speed-tapered cap; `angvel.y` is set directly.
  Airborne, a weak `AIR_YAW` (0.85) lets you line up a landing.
- **Kerb detection** — `sampleTrack(x, z)` in `src/game/trackQuery.js:42-75`: a
  uniform 25 m grid over the tiles built once (`src/game/trackQuery.js:24-35`),
  lookup checks the 3×3 cells around the point and returns signed `lateral`,
  `onKerb`, `offRoad`. `carState.onKerb` also requires `grounded`
  (`src/components/Car.jsx:201`).
- **Boost pads** (`src/components/Car.jsx:207-227`): a handful per track, so a
  brute distance test to each `TRACK.boosts` entry beats a spatial index. Within
  `BOOST_RADIUS` (5.5 m) and grounded → an immediate forward impulse *and*
  `boostTimer = 5 s`, which raises the speed ceiling and drive multiplier by
  `BOOST_MULT` (1.3) (`src/components/Car.jsx:269-277`).

---

## 3. Entity & state model

Five mutable module singletons plus one React store. All are plain objects
mutated in place — no allocation on the hot path — each with a `reset*` helper.

| Module | Holds | Written by | Read by |
| --- | --- | --- | --- |
| `src/game/carState.js` | per-frame car telemetry + drivetrain | `Car.jsx` frame | `CarModel`, `Effects`, `audio.js`, `SunFollow` |
| `src/game/hud.js` | HUD display bag | `Car.jsx` frame | `Hud.jsx` rAF |
| `src/game/progress.js` | checkpoint index + respawn transform | checkpoint sensors | `Car.jsx` respawn, finish gate |
| `src/game/net.js` | `netState` (opponent) + `session` (room/roster/start) | socket handlers | `RemoteCar`, `Hud`, `Countdown`, `Result` |
| `src/game/timing.js` | wall-clock race timer | `store.js`, `Race.onFinish` | `Car.jsx`, `Ghost`, `Countdown` |
| `src/game/ghost.js` | `activeGhost.frames` + recorder | `Race` mount, recorder | `Ghost.jsx`, `Car.jsx` delta |

### `src/game/store.js` — the only React-facing store

A hand-rolled `useSyncExternalStore` store (`src/game/store.js:1-50`):

```js
{ phase: 'menu'|'lobby'|'countdown'|'racing'|'finished',
  runId: 0,          // bump to force a full car + physics reset
  result: null,      // { timeMs, isPB, medal, prevBest, delta, topKmh }
  multiplayer: false }
```

Transitions (`src/game/store.js:52-80`): `startCountdown` /
`startMultiplayerCountdown` reset the timer and **increment `runId`**;
`beginRacing` starts the timer; `finishRace` stores the result. Hooks
`usePhase`, `useRunId`, `useResult`, `useMultiplayer` are thin selectors.
Per-frame values (timer, speed) are deliberately not here.

### `<Race key={runId}>` — reset by remount

`src/components/Race.jsx` is keyed by `runId`, so every `startCountdown()`
throws the old subtree away and mounts a fresh one. All reset logic is in one
`useMemo` that runs once before first frame (`src/components/Race.jsx:21-29`):
`resetProgress`, `resetHud`, `resetTimer`, `resetCarState`, `startMusic`, load
the ghost, return a new `GhostRecorder`. That's why the physics body, timers,
particle pools and ghost all come up clean with no imperative teardown.
`onFinish` (`src/components/Race.jsx:31-48`), fired by the finish sensor: stop
the timer, submit to the local leaderboard, save the ghost on a PB, send the MP
finish, `finishRace(...)`.

### Timing — not deterministic (yet)

`src/game/timing.js` is a `performance.now()` stopwatch
(`src/game/timing.js:12-34`). Its header (`src/game/timing.js:1-6`) flags this:
fine for local play, **not** reproducible across machines because it's
wall-clock, not step-count. A verified global leaderboard would switch
`elapsedMs()` to counting fixed physics steps; the API is kept tiny so the swap
is localised.

### Progress, ghost, leaderboard

- `progress.next` is the next checkpoint that counts; `clearCheckpoint(i)` only
  advances if `i === progress.next` and moves the respawn point to that gate
  (`src/game/progress.js:19-25`). Checkpoint and finish sensors are tall
  `CuboidCollider sensor` boxes (`src/components/Track.jsx:215-252`); the finish
  gate refuses to fire until `allCheckpointsCleared()`.
- `src/game/ghost.js`: `GhostRecorder.sample` pushes
  `[timeMs, x,y,z, qx,qy,qz,qw]` keyframes at 50 Hz
  (`src/game/ghost.js:8`, `src/game/ghost.js:20-33`), saved to `localStorage` on
  a PB. `sampleGhost` binary-searches + lerp/slerps to an arbitrary time
  (`src/game/ghost.js:62-88`); `ghostTimeAtPosition` gives the live delta
  (`src/game/ghost.js:92-107`).
- `src/game/leaderboard.js`: PBs + a local top-8 board in `localStorage` keyed
  by track (`src/game/leaderboard.js:43-56`); `medalFor` maps a time to
  author/gold/silver/bronze against `TRACK.medals`
  (`src/game/leaderboard.js:58-64`), themselves derived from a per-track
  reference-lap constant (`src/game/track.js`, `medalsFor` /
  `medalsFromAuthor`).

---

## 4. Multiplayer hook points

**Key design decision:** physics stays 100% client-side. A race result is *each
player's own local lap time*, measured start-line to finish-line exactly as in
single player. The server never simulates, never validates, never arbitrates
position — it is a **dumb relay** (`party/server.ts:1-14`).

### `src/game/net.js` — transport

Mirrors the `carState` / `hud` pattern: a mutable `netState` (per-frame opponent
transform + signed `gapM`) and a `session` object (room code, roster, `selfId`,
`startAtLocal`), plus a small event emitter for the coarse transitions that *do*
belong in React (`src/game/net.js:28-78`).

- **Transport:** one `PartySocket` to `PARTYKIT_HOST`
  (`src/game/net.js:136-140`; resolved in `src/game/net-config.js` —
  `127.0.0.1:1999` in dev, the deployed `.partykit.dev` host in prod).
- **Telemetry out:** `sendTelemetry` self-throttles to 15 Hz, rounds
  aggressively, sends `{t, p, q, s, prog, air}` (`src/game/net.js:293-307`).
  Called from `Car.jsx` every physics frame while `session.active` and racing or
  counting down (`src/components/Car.jsx:456-465`).
- **Interpolation buffer:** inbound `oppTelem` snapshots are pushed with a local
  receive timestamp, capped at 40 (`src/game/net.js:236-248`).
  `sampleOpponent(selfProg)` — called once per rendered frame by `RemoteCar` —
  interpolates to `performance.now() - RENDER_DELAY_MS` (**110 ms in the past**,
  `src/game/net.js:19`, `src/game/net.js:326-367`) so two snapshots always
  bracket "now"; past the newest it *holds* the last pose rather than
  extrapolating a physics car. It also sets
  `netState.gapM = (selfProg - oppProg) · TRACK.length`.
- **Clock sync:** `ping`/`pong` every 3 s; keeps the 7 lowest-RTT samples and
  uses the least-jittered for `clockOffset` (`src/game/net.js:218-227`). Used to
  convert the server's `start` timestamp to local time:
  `session.startAtLocal = msg.startAt - clockOffset` (`src/game/net.js:229-234`).

### `party/server.ts` — the relay

One PartyKit room per join code, max two players, first in is host
(`party/server.ts:60-87`):

- `hello` → set name/colour (host's track is authoritative), reply `joined` +
  broadcast `roster` (`party/server.ts:101-116`).
- `ready` → `maybeStart()`: both ready → broadcast one `start` with
  `startAt = Date.now() + 3200` on the server clock
  (`party/server.ts:185-194`).
- `telem` → **relayed untouched** to the other connection
  (`party/server.ts:127-139`).
- `finish` → store, relay as `oppFinish` with the sender's name
  (`party/server.ts:140-149`).
- `rematch` → reset flags, broadcast `rematch` (`party/server.ts:150-160`).
- `onClose` → broadcast `oppLeft`, reset the remaining player to a clean lobby
  (`party/server.ts:164-181`). Idle rooms close after 15 min.

### `src/game/mp.js` — glue

Keeps `net.js` a pure transport and the components read-only.

- `bootstrapMultiplayer()` (`src/game/mp.js:26-67`) runs once at `App.jsx:16`
  before React renders: handles a `?join=CODE&track=ID` deep link, reloading
  once (with a `sessionStorage` handoff) if the friend's track isn't loaded.
- `hostRace()` / `joinAsGuest()` connect and `enterLobby()`
  (`src/game/mp.js:69-91`).
- `useMultiplayerCoordinator()` (`src/game/mp.js:113-138`) wires net events to
  store transitions: `start` → `startMultiplayerCountdown()`, `rematch` →
  `enterLobby()`, `full` → alert + menu, `oppLeft` mid-countdown → lobby. It
  also de-dupes colours — if both players picked the same paint the guest is
  nudged onto a free colour (`src/game/mp.js:101-111`).

### Components

- `src/components/Lobby.jsx` — room code, QR/share link (`net.joinUrl`), name
  field, ready toggle (`net.sendReady`, `src/components/Lobby.jsx:103-105`).
- `src/components/Countdown.jsx` — in MP, paces its 3-2-1-GO steps off
  `session.startAtLocal - GO_AT` so GO lands on the shared timestamp; solo just
  counts from now (`src/components/Countdown.jsx:17-42`). `beginRacing()` fires
  on GO for both.
- `src/components/RemoteCar.jsx` — the opponent is a **live-driven ghost**: a
  `CarModel` with **no collider**, posed each frame from `net.sampleOpponent()`
  ~110 ms in the past (`src/components/RemoteCar.jsx:13`,
  `src/components/RemoteCar.jsx:22-40`). Only mounted when
  `getState().multiplayer` (`src/components/Race.jsx:56`).
- `src/components/Result.jsx` — branches on `multiplayer`
  (`src/components/Result.jsx:9-15`); the head-to-head panel waits for
  `netState.oppFinished`, then compares the two local times for win/lose/draw
  and the margin (`src/components/Result.jsx:17-80`).

### What server-authoritative or shared-collision play would need

The relay model works *because* the cars never physically interact and each
result is self-measured. Server authority or car-vs-car collision would require:

- **Unlock pitch/roll** on the car body (`src/components/Car.jsx:531`) so cars
  can be shoved and can bank — which means reworking grip and slip-angle steering
  into a **surface-relative frame** instead of the current world-horizontal
  `fwd`/`right`.
- **Deterministic timing** — count fixed steps, not `performance.now()`
  (`src/game/timing.js`).
- **Lockstep or rollback netcode** — an authority simulates the shared world,
  clients send inputs not transforms, mispredictions are reconciled. The current
  15 Hz rounded-transform stream and 110 ms render delay are display-only
  smoothing and would be replaced.
- Server-side collision also needs the track collider geometry (`TRACK.slabs`,
  walls, ramps), currently derived only in the browser at module load.
