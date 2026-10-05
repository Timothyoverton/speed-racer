// The player's car. Procedural — no GLTF. Nose points along local +Z, the same
// axis Car.jsx uses as forward (`(0, 0, 1)` through the body quaternion).
//
// The shell is a lofted tub: narrow nose, open-wheel flanks, a dipped cockpit,
// wide sidepods and a coke-bottle tail. Wings, the diffuser and the wishbones
// are merged by material so the whole car stays a handful of draw calls.
// Boost flames hang off the four pipes and only exist on the live car. They
// read `carState.nos` (the driver boost); nothing here writes gameplay state.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { carState } from '../game/carState.js'

const WHEEL_R = 0.42
const TRACK_HALF = 0.95 // tub stays inboard of this, so the wheels stand clear
const WHEELBASE_F = 1.48
const WHEELBASE_R = -1.42
const WHEEL_Y = -0.16 // contact patch at -0.58, just under the collider

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _up = new THREE.Vector3(0, 1, 0)

// Plan-view stations, nose (high z) to tail. `side` is the shoulder height,
// `spine` the centreline — a spine below the shoulder is the cockpit opening,
// a spine well above it is the airbox. Width and height each move once, so the
// loft stays a clean coke-bottle instead of a rippled shell.
const KEYS = [
  { z: 2.18, w: 0.035, floor: -0.38, side: -0.3, spine: -0.28 },
  { z: 1.7, w: 0.12, floor: -0.43, side: -0.12, spine: -0.08 },
  { z: 1.28, w: 0.16, floor: -0.47, side: 0.0, spine: 0.04 },
  { z: 0.92, w: 0.26, floor: -0.48, side: 0.09, spine: 0.07 },
  { z: 0.42, w: 0.34, floor: -0.48, side: 0.11, spine: -0.02 },
  { z: 0.05, w: 0.4, floor: -0.49, side: 0.06, spine: 0.04 },
  { z: -0.22, w: 0.5, floor: -0.5, side: 0.0, spine: 0.1 },
  { z: -0.5, w: 0.6, floor: -0.5, side: -0.05, spine: 0.18 },
  { z: -0.85, w: 0.6, floor: -0.5, side: -0.07, spine: 0.26 },
  { z: -1.18, w: 0.4, floor: -0.48, side: -0.05, spine: 0.12 },
  { z: -1.6, w: 0.22, floor: -0.45, side: -0.1, spine: 0.0 },
  { z: -2.08, w: 0.12, floor: -0.4, side: -0.18, spine: -0.12 },
]

function sampleKey(z) {
  if (z >= KEYS[0].z) return KEYS[0]
  const last = KEYS.length - 1
  if (z <= KEYS[last].z) return KEYS[last]
  let i = 0
  while (i < last - 1 && !(z <= KEYS[i].z && z >= KEYS[i + 1].z)) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const t = (a.z - z) / (a.z - b.z)
  const s = t * t * (3 - 2 * t)
  const mix = (pa, pb) => pa + (pb - pa) * s
  const floor = mix(a.floor, b.floor)
  return {
    z,
    w: mix(a.w, b.w),
    floor,
    side: Math.max(floor + 0.03, mix(a.side, b.side)),
    spine: Math.max(floor + 0.02, mix(a.spine, b.spine)),
  }
}

// One half-outline, bottom centre → shoulder → spine. X is a fixed fraction of
// the station width, so the planform can't wobble between stations; only the
// heights move. A spine below the shoulder dips the cockpit.
function sectionPoints(k) {
  const w = Math.max(0.008, k.w)
  const { floor, side, spine } = k
  const rise = spine - side
  const wall = side - floor
  return [
    [0, floor],
    [w * 0.42, floor + 0.012],
    [w * 0.82, floor + 0.03],
    [w, floor + wall * 0.3],
    [w * 0.99, floor + wall * 0.66],
    [w * 0.94, side],
    [w * 0.58, side + rise * 0.32],
    [w * 0.3, side + rise * 0.66],
    [w * 0.1, side + rise * 0.9],
    [0, spine],
  ]
}

// Upper surface at a plan point, walking the outline from the spine down so a
// stripe lands on the deck and not on the floor.
function surfaceY(z, x) {
  const key = sampleKey(z)
  const pts = sectionPoints(key)
  const ax = Math.abs(x)
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i]
    const b = pts[i + 1]
    const lo = Math.min(a[0], b[0])
    const hi = Math.max(a[0], b[0])
    if (hi - lo < 1e-5) continue
    if (ax < lo - 1e-4 || ax > hi + 1e-4) continue
    const t = (ax - a[0]) / (b[0] - a[0])
    return a[1] + (b[1] - a[1]) * t
  }
  return key.spine
}

