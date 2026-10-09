// Sea life bigger than a school (the `life` spec in themes.js): jellyfish that
// drift beside the road and across it overhead, a whale shark that swoops over
// the car, anglerfish lures in the dark water, a whale-rib tunnel over the
// slalom, and a burst of bubbles off the car whenever boost lights.
//
// Everything is visual. There are no colliders, and nothing here touches React
// state: each frame writes instance matrices and group transforms. Positions come
// from the road helpers, so the life keeps pace with the lap's bends and drops.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Shapes } from './Boxes.jsx'
import { THEME } from '../game/themes.js'
import { carState } from '../game/carState.js'
import { TILES, LAP, HALF, rng, tileAt, nearestTile, roadPoint, yawAt } from './roadPath.js'

const TENT = 6 // tentacles per jelly
const SEG = 5 // segments per tentacle
const SEG_LEN = 0.7 // times the bell's size; short enough that a drifter clears the road
const BURST = 40 // car-boost bubbles alive at once
const BURST_PER = 14 // per boost, and each lives BURST_LIFE seconds
const BURST_LIFE = 2.2
const JELLY_HEX = ['#ff7ad9', '#7fe7ff', '#c9a2ff', '#8effc1', '#ffb36b']
const LURE_HEX = ['#7ff6ff', '#ffe27a']
const RIB_TINT = ['#f1e7d3', '#e9dcc4', '#f6eee0']

const wrap = (q) => ((q % LAP) + LAP) % LAP

function buildLife(spec) {
  const rand = rng(9001)
  const pick = (list) => list[(rand() * list.length) | 0]

  // every third jelly is a drifter: it sweeps across the road well above it
  const jellies = []
  for (let j = 0; j < spec.jellies; j++) {
    const drift = j % 3 === 0
    const side = rand() < 0.5 ? 1 : -1
    jellies.push({
      q0: rand() * LAP,
      dir: rand() < 0.5 ? 1 : -1,
      speed: drift ? 1.2 + rand() * 1.5 : 2 + rand() * 3,
      lat0: drift ? 0 : side * (HALF + 7 + rand() * 20),
      latAmp: drift ? 15 : 2,
      latRate: 0.2 + rand() * 0.2,
      latPhase: rand() * Math.PI * 2,
      up0: drift ? 9 + rand() * 2 : 2 + rand() * 5,
      size: 1.4 + rand() * 0.8,
      phase: rand() * Math.PI * 2,
      pulse: 0.35 + rand() * 0.25,
      hex: pick(JELLY_HEX),
    })
  }

  const lures = []
  for (let k = 0; k < spec.lures; k++) {
    lures.push({
      q: rand() * LAP,
      lat: (rand() < 0.5 ? -1 : 1) * (HALF + 6 + rand() * 40),
      up: -1 + rand() * 10,
      phase: rand() * Math.PI * 2,
      hex: pick(LURE_HEX),
    })
  }

  // rib stations, each a fixed point on the road with the road's own angle
  const r = spec.ribs
  const ribs = []
  for (let q = r.from; q <= r.to + 1e-6; q += r.every) {
    const i = tileAt(q)
    const p = roadPoint(q, 0, 0, new THREE.Vector3())
    const pitch = TILES[i].pitch
    ribs.push({ p: [p.x, p.y, p.z], r: [-pitch, yawAt(i, 0.5), 0], s: [1, 1, 1], hex: pick(RIB_TINT) })
  }
  return { jellies, lures, ribs }
}

// Shared scratch objects, so the frame loop allocates nothing.
const P0 = new THREE.Vector3()
const PA = new THREE.Vector3()
const PB = new THREE.Vector3()
const TMP = new THREE.Matrix4()
const ID = new THREE.Quaternion()
const SC = new THREE.Vector3()
const TR = new THREE.Vector3()
const COL = new THREE.Color()

