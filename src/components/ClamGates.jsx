// Giant clams straddling the road at the Fish Pond's boost pads (the `clams`
// spec in themes.js). Every pad gets a clam, so the drive-through is the thing
// you are already aiming for.
//
// Each clam is a bivalve, built in its own axes: x across the road, y up, z
// along it, origin on the centreline at the pad.
//  - the top valve is a scalloped dome raised over the road and open
//    underneath, so the car drives under it. Its rim stays well above the car.
//  - two bottom valves are scalloped bowls beside the road, tipped outward, so
//    the clam reads as open rather than as a lid.
//  - a fleshy lip round the top valve's rim, and a glowing pearl hanging in the
//    mouth, pulsing.
// Purely visual: no colliders, and nothing comes within 11 m of the centreline.
//
// Openness (0 shut .. 1 wide open) is one number per clam, eased in useFrame
// from carState.pos. It opens while the car is inside openDist ahead of the gate,
// and snaps partly shut the moment the car passes under it, staying there until
// the next gate. The snap throws a burst of bubbles out of the mouth.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { TRACK } from '../game/track.js'
import { THEME } from '../game/themes.js'
import { carState } from '../game/carState.js'
import { nearestTile, rng } from './roadPath.js'

const DOME_RX = 15 // top valve: half-width, half-depth and crown height
const DOME_RZ = 10
const DOME_RY = 7.5
const RIM_LOW = 6.5 // rim height when nearly shut, opening up by RIM_OPEN
const RIM_OPEN = 1.8
const BOTTOM_X = 19 // bottom valves sit this far either side of the road
const BOTTOM_R = [8, 3.8, 9]
const PEARL_Y = 4.2 // hangs in the mouth, well clear of the car's roof
const RIBS = 14 // scallop ribs round each valve
const BUBBLES = 12 // per clam, for the snap
const BUBBLE_LIFE = 2.4
const SNAP_OPEN = 0.3 // how far it stays open behind the car
const SNAP_RATE = 14 // closing is a snap; opening is a slow ease
const OPEN_RATE = 1.8
const PASS_R = 40 // a snap only counts this close to the gate

// Unit hemisphere, the top valve (dome) or the bottom one (bowl), with the
// scallops built in: the outline ripples with RIBS ribs running from crest to
// rim, and the ripple deepens towards the rim so the edge reads as a fan.
function scallopedShell(lower) {
  const g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, lower ? Math.PI / 2 : 0, Math.PI / 2)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const rim = 1 - Math.abs(y) // 0 at the crest or pole, 1 at the rim
    const k = 1 + (0.02 + 0.08 * rim) * Math.cos(RIBS * Math.atan2(z, x))
    p.setXYZ(i, x * k, y, z * k)
  }
  g.computeVertexNormals()
  return g
}

// The fleshy lip: a torus laid flat on the rim. Its ring is an ellipse baked into
// the geometry rather than squashed per instance, because a non-uniform scale
// would also swell the tube where the ring runs across the road.
function lipRing(rx, rz) {
  const g = new THREE.TorusGeometry(1, 0.22, 8, 48)
  g.rotateX(Math.PI / 2)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const u = Math.atan2(z, x)
    const ox = x - Math.cos(u) // the tube's offset from the ring centreline
    const oz = z - Math.sin(u)
    p.setXYZ(i, rx * Math.cos(u) + ox, y, rz * Math.sin(u) + oz)
  }
  g.computeVertexNormals()
  return g
}

// Per-clam state: openness, whether the car has passed, and the bubble spots.
function clamState(N) {
  const rand = rng(31)
  const nb = N * BUBBLES
  const bx = new Float32Array(nb)
  const bz = new Float32Array(nb)
  const bd = new Float32Array(nb)
  const br = new Float32Array(nb)
  for (let i = 0; i < nb; i++) {
    bx[i] = (rand() - 0.5) * 20
    bz[i] = (rand() - 0.5) * 14
    bd[i] = rand() * 0.25
    br[i] = 0.18 + rand() * 0.22
  }
  return {
    open: new Float32Array(N).fill(SNAP_OPEN),
    passed: new Uint8Array(N),
    age: new Float32Array(nb).fill(-1), // -1 is dormant
    bx,
    bz,
    bd,
    br,
  }
}

