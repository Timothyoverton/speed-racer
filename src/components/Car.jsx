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
import { carState, resetCarState, updateDrivetrain, torqueFactor } from '../game/carState.js'
import { updateAudio, idleAudio, thud, initAudio } from '../game/audio.js'

// --- tuning (all in m, s) ---------------------------------------------------
const ACCEL = 16 // m/s^2 at full throttle (tapers to 0 near MAX_SPEED)
const REVERSE_ACCEL = 8
const BRAKE_ACCEL = 26
const MAX_SPEED = 62 // ~220 km/h ceiling; real top speed ~175 with drag
const LIN_DRAG = 0.05 // 1/s
const QUAD_DRAG = 0.0003 // 1/m
const GRIP = 12 // lateral bite, 1/s — how tightly velocity tracks heading
const GRIP_HANDBRAKE = 1.4 // rear steps out but the car keeps its momentum
const AERO_GRIP = 0.75 // extra grip at top speed — downforce, keeps fast corners planted
const HANDBRAKE_DECEL = 7 // m/s^2 of extra slowing while the handbrake is held
// The steering authority tapers off with speed. The handbrake gets much higher
// floors on both taper curves, so grabbing it at 200 km/h still rotates the car
// — without those, the taper eats the whole effect and nothing happens.
const SLIP_FLOOR = 0.45
const SLIP_FLOOR_HANDBRAKE = 0.85
const YAW_FLOOR = 0.4
const YAW_FLOOR_HANDBRAKE = 0.95
const HANDBRAKE_KICK = 0.5 // rad/s of instant rotation the moment you grab it
const BASE_YAW = 1.6 // rad/s max turn rate (tapers with speed above YAW_REF_SPEED)
const YAW_REF_SPEED = 13 // m/s
const YAW_RESPONSE = 10 // how fast yaw rate approaches target
const AIR_YAW = 0.85 // rad/s of steering authority while airborne
const MAX_SLIP = 0.42 // rad — steering slip angle at full lock, low speed
const MAX_SLIP_HANDBRAKE = 0.72 // bigger slip while drifting
const STEER_SNAP = 6 // heading-error -> yaw-rate gain
const TURN_MIN_SPEED = 1.5 // below this you can't really steer
const MAX_AIR_TIME = 1.8 // airborne longer than this = fell off, respawn
const STEER_RATE = 5.5 // how fast the steering input itself moves, 1/s
const WHEEL_R = 0.42