function pose(geo, pos, rot) {
  _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0)
  _q.setFromEuler(_e)
  _v.set(pos[0], pos[1], pos[2])
  geo.applyMatrix4(_m.compose(_v, _q, _up.clone().set(1, 1, 1)))
  return geo
}

function withColor(geo, color) {
  const c = color.isColor ? color : new THREE.Color(color)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

function ensureUv(geo) {
  if (!geo.attributes.uv) {
    const n = geo.attributes.position.count
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
  }
  return geo
}

function merge(geos) {
  const list = geos.filter(Boolean)
  const g = mergeGeometries(list, false)
  if (!g) throw new Error('car geometry merge failed')
  for (const x of list) x.dispose()
  return g
}

function box(size, pos, rot) {
  return pose(new THREE.BoxGeometry(size[0], size[1], size[2]), pos, rot || [0, 0, 0])
}

function strut(a, b, radius) {
  _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = _v.length()
  if (len < 1e-4) return null
  const g = new THREE.CylinderGeometry(radius, radius, len, 6)
  _q.setFromUnitVectors(_up, _v.multiplyScalar(1 / len))
  _v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
  g.applyMatrix4(_m.compose(_v, _q, _up.clone().set(1, 1, 1)))
  return g
}

function luminance(hex) {
  const c = new THREE.Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

// Light paint gets a dark stripe, dark paint a white one, so every swatch
// still reads as that car's colour with a contrasting livery.
function stripeColor(hex) {
  return luminance(hex) > 0.62 ? '#141820' : '#f3f6fb'
}

function buildShell(hex) {
  const base = new THREE.Color(hex)
  const deep = base.clone().multiplyScalar(0.34)
  const samples = []
  for (let z = 2.16; z >= -2.06 - 1e-6; z -= 0.05) samples.push(sampleKey(z))
  const halfN = sectionPoints(samples[0]).length
  const ringN = halfN * 2 - 2
  const positions = []
  const colors = []
  const rings = []

  for (const key of samples) {
    const half = sectionPoints(key)
    const ring = []
    const push = (x, y) => {
      ring.push(positions.length / 3)
      positions.push(x, y, key.z)
      // Floor only. A flank tint reads as a hard seam where the sidepods start.
      const onFloor = y < key.floor + 0.055
      const c = onFloor ? deep : base
      colors.push(c.r, c.g, c.b)
    }
    for (let i = 0; i < half.length; i++) push(half[i][0], half[i][1])
    for (let i = half.length - 2; i >= 1; i--) push(-half[i][0], half[i][1])
    rings.push(ring)
  }

  const idx = []
  const tri = (a, b, c) => {
    const ax = positions[a * 3]
    const ay = positions[a * 3 + 1]
    const az = positions[a * 3 + 2]
    const bx = positions[b * 3] - ax
    const by = positions[b * 3 + 1] - ay
    const bz = positions[b * 3 + 2] - az
    const cx = positions[c * 3] - ax
    const cy = positions[c * 3 + 1] - ay
    const cz = positions[c * 3 + 2] - az
    const crx = by * cz - bz * cy
    const cry = bz * cx - bx * cz
    const crz = bx * cy - by * cx
    if (crx * crx + cry * cry + crz * crz < 1e-12) return
    idx.push(a, b, c)
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i]
    const r1 = rings[i + 1]
    for (let j = 0; j < ringN; j++) {
      const j2 = (j + 1) % ringN
      const a = r0[j]
      const b = r0[j2]
      const c = r1[j]
      const d = r1[j2]
      // Ring order is CCW looking toward -Z, so this diagonal faces outward.
      tri(a, d, b)
      tri(a, c, d)
    }
  }
  const cap = (ring, nose) => {
    let cx = 0
    let cy = 0
    let cz = 0
    for (const vi of ring) {
      cx += positions[vi * 3]
      cy += positions[vi * 3 + 1]
      cz += positions[vi * 3 + 2]
    }
    cx /= ring.length
    cy /= ring.length
    cz /= ring.length
    const ci = positions.length / 3
    positions.push(cx, cy, cz)
    colors.push(base.r, base.g, base.b)
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j]
      const b = ring[(j + 1) % ring.length]
      if (nose) tri(ci, a, b)
      else tri(ci, b, a)
    }
  }
  cap(rings[0], true)
  cap(rings[rings.length - 1], false)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()

  // Widest vertex of a mid station should point outward. If it doesn't, the
  // shell was wound inside-out.
  const mid = rings[Math.floor(rings.length / 2)]
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  let best = mid[0]
  let bestX = -1
  for (const vi of mid) {
    const x = Math.abs(pos.getX(vi))
    if (x > bestX) {
      bestX = x
      best = vi
    }
  }
  if (nor.getX(best) * pos.getX(best) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]
      idx[i + 1] = idx[i + 2]
      idx[i + 2] = t
    }
    geo.setIndex(idx)
    geo.computeVertexNormals()
  }
  return ensureUv(geo)
}

