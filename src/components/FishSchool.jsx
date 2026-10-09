// Fish and bubbles for the fish pond (the `fish` spec in themes.js). Purely
// visual: nothing here has a collider, and nothing touches React state. One
// useFrame moves every fish and bubble by writing instance matrices.
//
// Each fish is a function of time, not something that accumulates frame to
// frame. It rides the road's own centreline at a lateral offset, so a school
// keeps pace with the car (or comes at it), and the lap's shape carries through
// the corners.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { TRACK } from '../game/track.js'
import { THEME } from '../game/themes.js'
import { GROUND_Y } from '../game/trackVisuals.js'

// Same generator as Scenery.jsx, so the pond looks identical on every load.
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

const TILES = TRACK.tiles
const LAP = TRACK.length
const HALF = TRACK.roadWidth / 2
const RUN = TILES.map((t) => t.size[2] * Math.cos(t.pitch)) // horizontal run
const STARTS = TILES.map((t) => t.dist)
const FLOOR = GROUND_Y + 0.9 // the height Scenery plants its props on
const DT = 0.05 // finite-difference step for heading

// Index of the tile whose run covers arc length q (binary search on the starts).
function tileAt(q) {
  let lo = 0
  let hi = TILES.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (STARTS[mid] <= q) lo = mid
    else hi = mid - 1
  }
  return lo
}

// Point on tile i's centreline, `off` metres along it from the tile centre.
function onTile(i, off, out) {
  const t = TILES[i]
  const yaw = t.rot[1]
  return out.set(t.pos[0] + Math.sin(yaw) * off, t.pos[1] + Math.tan(t.pitch) * off, t.pos[2] + Math.cos(yaw) * off)
}

const EDGE_A = new THREE.Vector3()
const EDGE_B = new THREE.Vector3()

// Heading at fraction f through tile i. Each tile's own heading would snap the
// lateral offset sideways at every chord joint (2m on a 40m offset through a
// corner), so blend between the heading at each joint instead.
function yawAt(i, f) {
  const last = TILES.length - 1
  const a = i > 0 ? (TILES[i - 1].rot[1] + TILES[i].rot[1]) / 2 : TILES[i].rot[1]
  const b = i < last ? (TILES[i].rot[1] + TILES[i + 1].rot[1]) / 2 : TILES[i].rot[1]
  return a + (b - a) * f
}

