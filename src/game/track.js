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
    ['ramp', 22, 2.8], // gentle launch
    ['straight', 34],
    ['checkpoint'],
    ['turn', 110, 48], // big, lazy left back around
    ['straight', 70],
    ['finish'],
  ],
})

// --- Track 1: Stadium Sprint (the real one) --------------------------------
const STADIUM_SPRINT = buildTrack({
  id: 'stadium-sprint-1',
  name: 'Stadium Sprint',
  roadWidth: 15,
  medals: { author: 30000, gold: 36000, silver: 44000, bronze: 55000 },
  course: [
    ['start'],
    ['straight', 26],
    ['checkpoint'],
    ['straight', 20],
    ['turn', -70, 26],
    ['straight', 16],
    ['ramp', 22, 1.5],
    ['straight', 10],
    ['ramp', 20, -1.5],
    ['straight', 10],
    ['checkpoint'],
    ['straight', 20],
    ['turn', 78, 24],
    ['straight', 26],
    ['turn', -50, 30],
    ['checkpoint'],
    ['straight', 18],
    ['turn', 100, 18],
    ['straight', 34],
    ['finish'],
  ],
})

// --- Track 2: Nations Sprint -------------------------------------------------
// A homage to the classic Nations stadium sprint, not a copy of it: fast
// opening straight, a crest to get light over, a quick chicane, a long
// sweeper, and a run to the line. Point-to-point, like the originals.
const NATIONS_SPRINT = buildTrack({
  id: 'nations-sprint-2',
  name: 'Nations Sprint',
  roadWidth: 16,
  // estimates from the layout, not driven times — retune once there are laps
  medals: { author: 34000, gold: 39000, silver: 46000, bronze: 56000 },
  course: [
    ['start'],
    ['straight', 60], // launch straight, hard on the throttle
    ['turn', -55, 34], // fast right, taken flat
    ['straight', 24],
    ['checkpoint'],
    ['ramp', 18, 3.2], // up over the crest
    ['straight', 12],
    ['ramp', 16, -3.2], // and back down
    ['straight', 20],
    ['turn', 80, 22], // into the chicane
    ['straight', 18],
    ['turn', -95, 18], // and out of it
    ['checkpoint'],
    ['straight', 34],
    ['turn', -120, 26], // long right-hand sweeper
    ['straight', 40],
    ['turn', 90, 20], // tight left
    ['straight', 26],
    ['checkpoint'],
    ['turn', -70, 30],
    ['straight', 70], // run to the line
    ['finish'],
  ],
})

export const TRACKS = [TEST_PAD, STADIUM_SPRINT, NATIONS_SPRINT]

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
