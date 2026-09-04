// Where is the car, relative to the road?
//
// The physics only knows "am I on something solid". This answers the other
// question — how far across the road am I, and am I out on the kerb — which is
// what lets the car rumble over the edge instead of the kerbs being paint.
//
// A uniform grid over the tiles, built once. Lookup checks the 3x3 cells around
// a point, so it's a handful of dot products per frame rather than a scan.
import { TRACK } from './track.js'

const CELL = 25 // metres
export const KERB_WIDTH = 1.6 // must match trackVisuals

const grid = new Map()
const key = (cx, cz) => cx + '|' + cz

function add(cx, cz, index) {
  const k = key(cx, cz)
  let list = grid.get(k)
  if (!list) grid.set(k, (list = []))
  list.push(index)
}

TRACK.tiles.forEach((tile, i) => {
  // a tile can straddle cells, so register both ends and the middle
  const len = tile.size[2]
  const yaw = tile.rot[1]
  const dx = Math.sin(yaw)
  const dz = Math.cos(yaw)
  for (const f of [-0.5, 0, 0.5]) {
    const x = tile.pos[0] + dx * len * f
    const z = tile.pos[2] + dz * len * f
    add(Math.floor(x / CELL), Math.floor(z / CELL), i)
  }
})

const HALF = TRACK.roadWidth / 2

// Returns { lateral, alongFrac, tile, onKerb, offRoad } or null if nowhere near
// the road. `lateral` is signed: positive towards the car's left (+X at yaw 0),
// matching the `right` vector used in Car.jsx.
export function sampleTrack(x, z) {
  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  let best = null
  let bestLat = Infinity
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const list = grid.get(key(cx + a, cz + b))
      if (!list) continue
      for (const i of list) {
        const tile = TRACK.tiles[i]
        const yaw = tile.rot[1]
        const ox = x - tile.pos[0]
        const oz = z - tile.pos[2]
        const along = ox * Math.sin(yaw) + oz * Math.cos(yaw)
        const half = tile.size[2] / 2
        if (along < -half - 0.5 || along > half + 0.5) continue
        const lateral = ox * Math.cos(yaw) - oz * Math.sin(yaw)
        if (Math.abs(lateral) < Math.abs(bestLat)) {
          bestLat = lateral
          best = { tile, index: i, along, alongFrac: along / half }
        }
      }
    }
  }
  if (!best) return null
  const abs = Math.abs(bestLat)
  return {
    ...best,
    lateral: bestLat,
    onKerb: abs > HALF - KERB_WIDTH && abs <= HALF + 0.3,
    offRoad: abs > HALF + 0.3,
  }
}
