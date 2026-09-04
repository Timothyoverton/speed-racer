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

// --- tuning (all in m, s) ---------------------------------------------------
const ACCEL = 16 // m/s^2 at full throttle (tapers to 0 near MAX_SPEED)
const REVERSE_ACCEL = 8
const BRAKE_ACCEL = 26
const MAX_SPEED = 62 // ~220 km/h ceiling; real top speed ~175 with drag
const LIN_DRAG = 0.05 // 1/s
const QUAD_DRAG = 0.0003 // 1/m
const GRIP = 12 // lateral bite, 1/s — how tightly velocity tracks heading
const GRIP_HANDBRAKE = 2.4
const BASE_YAW = 1.6 // rad/s max turn rate (tapers with speed above YAW_REF_SPEED)
const YAW_REF_SPEED = 13 // m/s
const YAW_RESPONSE = 10 // how fast yaw rate approaches target
const MAX_SLIP = 0.42 // rad — steering slip angle at full lock, low speed
const STEER_SNAP = 6 // heading-error -> yaw-rate gain
const TURN_MIN_SPEED = 1.5 // below this you can't really steer
const MAX_AIR_TIME = 1.8 // airborne longer than this = fell off, respawn
const CAM_DIST = 11
const CAM_HEIGHT = 5
const CAM_LOOKAHEAD = 10
const RESPAWN_Y = -6
const STUCK_TIME = 2.0

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = { x: 0, y: -1, z: 0 }

