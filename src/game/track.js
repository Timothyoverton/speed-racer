// Procedural-but-fixed tracks.
//
// A turtle walks a ribbon of road tiles from a list of commands
// (straight / turn / ramp / checkpoint). Corners are short straight chords so
// tile edges line up. Everything downstream (meshes, colliders, checkpoints,
// respawns) is derived from the generated data.

const ROAD_THICK = 1.6
const TILE_LEN = 6 // target length of a single straight chord
const DEG = Math.PI / 180

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
    this.tiles = []
    this.checkpoints = []
    this.start = null
    this.finish = null
  }

  _placeTile(len, pitch) {
    const [dx, dz] = dirOf(this.heading)
    const cx = this.x + (dx * len) / 2
    const cz = this.z + (dz * len) / 2
    const rise = Math.tan(pitch) * len
    // place the tile so its top surface sits at the turtle's current height
    const cy = this.y + rise / 2 - ROAD_THICK / 2
    this.tiles.push({
      pos: [cx, cy, cz],
      rot: [pitch, this.heading, 0],
      size: [this.w, ROAD_THICK, len],
    })
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

  ramp(dist, rise) {
    const pitch = Math.atan2(rise, dist)
    let remaining = dist
    while (remaining > 0.01) {
      const seg = Math.min(TILE_LEN, remaining)
      this._placeTile(seg, pitch)
      remaining -= seg
    }
    return this
  }

  // angle in degrees, +ve turns left, radius in metres
  turn(angleDeg, radius) {
    const total = Math.abs(angleDeg) * DEG
    const sign = Math.sign(angleDeg)
    const arcLen = total * radius
    const steps = Math.max(3, Math.ceil(arcLen / TILE_LEN))
    const dAngle = (total / steps) * sign
    const chord = arcLen / steps
    for (let i = 0; i < steps; i++) {
      this.heading += dAngle / 2
      this._placeTile(chord, 0)
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
    slabs: mergeTiles(t.tiles),
    checkpoints: t.checkpoints,
    start: t.start,
    finish: t.finish,
    medals,
  }
}

function mergeTiles(tiles) {
  const slabs = []
  let run = null
  const sameOrient = (a, b) =>
    Math.abs(a.rot[0] - b.rot[0]) < 1e-6 && Math.abs(a.rot[1] - b.rot[1]) < 1e-6

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
    const [pitch, yaw] = first.rot
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
    }
  })
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
    ['ramp', 15, 2.2],
    ['straight', 10],
    ['ramp', 12, -2.2],
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

export const TRACKS = [TEST_PAD, STADIUM_SPRINT]

// Active track. Swap to STADIUM_SPRINT (or TRACKS[1]) once the dynamics feel good.
export const TRACK = TEST_PAD
export const CHECKPOINT_COUNT = TRACK.checkpoints.length
