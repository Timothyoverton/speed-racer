// Mutable telemetry bag. The physics loop writes here every frame; the HUD reads
// it on its own requestAnimationFrame. No React state involved.

export const hud = {
  timeMs: 0,
  speedKmh: 0,
  checkpoints: 0,
  totalCheckpoints: 0,
  ghostDeltaMs: null, // +ve => player is behind their ghost
  airborne: false,
}

export function resetHud(totalCheckpoints) {
  hud.timeMs = 0
  hud.speedKmh = 0
  hud.checkpoints = 0
  hud.totalCheckpoints = totalCheckpoints
  hud.ghostDeltaMs = null
  hud.airborne = false
}
