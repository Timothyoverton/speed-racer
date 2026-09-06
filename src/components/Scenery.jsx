// Everything around the circuit: ground, treeline, grandstands, floodlights,
// distant hills. All instanced and generated once from a fixed seed, so it
// costs a few draw calls and looks the same every run.
import { useMemo } from 'react'
import * as THREE from 'three'
import Boxes, { Shapes } from './Boxes.jsx'
import { BOUNDS, GROUND_Y } from '../game/trackVisuals.js'
import { sampleTrack } from '../game/trackQuery.js'
import { TRACK } from '../game/track.js'
import { trackMaterials } from '../game/materials.js'

// A stand of trees that is all one green reads as a wall of cardboard cones.
// Vary the shade per instance and the same 260 cones become a treeline.
const LEAF = ['#2c5a33', '#356b3a', '#24512e', '#3d7442', '#2a6340', '#1f4a2b', '#437a46']
// Nearer hills keep some green; the far ridge is pushed toward the sky colour
// so the horizon reads as distance rather than as a cardboard cutout.
const HILL_NEAR = ['#3f5a55', '#47635c', '#38534f', '#4e6b62', '#334d4a']
const HILL_FAR = ['#5f7887', '#687f92', '#57707f', '#71879a']
const SCRUB = ['#3c5f34', '#456b3b', '#33512c', '#4d7340']

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