export default function Car({ recorder }) {
  const body = useRef(null)
  const { world, rapier } = useRapier()

  const q = useRef(new THREE.Quaternion())
  const fwd = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const vel = useRef(new THREE.Vector3())
  const impulse = useRef(new THREE.Vector3())
  const rayOrigin = useRef(new THREE.Vector3())
  const camDesired = useRef(new THREE.Vector3())
  const camLook = useRef(new THREE.Vector3())
  const carPos = useRef(new THREE.Vector3())
  const stuckTimer = useRef(0)
  const ghostThrottle = useRef(0)
  const camInit = useRef(false)
  const airTimer = useRef(0)

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
    airTimer.current = 0
    camInit.current = false
  }

  useFrame((state, delta) => {
    const b = body.current
    if (!b) return
    const dt = Math.min(delta, 1 / 30)
    const phase = getState().phase
    const racing = phase === 'racing'

    if (input.restart) {
      input.restart = false
      startCountdown()
      return
    }


    const t = b.translation()
    carPos.current.set(t.x, t.y, t.z)
    const rot = b.rotation()
    q.current.set(rot.x, rot.y, rot.z, rot.w)
    fwd.current.set(0, 0, 1).applyQuaternion(q.current)
    fwd.current.y = 0
    fwd.current.normalize()
    right.current.crossVectors(UP, fwd.current).normalize()

    const NO_SENSORS = rapier.QueryFilterFlags?.EXCLUDE_SENSORS

    // ground probe
    let grounded = false
    try {
      rayOrigin.current.set(t.x, t.y + 0.3, t.z)
      const ray = new rapier.Ray(rayOrigin.current, DOWN)
      const hit = world.castRay(ray, 1.0, true, NO_SENSORS, undefined, undefined, b)
      grounded = !!hit
    } catch {
      grounded = t.y < 1.4
    }

    const lv = b.linvel()
    vel.current.set(lv.x, lv.y, lv.z)
    const vForward = vel.current.dot(fwd.current)
    const vRight = vel.current.dot(right.current)
    const speed = Math.hypot(lv.x, lv.z)

    // Drive with impulses (not linvel overrides) so Rapier's own collision
    // response — bouncing off the barriers, which have restitution — still lands.
    impulse.current.set(0, 0, 0)

    // ---- longitudinal ----
    if (racing && grounded) {
      const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0)
      if (throttle > 0) {
        const taper = THREE.MathUtils.clamp(1 - vForward / MAX_SPEED, 0, 1)
        impulse.current.addScaledVector(fwd.current, ACCEL * taper * dt)
      } else if (throttle < 0) {
        if (vForward > 1) impulse.current.addScaledVector(fwd.current, -BRAKE_ACCEL * dt)
        else impulse.current.addScaledVector(fwd.current, -REVERSE_ACCEL * dt)
      }
    }

    if (grounded) {
      // rolling resistance + drag
      const drag = LIN_DRAG + QUAD_DRAG * Math.abs(vForward)
      impulse.current.addScaledVector(fwd.current, -vForward * drag * dt)
      // lateral grip — kill sideways slide (less when handbraking => drift)
      const grip = input.handbrake ? GRIP_HANDBRAKE : GRIP
      impulse.current.addScaledVector(right.current, -vRight * Math.min(1, grip * dt))
    } else {
      impulse.current.addScaledVector(fwd.current, -vForward * 0.05 * dt)
    }

    // impulse.current holds a target deltaV; applyImpulse wants mass * deltaV
    b.applyImpulse(impulse.current.multiplyScalar(b.mass()), true)

    // ---- steering ----
    // The car heading chases its *velocity direction* plus a steering offset
    // (a slip angle). This self-centres — a knock or a slide makes the car
    // reorient to face where it's actually going instead of spinning out.
    // +1 = steering left (toward +X / screen-left with the chase camera)
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0)
    const av = b.angvel()
    if (racing && grounded && speed > TURN_MIN_SPEED) {
      const velHeading = Math.atan2(lv.x, lv.z)
      const carHeading = Math.atan2(fwd.current.x, fwd.current.z)
      const dirSign = vForward < 0 ? -1 : 1
      const slip = steer * MAX_SLIP * dirSign * THREE.MathUtils.clamp(YAW_REF_SPEED / speed, 0.45, 1.3)
      let err = velHeading + slip - carHeading
      err = Math.atan2(Math.sin(err), Math.cos(err)) // wrap to [-pi, pi]
      const yawCap = THREE.MathUtils.clamp((BASE_YAW * YAW_REF_SPEED) / speed, 0.4, BASE_YAW)
      const targetYaw = THREE.MathUtils.clamp(err * STEER_SNAP, -yawCap, yawCap)
      const k = 1 - Math.exp(-YAW_RESPONSE * dt)
      b.setAngvel({ x: 0, y: THREE.MathUtils.lerp(av.y, targetYaw, k), z: 0 }, true)
    } else if (grounded) {
      b.setAngvel({ x: 0, y: av.y * (1 - Math.min(1, 10 * dt)), z: 0 }, true)
    }

    // ---- respawn ----
    if (racing) {
      if (grounded && speed < 2) stuckTimer.current += dt
      else stuckTimer.current = 0
      if (grounded) airTimer.current = 0
      else airTimer.current += dt
    }
    if (
      t.y < RESPAWN_Y ||
      stuckTimer.current > STUCK_TIME ||
      airTimer.current > MAX_AIR_TIME
    ) {
      const r =
        progress.respawn || {
          pos: [start.pos[0], start.pos[1] + 0.6, start.pos[2]],
          yaw: start.yaw,
        }
      placeAt(r.pos, r.yaw)
      return
    }

    // ---- HUD ----
    hud.speedKmh = Math.max(0, vForward) * 3.6
    hud.timeMs = elapsedMs()
    hud.checkpoints = progress.next
    hud.airborne = !grounded

    ghostThrottle.current += dt
    if (activeGhost.frames && ghostThrottle.current > 0.15) {
      ghostThrottle.current = 0
      hud.ghostDeltaMs = racing
        ? elapsedMs() - ghostTimeAtPosition(activeGhost.frames, t.x, t.z)
        : null
    }

    if (racing && recorder) recorder.sample(elapsedMs(), t, rot)

    if (import.meta.env.DEV) {
      window.__body = b
      window.__dbg = {
        phase,
        grounded,
        vForward: +vForward.toFixed(2),
        speed: +speed.toFixed(2),
        pos: [+t.x.toFixed(1), +t.y.toFixed(1), +t.z.toFixed(1)],
        stuck: +stuckTimer.current.toFixed(1),
        next: progress.next,
      }
    }

    // ---- chase camera ----
    camDesired.current
      .copy(fwd.current)
      .multiplyScalar(-CAM_DIST)
      .add(carPos.current)
    camDesired.current.y += CAM_HEIGHT
    if (!camInit.current) {
      state.camera.position.copy(camDesired.current)
      camInit.current = true
    } else {
      state.camera.position.lerp(camDesired.current, 1 - Math.pow(0.0016, dt))
    }
    camLook.current.copy(carPos.current)
    camLook.current.y += 1.1
    camLook.current.addScaledVector(fwd.current, CAM_LOOKAHEAD)
    state.camera.lookAt(camLook.current)
  })

  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={[start.pos[0], start.pos[1] + 0.6, start.pos[2]]}
      rotation={[0, start.yaw, 0]}
      mass={1}
      linearDamping={0}
      angularDamping={0.6}
      enabledRotations={[false, true, false]}
      canSleep={false}
      ccd
    >
      {/* frictionless box — all longitudinal / lateral behaviour is done in code */}
      <CuboidCollider args={[0.85, 0.42, 1.85]} friction={0} restitution={0.2} />
      <CarModel />
    </RigidBody>
  )
}
