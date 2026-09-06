// Procedural-but-fixed tracks.
//
// A turtle walks a ribbon of road tiles from a list of commands
// (straight / turn / ramp / checkpoint). Corners are short straight chords so
// tile edges line up. Everything downstream (meshes, colliders, checkpoints,
// respawns) is derived from the generated data.

const ROAD_THICK = 1.6
const TILE_LEN = 6 // target length of a single straight chord
const RAMP_TILE_LEN = 1.2 // elevation changes get much shorter slices, so the
// eased profile below reads as a curve rather than a set of steps
const DEG = Math.PI / 180
// Corners are built from straight chords, and the barrier is faceted the same
// way. Capping only the chord LENGTH leaves a tight corner turning ~19deg per
// chord, and each straight barrier segment then cuts well inside the arc. Cap
// the angle per chord too, and take whichever rule gives the finer slice.
const MAX_CHORD_ANGLE = 5 * DEG

function dirOf(heading) {
  // heading 0 => facing +Z
  return [Math.sin(heading), Math.cos(heading)]
}

class Turtle {
  constructor(roadWidth) {
    this.w = roadWidth
    this.x = 0
    this.y = 0
    this.z = 0
    this.heading = 0
    this.dist = 0
    this.tiles = []
    this.checkpoints = []
    this.walls = []
    this.boosts = []
    this.pools = []
    this.ramps = []
    this.falls = []
    this.start = null
    this.finish = null
  }

  _placeTile(len, pitch, curve = 0) {
    const [dx, dz] = dirOf(this.heading)
    const cx = this.x + (dx * len) / 2
    const cz = this.z + (dz * len) / 2
    const rise = Math.tan(pitch) * len
    const cosP = Math.cos(pitch)
    // Drop the box by half its thickness measured PERPENDICULAR to the road,
    // not vertically, so the top face lands exactly on the intended line. With
    // the plain vertical offset a pitched tile's surface sits ~1.5cm proud.
    const cy = this.y + rise / 2 - ROAD_THICK / 2 / cosP
    this.tiles.push({
      pos: [cx, cy, cz],
      // Pitch has to be applied about the road's OWN lateral axis, so the
      // rotation is YXZ (yaw first, then pitch) and negated: in three's XYZ
      // default the pitch is applied last, about the world X axis, which tilts
      // the road by -cos(yaw)*sin(pitch) — inverted, and scaled by heading.
      rot: [-pitch, this.heading, 0],
      pitch,
      // `len` is the horizontal run; the box has to be the longer SLOPE length
      // or consecutive pitched slices fall short of each other and leave a gap
      size: [this.w, ROAD_THICK, len / cosP],
      // 0 straight, +1 mid-left-hander, -1 mid-right-hander — drives kerbs
      curve,
      dist: this.dist,
    })
    this.dist += len
    this.x += dx * len
    this.z += dz * len
    this.y += rise
  }

  straight(dist) {
    let remaining = dist
    while (remaining > 0.01) {
      const seg = Math.min(TILE_LEN, remaining)
      this._placeTile(seg, 0)
      remaining -= seg
    }
    return this
  }

  // Elevation change with an eased (smoothstep) height profile: dead flat where
  // it meets the road at both ends, steepest in the middle. A constant-pitch
  // ramp puts a hard kink at the bottom and the crest, and the crest is where
  // the car catches. Sliced fine enough that the easing reads as a curve.
  ramp(dist, rise) {
    const steps = Math.max(2, Math.ceil(dist / RAMP_TILE_LEN))
    const seg = dist / steps
    const smooth = (t) => t * t * (3 - 2 * t)
    let prevH = 0
    for (let i = 0; i < steps; i++) {
      const h = rise * smooth((i + 1) / steps)
      this._placeTile(seg, Math.atan2(h - prevH, seg))
      prevH = h
    }
    return this
  }

