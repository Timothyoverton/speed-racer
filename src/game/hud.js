// Mutable telemetry bag. The physics loop writes here every frame; the HUD reads
// it on its own requestAnimationFrame. No React state involved.

export const hud = {
  timeMs: 0,
  speedKmh: 0,
  checkpoints: 0,
  totalCheckpoints: 0,
  ghostDeltaMs: null, // +ve => player is behind their ghost
  airborne: false,
  gear: 1,
  rpm01: 0, // 0..1 through the current gear, drives the rev bar
  drift: 0, // 0..1 how sideways the car is
  handbrake: false,
  airTime: 0, // seconds off the ground, for the flight readout
  topSpeedKmh: 0, // running max for the lap, banked with the record
  boost: 0, // seconds of boost left, drives the HUD flash
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__hud = hud

export function resetHud(totalCheckpoints) {
  hud.timeMs = 0
  hud.speedKmh = 0
  hud.checkpoints = 0
  hud.totalCheckpoints = totalCheckpoints
  hud.ghostDeltaMs = null
  hud.airborne = false
  hud.gear = 1
  hud.rpm01 = 0
  hud.drift = 0
  hud.handbrake = false
  hud.airTime = 0
  hud.topSpeedKmh = 0
  hud.boost = 0
}
