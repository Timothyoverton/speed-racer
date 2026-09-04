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
  for (const [cmd, a, b] of course) {
    if (cmd === 'start') t.markStart()
    else if (cmd === 'finish') t.markFinish()
    else if (cmd === 'checkpoint') t.checkpoint()
    else if (cmd === 'straight') t.straight(a)
    else if (cmd === 'ramp') t.ramp(a, b)
    else if (cmd === 'jump') t.jump(a, b)
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

  for (const tile of tiles) {
    if (run && sameOrient(run.tiles[0], tile)) {
      run.tiles.push(tile)
    } else {
      run = { tiles: [tile] }
      slabs.push(run)
    }
  }

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
    if (pitched(s) || pitched(slabs[i - 1]) || pitched(slabs[i + 1])) s.pad = 0
    else s.pad = s.span <= 1 ? 2.2 : 0.8
  }
  return slabs
}

// --- Track 0: a wide, forgiving test pad ------------------------------------
// Long straight (accel / top speed / braking), two big open sweepers, one
// gentle jump. Hard to hit a wall — for feeling out the car, not for racing.
const TEST_PAD = buildTrack({
  id: 'test-pad-0',
  name: 'Test Pad',
  roadWidth: 30,
  medals: { author: 24000, gold: 30000, silver: 38000, bronze: 50000 },
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

// --- Track 1: Long Ribbon -----------------------------------------------------
// Built to be driven flat. The car's turn rate is capped at BASE_YAW*13/speed,
// so the tightest radius holdable at speed v is v^2/20.8 — 120m at 180km/h,
// 77m at 144, 43m at 108. Every corner here is 60-110m, so it is long fast
// sweepers linked by straights, with one medium corner and the jump as the only
// real braking points. (Stadium Sprint, which this replaces, used 18-30m radii:
// under 90km/h through everything, hence the stop-start feel.)
const LONG_RIBBON = buildTrack({
  id: 'long-ribbon-1',
  name: 'Long Ribbon',
  roadWidth: 20,
  // estimates from the layout, not driven times — retune once there are laps
  medals: { author: 30000, gold: 34000, silver: 40000, bronze: 50000 },
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
// The real one's signature is the banked wall the road sweeps up into. Banking
// isn't in this DSL yet (corners are flat) and adding it means letting the car
// roll, which is currently locked — so this is the flat interpretation.
const QIDDIYA_RUSH = buildTrack({
  id: 'qiddiya-rush-2',
  name: 'Qiddiya Rush',
  roadWidth: 20,
  // estimates from the layout, not driven times — retune once there are laps
  medals: { author: 33000, gold: 38000, silver: 45000, bronze: 55000 },
  course: [
    ['start'],
    ['straight', 70], // long run-up, flat out
    ['turn', -40, 60], // opening sweeper, barely lift
    ['straight', 30],
    ['checkpoint'],
    ['jump', 26, 2.2], // kicker over the crest
    ['straight', 16],
    ['ramp', 24, -3.4], // and down the far side, steeper than the climb
    ['turn', -85, 30], // fast right off the bottom
    ['straight', 34],
    ['checkpoint'],
    ['turn', 70, 26], // left
    ['straight', 22],
    ['turn', -60, 24], // straight back into a right
    ['straight', 40],
    ['ramp', 20, -1.8], // descending
    ['checkpoint'],
    ['turn', 100, 34], // long left onto the final straight
    ['straight', 80],
    ['finish'],
  ],
})

export const TRACKS = [TEST_PAD, LONG_RIBBON, QIDDIYA_RUSH]

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