  // A kicker. Eased on at the bottom like a ramp — nothing to catch on — but it
  // leaves at FULL slope instead of flattening off, so you actually take off.
  // (`ramp` eases both ends, which is what you want for a hill and is exactly
  // what stops it launching you.) Exit angle is atan(2 * rise / dist).
  jump(dist, rise) {
    const steps = Math.max(2, Math.ceil(dist / RAMP_TILE_LEN))
    const seg = dist / steps
    let prevH = 0
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps
      const h = rise * t * t // quadratic: flat at the bottom, steepest at the lip
      this._placeTile(seg, Math.atan2(h - prevH, seg))
      prevH = h
    }
    return this
  }

  // A hole in the road. The turtle walks on and lays NOTHING — no surface, no
  // barrier, no collider — so this is a real void. Come up short and you fall
  // out of the world and respawn at the last checkpoint. `drop` lowers the far
  // side, which is what buys the car time to fall on its way across; a gap
  // between two equal heights needs a lot more speed than it looks.
  gap(dist, drop = 0) {
    // below the merge tolerance a "gap" would just be closed up again
    if (dist < 5) throw new Error(`gap(${dist}) too small to read as a hole`)
    const [dx, dz] = dirOf(this.heading)
    this.x += dx * dist
    this.z += dz * dist
    this.y -= drop
    this.dist += dist
    return this
  }

  // angle in degrees, +ve turns left, radius in metres
  turn(angleDeg, radius) {
    const total = Math.abs(angleDeg) * DEG
    const sign = Math.sign(angleDeg)
    const arcLen = total * radius
    const steps = Math.max(3, Math.ceil(Math.max(arcLen / TILE_LEN, total / MAX_CHORD_ANGLE)))
    const dAngle = (total / steps) * sign
    const chord = arcLen / steps
    for (let i = 0; i < steps; i++) {
      this.heading += dAngle / 2
      this._placeTile(chord, 0, sign)
      this.heading += dAngle / 2
    }
    return this
  }

  // A solid block sitting ON the road, covering part of its width. You don't
  // jump these — you pick a side and thread them. Set a few alternating and a
  // straight becomes a slalom you have to take at whatever speed you dare.
  // `lateral` is the block's centre offset from the centreline, + to the left.
  wall(lateral = 0, width = 8, height = 2.4, thickness = 1.4) {
    const rx = Math.cos(this.heading)
    const rz = -Math.sin(this.heading)
    this.walls.push({
      pos: [this.x + rx * lateral, this.y, this.z + rz * lateral],
      yaw: this.heading,
      size: [width, height, thickness],
    })
    return this
  }

  // A launch ramp sitting ON the road, covering only part of its width — a
  // wedge you drive up. Pair it with a wall on the other half and the jump
  // becomes a choice you can get wrong: take the ramp and fly, miss it and
  // you're into the block.
  //
  // It's a tilted slab rather than a true wedge because Rapier has no wedge
  // primitive; the car climbs its top face exactly as it would a real ramp.
  stuntRamp(lateral, width, len, rise) {
    const rx = Math.cos(this.heading)
    const rz = -Math.sin(this.heading)
    const fx = Math.sin(this.heading)
    const fz = Math.cos(this.heading)
    const pitch = Math.atan2(rise, len)
    const slope = Math.hypot(len, rise)
    this.ramps.push({
      pos: [
        this.x + rx * lateral + fx * (len / 2),
        this.y + rise / 2,
        this.z + rz * lateral + fz * (len / 2),
      ],
      yaw: this.heading,
      pitch,
      size: [width, 0.35, slope],
      // where the lip is, for the visuals to flag
      lip: [this.x + rx * lateral + fx * len, this.y + rise, this.z + rz * lateral + fz * len],
      exitDeg: (pitch * 180) / Math.PI,
    })
    return this
  }

  // A swimming pool: a gap with something to look at in the bottom of it. The
  // road stops exactly as it does over a void, so the physics is identical —
  // you clear it or you don't — but you can see what you're clearing, which is
  // most of the nerve.
  pool(dist, drop = 0) {
    const x0 = this.x
    const z0 = this.z
    const y0 = this.y
    this.gap(dist, drop)
    this.pools.push({
      pos: [(x0 + this.x) / 2, Math.min(y0, this.y), (z0 + this.z) / 2],
      yaw: this.heading,
      size: [this.w + 10, dist],
    })
    return this
  }

  // A waterfall curtain across the road. Purely something to fly through.
  waterfall(width = 40) {
    this.falls.push({ pos: [this.x, this.y, this.z], yaw: this.heading, width })
    return this
  }

  // A boost pad. Drive over the arrows, get a burst.
  boost() {
    this.boosts.push({ pos: [this.x, this.y, this.z], yaw: this.heading })
    return this
  }

  markStart() {
    this.start = { pos: [this.x, this.y, this.z], yaw: this.heading }
    return this
  }

  checkpoint() {
    this.checkpoints.push({
      pos: [this.x, this.y, this.z],
      yaw: this.heading,
      width: this.w,
    })
    return this
  }

  markFinish() {
    this.finish = { pos: [this.x, this.y, this.z], yaw: this.heading, width: this.w }
    return this
  }
}

