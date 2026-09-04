import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import CarModel from './CarModel.jsx'
import { getState } from '../game/store.js'
import { elapsedMs } from '../game/timing.js'
import { activeGhost, sampleGhost } from '../game/ghost.js'

export default function Ghost() {
  const group = useRef(null)
  const quat = useRef(new THREE.Quaternion())

  useFrame(() => {
    const g = group.current
    if (!g) return
    const frames = activeGhost.frames
    const phase = getState().phase
    if (!frames || (phase !== 'racing' && phase !== 'countdown')) {
      g.visible = false
      return
    }
    const s = sampleGhost(frames, elapsedMs())
    if (!s) {
      g.visible = false
      return
    }
    g.visible = true
    g.position.set(s.pos[0], s.pos[1], s.pos[2])
    quat.current.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3])
    g.quaternion.copy(quat.current)
  })

  return (
    <group ref={group} visible={false}>
      <CarModel ghost />
    </group>
  )
}
