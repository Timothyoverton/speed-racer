import { useMemo, useRef } from 'react'
import { RigidBody, CuboidCollider } from '@react-three/rapier'
import * as THREE from 'three'
import Boxes from './Boxes.jsx'
import { TRACK } from '../game/track.js'
import { VISUALS } from '../game/trackVisuals.js'
import { trackMaterials, gateMaterial } from '../game/materials.js'
import { getState } from '../game/store.js'
import { clearCheckpoint, allCheckpointsCleared } from '../game/progress.js'
import { blip } from '../game/audio.js'

const RAIL_H = 0.6 // collider half-height; must stay in step with the visuals
// The barrier only needs enough length to overlap its neighbour. It must NOT
// inherit the road's overlap: a rail is straight, so on a corner every extra
// metre past the chord swings its ends inward across the road — that was an
// invisible wall up to 43cm inside the visible barrier on the entry line.
const RAIL_OVERLAP = 0.2

export default function Track({ onFinish }) {
  const finished = useRef(false)
  const mats = useMemo(() => trackMaterials(), [])
  const gateMats = useMemo(
    () => ({
      start: gateMaterial('#66ffbd'),
      cp: gateMaterial('#ffc94a'),
      finish: gateMaterial('#ffffff'),
    }),
    [],
  )

  return (
    <group>
      {/* one static body holds every road + barrier collider. Colliders come
          from the merged slabs (long boxes over straight runs) so there are no
          tile seams for the frictionless car to trip on. */}
      <RigidBody type="fixed" colliders={false}>
        {TRACK.slabs.map((slab, i) => {
          const [w, h, l] = slab.size
          // how far this collider may stretch along its length — see padSlabs()
          const pad = slab.pad
          const rw = TRACK.roadWidth
          return (
            <group key={i} position={slab.pos} rotation={[slab.rot[0], slab.rot[1], slab.rot[2], 'YXZ']}>
              <CuboidCollider args={[w / 2 + pad, h / 2, l / 2 + pad]} friction={0} restitution={0} />
              <CuboidCollider
                args={[0.3, RAIL_H, l / 2 + RAIL_OVERLAP]}
                position={[rw / 2 + 0.3, h / 2 + RAIL_H, 0]}
                friction={0}
                restitution={0.55}
              />
              <CuboidCollider
                args={[0.3, RAIL_H, l / 2 + RAIL_OVERLAP]}
                position={[-rw / 2 - 0.3, h / 2 + RAIL_H, 0]}
                friction={0}
                restitution={0.55}
              />
            </group>
          )
        })}
      </RigidBody>

      {/* --- visuals: a handful of instanced meshes for the whole circuit --- */}
      <Boxes items={VISUALS.road} material={mats.asphalt} receiveShadow />
      <Boxes items={VISUALS.line} material={mats.line} />
      <Boxes items={VISUALS.dash} material={mats.line} />
      <Boxes items={VISUALS.kerb} material={mats.kerb} receiveShadow />
      <Boxes items={VISUALS.wall} material={mats.concrete} castShadow receiveShadow />
      <Boxes items={VISUALS.stripeR} material={mats.stripeR} />
      <Boxes items={VISUALS.stripeL} material={mats.stripeL} />
      <Boxes items={VISUALS.post} material={mats.post} castShadow />

      {/* start / finish road markings */}
      <RoadDecal
        pos={TRACK.start.pos}
        yaw={TRACK.start.yaw}
        width={TRACK.roadWidth}
        depth={2.4}
        material={mats.checker}
        repeat={[TRACK.roadWidth / 3, 1]}
      />
      <RoadDecal
        pos={TRACK.finish.pos}
        yaw={TRACK.finish.yaw}
        width={TRACK.roadWidth}
        depth={3.2}
        material={mats.checker}
        repeat={[TRACK.roadWidth / 3, 1.4]}
      />

      <Gate
        pos={TRACK.start.pos}
        yaw={TRACK.start.yaw}
        width={TRACK.roadWidth}
        color="#66ffbd"
        curtain={gateMats.start}
        mats={mats}
      />

      {TRACK.checkpoints.map((cp, i) => (
        <group key={i}>
          <Gate
            pos={cp.pos}
            yaw={cp.yaw}
            width={cp.width}
            color="#ffc94a"
            curtain={gateMats.cp}
            mats={mats}
          />
          <CuboidCollider
            sensor
            position={[cp.pos[0], cp.pos[1] + 2.5, cp.pos[2]]}
            rotation={[0, cp.yaw, 0]}
            args={[cp.width / 2, 3, 0.6]}
            onIntersectionEnter={() => {
              if (getState().phase !== 'racing') return
              clearCheckpoint(i)
              blip(880, 0.1, 0.12)
            }}
          />
        </group>
      ))}

      <Gate
        pos={TRACK.finish.pos}
        yaw={TRACK.finish.yaw}
        width={TRACK.roadWidth}
        color="#ffffff"
        curtain={gateMats.finish}
        mats={mats}
        finish
      />
      <CuboidCollider
        sensor
        position={[TRACK.finish.pos[0], TRACK.finish.pos[1] + 2.5, TRACK.finish.pos[2]]}
        rotation={[0, TRACK.finish.yaw, 0]}
        args={[TRACK.roadWidth / 2, 3, 0.7]}
        onIntersectionEnter={() => {
          if (getState().phase !== 'racing') return
          if (finished.current) return
          if (!allCheckpointsCleared()) return
          finished.current = true
          onFinish()
        }}
      />
    </group>
  )
}