function buildTrack({ id, name, roadWidth, medals, course }) {
  const t = new Turtle(roadWidth)
  for (const [cmd, a, b, c, d] of course) {
    if (cmd === 'start') t.markStart()
    else if (cmd === 'finish') t.markFinish()
    else if (cmd === 'checkpoint') t.checkpoint()
    else if (cmd === 'straight') t.straight(a)
    else if (cmd === 'ramp') t.ramp(a, b)
    else if (cmd === 'jump') t.jump(a, b)
    else if (cmd === 'gap') t.gap(a, b)
    else if (cmd === 'wall') t.wall(a, b, c)
    else if (cmd === 'boost') t.boost()
    else if (cmd === 'pool') t.pool(a, b)
    else if (cmd === 'stuntramp') t.stuntRamp(a, b, c, d)
    else if (cmd === 'waterfall') t.waterfall(a)
    else if (cmd === 'turn') t.turn(a, b)
  }
  return {
    id,
    name,
    roadWidth,
    roadThick: ROAD_THICK,
    tiles: t.tiles,
    // Merged collider slabs: consecutive tiles with the same orientation become
    // one long box, so straights have no seams for the car to catch on.
    slabs: padSlabs(mergeTiles(t.tiles)),
    checkpoints: t.checkpoints,
    walls: t.walls,
    boosts: t.boosts,
    pools: t.pools,
    ramps: t.ramps,
    falls: t.falls,
    start: t.start,
    finish: t.finish,
    length: t.dist,
    medals,
  }
}

function mergeTiles(tiles) {
  const slabs = []
  let run = null
  const sameOrient = (a, b) =>
    Math.abs(a.pitch - b.pitch) < 1e-6 && Math.abs(a.rot[1] - b.rot[1]) < 1e-6

  // Matching orientation is NOT enough to merge: two straights either side of a
  // `gap` are perfectly parallel, and merging them would span the void with one
  // long collider — an invisible floor across the hole. They have to actually
  // touch.
  //
  // The tolerance is deliberately loose. Consecutive chords around a corner do
  // NOT meet exactly — they're straight lines across an arc, so their ends
  // splay by up to ~0.2m at the chord angle used here. Tighten this to a few
  // centimetres and every corner chord reads as a gap, which strips the
  // collider overlap that keeps corners seamless. A real gap is >= 10m, so
  // there's a wide margin to sit in.
  const JOINED = 1.0
  const touching = (a, b) => {
    const horiz = Math.cos(a.pitch)
    const dir = [Math.sin(a.rot[1]) * horiz, Math.sin(a.pitch), Math.cos(a.rot[1]) * horiz]
    const end = a.pos.map((c, k) => c + (dir[k] * a.size[2]) / 2)
    const begin = b.pos.map((c, k) => c - (dir[k] * b.size[2]) / 2)
    return Math.hypot(end[0] - begin[0], end[1] - begin[1], end[2] - begin[2]) < JOINED
  }

  for (const tile of tiles) {
    const prev = run && run.tiles[run.tiles.length - 1]
    if (run && sameOrient(run.tiles[0], tile) && touching(prev, tile)) {
      run.tiles.push(tile)
    } else {
      if (run && prev && !touching(prev, tile)) run.gapAfter = true
      run = { tiles: [tile], gapBefore: !!(prev && !touching(prev, tile)) }
      slabs.push(run)
    }
  }
  if (run) run.gapAfter = run.gapAfter || false

  return slabs.map((s) => {
    const first = s.tiles[0]
    const last = s.tiles[s.tiles.length - 1]
    const pitch = first.pitch
    const yaw = first.rot[1]
    // unit vector along the run (accounting for the ramp pitch)
    const horiz = Math.cos(pitch)
    const dir = [Math.sin(yaw) * horiz, Math.sin(pitch), Math.cos(yaw) * horiz]
    const startEdge = first.pos.map((c, k) => c - (dir[k] * first.size[2]) / 2)
    const endEdge = last.pos.map((c, k) => c + (dir[k] * last.size[2]) / 2)
    const len = Math.hypot(
      endEdge[0] - startEdge[0],
      endEdge[1] - startEdge[1],
      endEdge[2] - startEdge[2],
    )
    return {
      pos: [
        (startEdge[0] + endEdge[0]) / 2,
        (startEdge[1] + endEdge[1]) / 2,
        (startEdge[2] + endEdge[2]) / 2,
      ],
      rot: first.rot,
      size: [first.size[0], first.size[1], len],
      // how many tiles this slab covers — 1 means it's a lone arc chord that
      // needs extra collider overlap to keep the surface seamless
      span: s.tiles.length,
      pitch,
      atGap: !!(s.gapBefore || s.gapAfter),
    }
  })
}