export default function SeaLife() {
  const spec = THEME.life
  const data = useMemo(() => buildLife(spec), [spec])
  const { jellies, lures, ribs } = data

  const geo = useMemo(
    () => ({
      bell: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      tent: new THREE.CylinderGeometry(0.5, 0.35, 1, 5, 1),
      lureHead: new THREE.SphereGeometry(0.5, 10, 8),
      stalk: new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1),
      ball: new THREE.SphereGeometry(1, 10, 8),
      sphere: new THREE.SphereGeometry(1, 16, 12),
      cone: new THREE.ConeGeometry(1, 1, 6),
      rib: new THREE.TorusGeometry(spec.ribs.radius, 0.7, 8, 28, Math.PI),
    }),
    [spec],
  )

  const mat = useMemo(
    () => ({
      bell: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
      tent: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }),
      lureHead: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      stalk: new THREE.MeshStandardMaterial({ color: '#2a3d4a', roughness: 0.8 }),
      burst: new THREE.MeshStandardMaterial({ color: '#e6fbff', transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false }),
      body: new THREE.MeshStandardMaterial({ color: '#4f6f86', roughness: 0.55 }),
      belly: new THREE.MeshStandardMaterial({ color: '#e8f1f3', roughness: 0.6 }),
      bone: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }),
    }),
    [],
  )

  // bell and tentacle instances, one jelly after another
  const bellRef = useRef(null)
  const tentRef = useRef(null)
  const lureRef = useRef(null)
  const stalkRef = useRef(null)
  const sharkRef = useRef(null)
  const puffRef = useRef(null)

  // car boost bubbles: a ring buffer, plus the car's last boost level, made on the first frame
  const burstRef = useRef(null)

  const bellCount = jellies.length
  const tentCount = jellies.length * TENT * SEG

  // instance tints go on once: each jelly's bell and tentacles share its colour
  useLayoutEffect(() => {
    const bell = bellRef.current
    const tent = tentRef.current
    const lure = lureRef.current
    if (!bell || !tent || !lure) return
    jellies.forEach((J, j) => {
      bell.setColorAt(j, COL.set(J.hex))
      for (let i = 0; i < TENT * SEG; i++) tent.setColorAt(j * TENT * SEG + i, COL.set(J.hex))
    })
    lures.forEach((L, k) => lure.setColorAt(k, COL.set(L.hex)))
    for (const m of [bell, tent, lure]) if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [jellies, lures])

  useFrame((state, delta) => {
    const bell = bellRef.current
    const tent = tentRef.current
    const lure = lureRef.current
    const stalk = stalkRef.current
    const puff = puffRef.current
    if (!bell || !tent || !lure || !stalk || !puff) return
    if (!burstRef.current) {
      burstRef.current = {
        age: new Float32Array(BURST).fill(-1),
        x: new Float32Array(BURST),
        y: new Float32Array(BURST),
        z: new Float32Array(BURST),
        next: 0,
        prev: 0,
      }
    }
    const burst = burstRef.current
    const dt = Math.min(delta, 1 / 30)
    const t = state.clock.elapsedTime
    const car = carState.pos

    // ---- jellyfish ----
    for (let j = 0; j < bellCount; j++) {
      const J = jellies[j]
      const q = wrap(J.q0 + J.dir * J.speed * t)
      const lat = J.lat0 + J.latAmp * Math.sin(J.latRate * t + J.latPhase)
      const up = J.up0 + 0.8 * Math.sin(t * 0.6 + J.phase)
      roadPoint(q, lat, up, P0)

      // the bell pumps: it draws in (taller, narrower) and blows out
      const k = Math.sin(2 * Math.PI * J.pulse * t + J.phase)
      const sxz = J.size * (1 + 0.08 * k)
      const sy = J.size * 0.75 * (1 - 0.2 * k)
      TMP.compose(P0, ID, SC.set(sxz, sy, sxz))
      bell.setMatrixAt(j, TMP)

      // tentacles hang from the bell's rim and trail with a slow sway
      for (let a = 0; a < TENT; a++) {
        const ang = J.phase + (a / TENT) * Math.PI * 2
        const rx = P0.x + Math.cos(ang) * J.size * 0.75
        const rz = P0.z + Math.sin(ang) * J.size * 0.75
        for (let s = 0; s < SEG; s++) {
          const f = (s + 1) / SEG
          const sway = Math.sin(t * 1.8 + J.phase + a * 1.1 + s * 0.8) * 0.45 * J.size * f
          const x = rx + Math.cos(ang + Math.PI / 2) * sway
          const z = rz + Math.sin(ang + Math.PI / 2) * sway
          const y = P0.y - (s + 0.5) * SEG_LEN * J.size
          const w = 0.07 * J.size * (1 - s * 0.12)
          TMP.compose(TR.set(x, y, z), ID, SC.set(w, SEG_LEN * J.size, w))
          tent.setMatrixAt((j * TENT + a) * SEG + s, TMP)
        }
      }
    }

    // ---- anglerfish lures: a slow bob and a blink ----
    for (let k = 0; k < lures.length; k++) {
      const L = lures[k]
      roadPoint(L.q, L.lat, L.up + 0.4 * Math.sin(t * 0.5 + L.phase), P0)
      const blink = 0.85 + 0.15 * Math.sin(t * 2.3 + L.phase)
      TMP.compose(P0, ID, SC.set(blink, blink, blink))
      lure.setMatrixAt(k, TMP)
      // the stalk runs down from the lamp, into the dark
      TMP.compose(TR.set(P0.x, P0.y - 0.7, P0.z), ID, SC.set(0.06, 1.4, 0.06))
      stalk.setMatrixAt(k, TMP)
    }

    // ---- car boost bubbles ----
    // carState.boost is raised by both the pads and the driver's NOS, so its
    // rising edge is the moment a burst starts
    const boosting = carState.boost > 0.01
    if (boosting && burst.prev <= 0.01) {
      const fx = carState.fwd[0]
      const fz = carState.fwd[2]
      for (let k = 0; k < BURST_PER; k++) {
        const i = burst.next
        burst.next = (burst.next + 1) % BURST
        burst.age[i] = 0
        burst.x[i] = car[0] - fx * (3 + Math.random() * 3) + (Math.random() - 0.5) * 2.4
        burst.y[i] = car[1] + 0.2 + Math.random() * 0.6
        burst.z[i] = car[2] - fz * (3 + Math.random() * 3) + (Math.random() - 0.5) * 2.4
      }
    }
    burst.prev = carState.boost
    for (let i = 0; i < BURST; i++) {
      let a = burst.age[i]
      if (a >= 0 && a < BURST_LIFE) a += dt
      burst.age[i] = a
      const live = a >= 0 && a < BURST_LIFE
      const r = live ? 0.2 + 0.25 * (a / BURST_LIFE) : 0
      burst.y[i] += live ? 1.6 * dt : 0
      TMP.compose(TR.set(burst.x[i], burst.y[i], burst.z[i]), ID, SC.set(r, r, r))
      puff.setMatrixAt(i, TMP)
    }

    // ---- whale shark: one swoop every `period` seconds ----
    const sk = spec.shark
    const grp = sharkRef.current
    if (grp) {
      const local = (t + sk.lead) % sk.period
      if (local > sk.swoop) {
        grp.visible = false
      } else {
        grp.visible = true
        const u = local / sk.swoop
        // the car's place on the lap, then the shark sweeps from behind it to
        // ahead of it, overhead
        const ci = nearestTile(car[0], car[1], car[2])
        const qCar = TILES[ci].dist + (TILES[ci].size[2] * Math.cos(TILES[ci].pitch)) / 2
        const q = wrap(qCar - sk.reach + 2 * sk.reach * u)
        const h = sk.height + 2 * Math.sin(Math.PI * u)
        roadPoint(q, Math.sin(Math.PI * u) * 3, h, P0)
        roadPoint(wrap(q + 1), Math.sin(Math.PI * u) * 3, h, PA)
        roadPoint(wrap(q - 1), Math.sin(Math.PI * u) * 3, h, PB)
        const dx = PA.x - PB.x
        const dy = PA.y - PB.y
        const dz = PA.z - PB.z
        const hyp = Math.hypot(dx, dz) || 1
        grp.position.copy(P0)
        grp.rotation.set(-Math.atan2(dy, hyp), Math.atan2(dx, dz), 0, 'YXZ')
        // it fades in and out at either end of the swoop, not at a pop
        const e = Math.min(1, u * 6, (1 - u) * 6)
        grp.scale.setScalar(Math.max(0.001, e))
      }
    }

    bell.instanceMatrix.needsUpdate = true
    tent.instanceMatrix.needsUpdate = true
    lure.instanceMatrix.needsUpdate = true
    stalk.instanceMatrix.needsUpdate = true
    puff.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={bellRef} args={[geo.bell, mat.bell, bellCount]} frustumCulled={false} />
      <instancedMesh ref={tentRef} args={[geo.tent, mat.tent, tentCount]} frustumCulled={false} />
      <instancedMesh ref={lureRef} args={[geo.lureHead, mat.lureHead, lures.length]} frustumCulled={false} />
      <instancedMesh ref={stalkRef} args={[geo.stalk, mat.stalk, lures.length]} frustumCulled={false} />
      <instancedMesh ref={puffRef} args={[geo.ball, mat.burst, BURST]} frustumCulled={false} />
      <Shapes items={ribs} geometry={geo.rib} material={mat.bone} colors={ribs.map((r) => r.hex)} castShadow />
      <group ref={sharkRef} visible={false}>
        <mesh geometry={geo.sphere} material={mat.body} scale={[2.4, 2.2, 7.5]} />
        <mesh geometry={geo.sphere} material={mat.belly} position={[0, -0.9, 0.2]} scale={[2.0, 1.1, 6.9]} />
        {/* dorsal fin, tail and pectorals, each a flattened shape */}
        <mesh geometry={geo.cone} material={mat.body} position={[0, 2.2, -1.4]} scale={[0.35, 1.9, 1.7]} />
        <mesh geometry={geo.sphere} material={mat.body} position={[0, 1.0, -7.4]} scale={[0.35, 2.2, 1.5]} />
        <mesh geometry={geo.sphere} material={mat.body} position={[0, -0.8, -7.3]} scale={[0.3, 1.0, 1.1]} />
        <mesh geometry={geo.sphere} material={mat.body} position={[2.6, -0.5, 1.8]} rotation={[0, 0.4, 0]} scale={[1.9, 0.18, 0.9]} />
        <mesh geometry={geo.sphere} material={mat.body} position={[-2.6, -0.5, 1.8]} rotation={[0, -0.4, 0]} scale={[1.9, 0.18, 0.9]} />
      </group>
    </group>
  )
}
