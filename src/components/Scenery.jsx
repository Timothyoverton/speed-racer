// Everything around the circuit: ground, treeline, grandstands, floodlights,
// distant hills. All instanced and generated once from a fixed seed, so it
// costs a few draw calls and looks the same every run.
import { useMemo } from 'react'
import * as THREE from 'three'
import Boxes, { Shapes } from './Boxes.jsx'
import { BOUNDS } from '../game/trackVisuals.js'
import { trackMaterials } from '../game/materials.js'

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

  const extra = useMemo(() => {
    const r = rng(1337)
    const trunks = []
    const canopies = []
    const stands = []
    const crowd = []
    const masts = []
    const heads = []
    const hills = []

    // treeline — a broken ring well outside the barriers
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2
      const rad = R + 22 + r() * 190
      const x = cx + Math.cos(a) * rad
      const z = cz + Math.sin(a) * rad
      const h = 5 + r() * 7
      const w = 2.2 + r() * 1.8
      trunks.push({ p: [x, h * 0.22, z], r: [0, r() * 3, 0], s: [0.5, h * 0.45, 0.5] })
      canopies.push({ p: [x, h * 0.72, z], r: [0, r() * 3, 0], s: [w, h * 0.95, w] })
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
          p: [s.x - dx, h / 2, s.z - dz],
          r: [0, s.rot, 0],
          s: [70, h, depth],
        })
        // seated crowd: a band of small blocks on each terrace
        for (let k = 0; k < 34; k++) {
          const along = (k / 33 - 0.5) * 66
          const ax = s.x - dx + Math.cos(s.rot) * along
          const az = s.z - dz - Math.sin(s.rot) * along
          crowd.push({
            p: [ax, h + 0.5, az],
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
      masts.push({ p: [x, 15, z], r: [0, -a, 0], s: [1.0, 30, 1.0] })
      heads.push({ p: [x, 30.5, z], r: [0, -a, 0], s: [9, 3.4, 1.2] })
    }

    // distant hills, well past everything else
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2
      const rad = 620 + r() * 260
      const s = 120 + r() * 220
      hills.push({
        p: [cx + Math.cos(a) * rad, -10, cz + Math.sin(a) * rad],
        r: [0, r() * 6, 0],
        s: [s, s * (0.22 + r() * 0.18), s],
      })
    }

    return { trunks, canopies, stands, crowd, masts, heads, hills }
  }, [cx, cz, R])

  const geos = useMemo(
    () => ({
      cone: new THREE.ConeGeometry(0.5, 1, 7),
      hill: new THREE.ConeGeometry(0.5, 1, 9),
    }),
    [],
  )

  const extraMats = useMemo(
    () => ({
      trunk: new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 }),
      canopy: new THREE.MeshStandardMaterial({ color: '#2c5a33', roughness: 1 }),
      crowd: new THREE.MeshStandardMaterial({ color: '#8892a6', roughness: 0.9 }),
      hill: new THREE.MeshStandardMaterial({ color: '#3f5a55', roughness: 1 }),
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.9, cz]} receiveShadow>
        <planeGeometry args={[2600, 2600]} />
        <primitive object={mats.grass} attach="material" />
      </mesh>

      <Shapes items={extra.hills} geometry={geos.hill} material={extraMats.hill} />
      <Shapes items={extra.trunks} geometry={geos.cone} material={extraMats.trunk} />
      <Shapes items={extra.canopies} geometry={geos.cone} material={extraMats.canopy} castShadow />

      <Boxes items={extra.stands} material={mats.concrete} castShadow receiveShadow />
      <Boxes items={extra.crowd} material={extraMats.crowd} />
      <Boxes items={extra.masts} material={mats.metal} castShadow />
      <Boxes items={extra.heads} material={extraMats.lamp} />
    </group>
  )
}