// How far each collider may be stretched along its own length.
//
// Overlapping neighbours is what keeps a corner's arc chords seamless — they
// all sit at the same height, so overlap costs nothing. Do it to a slab that is
// pitched (or that abuts one) and the stretched end carries on up the slope,
// poking through the road beyond it: that was a 9cm lip at the top of every
// rise, and exactly the sort of edge a frictionless car catches on.
function padSlabs(slabs) {
  const pitched = (s) => s && Math.abs(s.pitch) > 1e-6
  for (let i = 0; i < slabs.length; i++) {
    const s = slabs[i]
    // padding a slab that ends at a void would hang an invisible ledge out over
    // the hole — exactly what you'd catch a wheel on taking off
    if (s.atGap || pitched(s) || pitched(slabs[i - 1]) || pitched(slabs[i + 1])) s.pad = 0
    else s.pad = s.span <= 1 ? 2.2 : 0.8
  }
  return slabs
}

// --- Medals ------------------------------------------------------------------
// Medal times are derived from a REFERENCE LAP rather than hand-written, so all
// four tracks sit at the same difficulty instead of drifting apart.
//
// The reference lap is the time an autopilot sets driving the exact centreline
// with a perfect braking model and no mistakes — fast, but not a racing line,
// since it never cuts an apex. Measured by stepping the real physics at a fixed
// 1/60 (see README, "Measuring a reference lap").
//
// Author sits AUTHOR_FACTOR above that lap and the rest step down from Author.
// These numbers regenerate Test Pad's original hand-tuned medals to the second,
// which is why they're anchored here — retune every track with one constant.
const AUTHOR_FACTOR = 1.58
const MEDAL_SPREAD = { author: 1, gold: 1.25, silver: 1.583, bronze: 2.083 }

// Every refLapSec below was measured with tools/autopilot.js at the same
// revision. They only mean anything RELATIVE to each other, so if you change how
// the autopilot drives, re-measure all five or the tracks drift apart again.
function medalsFor(refLapSec) {
  const author = refLapSec * 1000 * AUTHOR_FACTOR
  const out = {}
  for (const k in MEDAL_SPREAD) out[k] = Math.round((author * MEDAL_SPREAD[k]) / 1000) * 1000
  return out
}

// --- Track 0: a wide, forgiving test pad ------------------------------------
// Long straight (accel / top speed / braking), two big open sweepers, one
// gentle jump. Hard to hit a wall — for feeling out the car, not for racing.
const TEST_PAD = buildTrack({
  id: 'test-pad-0',
  name: 'Test Pad',
  roadWidth: 30,
  medals: medalsFor(15.25),
  course: [
    ['start'],
    ['straight', 100],
    ['checkpoint'],
    ['turn', 120, 48], // big, lazy left
    ['straight', 46],
    ['jump', 24, 2.0], // kicker — leaves at ~9.5deg, good for a few car lengths
    ['straight', 34],
    ['checkpoint'],
    ['turn', 110, 48], // big, lazy left back around
    ['straight', 70],
    ['finish'],
  ],
})

// --- Track 1: Slipstream -----------------------------------------------------
// Built to be driven flat. The car's turn rate is capped at BASE_YAW*13/speed,
// so the tightest radius holdable at speed v is v^2/20.8 — 120m at 180km/h,
// 77m at 144, 43m at 108. Every corner here is 60-110m, so it is long fast
// sweepers linked by straights, with one medium corner and the jump as the only
// real braking points. (Stadium Sprint, which this replaces, used 18-30m radii:
// under 90km/h through everything, hence the stop-start feel.)
const SLIPSTREAM = buildTrack({
  id: 'long-ribbon-1',
  name: 'Slipstream',
  roadWidth: 20,
  // estimates from the layout, not driven times — retune once there are laps
  medals: medalsFor(26.62),
  course: [
    ['start'],
    ['straight', 90], // long launch
    ['turn', -35, 110], // huge opening right, flat
    ['straight', 40],
    ['checkpoint'],
    ['turn', 45, 90], // fast left
    ['straight', 30],
    ['jump', 26, 1.8], // kicker
    ['straight', 40],
    ['turn', -60, 75], // long right sweeper
    ['straight', 36],
    ['checkpoint'],
    ['turn', 70, 60], // the one corner worth lifting for
    ['straight', 44],
    ['turn', -50, 80],
    ['straight', 30],
    ['ramp', 24, -2.2], // drop away
    ['turn', 40, 95], // fast left
    ['straight', 50],
    ['checkpoint'],
    ['turn', -55, 70],
    ['straight', 90], // run to the line
    ['finish'],
  ],
})