const P = new THREE.Vector3()
const Q = new THREE.Quaternion()
const S = new THREE.Vector3()
const ID = new THREE.Quaternion()
const TMP = new THREE.Matrix4()
const OUT = new THREE.Matrix4()
const EULER = new THREE.Euler()
const COL = new THREE.Color()

export default function ClamGates() {
  const spec = THEME.clams

  // One clam per boost pad. The tile under the pad gives its pitch, so a clam on
  // a slope sits on the road's own angle.
  const clams = useMemo(() => {
    const rand = rng(777)
    return TRACK.boosts.map((b, i) => {
      const tile = TRACK.tiles[nearestTile(b.pos[0], b.pos[1], b.pos[2])]
      return {
        origin: b.pos,
        yaw: b.yaw,
        pitch: tile.pitch,
        shell: spec.palette[i % spec.palette.length],
        lip: spec.lip[i % spec.lip.length],
        phase: rand() * Math.PI * 2,
      }
    })
  }, [spec])
  const N = clams.length

  const base = useMemo(
    () =>
      clams.map((c) => {
        EULER.set(-c.pitch, c.yaw, 0, 'YXZ')
        return new THREE.Matrix4().compose(P.set(...c.origin), Q.setFromEuler(EULER), S.set(1, 1, 1))
      }),
    [clams],
  )

  const geo = useMemo(
    () => ({
      dome: scallopedShell(false),
      bowl: scallopedShell(true),
      lip: lipRing(DOME_RX, DOME_RZ),
      pearl: new THREE.SphereGeometry(1, 18, 12),
      halo: new THREE.SphereGeometry(1, 14, 10),
      bubble: new THREE.SphereGeometry(1, 8, 6),
    }),
    [],
  )

  const mat = useMemo(
    () => ({
      shell: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.42,
        metalness: 0.03,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
      lip: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.5,
        emissive: '#ff2f7e',
        emissiveIntensity: 0.45,
      }),
      pearl: new THREE.MeshStandardMaterial({
        color: '#fff8ea',
        emissive: '#fff1cc',
        emissiveIntensity: 1.5,
        roughness: 0.2,
      }),
      halo: new THREE.MeshBasicMaterial({
        color: '#fff3d6',
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      bubble: new THREE.MeshStandardMaterial({
        color: '#e6fbff',
        transparent: true,
        opacity: 0.4,
        roughness: 0.1,
        depthWrite: false,
      }),
    }),
    [],
  )

  const domeRef = useRef(null)
  // per-clam state, all plain typed arrays, made on the first frame
  const stRef = useRef(null)
  const bowlRef = useRef(null)
  const lipRef = useRef(null)
  const pearlRef = useRef(null)
  const haloRef = useRef(null)
  const bubbleRef = useRef(null)

  useLayoutEffect(() => {
    const dome = domeRef.current
    const bowl = bowlRef.current
    const lip = lipRef.current
    if (!dome || !bowl || !lip) return
    clams.forEach((c, i) => {
      dome.setColorAt(i, COL.set(c.shell))
      bowl.setColorAt(i * 2, COL.set(c.shell))
      bowl.setColorAt(i * 2 + 1, COL.set(c.shell))
      lip.setColorAt(i, COL.set(c.lip))
    })
    for (const m of [dome, bowl, lip]) if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [clams])

  useFrame((state, delta) => {
    const dome = domeRef.current
    if (!dome) return
    const bowl = bowlRef.current
    const lip = lipRef.current
    const pearl = pearlRef.current
    const halo = haloRef.current
    const bub = bubbleRef.current
    if (!stRef.current) stRef.current = clamState(N)
    const { open, passed, age, bx, bz, bd, br } = stRef.current
    const dt = Math.min(delta, 1 / 30)
    const t = state.clock.elapsedTime
    const car = carState.pos

    // the pearls breathe together; each clam's own phase offsets its pulse
    pearl.material.emissiveIntensity = 1.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.9))

    for (let c = 0; c < N; c++) {
      const cl = clams[c]
      const o = cl.origin
      const dx = car[0] - o[0]
      const dy = car[1] - o[1]
      const dz = car[2] - o[2]
      // how far the car is along the gate's heading: negative is still to come
      const s = dx * Math.sin(cl.yaw) + dz * Math.cos(cl.yaw)
      const d = Math.hypot(dx, dz)
      const approaching = s < 0
      let snap = false
      if (approaching) {
        passed[c] = 0
      } else if (!passed[c]) {
        passed[c] = 1
        snap = d < PASS_R && Math.abs(dy) < 15
      }

      const target = approaching && -s < spec.openDist ? 1 : SNAP_OPEN
      if (snap) open[c] = SNAP_OPEN // the snap itself is instant
      else open[c] += (target - open[c]) * (1 - Math.exp(-dt * (target < open[c] ? SNAP_RATE : OPEN_RATE)))

      if (snap) {
        for (let k = 0; k < BUBBLES; k++) age[c * BUBBLES + k] = -bd[c * BUBBLES + k]
      }

      const b = base[c]
      const rim = RIM_LOW + RIM_OPEN * open[c]
      const tilt = 0.12 + 0.4 * open[c] // how far the bottom valves have swung out

      // top valve
      TMP.compose(P.set(0, rim, 0), ID, S.set(DOME_RX, DOME_RY, DOME_RZ))
      dome.setMatrixAt(c, OUT.multiplyMatrices(b, TMP))

      // lip, which sits on the rim
      TMP.compose(P.set(0, rim, 0), ID, S.set(1, 1, 1))
      lip.setMatrixAt(c, OUT.multiplyMatrices(b, TMP))

      // bottom valves, one each side, tipped so the inner edge lifts off the road
      for (const side of [1, -1]) {
        EULER.set(0, 0, -side * tilt)
        TMP.compose(P.set(side * BOTTOM_X, 1, 0), Q.setFromEuler(EULER), S.set(...BOTTOM_R))
        bowl.setMatrixAt(c * 2 + (side > 0 ? 0 : 1), OUT.multiplyMatrices(b, TMP))
      }

      // pearl and its halo, both hanging in the mouth and pulsing
      const pulse = 1 + 0.08 * Math.sin(t * 2.2 + cl.phase)
      TMP.compose(P.set(0, PEARL_Y, 0), ID, S.set(1.5 * pulse, 1.5 * pulse, 1.5 * pulse))
      pearl.setMatrixAt(c, OUT.multiplyMatrices(b, TMP))
      TMP.compose(P.set(0, PEARL_Y, 0), ID, S.set(2.8 * pulse, 2.8 * pulse, 2.8 * pulse))
      halo.setMatrixAt(c, OUT.multiplyMatrices(b, TMP))
    }

    // bubbles: a delayed burst out of the mouth on each snap, rising and fading
    const nb = N * BUBBLES
    for (let i = 0; i < nb; i++) {
      const c = (i / BUBBLES) | 0
      // -1 is dormant; a small negative age is a bubble still waiting to go
      let a = age[i]
      if (a > -1 && a < BUBBLE_LIFE) a += dt
      age[i] = a
      const live = a >= 0 && a < BUBBLE_LIFE
      const fade = live ? Math.min(1, (BUBBLE_LIFE - a) * 2) : 0
      const r = live ? br[i] * fade : 0
      TMP.compose(
        P.set(bx[i], RIM_LOW - 1 + Math.max(0, a) * 1.6, bz[i]),
        ID,
        S.set(r, r, r),
      )
      bub.setMatrixAt(i, OUT.multiplyMatrices(base[c], TMP))
    }

    dome.instanceMatrix.needsUpdate = true
    bowl.instanceMatrix.needsUpdate = true
    lip.instanceMatrix.needsUpdate = true
    pearl.instanceMatrix.needsUpdate = true
    halo.instanceMatrix.needsUpdate = true
    bub.instanceMatrix.needsUpdate = true
  })

  if (!N) return null

  return (
    <group>
      <instancedMesh ref={domeRef} args={[geo.dome, mat.shell, N]} frustumCulled={false} />
      <instancedMesh ref={bowlRef} args={[geo.bowl, mat.shell, N * 2]} frustumCulled={false} />
      <instancedMesh ref={lipRef} args={[geo.lip, mat.lip, N]} frustumCulled={false} />
      <instancedMesh ref={pearlRef} args={[geo.pearl, mat.pearl, N]} frustumCulled={false} />
      <instancedMesh ref={haloRef} args={[geo.halo, mat.halo, N]} frustumCulled={false} />
      <instancedMesh ref={bubbleRef} args={[geo.bubble, mat.bubble, N * BUBBLES]} frustumCulled={false} />
    </group>
  )
}
