import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import CarModel from './CarModel.jsx'
import * as net from '../game/net.js'
import { carState } from '../game/carState.js'
import { trackProgress } from '../game/trackQuery.js'
import { getState } from '../game/store.js'

// The opponent's car in a two-player race. No physics body — it's driven purely
// by the interpolated telemetry stream (net.sampleOpponent), rendered ~110ms in
// the past so there are always two snapshots to interpolate between.
export default function RemoteCar() {
  const group = useRef(null)
  const quat = useMemo(() => new THREE.Quaternion(), [])

  const colour = useMemo(() => {
    const them = net.session.roster.find((p) => p.id !== net.session.selfId)
    return them?.colour || '#ff4fa8'
  }, [])

  useFrame(() => {
    const g = group.current
    if (!g) return

    const phase = getState().phase
    const racingOrCountdown = phase === 'racing' || phase === 'countdown'

    const selfProg = trackProgress(carState.pos[0], carState.pos[2])
    const opp = net.sampleOpponent(selfProg)

    if (!opp || !racingOrCountdown) {
      g.visible = false
      return
    }
    g.visible = true
    g.position.set(opp.p[0], opp.p[1], opp.p[2])
    quat.set(opp.q[0], opp.q[1], opp.q[2], opp.q[3])
    g.quaternion.copy(quat)
  })

  return (
    <group ref={group} visible={false}>
      <CarModel color={colour} />
    </group>
  )
}