// A flat strip painted on the road surface.
function RoadDecal({ pos, yaw, width, depth, material, repeat }) {
  const mat = useMemo(() => {
    const m = material.clone()
    if (m.map) {
      m.map = m.map.clone()
      m.map.needsUpdate = true
      m.map.repeat.set(repeat[0], repeat[1])
      m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping
    }
    return m
  }, [material, repeat])

  return (
    <mesh
      position={[pos[0], pos[1] + 0.015, pos[2]]}
      rotation={[-Math.PI / 2, 0, yaw]}
      material={mat}
    >
      <planeGeometry args={[width, depth]} />
    </mesh>
  )
}

// Gantry over the road: two pylons, a banner beam, floodlight pods and a
// translucent curtain so you can see the gate from a long way out.
function Gate({ pos, yaw, width, color, curtain, mats, finish = false }) {
  const postH = 6.4
  const half = width / 2 + 0.9
  return (
    <group position={[pos[0], pos[1], pos[2]]} rotation={[0, yaw, 0]}>
      {[1, -1].map((s) => (
        <group key={s} position={[s * half, 0, 0]}>
          <mesh position={[0, postH / 2, 0]} castShadow material={mats.metal}>
            <boxGeometry args={[0.5, postH, 0.5]} />
          </mesh>
          <mesh position={[0, 0.35, 0]} castShadow material={mats.concrete}>
            <boxGeometry args={[1.3, 0.7, 1.3]} />
          </mesh>
          {/* diagonal brace */}
          <mesh position={[-s * 1.1, postH - 1.3, 0]} rotation={[0, 0, s * 0.72]} material={mats.metal}>
            <boxGeometry args={[0.22, 3.0, 0.22]} />
          </mesh>
        </group>
      ))}

      {/* banner beam */}
      <mesh position={[0, postH - 0.6, 0]} castShadow material={mats.metal}>
        <boxGeometry args={[half * 2, 1.2, 0.45]} />
      </mesh>
      <mesh position={[0, postH - 0.6, 0.24]}>
        <planeGeometry args={[half * 2 - 0.6, 0.9]} />
        <meshStandardMaterial
          color={finish ? '#101216' : color}
          emissive={color}
          emissiveIntensity={finish ? 0.25 : 1.4}
          roughness={0.4}
        />
      </mesh>

      {/* light pods along the beam */}
      {[-0.62, -0.2, 0.2, 0.62].map((f, i) => (
        <mesh key={i} position={[f * half * 2, postH - 1.35, 0]}>
          <boxGeometry args={[0.7, 0.2, 0.35]} />
          <meshStandardMaterial color="#fff8e0" emissive="#ffeeb8" emissiveIntensity={1.3} />
        </mesh>
      ))}

      {/* the gate itself */}
      <mesh position={[0, 2.6, 0]} material={curtain}>
        <planeGeometry args={[width, 5.2]} />
      </mesh>
    </group>
  )
}