// --- Track 2: Qiddiya Rush ---------------------------------------------------
// Modelled on the Trackmania Qiddiya City map — its character, not its layout:
// wide fast asphalt, a long opening sweeper, a crest into a drop, a flowing
// right-left, and a net downhill run to the line. Point to point.
//
// Corners are 65-105m so it can be driven near flat, like the real thing —
// the drop out of the crest onto the 65m right is the one place worth braking.
// (It was built with 24-60m corners, which capped it at 80-90km/h throughout.)
//
// The real one's signature is the banked wall the road sweeps up into. Banking
// isn't in this DSL yet (corners are flat) and adding it means letting the car
// roll, which is currently locked — so this is the flat interpretation.
const QIDDIYA_RUSH = buildTrack({
  id: 'qiddiya-rush-2',
  name: 'Qiddiya Rush',
  roadWidth: 20,
  // estimates from the layout, not driven times — retune once there are laps
  medals: medalsFor(23.57),
  course: [
    ['start'],
    ['straight', 80], // long run-up, flat out
    ['turn', -40, 105], // opening sweeper, barely lift
    ['straight', 34],
    ['checkpoint'],
    ['jump', 26, 2.2], // kicker over the crest
    ['straight', 18],
    ['ramp', 26, -3.4], // and down the far side
    ['turn', -70, 65], // the one corner worth braking for
    ['straight', 40],
    ['checkpoint'],
    ['turn', 60, 80], // swing left
    ['straight', 34],
    ['turn', -75, 95], // long right
    ['straight', 40],
    ['ramp', 22, -1.8], // descending
    ['checkpoint'],
    ['turn', -70, 100], // final sweeper onto the straight
    ['straight', 90], // run to the line
    ['finish'],
  ],
})

// --- Track 3: Freefall ------------------------------------------------------
// Slipstream taken to the extreme: twice the length, and built around four
// kickers that each launch straight onto a road falling away underneath you.
// Hold the middle and you spend a huge fraction of the lap in the air.
//
// The pattern each time is climb -> kicker -> long steep drop. The kicker sets
// the launch angle, then the road descends faster than the car does, so the
// flight keeps extending instead of ending at the same height it started.
// Net elevation is -18m over the lap, all of it downhill drama.
const FREEFALL = buildTrack({
  id: 'freefall-3',
  name: 'Freefall',
  roadWidth: 22, // wide — you land where you land
  medals: medalsFor(63.87),
  course: [
    ['start'],
    ['straight', 130], // get everything you can before the first launch
    ['turn', -30, 130],
    ['straight', 60],
    ['checkpoint'],
    ['jump', 30, 6.0], // kicker 1 — ~21deg off the lip
    ['ramp', 78, -15], // and the floor falls out
    ['straight', 95], // long run-out: the flight is ~100m
    ['turn', 45, 110],
    ['straight', 70],
    ['ramp', 50, 6], // climb to the big one
    ['jump', 28, 5.65], // kicker 2 — ~22deg
    ['ramp', 92, -21], // the long one
    ['checkpoint'],
    ['straight', 100],
    ['turn', -60, 95],
    ['straight', 80],
    ['ramp', 45, 5],
    ['jump', 26, 5.25], // kicker 3 — ~22deg
    ['ramp', 74, -14],
    ['straight', 70],
    ['turn', 50, 100],
    ['straight', 95],
    ['checkpoint'],
    ['turn', -55, 105],
    ['straight', 65],
    ['ramp', 40, 4.5], // up to the biggest
    ['jump', 32, 6.9], // kicker 4 — the big one, ~23deg
    ['ramp', 104, -24], // the drop of the lap
    ['straight', 105],
    // THE EDGE. A jump with a negative rise: the road stays flat, then pitches
    // down harder and harder, so it simply falls away under you at ~42deg. You
    // don't launch off it — you drive off it, which is the point.
    ['jump', 45, -20],
    ['ramp', 70, -13], // still falling
    ['straight', 130], // somewhere to land
    ['turn', 40, 120],
    ['straight', 150], // long run to the line
    ['finish'],
  ],
})

