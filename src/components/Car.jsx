import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CuboidCollider, useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import CarModel from './CarModel.jsx'
import { TRACK } from '../game/track.js'
import { getState, startCountdown } from '../game/store.js'
import { input } from '../game/useKeys.js'
import { hud } from '../game/hud.js'
import { elapsedMs } from '../game/timing.js'
import { progress } from '../game/progress.js'
import { activeGhost, ghostTimeAtPosition } from '../game/ghost.js'

// --- tuning -------------------------------------------------------------------
const ENGINE = 30 // m/s of speed added per second at full throttle
const REVERSE = 12
const MAX_SPEED = 44
const ROLL_RESIST = 0.55 // linear drag (1/s)
const QUAD_DRAG = 0.02
const BRAKE = 2.4
const GRIP_GROUND = 13 // lateral grip (1/s)
const GRIP_AIR = 1.2
const MAX_YAW = 2.3 // rad/s at speed
const TURN_SPEED_REF = 9 // speed at which full steering authority kicks in
const CAM_DIST = 8.5
const CAM_HEIGHT = 3.6
const CAM_LOOKAHEAD = 7
const RESPAWN_Y = -8

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = { x: 0, y: -1, z: 0 }

export default function Car({ recorder }) {
  const body = useRef(null)
  const { world, rapier } = useRapier()

  const q = useRef(new THREE.Quaternion())
  const fwd = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const vel = useRef(new THREE.Vector3())
  const newVel = useRef(new THREE.Vector3())
  const rayOrigin = useRef(new THREE.Vector3())
  const camDesired = useRef(new THREE.Vector3())
  const camLook = useRef(new THREE.Vector3())
  const stuckTimer = useRef(0)
  const ghostThrottle = useRef(0)
  const camInit = useRef(false)

  const start = TRACK.start

  function placeAt(pos, yaw) {
    const b = body.current
    if (!b) return
    b.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true)
    q.current.setFromAxisAngle(UP, yaw)
    b.setRotation(q.current, true)
    b.setLinvel({ x: 0, y: 0, z: 0 }, true)
    b.setAngvel({ x: 0, y: 0, z: 0 }, true)
    stuckTimer.current = 0
  }

  useFrame((state, delta) => {
    const b = body.current
    if (!b) return
    const dt = Math.min(delta, 1 / 30)
    const phase = getState().phase
    const racing = phase === 'racing'

    // handle a restart request (R) at any time
    if (input.restart) {
      input.restart = false
      startCountdown()
      return
    }

    const pos = b.translation()
    const rot = b.rotation()
    q.current.set(rot.x, rot.y, rot.z, rot.w)
    fwd.current.set(0, 0, 1).applyQuaternion(q.current)
    fwd.current.y = 0
    fwd.current.normalize()
    right.current.crossVectors(UP, fwd.current).normalize()

    // ground probe
    let grounded = false
    try {
      rayOrigin.current.set(pos.x, pos.y + 0.1, pos.z)
      const ray = new rapier.Ray(rayOrigin.current, DOWN)
      const hit = world.castRay(ray, 0.85, true, undefined, undefined, undefined, b)
      grounded = !!hit
    } catch {
      grounded = pos.y < 1.2
    }

    const lv = b.linvel()
    vel.current.set(lv.x, lv.y, lv.z)
    let vForward = vel.current.dot(fwd.current)
    let vRight = vel.current.dot(right.current)

    // ---- longitudinal ----
    const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0)
    if (racing && grounded) {
      if (throttle > 0) vForward += ENGINE * dt
      else if (throttle < 0) vForward -= REVERSE * dt
    }
    // drag + rolling resistance
    vForward -= vForward * ROLL_RESIST * dt
    vForward -= Math.sign(vForward) * QUAD_DRAG * vForward * vForward * dt
    // engine braking when coasting, hard brake on handbrake
    if (input.handbrake && grounded) vForward -= vForward * BRAKE * dt
    vForward = THREE.MathUtils.clamp(vForward, -14, MAX_SPEED)

    // ---- lateral grip ----
    const grip = grounded ? GRIP_GROUND : GRIP_AIR
    const gripK = 1 - Math.exp(-grip * dt * (input.handbrake ? 0.3 : 1))
    vRight -= vRight * gripK

    // recompose horizontal velocity, keep vertical (gravity / ramp launch)
    newVel.current
      .copy(fwd.current)
      .multiplyScalar(vForward)
      .addScaledVector(right.current, vRight)
    b.setLinvel({ x: newVel.current.x, y: lv.y, z: newVel.current.z }, true)

    // ---- steering ----
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0)
    const speedAuthority = THREE.MathUtils.clamp(Math.abs(vForward) / TURN_SPEED_REF, 0, 1)
    const dirSign = vForward < -0.5 ? -1 : 1
    const targetYaw = racing ? steer * MAX_YAW * speedAuthority * dirSign : 0
    const av = b.angvel()
    const yawK = 1 - Math.exp(-12 * dt)
    const nextYaw = grounded
      ? THREE.MathUtils.lerp(av.y, targetYaw, yawK)
      : av.y * (1 - 0.5 * dt)
    b.setAngvel({ x: 0, y: nextYaw, z: 0 }, true)

    // ---- respawn / stuck ----
    if (racing) {
      if (grounded && Math.abs(vForward) < 1.5) stuckTimer.current += dt
      else stuckTimer.current = 0
    }
    if (pos.y < RESPAWN_Y || stuckTimer.current > 2.4) {
      const r = progress.respawn || { pos: [start.pos[0], start.pos[1] + 0.6, start.pos[2]], yaw: start.yaw }
      placeAt(r.pos, r.yaw)
      return
    }

    // ---- HUD telemetry ----
    hud.speedKmh = Math.max(0, vForward) * 3.6
    hud.timeMs = elapsedMs()
    hud.checkpoints = progress.next
    hud.airborne = !grounded

    // ---- ghost delta (throttled) ----
    ghostThrottle.current += dt
    if (activeGhost.frames && ghostThrottle.current > 0.15) {
      ghostThrottle.current = 0
      if (racing) {
        const gt = ghostTimeAtPosition(activeGhost.frames, pos.x, pos.z)
        hud.ghostDeltaMs = elapsedMs() - gt
      } else {
        hud.ghostDeltaMs = null
      }
    }

    // ---- ghost recording ----
    if (racing && recorder) recorder.sample(elapsedMs(), pos, rot)

    // ---- chase camera ----
    camDesired.current
      .copy(fwd.current)
      .multiplyScalar(-CAM_DIST)
      .add({ x: pos.x, y: pos.y, z: pos.z })
    camDesired.current.y += CAM_HEIGHT
    if (!camInit.current) {
      state.camera.position.copy(camDesired.current)
      camInit.current = true
    } else {
      const camK = 1 - Math.pow(0.0018, dt)
      state.camera.position.lerp(camDesired.current, camK)
    }
    camLook.current
      .copy(fwd.current)
      .multiplyScalar(CAM_LOOKAHEAD)
      .add({ x: pos.x, y: pos.y + 1.1, z: pos.z })
    state.camera.lookAt(camLook.current)
  })

  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={[start.pos[0], start.pos[1] + 0.6, start.pos[2]]}
      rotation={[0, start.yaw, 0]}
      mass={1}
      linearDamping={0.1}
      angularDamping={1.5}
      enabledRotations={[false, true, false]}
      canSleep={false}
      ccd
    >
      <CuboidCollider args={[0.85, 0.45, 1.85]} friction={0.7} restitution={0.05} />
      <CarModel />
    </RigidBody>
  )
}