export default function Scenery() {
  const mats = useMemo(() => trackMaterials(), [])
  const [cx, , cz] = BOUNDS.center
  const R = BOUNDS.radius
  // scenery was authored against a ground plane at -0.9; keep it planted on the
  // ground wherever that now sits
  const gy = GROUND_Y + 0.9

  const extra = useMemo(() => {
    const r = rng(1337)
    const trunks = []
    const canopies = []
    const stands = []
    const crowd = []
    const masts = []
    const heads = []
    const hills = []
    const clouds = []
    const canopyColor = []
    const hillColor = []
    const scrub = []
    const scrubColor = []

    // treeline — a broken ring well outside the barriers
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2
      const rad = R + 22 + r() * 190
      const x = cx + Math.cos(a) * rad
      const z = cz + Math.sin(a) * rad
      const h = 4.5 + r() * 8.5
      const w = 2.0 + r() * 2.2
      const tint = LEAF[(r() * LEAF.length) | 0]
      trunks.push({ p: [x, gy + h * 0.22, z], r: [0, r() * 3, 0], s: [0.5, h * 0.45, 0.5] })
      // two stacked cones give a conifer a waist instead of a single triangle
      canopies.push({ p: [x, gy + h * 0.62, z], r: [0, r() * 3, 0], s: [w, h * 0.8, w] })
      canopyColor.push(tint)
      canopies.push({ p: [x, gy + h * 0.98, z], r: [0, r() * 3, 0], s: [w * 0.66, h * 0.6, w * 0.66] })
      canopyColor.push(tint)
    }

    // Low scrub over the infield and verges, so the grass isn't a billiard
    // table between the road and the treeline.
    //
    // Scattering by radius alone puts bushes in the middle of the racing line —
    // which is exactly what the first cut did, cones all down the straight. Ask
    // the track where the road actually is and keep well off it.
    const CLEAR = TRACK.roadWidth / 2 + 9
    for (let i = 0, tries = 0; i < 340 && tries < 4000; tries++) {
      const a = r() * Math.PI * 2
      const rad = R * (0.15 + r() * 1.15)
      const x = cx + Math.cos(a) * rad
      const z = cz + Math.sin(a) * rad
      const on = sampleTrack(x, z)
      if (on && Math.abs(on.lateral) < CLEAR) continue
      const w = 0.9 + r() * 1.7
      scrub.push({ p: [x, gy + w * 0.3, z], r: [0, r() * 3, 0], s: [w, w * 0.8, w] })
      scrubColor.push(SCRUB[(r() * SCRUB.length) | 0])
      i++
    }

    // grandstands on the two long sides
    const standSpots = [
      { x: cx, z: cz - R - 26, rot: 0 },
      { x: cx, z: cz + R + 26, rot: Math.PI },
      { x: cx - R - 26, z: cz, rot: Math.PI / 2 },
      { x: cx + R + 26, z: cz, rot: -Math.PI / 2 },
    ]
    for (const s of standSpots) {
      // stepped terraces, leaning back away from the track
      for (let step = 0; step < 6; step++) {
        const depth = 3.2
        const off = 2 + step * depth
        const h = 2.5 + step * 2.2
        const dx = Math.sin(s.rot) * off
        const dz = Math.cos(s.rot) * off
        stands.push({
          p: [s.x - dx, gy + h / 2, s.z - dz],
          r: [0, s.rot, 0],
          s: [70, h, depth],
        })
        // seated crowd: a band of small blocks on each terrace
        for (let k = 0; k < 34; k++) {
          const along = (k / 33 - 0.5) * 66
          const ax = s.x - dx + Math.cos(s.rot) * along
          const az = s.z - dz - Math.sin(s.rot) * along
          crowd.push({
            p: [ax, gy + h + 0.5, az],
            r: [0, s.rot, 0],
            s: [1.1, 1.0, 1.1],
          })
        }
      }
    }

    // floodlight pylons
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3
      const x = cx + Math.cos(a) * (R + 46)
      const z = cz + Math.sin(a) * (R + 46)
      masts.push({ p: [x, gy + 15, z], r: [0, -a, 0], s: [1.0, 30, 1.0] })
      heads.push({ p: [x, gy + 30.5, z], r: [0, -a, 0], s: [9, 3.4, 1.2] })
    }

    // distant hills, well past everything else — two rings, the far one hazier
    // and taller, so the skyline has depth instead of one row of pyramids
    for (let i = 0; i < 30; i++) {
      const a = r() * Math.PI * 2
      const rad = 600 + r() * 240
      const sz = 120 + r() * 220
      hills.push({
        p: [cx + Math.cos(a) * rad, gy - 10, cz + Math.sin(a) * rad],
        r: [0, r() * 6, 0],
        s: [sz, sz * (0.2 + r() * 0.16), sz],
      })
      hillColor.push(HILL_NEAR[(r() * HILL_NEAR.length) | 0])
    }
    for (let i = 0; i < 22; i++) {
      const a = r() * Math.PI * 2
      const rad = 1000 + r() * 420
      const sz = 260 + r() * 340
      hills.push({
        p: [cx + Math.cos(a) * rad, gy - 24, cz + Math.sin(a) * rad],
        r: [0, r() * 6, 0],
        s: [sz, sz * (0.24 + r() * 0.2), sz],
      })
      hillColor.push(HILL_FAR[(r() * HILL_FAR.length) | 0])
    }

    // A cloud deck well above even Freefall's biggest launch. These were single
    // wide boxes, which from underneath is exactly what they looked like:
    // sheets of cardboard hanging in the sky. Each cloud is now a clump of
    // squashed blobs, which reads as mass from any angle.
    for (let i = 0; i < 20; i++) {
      const a = r() * Math.PI * 2
      const rad = r() * 1000
      const bx = cx + Math.cos(a) * rad
      const bz = cz + Math.sin(a) * rad
      const by = gy + 160 + r() * 110
      const spread = 40 + r() * 70
      const puffs = 5 + ((r() * 5) | 0)
      for (let k = 0; k < puffs; k++) {
        const w = 34 + r() * 46
        clouds.push({
          p: [bx + (r() - 0.5) * spread * 2.4, by + (r() - 0.5) * 14, bz + (r() - 0.5) * spread],
          r: [0, r() * 3, 0],
          s: [w, w * (0.32 + r() * 0.22), w * (0.7 + r() * 0.5)],
        })
      }
    }

    return { trunks, canopies, stands, crowd, masts, heads, hills, clouds, canopyColor, hillColor, scrub, scrubColor }
  }, [cx, cz, R, gy])

  const geos = useMemo(
    () => ({
      cone: new THREE.ConeGeometry(0.5, 1, 7),
      hill: new THREE.ConeGeometry(0.5, 1, 9),
      puff: new THREE.SphereGeometry(0.5, 10, 7),
    }),
    [],
  )

  const extraMats = useMemo(
    () => ({
      trunk: new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 }),
      // white base: the per-instance colour multiplies it
      canopy: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
      scrub: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
      crowd: new THREE.MeshStandardMaterial({ color: '#8892a6', roughness: 0.9 }),
      hill: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
      cloud: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        roughness: 1,
        emissive: '#c9dcf2',
        emissiveIntensity: 0.25,
      }),
      lamp: new THREE.MeshStandardMaterial({
        color: '#fffbe8',
        emissive: '#fff3c4',
        emissiveIntensity: 1.4,
        roughness: 0.3,
      }),
    }),
    [],
  )

  return (
    <group>
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, GROUND_Y, cz]} receiveShadow>
        <planeGeometry args={[2600, 2600]} />
        <primitive object={mats.grass} attach="material" />
      </mesh>

      <Shapes items={extra.hills} geometry={geos.hill} material={extraMats.hill} colors={extra.hillColor} />
      <Shapes items={extra.trunks} geometry={geos.cone} material={extraMats.trunk} />
      <Shapes
        items={extra.canopies}
        geometry={geos.cone}
        material={extraMats.canopy}
        colors={extra.canopyColor}
        castShadow
      />
      <Shapes items={extra.scrub} geometry={geos.cone} material={extraMats.scrub} colors={extra.scrubColor} />

      <Boxes items={extra.stands} material={mats.concrete} castShadow receiveShadow />
      <Boxes items={extra.crowd} material={extraMats.crowd} />
      <Boxes items={extra.masts} material={mats.metal} castShadow />
      <Boxes items={extra.heads} material={extraMats.lamp} />
      <Shapes items={extra.clouds} geometry={geos.puff} material={extraMats.cloud} />
    </group>
  )
}