function buildCanopy() {
  const zFront = 0.92
  const zBack = -0.36
  const segZ = 20
  const segX = 16
  const verts = []
  const idx = []
  const rowOf = (iz) => {
    const u = iz / segZ
    const z = zFront + (zBack - zFront) * u
    const env = Math.sin(Math.PI * u) ** 0.72
    const hw = 0.045 + 0.25 * env
    const rise = 0.03 + 0.25 * env
    const ids = []
    for (let ix = 0; ix <= segX; ix++) {
      const v = (ix / segX - 0.5) * 2
      const arch = Math.sqrt(Math.max(0, 1 - v * v))
      ids.push(verts.length / 3)
      verts.push(v * hw, 0.05 + rise * Math.pow(arch, 0.7), z)
    }
    return ids
  }
  let prev = rowOf(0)
  for (let iz = 1; iz <= segZ; iz++) {
    const cur = rowOf(iz)
    for (let ix = 0; ix < segX; ix++) {
      const a = prev[ix]
      const b = prev[ix + 1]
      const c = cur[ix]
      const d = cur[ix + 1]
      idx.push(a, c, d, a, d, b)
    }
    prev = cur
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  let crown = 0
  let crownY = -Infinity
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) < 0.03 && pos.getY(i) > crownY) {
      crownY = pos.getY(i)
      crown = i
    }
  }
  if (nor.getY(crown) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]
      idx[i + 1] = idx[i + 2]
      idx[i + 2] = t
    }
    geo.setIndex(idx)
    geo.computeVertexNormals()
  }
  return geo
}

