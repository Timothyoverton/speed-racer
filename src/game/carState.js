// Mutable per-frame car telemetry. Written by the physics loop in Car.jsx,
// read by the car model (wheels, lights, body roll), the particle effects and
// the audio engine. Plain object on purpose — no React, no allocation.

export const carState = {
  // driver input, smoothed
  steer: 0, // -1 right .. +1 left
  throttle: 0, // 0..1
  brake: 0, // 0..1
  handbrake: false,
  reversing: false,

  // motion
  speed: 0, // m/s, horizontal
  vForward: 0,
  vRight: 0,
  lateralG: 0, // smoothed, for body roll
  longG: 0, // smoothed, for squat / dive
  slip: 0, // 0..1 how sideways the car is going
  grounded: true,
  airTime: 0,
  // how the road under the car is tilted, in the car's own axes (radians)
  groundPitch: 0,
  groundRoll: 0,

  // drivetrain (for HUD + audio; does not feed the physics directly)
  gear: 1,
  rpm: 900,
  rpm01: 0,
  wheelSpin: 0, // accumulated wheel rotation, radians

  // world transform, for particles
  pos: [0, 0, 0],
  fwd: [0, 0, 1],
  right: [1, 0, 0],
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__car = carState

export function resetCarState() {
  Object.assign(carState, {
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    reversing: false,
    speed: 0,
    vForward: 0,
    vRight: 0,
    lateralG: 0,
    longG: 0,
    slip: 0,
    grounded: true,
    airTime: 0,
    groundPitch: 0,
    groundRoll: 0,
    gear: 1,
    rpm: 900,
    rpm01: 0,
    wheelSpin: 0,
  })
}

// --- drivetrain model -------------------------------------------------------
// Top speed of each gear in m/s. Purely cosmetic/audible: it gives the engine
// note somewhere to climb to and something to drop back from on the shift.
const GEAR_TOPS = [11, 19, 28, 38, 49, 62]
const IDLE_RPM = 900
const MAX_RPM = 8200

export function updateDrivetrain(vForward) {
  const v = Math.abs(vForward)
  let gear = 0
  while (gear < GEAR_TOPS.length - 1 && v > GEAR_TOPS[gear]) gear++
  const lo = gear === 0 ? 0 : GEAR_TOPS[gear - 1]
  const hi = GEAR_TOPS[gear]
  const span = Math.max(hi - lo, 1)
  const frac = Math.min(Math.max((v - lo) / span, 0), 1)
  // each gear starts around 3200 rpm and pulls to the limiter
  const rpm = IDLE_RPM + (0.36 + 0.64 * frac) * (MAX_RPM - IDLE_RPM)
  carState.gear = vForward < -0.5 ? -1 : gear + 1
  carState.rpm = v < 0.4 ? IDLE_RPM : rpm
  carState.rpm01 = (carState.rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM)
  return carState.rpm01
}

// Mild torque curve so the engine has a character: soft off idle, strong in the
// mid-range, tailing off at the limiter. Multiplies engine force.
export function torqueFactor(rpm01) {
  return 0.86 + 0.34 * Math.sin(Math.min(rpm01, 1) * Math.PI * 0.92)
}