// --- Track 4: Stunt Park -----------------------------------------------------
// Not a circuit — a run of set pieces, each one a trick with its own name, laid
// out so you can read the next one while you're still landing the last.
//
// Freefall is about hang time on a road that keeps falling away. This is about
// GAPS: five of them, real holes with nothing underneath, where the road simply
// stops. Every one is set up by a kicker and lands on a slope that drops away
// from the lip, because a gap between two equal heights needs far more speed
// than it looks — the car has to fall the whole way across.
//
// Gap distances here are measured, not guessed: each one is clearable with room
// to spare at the speed the run-up actually produces, and coming up short drops
// you out of the world.
const STUNT_PARK = buildTrack({
  id: 'stunt-park-4',
  name: 'Stunt Park',
  roadWidth: 20,
  medals: medalsFor(57.4), // 58.17 / 56.58 measured; jumps make it vary
  course: [
    ['start'],
    ['straight', 130],
    ['jump', 20, 2.2], // THE OPENER — a pop to set the tone, ~12deg
    ['ramp', 26, -2.2],
    ['straight', 40],
    ['checkpoint'],

    // THE RHYTHM — five whoops on the trot. Hold it flat and the car skips
    // across the tops; lift and you drop into every trough.
    ['jump', 9, 0.9], ['ramp', 11, -0.9],
    ['jump', 9, 0.9], ['ramp', 11, -0.9],
    ['jump', 9, 0.9], ['ramp', 11, -0.9],
    ['jump', 9, 0.9], ['ramp', 11, -0.9],
    ['jump', 9, 0.9], ['ramp', 11, -0.9],
    ['straight', 55],
    ['turn', 42, 115],
    ['straight', 65],

    // THE TABLE-TOP — climb it, run the flat roof, then the roof just ends.
    // The climb is deliberately shallow: every metre climbed is speed gone, and
    // speed is what gets you across. 30m with an 8m drop clears from 90km/h.
    ['ramp', 40, 6],
    ['straight', 24],
    ['jump', 18, 3.4], // ~21deg
    ['gap', 30, 8],
    ['ramp', 44, -6],
    ['straight', 80],
    ['checkpoint'],

    // THE STAIRS — three shelves down, each one a small launch off its edge.
    // The shelf has to be LONGER than the flight off the shelf above it. The
    // first cut used a 22m shelf behind a kicker that throws you 41m at
    // racing speed, so you landed on the next kicker instead of the shelf and
    // got fired sideways into the void. 9deg and 40m lands you on the deck
    // from 100km/h all the way past 160.
    ['jump', 10, 0.8], ['gap', 12, 3], ['straight', 40],
    ['jump', 10, 0.8], ['gap', 12, 3], ['straight', 40],
    ['jump', 10, 0.8], ['gap', 12, 3], ['straight', 60],

    ['turn', -55, 100],
    ['straight', 70],

    // THE DOUBLE — land and immediately launch again, no time to gather it up
    ['ramp', 34, 5],
    ['jump', 22, 4.2],
    ['ramp', 56, -11],
    ['jump', 20, 3.8],
    ['ramp', 62, -12],
    ['straight', 90],
    ['checkpoint'],

    ['turn', 48, 120],
    ['straight', 80],

    // THE LEAP OF FAITH — the big one. Long climb, steep kicker, and a hole
    // wide enough that the far side is over the horizon of the lip.
    //
    // Checkpointed at the foot of the climb on purpose. Miss this and you fall
    // out of the world, and a respawn that left you without the run-up to try
    // again would just loop forever — which is exactly what the first cut of
    // this did. 42m with a 14m drop clears from 110km/h (50m of range) with
    // room to spare, and from 130 (64m) with a lot.
    ['checkpoint'],
    ['straight', 90], // FLAT run-up. The first cut climbed 15m into this kicker
    ['jump', 30, 6.4], // and the car arrived too slow to climb it at all, let
    ['gap', 40, 16],   // alone jump. The drama is the drop, not the climb.
    ['ramp', 70, -10],
    ['straight', 110],

    ['turn', -40, 130],
    ['straight', 120],
    ['finish'],
  ],
})

