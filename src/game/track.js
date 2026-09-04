// Procedural-but-fixed "Stadium Sprint" track.
//
// A turtle walks a ribbon of road tiles. Corners are approximated with short
// straight chords so tile edges line up. The layout is authored here as a list
// of commands, so tweaking the course is just editing COURSE below.
//
// Everything is generated once at module load into TRACK, which the renderer
// and the physics colliders both read from.

const ROAD_WIDTH = 11
const ROAD_THICK = 1.6
const TILE_LEN = 6 // target length of a single straight chord

const DEG = Math.PI / 180

function dirOf(heading) {
  // heading 0 => facing +Z
  return [Math.sin(heading), Math.cos(heading)]
}

class Turtle {
  constructor() {
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
      size: [ROAD_WIDTH, ROAD_THICK, len],
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
      width: ROAD_WIDTH,
    })
    return this
  }

  markFinish() {
    this.finish = {
      pos: [this.x, this.y, this.z],
      yaw: this.heading,
      width: ROAD_WIDTH,
    }
    return this
  }
}

// The course. Edit this list to reshape the track — everything downstream
// (meshes, colliders, checkpoints) is derived from it.
const COURSE = [
  ['start'],
  ['straight', 20],
  ['checkpoint'],
  ['straight', 14],
  ['turn', -78, 17], // long right sweep
  ['straight', 10],
  ['ramp', 13, 2.4], // launch up
  ['straight', 9], // brief air / elevated ledge
  ['ramp', 9, -2.4], // land back down
  ['checkpoint'],
  ['straight', 16],
  ['turn', 85, 14], // left
  ['straight', 22],
  ['turn', -55, 20], // gentle right
  ['checkpoint'],
  ['straight', 14],
  ['turn', 125, 11], // tight left, almost a hairpin
  ['straight', 30],
  ['finish'],
]

function buildTrack() {
  const t = new Turtle()

  for (const [cmd, a, b] of COURSE) {
    if (cmd === 'start') t.markStart()
    else if (cmd === 'finish') t.markFinish()
    else if (cmd === 'checkpoint') t.checkpoint()
    else if (cmd === 'straight') t.straight(a)
    else if (cmd === 'ramp') t.ramp(a, b)
    else if (cmd === 'turn') t.turn(a, b)
  }

  return {
    id: 'stadium-sprint-1',
    name: 'Stadium Sprint',
    roadWidth: ROAD_WIDTH,
    roadThick: ROAD_THICK,
    tiles: t.tiles,
    checkpoints: t.checkpoints,
    start: t.start,
    finish: t.finish,
    // target times in ms. Beat "author" and you have truly mastered it.
    medals: {
      author: 26000,
      gold: 29000,
      silver: 33000,
      bronze: 40000,
    },
  }
}

export const TRACK = buildTrack()
export const CHECKPOINT_COUNT = TRACK.checkpoints.length
