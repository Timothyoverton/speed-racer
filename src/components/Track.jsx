import { useRef } from 'react'
import { RigidBody, CuboidCollider } from '@react-three/rapier'
import { TRACK } from '../game/track.js'
import { getState } from '../game/store.js'
import { clearCheckpoint, allCheckpointsCleared } from '../game/progress.js'

const RAIL_H = 0.6

export default function Track({ onFinish }) {
  const finished = useRef(false)

  return (
    <group>
      {/* one static body holds every road + rail collider */}
      <RigidBody type="fixed" colliders={false} friction={0.9}>
        {TRACK.tiles.map((tile, i) => {
          const [w, h, l] = tile.size
          return (
            <group key={i} position={tile.pos} rotation={tile.rot}>
              <CuboidCollider args={[w / 2, h / 2, l / 2]} />
              <CuboidCollider args={[0.12, RAIL_H, l / 2]} position={[w / 2 + 0.12, h / 2 + RAIL_H, 0]} />
              <CuboidCollider args={[0.12, RAIL_H, l / 2]} position={[-w / 2 - 0.12, h / 2 + RAIL_H, 0]} />
            </group>
          )
        })}
      </RigidBody>

      {/* road + rail visuals */}
      {TRACK.tiles.map((tile, i) => {
        const [w, h, l] = tile.size
        return (
          <group key={i} position={tile.pos} rotation={tile.rot}>
            <mesh receiveShadow>
              <boxGeometry args={[w, h, l + 0.02]} />
              <meshStandardMaterial color={i % 2 ? '#2b3350' : '#333c5c'} roughness={0.95} />
            </mesh>
            {/* centre line */}
            <mesh position={[0, h / 2 + 0.02, 0]}>
              <boxGeometry args={[0.18, 0.02, l * 0.55]} />
              <meshStandardMaterial color="#e9f0ff" emissive="#4a5a80" emissiveIntensity={0.3} />
            </mesh>
            {[1, -1].map((s) => (
              <mesh key={s} position={[s * (w / 2 + 0.12), h / 2 + RAIL_H, 0]}>
                <boxGeometry args={[0.24, RAIL_H * 2, l]} />
                <meshStandardMaterial
                  color={s > 0 ? '#3ba7ff' : '#ff4d5a'}
                  emissive={s > 0 ? '#12405f' : '#5c1016'}
                  emissiveIntensity={0.5}
                  roughness={0.5}
                />
              </mesh>
            ))}
          </group>
        )
      })}

      {/* start banner */}
      <Gate pos={TRACK.start.pos} yaw={TRACK.start.yaw} width={TRACK.roadWidth} color="#7cf3c1" label />

      {/* checkpoint sensors + gates */}
      {TRACK.checkpoints.map((cp, i) => (
        <group key={i}>
          <Gate pos={cp.pos} yaw={cp.yaw} width={cp.width} color="#ffcf5c" />
          <CuboidCollider
            sensor
            position={[cp.pos[0], cp.pos[1] + 2.5, cp.pos[2]]}
            rotation={[0, cp.yaw, 0]}
            args={[cp.width / 2, 3, 0.6]}
            onIntersectionEnter={() => {
              if (getState().phase === 'racing') clearCheckpoint(i)
            }}
          />
        </group>
      ))}

      {/* finish */}
      <Gate pos={TRACK.finish.pos} yaw={TRACK.finish.yaw} width={TRACK.roadWidth} color="#ffffff" finish />
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

function Gate({ pos, yaw, width, color, finish = false, label = false }) {
  const postH = 4.2
  return (
    <group position={[pos[0], pos[1], pos[2]]} rotation={[0, yaw, 0]}>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * (width / 2 + 0.3), postH / 2, 0]} castShadow>
          <boxGeometry args={[0.35, postH, 0.35]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
        </mesh>
      ))}
      <mesh position={[0, postH, 0]}>
        <boxGeometry args={[width + 1, 0.5, 0.35]} />
        <meshStandardMaterial
          color={finish ? '#ffffff' : color}
          emissive={finish ? '#888' : color}
          emissiveIntensity={0.4}
        />
      </mesh>
      {finish && (
        <mesh position={[0, postH, 0.2]}>
          <boxGeometry args={[width + 1, 0.5, 0.05]} />
          <meshStandardMaterial color="#111" wireframe />
        </mesh>
      )}
      {label && (
        <mesh position={[0, postH - 0.02, 0.25]}>
          <planeGeometry args={[3.4, 0.9]} />
          <meshBasicMaterial color="#7cf3c1" />
        </mesh>
      )}
    </group>
  )
}
