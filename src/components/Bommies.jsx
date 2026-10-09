// The wall blocks of the fish pond, dressed as bommies: lumpy reef rock with
// algae on top, coral flecks and a few tufts. Visual only. Each one is built to
// sit inside the wall's own collider box (TRACK.walls size and position are what
// Track.jsx hands to Rapier), so the rock you see is the rock you hit; the only
// things that poke out are the thin tufts on top.
//
// All walls are merged into one flat-shaded mesh in world space: a single draw.
import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TRACK } from '../game/track.js'
import { THEME } from '../game/themes.js'
import { GROUND_Y } from '../game/trackVisuals.js'
import { litUnderwater } from '../game/materials.js'

function rng(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// smooth value noise in 0..1
const hash = (x, y, z, s) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453
  return h - Math.floor(h)
}
function noise3(x, y, z, s) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const fx = x - xi
  const fy = y - yi
  const fz = z - zi
  const sm = (t) => t * t * (3 - 2 * t)
  const ux = sm(fx)
  const uy = sm(fy)
  const uz = sm(fz)
  let v = 0
  for (let k = 0; k < 2; k++) {
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const w = (i ? ux : 1 - ux) * (j ? uy : 1 - uy) * (k ? uz : 1 - uz)
        v += w * hash(xi + i, yi + j, zi + k, s)
      }
    }
  }
  return v
}
const fbm = (x, y, z, s) => 0.55 * noise3(x * 0.33, y * 0.33, z * 0.33, s) + 0.3 * noise3(x * 0.8, y * 0.8, z * 0.8, s + 3) + 0.15 * noise3(x * 1.9, y * 1.9, z * 1.9, s + 7)

const PLACE = new THREE.Matrix4()
const QUAT = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

// A rough block that fills the box [-a,a] x [0,2b] x [-c,c]. Corners are eased
// off (a 4-norm squircle) and the surface pushed in and out by noise, never past
// the box. Vertex colours carry the mottling.
function rockBody(a, b, c, seed, pal, rand) {
  const g = new THREE.BoxGeometry(a * 2, b * 2, c * 2, Math.min(40, Math.ceil((a * 2) / 0.6)), Math.min(24, Math.ceil((b * 2) / 0.6)), Math.min(24, Math.ceil((c * 2) / 0.6)))
  const pos = g.attributes.position
  const col = new Float32Array(pos.count * 3)
  const c1 = new THREE.Color()
  const out = new THREE.Color()
  const base1 = new THREE.Color(pal.rock[(rand() * pal.rock.length) | 0])
  const base2 = new THREE.Color(pal.rock[(rand() * pal.rock.length) | 0])
  const algae = new THREE.Color(pal.algae[(rand() * pal.algae.length) | 0])
  const coral = new THREE.Color(pal.coral[(rand() * pal.coral.length) | 0])
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i) / a
    const uy = pos.getY(i) / b
    const uz = pos.getZ(i) / c
    const k = Math.pow(ux ** 4 + uy ** 4 + uz ** 4, 0.25) || 1
    const f = fbm(ux * a, uy * b, uz * c + seed, seed)
    const d = 0.78 + 0.22 * f
    let qx = (ux / k) * d
    let qy = (uy / k) * d
    let qz = (uz / k) * d
    if (uy < -0.99) qy = -1 // the foot stays flat on the seabed
    if (uy > 0.99) qy = 0.78 + 0.22 * fbm(ux * a, 5, uz * c, seed + 11) // lumpy crown, below the lid
    pos.setXYZ(i, qx * a, (qy + 1) * b, qz * c)

    // mottling: two greys, algae where it faces up, coral flecks, dark below
    const m = noise3(qx * a * 1.3, qy * b * 1.3, qz * c * 1.3, seed + 5)
    c1.copy(base1).lerp(base2, m)
    const hi = Math.max(0, qy)
    const algaeAmt = Math.max(0, Math.min(1, (hi - 0.15) * 1.6 + (noise3(qx * a * 0.9, 1, qz * c * 0.9, seed + 9) - 0.5) * 0.9))
    c1.lerp(algae, algaeAmt * 0.4)
    if (noise3(qx * a * 1.7, qy * b * 1.7, qz * c * 1.7, seed + 13) > 0.86) c1.lerp(coral, 0.6)
    c1.multiplyScalar(0.8 + 0.4 * noise3(qx * a * 3.1, qy * b * 3.1, qz * c * 3.1, seed + 17))
    const dark = 0.7 + 0.3 * Math.min(1, (qy + 1) * 0.7)
    out.copy(c1).multiplyScalar(dark)
    col[i * 3] = out.r
    col[i * 3 + 1] = out.g
    col[i * 3 + 2] = out.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.deleteAttribute('uv')
  return g
}

function tinted(geo, hex, scale = 1) {
  const col = new THREE.Color(hex).multiplyScalar(scale)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r
    arr[i * 3 + 1] = col.g
    arr[i * 3 + 2] = col.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  geo.deleteAttribute('uv')
  return geo
}

