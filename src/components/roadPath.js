// Road-following helpers shared by the sea-life layers (FishSchool, SeaLife,
// ClamGates). Pure maths over the tile list, built once at load: a point
// described by arc length along the lap plus a lateral and vertical offset from
// the road, so anything placed with it keeps pace with the lap's curves and
// climbs and drops.
import * as THREE from 'three'
import { TRACK } from '../game/track.js'

// Same generator as Scenery.jsx, so the scene looks identical on every load.
export function rng(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const TILES = TRACK.tiles
export const LAP = TRACK.length
export const HALF = TRACK.roadWidth / 2
const RUN = TILES.map((t) => t.size[2] * Math.cos(t.pitch)) // horizontal run
const STARTS = TILES.map((t) => t.dist)

// Index of the tile whose run covers arc length q (binary search on the starts).
export function tileAt(q) {
  let lo = 0
  let hi = TILES.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (STARTS[mid] <= q) lo = mid
    else hi = mid - 1
  }
  return lo
}

// Nearest tile centre to a world point, by full 3D distance. Every tile, every
// call: a lap is a few hundred tiles, so this is cheaper than any index.
export function nearestTile(x, y, z) {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < TILES.length; i++) {
    const p = TILES[i].pos
    const dx = p[0] - x
    const dy = p[1] - y
    const dz = p[2] - z
    const d = dx * dx + dy * dy + dz * dz
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

// Point on tile i's centreline, `off` metres along it from the tile centre.
export function onTile(i, off, out) {
  const t = TILES[i]
  const yaw = t.rot[1]
  return out.set(t.pos[0] + Math.sin(yaw) * off, t.pos[1] + Math.tan(t.pitch) * off, t.pos[2] + Math.cos(yaw) * off)
}

const EDGE_A = new THREE.Vector3()
const EDGE_B = new THREE.Vector3()

// Heading at fraction f through tile i. Each tile's own heading would snap the
// lateral offset sideways at every chord joint (2m on a 40m offset through a
// corner), so blend between the heading at each joint instead.
export function yawAt(i, f) {
  const last = TILES.length - 1
  const a = i > 0 ? (TILES[i - 1].rot[1] + TILES[i].rot[1]) / 2 : TILES[i].rot[1]
  const b = i < last ? (TILES[i].rot[1] + TILES[i + 1].rot[1]) / 2 : TILES[i].rot[1]
  return a + (b - a) * f
}

// Centreline at arc length q, `lat` to the left and `up` above the road. Across a
// hole there is no tile, so this runs a straight line from the lip to the
// landing rather than carrying a take-off slope on into the air.
export function roadPoint(q, lat, up, out) {
  const i = tileAt(q)
  const end = STARTS[i] + RUN[i]
  if (q <= end || i + 1 >= TILES.length) {
    onTile(i, q - STARTS[i] - RUN[i] / 2, out)
  } else {
    onTile(i, RUN[i] / 2, EDGE_A)
    onTile(i + 1, -RUN[i + 1] / 2, EDGE_B)
    out.lerpVectors(EDGE_A, EDGE_B, (q - end) / (STARTS[i + 1] - end))
  }
  const yaw = yawAt(i, Math.min(1, Math.max(0, (q - STARTS[i]) / RUN[i])))
  out.x += Math.cos(yaw) * lat
  out.z -= Math.sin(yaw) * lat
  out.y += up
  return out
}