const CAM_DIST = 8.6
const CAM_HEIGHT = 3.5
const CAM_LOOKAHEAD = 12
const FOV_BASE = 60
const FOV_GAIN = 24
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
  const prevForward = useRef(0)
  const shake = useRef(0)
  const wasRacing = useRef(false)
  const hbPrev = useRef(false)

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
    hbPrev.current = false
    resetCarState()
  }

  useFrame((state, delta) => {
    const b = body.current
    if (!b) return
    const dt = Math.min(delta, 1 / 30)
    const phase = getState().phase
    const racing = phase === 'racing'

    if (input.restart) {
      input.restart = false
      initAudio()
      startCountdown()
      return
    }
    if (input.respawn) {
      input.respawn = false
      const r = progress.respawn
      if (r) {
        placeAt(r.pos, r.yaw)
        return
      }
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

    // --- smoothed driver input ---------------------------------------------
    // +1 = steering left (toward +X / screen-left with the chase camera)
    const steerTarget = racing ? (input.left ? 1 : 0) - (input.right ? 1 : 0) : 0
    const sk = 1 - Math.exp(-STEER_RATE * dt)
    carState.steer = THREE.MathUtils.lerp(carState.steer, steerTarget, sk)
    const steer = carState.steer

    const throttleTarget = racing && input.forward ? 1 : 0
    const brakeTarget = racing && input.back && vForward > 1 ? 1 : 0
    carState.throttle = THREE.MathUtils.lerp(carState.throttle, throttleTarget, 1 - Math.exp(-9 * dt))
    carState.brake = THREE.MathUtils.lerp(carState.brake, brakeTarget, 1 - Math.exp(-14 * dt))
    carState.handbrake = racing && input.handbrake

    const rpm01 = updateDrivetrain(vForward)

    // Drive with impulses (not linvel overrides) so Rapier's own collision
    // response — bouncing off the barriers, which have restitution — still lands.
    impulse.current.set(0, 0, 0)

    // ---- longitudinal ----
    if (racing && grounded) {
      const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0)
      if (throttle > 0) {
        const taper = THREE.MathUtils.clamp(1 - vForward / MAX_SPEED, 0, 1)
        impulse.current.addScaledVector(fwd.current, ACCEL * torqueFactor(rpm01) * taper * dt)
      } else if (throttle < 0) {
        if (vForward > 1) impulse.current.addScaledVector(fwd.current, -BRAKE_ACCEL * dt)
        else impulse.current.addScaledVector(fwd.current, -REVERSE_ACCEL * dt)
      }
    }

    if (grounded) {
      // rolling resistance + drag
      const drag = LIN_DRAG + QUAD_DRAG * Math.abs(vForward)
      impulse.current.addScaledVector(fwd.current, -vForward * drag * dt)
      // handbrake: bleed forward speed as well as breaking the rear loose
      if (input.handbrake && racing) {
        const dv = Math.min(HANDBRAKE_DECEL * dt, Math.abs(vForward))
        impulse.current.addScaledVector(fwd.current, -Math.sign(vForward) * dv)
      }
      // lateral grip — kill sideways slide. Downforce adds bite with speed, so
      // fast sweepers stay planted while slow hairpins stay playful. It does
      // *not* apply under the handbrake: a locked, sliding tyre has no grip to
      // press harder onto the road.
      const aero = 1 + Math.min(speed / MAX_SPEED, 1) * AERO_GRIP
      const grip = input.handbrake ? GRIP_HANDBRAKE : GRIP * aero
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
    const av = b.angvel()
    const hb = racing && input.handbrake
    if (racing && grounded && speed > TURN_MIN_SPEED) {
      const velHeading = Math.atan2(lv.x, lv.z)
      const carHeading = Math.atan2(fwd.current.x, fwd.current.z)
      const dirSign = vForward < 0 ? -1 : 1
      const slipMax = hb ? MAX_SLIP_HANDBRAKE : MAX_SLIP
      const taper = THREE.MathUtils.clamp(
        YAW_REF_SPEED / speed,
        hb ? SLIP_FLOOR_HANDBRAKE : SLIP_FLOOR,
        1.3,
      )
      const slip = steer * slipMax * dirSign * taper
      let err = velHeading + slip - carHeading
      err = Math.atan2(Math.sin(err), Math.cos(err)) // wrap to [-pi, pi]
      const yawCeil = hb ? BASE_YAW * 1.4 : BASE_YAW
      const yawFloor = Math.min(hb ? YAW_FLOOR_HANDBRAKE : YAW_FLOOR, yawCeil)
      const yawCap = THREE.MathUtils.clamp((yawCeil * YAW_REF_SPEED) / speed, yawFloor, yawCeil)
      const targetYaw = THREE.MathUtils.clamp(err * STEER_SNAP, -yawCap, yawCap)
      // grabbing the handbrake mid-corner snaps the tail out straight away,
      // rather than waiting for the yaw rate to ramp
      let from = av.y
      if (hb && !hbPrev.current && speed > 8) from += steer * HANDBRAKE_KICK
      const k = 1 - Math.exp(-YAW_RESPONSE * dt)
      b.setAngvel({ x: 0, y: THREE.MathUtils.lerp(from, targetYaw, k), z: 0 }, true)
    } else if (!grounded && racing) {
      // a bit of air steering to line the landing up, Trackmania-style
      const k = 1 - Math.exp(-4 * dt)
      b.setAngvel({ x: 0, y: THREE.MathUtils.lerp(av.y, steer * AIR_YAW, k), z: 0 }, true)
    } else if (grounded) {
      b.setAngvel({ x: 0, y: av.y * (1 - Math.min(1, 10 * dt)), z: 0 }, true)
    }

    hbPrev.current = hb

    // ---- telemetry for the model, particles and audio ----------------------
    const wasAir = airTimer.current
    if (racing) {
      // "stuck" means trying to move and going nowhere — sitting still on the
      // grid with no input is not stuck
      if (grounded && speed < 2 && (input.forward || input.back)) stuckTimer.current += dt
      else stuckTimer.current = 0
      if (grounded) airTimer.current = 0
      else airTimer.current += dt
    }
    if (grounded && wasAir > 0.35) {
      thud(Math.min(0.18 + wasAir * 0.2, 0.5))
      shake.current = Math.min(wasAir * 0.5, 0.6)
    }

    const latAccel = av.y * vForward // cornering acceleration, m/s^2
    const longAccel = (vForward - prevForward.current) / Math.max(dt, 1e-4)
    prevForward.current = vForward
    const smooth = 1 - Math.exp(-8 * dt)
    carState.lateralG = THREE.MathUtils.lerp(carState.lateralG, latAccel / 9.81, smooth)
    carState.longG = THREE.MathUtils.lerp(
      carState.longG,
      THREE.MathUtils.clamp(longAccel / 9.81, -2.5, 2.5),
      smooth,
    )
    carState.speed = speed
    carState.vForward = vForward
    carState.vRight = vRight
    carState.grounded = grounded
    carState.airTime = airTimer.current
    carState.reversing = vForward < -0.5
    carState.slip = speed > 2 ? Math.min(Math.abs(vRight) / Math.max(speed, 6), 1) : 0
    // locked wheels under the handbrake, otherwise rolling with the road
    if (!(input.handbrake && racing)) {
      carState.wheelSpin += (vForward / WHEEL_R) * dt
      if (racing && grounded && input.forward && speed < 5) carState.wheelSpin += 14 * dt
    }
    carState.pos[0] = t.x
    carState.pos[1] = t.y
    carState.pos[2] = t.z
    carState.fwd[0] = fwd.current.x
    carState.fwd[2] = fwd.current.z
    carState.right[0] = right.current.x
    carState.right[2] = right.current.z

    if (racing) {
      updateAudio(carState)
      wasRacing.current = true
    } else if (wasRacing.current) {
      idleAudio()
      wasRacing.current = false
    }

    // ---- respawn ----
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
    hud.gear = carState.gear
    hud.rpm01 = carState.rpm01
    hud.drift = carState.slip

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
        air: +airTimer.current.toFixed(2),
        next: progress.next,
      }
    }

    // ---- chase camera ----
    // window.__freecam = true in dev frees the camera up for inspection
    if (import.meta.env.DEV && window.__freecam) return
    // Sits lower and closer than a typical follow cam, pulls back and widens
    // the lens with speed, and leans into corners.
    const speed01 = Math.min(speed / MAX_SPEED, 1)
    const dist = CAM_DIST + speed01 * 2.2
    camDesired.current.copy(fwd.current).multiplyScalar(-dist).add(carPos.current)
    camDesired.current.y += CAM_HEIGHT + speed01 * 0.5
    if (shake.current > 0.001) {
      camDesired.current.x += (Math.random() - 0.5) * shake.current
      camDesired.current.y += (Math.random() - 0.5) * shake.current
      camDesired.current.z += (Math.random() - 0.5) * shake.current
      shake.current *= 1 - Math.min(1, 6 * dt)
    }
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
    // roll the horizon slightly against the cornering load
    state.camera.rotateZ(THREE.MathUtils.clamp(carState.lateralG * 0.03, -0.06, 0.06))

    const targetFov = FOV_BASE + speed01 * speed01 * FOV_GAIN
    if (Math.abs(state.camera.fov - targetFov) > 0.05) {
      state.camera.fov = THREE.MathUtils.lerp(state.camera.fov, targetFov, 1 - Math.exp(-3 * dt))
      state.camera.updateProjectionMatrix()
    }
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
      <CarModel live />
    </RigidBody>
  )
}