// --- Track 5: Mission Impossible ---------------------------------------------
// Stunt Park with the safety taken off, for the kids. Everything that track
// does, bigger, and three things it doesn't: solid blocks you thread rather
// than jump, boost pads that make the big gaps reachable, and a shark pool.
//
// The road is 14m wide, not 20. That single number does more for the
// difficulty than any jump on here — every wall gap, every landing and every
// corner gets proportionally meaner, and there's no room to be lazy.
//
// The boost pads are load-bearing, not decoration: the last two gaps are sized
// so you need the pad before them. Miss the pad and you will not make it.
const MISSION_IMPOSSIBLE = buildTrack({
  id: 'mission-impossible-5',
  name: 'Mission Impossible',
  roadWidth: 14,
  // ESTIMATE, not measured: 63.05s was the reference lap for the previous
  // layout of this track. The autopilot can't drive the new one — it has no
  // concept of aiming at a stunt ramp, so it takes the wall every time. Re-measure
  // once the harness can pick a ramp, or off a real lap.
  medals: medalsFor(63),
  course: [
    ['start'],
    ['straight', 110],
    ['boost'],
    ['straight', 50],
    ['jump', 26, 4.6],
    ['gap', 38, 9],
    ['ramp', 40, -6],
    ['straight', 60],
    ['checkpoint'],

    // THE SLALOM — once, not twice. Blocks overlap the centreline so there's
    // no lazy line through the middle, and they're 60m apart because the ~7m
    // shift between them needs the room.
    ['straight', 40],
    ['wall', 3.5, 8, 2.4],
    ['straight', 60],
    ['wall', -3.5, 8, 2.4],
    ['straight', 60],
    ['wall', 3.5, 8, 2.4],
    ['straight', 90],
    ['turn', 40, 120],
    ['straight', 70],

    // THE CHOICE — a launch ramp on the left half, a solid block on the right.
    // Take the ramp and you sail the shark pool. Miss it and you hit the wall.
    // Nothing else on any track makes you pick a line this early.
    ['boost'],
    ['straight', 60],
    ['stuntramp', -3.5, 7, 16, 3.4],
    ['wall', 3.5, 7, 2.6],
    ['straight', 16],
    ['pool', 40, 12],
    ['ramp', 46, -7],
    ['straight', 80],
    ['checkpoint'],

    ['turn', -45, 110],
    ['straight', 90],

    // THE WATERFALL — huge jump straight through the curtain
    ['boost'],
    ['straight', 60],
    ['jump', 32, 7.4], // ~25deg
    ['waterfall', 46],
    ['gap', 62, 20],
    ['ramp', 80, -14],
    ['straight', 100],
    ['checkpoint'],

    ['turn', 45, 120],
    ['straight', 120],
    ['wall', -3.3, 7.4, 2.4],
    ['straight', 90],

    // THE LAST WORD — the biggest drop in the game
    ['boost'],
    ['straight', 46],
    ['jump', 30, 7.0],
    ['gap', 72, 26],
    ['ramp', 90, -16],
    ['straight', 110],
    ['turn', -38, 130],
    ['straight', 120],
    ['finish'],
  ],
})

export const TRACKS = [TEST_PAD, SLIPSTREAM, QIDDIYA_RUSH, FREEFALL, STUNT_PARK, MISSION_IMPOSSIBLE]

const TRACK_KEY = 'speed-racer:track'

function pickTrack() {
  try {
    return TRACKS.find((t) => t.id === localStorage.getItem(TRACK_KEY)) || TRACKS[0]
  } catch {
    return TRACKS[0]
  }
}

// The active track, chosen once at load.
export const TRACK = pickTrack()

// Switching reloads the page. Everything downstream — collider slabs, the
// instanced track meshes, the texture repeats, the shadow camera bounds — is
// derived from TRACK once at module load, and picking a different track is a
// rare, deliberate act in a time-attack game. Not worth making all of that
// rebuild live for something you do between grinding sessions.
export function selectTrack(id) {
  try {
    localStorage.setItem(TRACK_KEY, id)
  } catch {
    /* private mode — the choice just won't stick */
  }
  window.location.reload()
}

if (import.meta.env?.DEV && typeof window !== 'undefined') window.__track = TRACK
export const CHECKPOINT_COUNT = TRACK.checkpoints.length