function buildHelmet(hex) {
  const g = new THREE.SphereGeometry(0.15, 22, 16)
  const base = new THREE.Color('#f4f1ea')
  const band = new THREE.Color(hex)
  const pos = g.attributes.position
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const c = y > 0.01 && y < 0.055 ? band : base
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

// A strip laid on the deck. One mesh, so the stripe follows the loft instead of
// a chain of tilted boxes.
function ribbon(z0, z1, xAt, halfWAt) {
  const steps = Math.max(4, Math.ceil(Math.abs(z1 - z0) / 0.05))
  const hwOf = typeof halfWAt === 'function' ? halfWAt : () => halfWAt
  const verts = []
  const idx = []
  for (let i = 0; i <= steps; i++) {
    const z = z0 + ((z1 - z0) * i) / steps
    const x = xAt(z)
    const hw = Math.max(0.008, hwOf(z))
    const y = surfaceY(z, x) + 0.018
    const base = verts.length / 3
    verts.push(x - hw, y, z, x + hw, y, z)
    if (i > 0) {
      const a = base - 2
      const b = base - 1
      const c = base
      const d = base + 1
      idx.push(a, b, c, b, d, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return ensureUv(geo)
}

function buildLivery() {
  const noseW = (z) => Math.min(0.05, sampleKey(z).w * 0.62)
  const engineX = (sign) => (z) => {
    const w = sampleKey(z).w
    return sign * Math.min(0.12, Math.max(0.028, w * 0.32))
  }
  const parts = [
    ribbon(2.02, 1.15, () => 0, noseW),
    ribbon(-0.28, -1.7, engineX(1), 0.028),
    ribbon(-0.28, -1.7, engineX(-1), 0.028),
    box([0.012, 0.045, 0.34], [0.748, 0.46, -1.88]),
    box([0.012, 0.045, 0.34], [-0.748, 0.46, -1.88]),
    box([0.012, 0.035, 0.28], [0.72, -0.32, 2.0]),
    box([0.012, 0.035, 0.28], [-0.72, -0.32, 2.0]),
    box([0.01, 0.06, 0.7], [0.645, -0.24, -0.55]),
    box([0.01, 0.06, 0.7], [-0.645, -0.24, -0.55]),
  ]
  return merge(parts)
}

function buildPaintExtras(hex) {
  const c = new THREE.Color(hex)
  // Rear wing is the slab the chase camera stares at, so it wears the paint.
  // Front flap too — the main plane stays carbon so the nose stays sharp.
  const specs = [
    [[1.46, 0.036, 0.32], [0, 0.4, -1.84], [0.2, 0, 0]],
    [[1.38, 0.026, 0.15], [0, 0.29, -1.96], [0.36, 0, 0]],
    [[1.28, 0.022, 0.14], [0, -0.34, 2.1], [-0.2, 0, 0]],
  ]
  return specs.map(([s, p, r]) => withColor(box(s, p, r), c))
}

function buildCarbon() {
  const parts = []
  const add = (size, pos, rot) => parts.push(box(size, pos, rot))
  // Front wing: centre plane, drooped tips, endplates, pylons down from the nose.
  add([0.62, 0.026, 0.34], [0, -0.4, 2.0], [-0.06, 0, 0])
  add([0.4, 0.024, 0.3], [0.5, -0.43, 2.0], [-0.06, 0, 0.1])
  add([0.4, 0.024, 0.3], [-0.5, -0.43, 2.0], [-0.06, 0, -0.1])
  add([0.03, 0.2, 0.4], [0.73, -0.36, 2.02])
  add([0.03, 0.2, 0.4], [-0.73, -0.36, 2.02])
  parts.push(strut([0.07, -0.28, 1.78], [0.07, -0.4, 1.98], 0.014))
  parts.push(strut([-0.07, -0.28, 1.78], [-0.07, -0.4, 1.98], 0.014))
  // Splitter and floor edges.
  add([0.7, 0.03, 0.36], [0, -0.46, 1.7])
  add([0.045, 0.07, 1.7], [0.7, -0.47, -0.35])
  add([0.045, 0.07, 1.7], [-0.7, -0.47, -0.35])
  // Low bargeboards. A tall plate covers the flank and reads as a black hole.
  add([0.016, 0.1, 0.2], [0.34, -0.38, 0.7], [0, 0.3, 0])
  add([0.016, 0.1, 0.2], [-0.34, -0.38, 0.7], [0, -0.3, 0])
  // Halo: two legs, a brow, a forward pillar.
  add([0.03, 0.22, 0.03], [-0.22, 0.16, 0.32])
  add([0.03, 0.22, 0.03], [0.22, 0.16, 0.32])
  add([0.48, 0.03, 0.03], [0, 0.27, 0.3])
  add([0.03, 0.16, 0.03], [0, 0.18, 0.5], [0.45, 0, 0])
  // Headrest and shark fin back to the wing.
  add([0.22, 0.16, 0.1], [0, 0.1, -0.18], [0.15, 0, 0])
  add([0.02, 0.26, 0.85], [0, 0.24, -1.2])
  // Mirror stalks.
  add([0.2, 0.016, 0.02], [0.3, 0.12, 0.48], [0, 0, 0.4])
  add([0.2, 0.016, 0.02], [-0.3, 0.12, 0.48], [0, 0, -0.4])
  // Diffuser, kicked up toward the camera, with strakes.
  add([1.32, 0.026, 0.82], [0, -0.43, -1.76], [0.22, 0, 0])
  for (const x of [-0.5, -0.28, -0.08, 0.08, 0.28, 0.5]) {
    add([0.02, 0.13, 0.72], [x, -0.37, -1.76], [0.22, 0, 0])
  }
  // Bulkhead the pipes pass through, and the rear-wing endplates + swan necks.
  add([1.05, 0.14, 0.08], [0, -0.3, -1.88])
  add([0.022, 0.2, 0.34], [0.74, 0.36, -1.88])
  add([0.022, 0.2, 0.34], [-0.74, 0.36, -1.88])
  parts.push(strut([0.2, 0.06, -1.48], [0.2, 0.38, -1.8], 0.016))
  parts.push(strut([-0.2, 0.06, -1.48], [-0.2, 0.38, -1.8], 0.016))
  parts.push(strut([0, 0.02, -1.55], [0, 0.36, -1.82], 0.018))
  return merge(parts)
}

function buildArms() {
  const parts = []
  const side = (sign, z, tubX, hubX) => {
    const s = sign
    parts.push(strut([s * tubX, -0.04, z + 0.12], [s * hubX, -0.1, z + 0.08], 0.016))
    parts.push(strut([s * tubX, -0.04, z - 0.12], [s * hubX, -0.1, z - 0.06], 0.016))
    parts.push(strut([s * (tubX - 0.02), -0.32, z + 0.1], [s * hubX, -0.22, z + 0.05], 0.016))
    parts.push(strut([s * (tubX - 0.02), -0.32, z - 0.12], [s * hubX, -0.22, z - 0.08], 0.016))
    parts.push(strut([s * tubX, 0.02, z], [s * (hubX - 0.04), -0.06, z], 0.011))
  }
  side(1, WHEELBASE_F, 0.2, 0.78)
  side(-1, WHEELBASE_F, 0.2, 0.78)
  side(1, WHEELBASE_R, 0.28, 0.78)
  side(-1, WHEELBASE_R, 0.28, 0.78)
  return merge(parts)
}

function buildPit() {
  return merge([
    // Flank slots at the widest station, and inlet mouths on the deck. Both
    // sit on the shell — a slot further forward floats off the narrow tub.
    box([0.04, 0.12, 0.16], [0.625, -0.24, -0.72]),
    box([0.04, 0.12, 0.16], [-0.625, -0.24, -0.72]),
    box([0.14, 0.018, 0.16], [0.3, 0.015, -0.48]),
    box([0.14, 0.018, 0.16], [-0.3, 0.015, -0.48]),
    box([0.14, 0.08, 0.06], [0, 0.14, -0.48]),
    box([0.32, 0.04, 0.42], [0, -0.01, 0.28]),
    box([0.28, 0.07, 0.18], [0, 0.02, 0.22]),
    // Dark throat in each pipe so the tip reads as a hole.
    ...[-0.46, -0.17, 0.17, 0.46].map((x) =>
      pose(new THREE.CylinderGeometry(0.07, 0.05, 0.16, 10), [x, -0.26, -2.12], [Math.PI / 2, 0, 0]),
    ),
  ])
}

function buildPipes() {
  const parts = []
  for (const x of [-0.46, -0.17, 0.17, 0.46]) {
    parts.push(pose(new THREE.CylinderGeometry(0.105, 0.115, 0.42, 14), [x, -0.26, -2.02], [Math.PI / 2, 0, 0]))
    const flange = new THREE.TorusGeometry(0.1, 0.012, 6, 14)
    flange.translate(x, -0.26, -2.22)
    parts.push(flange)
  }
  return merge(parts)
}

function buildTips() {
  return merge(
    [-0.46, -0.17, 0.17, 0.46].map((x) =>
      pose(new THREE.CylinderGeometry(0.082, 0.082, 0.06, 12), [x, -0.26, -2.21], [Math.PI / 2, 0, 0]),
    ),
  )
}

function buildLights(kind) {
  if (kind === 'head') {
    return merge([
      box([0.1, 0.028, 0.02], [0, -0.32, 2.18]),
      box([0.02, 0.045, 0.05], [0.72, -0.34, 2.08]),
      box([0.02, 0.045, 0.05], [-0.72, -0.34, 2.08]),
    ])
  }
  // On the wing endplates and the cover. A bar at pipe height draws through the exhausts.
  return merge([
    box([0.04, 0.026, 0.014], [0.74, 0.3, -2.055]),
    box([0.04, 0.026, 0.014], [-0.74, 0.3, -2.055]),
    box([0.045, 0.036, 0.014], [0, 0.2, -1.58]),
  ])
}

function buildTyre() {
  const profile = [
    new THREE.Vector2(0.2, -0.175),
    new THREE.Vector2(0.34, -0.175),
    new THREE.Vector2(0.4, -0.145),
    new THREE.Vector2(WHEEL_R, -0.07),
    new THREE.Vector2(WHEEL_R, 0.07),
    new THREE.Vector2(0.4, 0.145),
    new THREE.Vector2(0.34, 0.175),
    new THREE.Vector2(0.2, 0.175),
  ]
  const tyre = new THREE.LatheGeometry(profile, 28)
  tyre.rotateZ(Math.PI / 2)
  return tyre
}

function buildRim() {
  const parts = []
  // Torus lip, not a capped cylinder — a cap reads as a solid hubcap and hides
  // the spokes.
  const lip = new THREE.TorusGeometry(0.3, 0.016, 8, 28)
  lip.rotateY(Math.PI / 2)
  lip.translate(0.172, 0, 0)
  parts.push(lip)
  const hoop = new THREE.TorusGeometry(0.26, 0.01, 6, 24)
  hoop.rotateY(Math.PI / 2)
  hoop.translate(0.12, 0, 0)
  parts.push(hoop)
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.BoxGeometry(0.046, 0.2, 0.026)
    spoke.translate(0, 0.14, 0)
    spoke.rotateX((i / 5) * Math.PI * 2)
    spoke.translate(0.15, 0, 0)
    parts.push(spoke)
  }
  const hub = new THREE.CylinderGeometry(0.05, 0.055, 0.036, 12, 1, true)
  hub.rotateZ(Math.PI / 2)
  hub.translate(0.155, 0, 0)
  parts.push(hub)
  const nut = new THREE.CylinderGeometry(0.026, 0.028, 0.018, 6)
  nut.rotateZ(Math.PI / 2)
  nut.translate(0.178, 0, 0)
  parts.push(nut)
  return merge(parts)
}

function buildDisc() {
  const g = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20)
  g.rotateZ(Math.PI / 2)
  g.translate(0.03, 0, 0)
  return g
}

function buildBlur() {
  const g = new THREE.CylinderGeometry(0.3, 0.3, 0.01, 24)
  g.rotateZ(Math.PI / 2)
  g.translate(0.17, 0, 0)
  return g
}

function useCarGeometry(color) {
  return useMemo(() => {
    const shell = buildShell(color)
    const body = merge([shell, ...buildPaintExtras(color)])
    return {
      body,
      canopy: buildCanopy(),
      helmet: buildHelmet(color),
      visor: new THREE.SphereGeometry(0.105, 16, 12),
      livery: buildLivery(),
      carbon: buildCarbon(),
      arms: buildArms(),
      pit: buildPit(),
      pipes: buildPipes(),
      tips: buildTips(),
      head: buildLights('head'),
      tail: buildLights('tail'),
      tyre: buildTyre(),
      rim: buildRim(),
      disc: buildDisc(),
      blur: buildBlur(),
    }
  }, [color])
}

function useMaterials(ghost, color) {
  return useMemo(() => {
    const g = (c, o) =>
      new THREE.MeshStandardMaterial({
        color: c,
        emissive: c,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: o,
        depthWrite: false,
        roughness: 0.4,
      })
    if (ghost) {
      return {
        paint: g('#6cf0c4', 0.26),
        carbon: g('#4fd8ae', 0.2),
        pit: g('#4fd8ae', 0.16),
        livery: g('#8ffbd8', 0.18),
        glass: g('#8ffbd8', 0.14),
        helmet: g('#8ffbd8', 0.18),
        visor: g('#8ffbd8', 0.12),
        head: g('#c8fff0', 0.3),
        tail: g('#8ffbd8', 0.3),
        exhaust: g('#8ffbd8', 0.16),
        tyre: g('#3ad39f', 0.22),
        rim: g('#8ffbd8', 0.24),
        disc: g('#8ffbd8', 0.2),
        blur: g('#8ffbd8', 0),
        caliper: g('#8ffbd8', 0.16),
        ghost: true,
      }
    }
    const stripe = stripeColor(color)
    return {
      // Vertex colours carry the swatch (and a darker floor). Albedo stays
      // white here so clearcoat tuning matches a flat paint colour of `color`.
      // Horizontal dark panels wash out against this sky — carbon and the
      // canopy stay rough on purpose. If the sky changes, recheck the rear
      // wing and the canopy from the chase camera.
      paint: new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        vertexColors: true,
        metalness: 0.45,
        roughness: 0.42,
        clearcoat: 0.85,
        clearcoatRoughness: 0.32,
        envMapIntensity: 0.5,
      }),
      carbon: new THREE.MeshPhysicalMaterial({
        color: '#171a20',
        metalness: 0.28,
        roughness: 0.7,
        clearcoat: 0.3,
        clearcoatRoughness: 0.4,
        envMapIntensity: 0.38,
      }),
      pit: new THREE.MeshStandardMaterial({
        color: '#07080c',
        metalness: 0.05,
        roughness: 0.92,
        envMapIntensity: 0.08,
      }),
      livery: new THREE.MeshPhysicalMaterial({
        color: stripe,
        metalness: 0.2,
        roughness: 0.4,
        clearcoat: 0.75,
        clearcoatRoughness: 0.2,
        envMapIntensity: 0.55,
        side: THREE.DoubleSide,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: '#163044',
        metalness: 0,
        roughness: 0.12,
        transparent: true,
        opacity: 0.42,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.25,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      helmet: new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        vertexColors: true,
        metalness: 0.12,
        roughness: 0.32,
        clearcoat: 0.75,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.5,
      }),
      visor: new THREE.MeshPhysicalMaterial({
        color: '#070b12',
        metalness: 0.7,
        roughness: 0.12,
        envMapIntensity: 0.7,
      }),
      exhaust: new THREE.MeshStandardMaterial({
        color: '#12141a',
        emissive: '#3d8bff',
        emissiveIntensity: 0,
        metalness: 0.65,
        roughness: 0.45,
      }),
      caliper: new THREE.MeshStandardMaterial({
        color: '#d23b32',
        metalness: 0.45,
        roughness: 0.42,
      }),
      tyre: new THREE.MeshStandardMaterial({
        color: '#121318',
        roughness: 0.92,
        metalness: 0,
      }),
      rim: new THREE.MeshStandardMaterial({
        color: '#d5dbe6',
        metalness: 1,
        roughness: 0.16,
        envMapIntensity: 2.1,
      }),
      head: new THREE.MeshStandardMaterial({
        color: '#eaf4ff',
        emissive: '#d5e9ff',
        emissiveIntensity: 2.1,
        roughness: 0.2,
      }),
      tail: new THREE.MeshStandardMaterial({
        color: '#3a0a10',
        emissive: '#ff2233',
        emissiveIntensity: 0.9,
        roughness: 0.3,
      }),
      blur: new THREE.MeshStandardMaterial({
        color: '#8f97a5',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        roughness: 0.5,
        metalness: 0.6,
      }),
      disc: new THREE.MeshStandardMaterial({
        color: '#3a3d44',
        emissive: '#ff3300',
        emissiveIntensity: 0,
        metalness: 0.8,
        roughness: 0.5,
      }),
      ghost: false,
    }
  }, [ghost, color])
}