function buildBommies(pal) {
  const parts = []
  TRACK.walls.forEach((w, wi) => {
    const rand = rng(900 + wi * 31)
    const [ww, wh, wt] = w.size
    const a = ww / 2
    const b = wh / 2
    const c = wt / 2
    const local = []
    local.push(rockBody(a, b, c, wi * 7 + 1, pal, rand))

    // stacked boulders touching the faces of the box, so the outline is lumpy
    const lumps = 5 + ((rand() * 3) | 0)
    for (let l = 0; l < lumps; l++) {
      const r = (0.4 + rand() * 0.35) * Math.min(wt, wh)
      const g = new THREE.SphereGeometry(1, 8, 6)
      const lp = g.attributes.position
      for (let v = 0; v < lp.count; v++) {
        const k = 0.78 + 0.4 * noise3(lp.getX(v) * 1.6 + l, lp.getY(v) * 1.6, lp.getZ(v) * 1.6 + wi, 5)
        lp.setXYZ(v, lp.getX(v) * k, lp.getY(v) * k, lp.getZ(v) * k)
      }
      const sx = 1 + rand() * 0.5
      const sy = 0.7 + rand() * 0.4
      // never thicker than the wall itself, or the lump pokes out of the collider
      const sz = Math.min(1 + rand() * 0.5, (c + 0.1) / (r * 1.2))
      g.scale(r * sx, r * sy, r * sz)
      const face = rand()
      let x
      let z
      if (face < 0.4) {
        x = (rand() < 0.5 ? -1 : 1) * (a - r * sx * 0.9)
        z = (rand() - 0.5) * 2 * Math.max(0, c - r * sz)
      } else if (face < 0.8) {
        x = (rand() - 0.5) * 2 * Math.max(0, a - r * sx)
        z = (rand() < 0.5 ? -1 : 1) * (c - r * sz * 0.9)
      } else {
        x = (rand() - 0.5) * 2 * Math.max(0, a - r * sx)
        z = (rand() - 0.5) * 2 * Math.max(0, c - r * sz)
      }
      const y = Math.min(wh - r * sy * 0.9, r * sy * 0.6 + rand() * (wh - r * sy * 1.6))
      g.translate(x, Math.max(r * sy * 0.5, y), z)
      const pickc = rand()
      const hex = pickc < 0.07 ? pal.coral[(rand() * pal.coral.length) | 0] : pickc < 0.2 ? pal.algae[(rand() * pal.algae.length) | 0] : pal.rock[(rand() * pal.rock.length) | 0]
      local.push(tinted(g, hex, 0.8 + rand() * 0.35))
    }

    // tufts on the crown: coral fingers and kelp blades
    const tufts = 2 + ((rand() * 3) | 0)
    for (let t = 0; t < tufts; t++) {
      const x = (rand() - 0.5) * 2 * (a - 0.6)
      const z = (rand() - 0.5) * 2 * Math.max(0, c - 0.5)
      const y = wh * (0.8 + rand() * 0.12)
      if (rand() < 0.55) {
        const hex = pal.coral[(rand() * pal.coral.length) | 0]
        for (let f = 0; f < 3; f++) {
          const len = 0.5 + rand() * 0.55
          const g = new THREE.CylinderGeometry(0.05, 0.13, len, 5)
          g.rotateX((rand() - 0.5) * 0.7)
          g.rotateZ((rand() - 0.5) * 0.7)
          g.translate(x + (rand() - 0.5) * 0.4, y + len * 0.4, z + (rand() - 0.5) * 0.4)
          local.push(tinted(g, hex))
        }
      } else {
        const hex = pal.kelp[(rand() * pal.kelp.length) | 0]
        for (let f = 0; f < 3; f++) {
          const len = 0.7 + rand() * 0.6
          const g = new THREE.BoxGeometry(0.06, len, 0.4)
          g.rotateZ((rand() - 0.5) * 0.5)
          g.rotateY(rand() * 3)
          g.translate(x + (rand() - 0.5) * 0.4, y + len * 0.45, z + (rand() - 0.5) * 0.4)
          local.push(tinted(g, hex))
        }
      }
    }

    QUAT.setFromAxisAngle(UP, w.yaw)
    PLACE.compose(new THREE.Vector3(w.pos[0], w.pos[1], w.pos[2]), QUAT, new THREE.Vector3(1, 1, 1))
    for (const g of local) {
      g.applyMatrix4(PLACE)
      parts.push(g.index ? g.toNonIndexed() : g)
    }
  })
  if (!parts.length) return null
  return mergeGeometries(parts, false)
}

export default function Bommies() {
  const pal = THEME.bommies
  const geo = useMemo(() => buildBommies(pal), [pal])
  const mat = useMemo(
    () =>
      litUnderwater(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }),
        THEME.water.caustics,
        GROUND_Y + 0.9,
      ),
    [],
  )
  if (!geo) return null
  return <mesh geometry={geo} material={mat} castShadow receiveShadow frustumCulled={false} />
}
