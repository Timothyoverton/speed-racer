// Fish and bubbles for the fish pond (the `fish` spec in themes.js). Purely
// visual: nothing here has a collider, and nothing touches React state. One
// useFrame moves every fish and bubble by writing instance matrices.
//
// Each fish is a function of time, not something that accumulates frame to
// frame. It rides the road's own centreline at a lateral offset, so a school
// keeps pace with the car (or comes at it), and the lap's shape carries through
// the corners. The only state is the scatter offset: fish near the car are
// shoved aside and ease back, which is why it is kept per fish.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { THEME } from '../game/themes.js'
import { GROUND_Y } from '../game/trackVisuals.js'
import { carState } from '../game/carState.js'
import { TILES, LAP, HALF, rng, roadPoint } from './roadPath.js'

const FLOOR = GROUND_Y + 0.9 // the height Scenery plants its props on
const DT = 0.05 // finite-difference step for heading
// Fish inside this many metres of the car dart off, and drift back once it has
// gone. The push falls off linearly to nothing at the edge of the bubble.
const SCARE_R = 25
const SCARE_PUSH = 7

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
  } else if (f.kind === 'bait') {
    // a bait ball: fish on a ring in the plane across the road, turning in place
    const a = f.a0 + f.rate * t
    lat = f.lat + Math.cos(a) * f.radius
    up = f.up + Math.sin(a) * f.radius
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

  // A bait ball: two counter-turning rings of small fish, held over one stretch.
  // dir and speed are zero, so each fish stays at q0 and only the ring moves.
  if (spec.bait) {
    const b = spec.bait
    for (let k = 0; k < b.count; k++) {
      const inner = k % 2 === 1
      fish.push({
        kind: 'bait',
        q0: b.q,
        dir: 0,
        speed: 0,
        lat: b.lat,
        up: b.up,
        radius: inner ? b.radius * 0.55 : b.radius,
        a0: (((k >> 1) / (b.count / 2)) * Math.PI * 2),
        rate: inner ? -1.5 : 1.1,
        phase: rand() * Math.PI * 2,
        size: 0.7 + rand() * 0.15,
        wagRate: 11,
        wag: 0.6,
        hex: pick(spec.palette),
      })
    }
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
  // per-fish scatter offset (x, y, z), eased by the frame loop; made on first frame
  const scatterRef = useRef(null)

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

  useFrame((state, delta) => {
    const body = bodyRef.current
    const tail = tailRef.current
    const bub = bubbleRef.current
    if (!body || !tail || !bub) return
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 1 / 30)
    const car = carState.pos
    if (!scatterRef.current) scatterRef.current = new Float32Array(fish.length * 3)
    const scatter = scatterRef.current

    for (let i = 0; i < fish.length; i++) {
      const f = fish[i]
      const fade = poseAt(f, t, P0)
      poseAt(f, t + DT, P1)

      // Scatter: a fish inside the car's bubble is shoved away from it (and a
      // little up), and eases back once the car has gone. The offset is state
      // in scatter[], so the fish glides rather than teleports.
      const sx = P0.x - car[0]
      const sy = P0.y - car[1]
      const sz = P0.z - car[2]
      const d = Math.hypot(sx, sy, sz)
      const near = d < SCARE_R
      let tx = 0
      let ty = 0
      let tz = 0
      if (near) {
        const k = ((1 - d / SCARE_R) * SCARE_PUSH) / Math.max(d, 0.5)
        tx = sx * k
        ty = sy * k + 1.5 * (1 - d / SCARE_R)
        tz = sz * k
      }
      const ease = 1 - Math.exp(-dt * (near ? 5 : 1.2))
      const o = i * 3
      scatter[o] += (tx - scatter[o]) * ease
      scatter[o + 1] += (ty - scatter[o + 1]) * ease
      scatter[o + 2] += (tz - scatter[o + 2]) * ease
      P0.x += scatter[o]
      P0.y += scatter[o + 1]
      P0.z += scatter[o + 2]
      P1.x += scatter[o]
      P1.y += scatter[o + 1]
      P1.z += scatter[o + 2]
      if (P0.y < FLOOR + 1.5) P0.y = FLOOR + 1.5

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