function Wheel({ geo, mat, position, steerRef, spinRef, flip = false }) {
  const out = flip ? -1 : 1
  return (
    <group position={position}>
      <group ref={steerRef}>
        <mesh position={[out * 0.08, 0.15, 0.04]}>
          <boxGeometry args={[0.09, 0.15, 0.1]} />
          <primitive object={mat.caliper} attach="material" />
        </mesh>
        <group ref={spinRef} rotation={[0, flip ? Math.PI : 0, 0]}>
          <mesh geometry={geo.tyre} material={mat.tyre} castShadow />
          <mesh geometry={geo.rim} material={mat.rim} />
          <mesh geometry={geo.disc} material={mat.disc} />
          <mesh geometry={geo.blur} material={mat.blur} />
        </group>
      </group>
    </group>
  )
}

const PIPE_X = [-0.46, -0.17, 0.17, 0.46]

export default function CarModel({ ghost = false, color = '#2f6dff', live = false }) {
  const geo = useCarGeometry(color)
  const mat = useMaterials(ghost, color)

  const chassis = useRef(null)
  const attitude = useRef(null)
  const fl = useRef(null)
  const fr = useRef(null)
  const spin = [useRef(null), useRef(null), useRef(null), useRef(null)]
  const flames = [useRef(null), useRef(null), useRef(null), useRef(null)]
  const flameLevel = useRef(0)
  // One flame per pipe. A single additive cone shaded along its length instead
  // of stacked flat-coloured cones: white-blue at the nozzle, blue through the
  // body, burning to orange at the ragged tip, with shock diamonds banded
  // through the blue (the tell of a real pressurised exhaust).
  const flameGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.07, 1, 14, 1, true)
    g.translate(0, 0.5, 0) // base at the origin
    g.rotateX(-Math.PI / 2) // apex points back along -Z
    return g
  }, [])
  const flameMats = useMemo(
    () =>
      [0, 1, 2, 3].map(
        (i) =>
          new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            uniforms: { uTime: { value: 0 }, uPhase: { value: i * 1.7 } },
            vertexShader: `
              varying float vT; varying vec3 vN; varying vec3 vV;
              void main() {
                vT = clamp(-position.z, 0.0, 1.0);
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal);
                vV = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
              }`,
            fragmentShader: `
              uniform float uTime; uniform float uPhase;
              varying float vT; varying vec3 vN; varying vec3 vV;
              void main() {
                float t = vT;
                float flick = 0.82 + 0.18 * sin(uTime * 70.0 + uPhase + t * 9.0)
                                   * sin(uTime * 43.0 + uPhase * 2.0);
                // colour: hot white-blue -> saturated blue -> orange -> red at the tip
                vec3 col = mix(vec3(0.85, 0.95, 1.0), vec3(0.18, 0.42, 1.0), smoothstep(0.0, 0.3, t));
                col = mix(col, vec3(1.0, 0.55, 0.12), smoothstep(0.3, 0.65, t));
                col = mix(col, vec3(1.0, 0.16, 0.04), smoothstep(0.62, 0.95, t));
                // shock diamonds: tight bright bands in the first half
                float d = pow(0.5 + 0.5 * sin(t * 34.0 - 1.2), 5.0) * (1.0 - smoothstep(0.1, 0.65, t));
                col += vec3(0.5, 0.75, 1.0) * d * 1.2;
                // soft edges: fade where the cone turns edge-on to the camera
                float f = pow(abs(dot(normalize(vN), normalize(vV))), 0.7);
                float a = (1.0 - smoothstep(0.55, 1.0, t)) * (1.0 - 0.35 * t) * f * flick;
                gl_FragColor = vec4(col * (1.4 + 1.2 * smoothstep(0.4, 0.85, t)), clamp(a, 0.0, 1.0));
              }`,
          }),
      ),
    [],
  )
  // blue bloom around each pipe mouth
  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#3d8bff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  const flameLight = useRef(null)
  const roll = useRef(0)
  const pitch = useRef(0)
  const gPitch = useRef(0)
  const gRoll = useRef(0)

  useFrame((_, delta) => {
    if (!live) return
    const dt = Math.min(delta, 1 / 30)
    const s = carState

    const targetRoll = THREE.MathUtils.clamp(-s.lateralG * 0.055, -0.13, 0.13)
    const targetPitch = THREE.MathUtils.clamp(-s.longG * 0.02, -0.07, 0.07)
    const k = 1 - Math.exp(-9 * dt)
    roll.current = THREE.MathUtils.lerp(roll.current, targetRoll, k)
    pitch.current = THREE.MathUtils.lerp(pitch.current, targetPitch, k)
    if (chassis.current) {
      chassis.current.rotation.z = roll.current
      chassis.current.rotation.x = pitch.current
      chassis.current.position.y = -Math.abs(roll.current) * 0.12 - s.landing * 0.13
      const squash = 1 - s.landing * 0.06
      chassis.current.scale.set(1, squash, 1)
    }

    const gk = 1 - Math.exp(-12 * dt)
    gPitch.current = THREE.MathUtils.lerp(gPitch.current, s.groundPitch, gk)
    gRoll.current = THREE.MathUtils.lerp(gRoll.current, s.groundRoll, gk)
    if (attitude.current) {
      attitude.current.rotation.x = -gPitch.current
      attitude.current.rotation.z = -gRoll.current
    }

    const steerAngle = s.steer * 0.44
    if (fl.current) fl.current.rotation.y = steerAngle
    if (fr.current) fr.current.rotation.y = steerAngle

    for (const r of spin) if (r.current) r.current.rotation.x = -s.wheelSpin

    mat.disc.emissiveIntensity = THREE.MathUtils.lerp(
      mat.disc.emissiveIntensity,
      s.brake * 1.6 + (s.handbrake ? 1.1 : 0),
      1 - Math.exp(-5 * dt),
    )
    mat.tail.emissiveIntensity = 0.7 + (s.brake > 0.05 || s.handbrake ? 2.6 : 0)

    // Pipe mouths glow for any boost. The plume itself is the driver boost only.
    mat.exhaust.emissiveIntensity = THREE.MathUtils.lerp(
      mat.exhaust.emissiveIntensity,
      s.boost > 0 ? 2.4 : 0,
      1 - Math.exp(-8 * dt),
    )

    // fire out of the pipes while the driver boost is lit: lights fast, dies
    // away a touch slower, and the length breathes so it reads as a flame
    flameLevel.current = THREE.MathUtils.lerp(
      flameLevel.current,
      s.nos ? 1 : 0,
      1 - Math.exp(-(s.nos ? 22 : 10) * dt),
    )
    const fl01 = flameLevel.current
    const now = performance.now() / 1000
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i].current
      if (!f) continue
      f.visible = fl01 > 0.03
      if (f.visible) {
        flameMats[i].uniforms.uTime.value = now
        const len = fl01 * (0.95 + Math.random() * 0.4) // metres: short and fierce
        const w = 0.8 + fl01 * 0.3
        f.scale.set(w, w, len)
      }
    }
    glowMat.opacity = fl01 * (0.5 + Math.random() * 0.12)
    if (flameLight.current) flameLight.current.intensity = fl01 * (2.2 + Math.random() * 0.8)

    mat.blur.opacity = THREE.MathUtils.clamp((s.speed - 12) / 26, 0, 0.55)
  })

  return (
    <group ref={attitude}>
      <group ref={chassis}>
        <mesh name="car-body" geometry={geo.body} material={mat.paint} castShadow receiveShadow />
        <mesh geometry={geo.carbon} material={mat.carbon} castShadow />
        <mesh geometry={geo.livery} material={mat.livery} />
        <mesh geometry={geo.pit} material={mat.pit} />
        <mesh geometry={geo.canopy} material={mat.glass} />
        <mesh geometry={geo.helmet} material={mat.helmet} position={[0, 0.09, 0.2]} castShadow />
        <mesh geometry={geo.visor} material={mat.visor} position={[0, 0.1, 0.3]} scale={[1.25, 0.62, 0.42]} />
        <mesh geometry={geo.head} material={mat.head} />
        <mesh geometry={geo.tail} material={mat.tail} />
        <mesh geometry={geo.pipes} material={mat.rim} />
        <mesh geometry={geo.tips} material={mat.exhaust} />
        {PIPE_X.map((x, i) => (
          <group key={x}>
            {live && (
              <>
                <group ref={flames[i]} position={[x, -0.26, -2.22]} visible={false}>
                  <mesh geometry={flameGeo}>
                    <primitive object={flameMats[i]} attach="material" />
                  </mesh>
                </group>
                <mesh position={[x, -0.26, -2.24]}>
                  <sphereGeometry args={[0.2, 12, 8]} />
                  <primitive object={glowMat} attach="material" />
                </mesh>
              </>
            )}
          </group>
        ))}
        {live && <pointLight ref={flameLight} position={[0, -0.1, -2.7]} color="#4d8dff" intensity={0} distance={7} decay={2} />}
      </group>

      <mesh geometry={geo.arms} material={mat.carbon} />

      <Wheel geo={geo} mat={mat} position={[TRACK_HALF, WHEEL_Y, WHEELBASE_F]} steerRef={fl} spinRef={spin[0]} />
      <Wheel
        geo={geo}
        mat={mat}
        position={[-TRACK_HALF, WHEEL_Y, WHEELBASE_F]}
        steerRef={fr}
        spinRef={spin[1]}
        flip
      />
      <Wheel geo={geo} mat={mat} position={[TRACK_HALF, WHEEL_Y, WHEELBASE_R]} spinRef={spin[2]} />
      <Wheel
        geo={geo}
        mat={mat}
        position={[-TRACK_HALF, WHEEL_Y, WHEELBASE_R]}
        spinRef={spin[3]}
        flip
      />
    </group>
  )
}

export { WHEEL_R, TRACK_HALF, WHEELBASE_R }
