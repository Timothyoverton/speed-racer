// Ghost = a recording of the car's transform over time for the current PB run.
//
// Phase 1 records transform keyframes (position + quaternion), which always plays
// back cleanly regardless of physics determinism. Phase 2 will additionally
// record the raw input stream so the server can re-simulate and verify a time.

const KEY = (trackId) => `speed-racer:ghost:${trackId}`
const SAMPLE_MS = 20 // 50 Hz

// The ghost frames for the current race (null = no PB recorded yet). Set by the
// Race orchestrator on mount; read by Car (for the live delta) and Ghost.
export const activeGhost = { frames: null }

export class GhostRecorder {
  constructor() {
    this.frames = []
    this._lastT = -Infinity
  }

  sample(timeMs, pos, quat) {
    if (timeMs - this._lastT < SAMPLE_MS) return
    this._lastT = timeMs
    this.frames.push([
      Math.round(timeMs),
      round(pos.x),
      round(pos.y),
      round(pos.z),
      round(quat.x, 4),
      round(quat.y, 4),
      round(quat.z, 4),
      round(quat.w, 4),
    ])
  }

  save(trackId) {
    try {
      localStorage.setItem(KEY(trackId), JSON.stringify(this.frames))
    } catch {
      /* ignore */
    }
  }
}

function round(n, dp = 2) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

export function loadGhost(trackId) {
  try {
    const raw = localStorage.getItem(KEY(trackId))
    if (!raw) return null
    const frames = JSON.parse(raw)
    return Array.isArray(frames) && frames.length > 1 ? frames : null
  } catch {
    return null
  }
}

// Interpolate a ghost recording to an arbitrary time. Returns { pos:[x,y,z],
// quat:[x,y,z,w], done } or null before the first frame.
export function sampleGhost(frames, timeMs) {
  if (!frames || frames.length === 0) return null
  if (timeMs <= frames[0][0]) {
    const f = frames[0]
    return { pos: [f[1], f[2], f[3]], quat: [f[4], f[5], f[6], f[7]], done: false }
  }
  const last = frames[frames.length - 1]
  if (timeMs >= last[0]) {
    return { pos: [last[1], last[2], last[3]], quat: [last[4], last[5], last[6], last[7]], done: true }
  }
  // binary search for the frame pair straddling timeMs
  let lo = 0
  let hi = frames.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (frames[mid][0] <= timeMs) lo = mid
    else hi = mid
  }
  const a = frames[lo]
  const b = frames[hi]
  const t = (timeMs - a[0]) / (b[0] - a[0] || 1)
  return {
    pos: [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)],
    quat: slerp([a[4], a[5], a[6], a[7]], [b[4], b[5], b[6], b[7]], t),
    done: false,
  }
}

// distance (in ms) the ghost is ahead/behind: find the ghost time at which it
// was closest to the player's current position -> compare to player's clock.
export function ghostTimeAtPosition(frames, px, pz) {
  if (!frames) return null
  let bestT = 0
  let bestD = Infinity
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const dx = f[1] - px
    const dz = f[3] - pz
    const d = dx * dx + dz * dz
    if (d < bestD) {
      bestD = d
      bestT = f[0]
    }
  }
  return bestT
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  let bx = b[0]
  let by = b[1]
  let bz = b[2]
  let bw = b[3]
  if (dot < 0) {
    dot = -dot
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
  }
  if (dot > 0.9995) {
    return normalize([
      lerp(a[0], bx, t),
      lerp(a[1], by, t),
      lerp(a[2], bz, t),
      lerp(a[3], bw, t),
    ])
  }
  const theta0 = Math.acos(dot)
  const theta = theta0 * t
  const s0 = Math.cos(theta) - (dot * Math.sin(theta)) / Math.sin(theta0)
  const s1 = Math.sin(theta) / Math.sin(theta0)
  return [
    a[0] * s0 + bx * s1,
    a[1] * s0 + by * s1,
    a[2] * s0 + bz * s1,
    a[3] * s0 + bw * s1,
  ]
}

function normalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len]
}