// Centreline at arc length q, `lat` to the left and `up` above the road. Across a
// hole there is no tile, so this runs a straight line from the lip to the
// landing rather than carrying a take-off slope on into the air.
function roadPoint(q, lat, up, out) {
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

const P0 = new THREE.Vector3()
const P1 = new THREE.Vector3()

// Where fish f is at time t, into `out`. Returns its size factor: 0 at either end
// of the lap, so a fish that wraps round the end grows out of nothing instead of
// popping into place.
function poseAt(f, t, out) {
  const along = f.q0 + f.dir * f.speed * t
  const q = ((along % LAP) + LAP) % LAP
  let lat
  let up
  if (f.kind === 'dart') {
    // darts in and out across the open water on its side, never over the tarmac
    lat = f.side * (HALF + 3 + 11 * (0.5 + 0.5 * Math.sin(f.rate * t + f.phase)))
    up = f.up + Math.sin(t * 3 + f.phase) * 0.3
  } else {
    lat = f.lat + Math.sin(t * 0.7 + f.phase) * 0.8
    up = f.up + Math.sin(t * 1.3 + f.phase) * 0.8
  }
  roadPoint(q, lat, up, out)
  if (out.y < FLOOR + 1.5) out.y = FLOOR + 1.5
  const e = Math.min(1, Math.min(q, LAP - q) / 12)
  return e * e * (3 - 2 * e)
}

// Schools of 6-12 beside the road, a few big slow fish further out, and darters.
// Heights are measured from the road surface, so they swim level with the car.
function buildFish(spec, rand) {
  const pick = (list) => list[(rand() * list.length) | 0]
  const fish = []

  for (let s = 0; s < spec.schools; s++) {
    const dir = rand() < 0.5 ? 1 : -1 // with the car, or coming at it
    const speed = 4 + rand() * 8
    const side = rand() < 0.5 ? 1 : -1
    const lat = side * (HALF + 8 + rand() * 32) // 8-40m off the road edge
    const up = -1.5 + rand() * 9
    const q0 = ((s + rand()) / spec.schools) * LAP
    const hex = pick(spec.palette)
    const n = 6 + ((rand() * 7) | 0)
    for (let k = 0; k < n; k++) {
      fish.push({
        kind: 'school',
        q0: q0 + (k - n / 2) * 2.2 + (rand() - 0.5),
        dir,
        speed,
        lat: lat + (rand() - 0.5) * 3,
        up: up + (rand() - 0.5) * 3,
        size: 1.1 + rand() * 0.4,
        phase: rand() * Math.PI * 2,
        wagRate: 7,
        wag: 0.5,
        hex,
      })
    }
  }

  for (let d = 0; d < spec.darters; d++) {
    fish.push({
      kind: 'dart',
      q0: rand() * LAP,
      dir: rand() < 0.5 ? 1 : -1,
      speed: 6 + rand() * 6,
      side: rand() < 0.5 ? 1 : -1,
      rate: (2 * Math.PI) / (2.5 + rand() * 2),
      phase: rand() * Math.PI * 2,
      up: 0.5 + rand() * 4,
      size: 0.6 + rand() * 0.25,
      wagRate: 14,
      wag: 0.7,
      hex: pick(spec.palette),
    })
  }

  for (let b = 0; b < spec.big; b++) {
    fish.push({
      kind: 'big',
      q0: rand() * LAP,
      dir: rand() < 0.5 ? 1 : -1,
      speed: 2 + rand(),
      lat: (rand() < 0.5 ? 1 : -1) * (HALF + 22 + rand() * 18),
      up: 3 + rand() * 7,
      size: 4.2 + rand() * 0.8,
      phase: rand() * Math.PI * 2,
      wagRate: 2.2,
      wag: 0.28,
      hex: pick(spec.bigPalette),
    })
  }
  return fish
}

// Bubble columns rising from the floor just off the road edges. Each column
// shares one rise speed, so its bubbles travel as a chain.
function buildBubbles(spec, rand) {
  const b = spec.bubbles
  const out = []
  for (let c = 0; c < b.columns; c++) {
    const tile = TILES[(rand() * TILES.length) | 0]
    const yaw = tile.rot[1]
    const side = rand() < 0.5 ? 1 : -1
    const dist = HALF + b.minOff + rand() * (b.maxOff - b.minOff)
    const along = (rand() - 0.5) * 10
    const x = tile.pos[0] + Math.cos(yaw) * side * dist + Math.sin(yaw) * along
    const z = tile.pos[2] - Math.sin(yaw) * side * dist + Math.cos(yaw) * along
    const speed = 0.8 + rand() * 0.8 // metres per second
    for (let k = 0; k < b.perColumn; k++) {
      out.push({
        x: x + (rand() - 0.5) * 1.2,
        z: z + (rand() - 0.5) * 1.2,
        phase: ((k / b.perColumn) + rand() * 0.2) % 1,
        speed,
        r: 0.14 + rand() * 0.22,
        wob: rand() * 6,
      })
    }
  }
  return out
}

// Shared scratch objects, so the frame loop allocates nothing.
const ROOT = new THREE.Object3D()
const PIVOT = new THREE.Object3D()
const DOT = new THREE.Object3D()
const BODY_M = new THREE.Matrix4()
const TAIL_M = new THREE.Matrix4()
// body: a unit sphere stretched to a fish (1.15m long, 0.5m tall, 0.36m wide)
const BODY_LOCAL = new THREE.Matrix4().makeScale(0.36, 0.5, 1.15)
// tail: apex at the pivot, trailing 0.5m behind it, a thin fin
const TAIL_LOCAL = new THREE.Matrix4().compose(
  new THREE.Vector3(0, 0, -0.25),
  new THREE.Quaternion(),
  new THREE.Vector3(0.14, 0.9, 0.5),
)

export default function FishSchool() {
  const spec = THEME.fish
  const { fish, bubbles } = useMemo(() => {
    const rand = rng(4242)
    const f = buildFish(spec, rand)
    return { fish: f, bubbles: buildBubbles(spec, rand) }
  }, [spec])

  const bodyGeo = useMemo(() => new THREE.SphereGeometry(0.5, 10, 8), [])
  const tailGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.5, 1, 4)
    g.rotateX(Math.PI / 2) // apex forward (+Z), base trailing
    return g
  }, [])

  const bodyRef = useRef(null)
  const tailRef = useRef(null)
  const bubbleRef = useRef(null)

  useLayoutEffect(() => {
    const body = bodyRef.current
    const tail = tailRef.current
    if (!body || !tail) return
    const c = new THREE.Color()
    fish.forEach((f, i) => {
      c.set(f.hex)
      body.setColorAt(i, c)
      tail.setColorAt(i, c)
    })
    if (body.instanceColor) body.instanceColor.needsUpdate = true
    if (tail.instanceColor) tail.instanceColor.needsUpdate = true
  }, [fish])

  useFrame((state) => {
    const body = bodyRef.current
    const tail = tailRef.current
    const bub = bubbleRef.current
    if (!body || !tail || !bub) return
    const t = state.clock.elapsedTime

    for (let i = 0; i < fish.length; i++) {
      const f = fish[i]
      const fade = poseAt(f, t, P0)
      poseAt(f, t + DT, P1)
      const vx = P1.x - P0.x
      const vy = P1.y - P0.y
      const vz = P1.z - P0.z
      ROOT.position.copy(P0)
      ROOT.rotation.set(-Math.atan2(vy, Math.hypot(vx, vz)), Math.atan2(vx, vz), 0, 'YXZ')
      ROOT.scale.setScalar(f.size * fade)
      ROOT.updateMatrix()
      BODY_M.multiplyMatrices(ROOT.matrix, BODY_LOCAL)
      body.setMatrixAt(i, BODY_M)

      PIVOT.position.set(0, 0, -0.5)
      PIVOT.rotation.set(0, Math.sin(t * f.wagRate + f.phase) * f.wag, 0)
      PIVOT.updateMatrix()
      TAIL_M.multiplyMatrices(ROOT.matrix, PIVOT.matrix).multiply(TAIL_LOCAL)
      tail.setMatrixAt(i, TAIL_M)
    }
    body.instanceMatrix.needsUpdate = true
    tail.instanceMatrix.needsUpdate = true

    const H = spec.bubbles.height
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i]
      const frac = (b.phase + (t * b.speed) / H) % 1
      // grow out of the floor, shrink into the surface
      const grow = Math.min(1, frac * 6, (1 - frac) * 6)
      DOT.position.set(b.x + Math.sin(t * 1.6 + b.wob) * 0.35, FLOOR + frac * H, b.z)
      DOT.scale.setScalar(b.r * grow)
      DOT.updateMatrix()
      bub.setMatrixAt(i, DOT.matrix)
    }
    bub.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, fish.length]} frustumCulled={false}>
        <primitive object={bodyGeo} attach="geometry" />
        <meshStandardMaterial roughness={0.42} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={tailRef} args={[undefined, undefined, fish.length]} frustumCulled={false}>
        <primitive object={tailGeo} attach="geometry" />
        <meshStandardMaterial roughness={0.42} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={bubbleRef} args={[undefined, undefined, bubbles.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#e6fbff" transparent opacity={0.3} roughness={0.08} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}
