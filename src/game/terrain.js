// Rolling ground for themes that ask for it (`terrain` in themes.js).
//
// The circuit and everything built beside it (stands, sheds, masts) were laid
// out on a flat plane, and the physics floor is flat, so the ground stays level
// out to `flat` metres past the circuit's bounding circle. Beyond that it rises
// into low hills. It is scenery only: nothing drives on the slopes.
import { BOUNDS, GROUND_Y } from './trackVisuals.js'
import { THEME } from './themes.js'

const T = THEME.terrain || null
const [cx, , cz] = BOUNDS.center

const hash = (x, z) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const fade = (t) => t * t * (3 - 2 * t)
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z)
  const u = fade(x - xi), v = fade(z - zi)
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const fbm = (x, z) => (noise(x, z) * 0.55 + noise(x * 2.1 + 9, z * 2.1 + 4) * 0.3 + noise(x * 4.7 + 3, z * 4.7 + 17) * 0.15)
const smooth = (a, b, x) => fade(Math.min(1, Math.max(0, (x - a) / (b - a))))

export const HAS_TERRAIN = !!T

// Height above the flat ground plane at a world position.
export function terrainHeight(x, z) {
  if (!T) return 0
  const d = Math.hypot(x - cx, z - cz) - BOUNDS.radius
  const near = smooth(T.flat, T.flat + T.rise, d)
  const far = smooth(T.flat + T.rise * 0.6, T.flat + T.rise * 3.2, d)
  const n = fbm(x / T.scale, z / T.scale)
  const n2 = fbm(x / (T.scale * 3.1) + 40, z / (T.scale * 3.1) + 7)
  return near * (T.lift + T.roll * n) + far * T.hills * n2
}

// World y of the ground surface at a position.
export const groundY = (x, z) => GROUND_Y + terrainHeight(x, z)
