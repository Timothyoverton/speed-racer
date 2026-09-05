// Steering by rotating the phone.
//
// Two things make this fiddly and both are handled here rather than in the UI:
//  - which axis means "rotate like a steering wheel" depends on how the phone
//    is held, so the axis is chosen from screen.orientation.angle;
//  - "level" is wherever the player is actually holding it, not 0, so the
//    baseline is captured on demand and everything is measured against that.
//
// iOS additionally requires DeviceOrientationEvent.requestPermission() from a
// user gesture — enableTilt() must be called from a tap handler.

import { input } from './useKeys.js'

const INVERT_KEY = 'speed-racer:tilt-invert'
const RANGE_DEG = 28 // tilt this far from level for full lock
const DEAD_DEG = 2.5 // ignore this much, so a steady hand tracks straight

export const tilt = {
  supported: typeof window !== 'undefined' && 'DeviceOrientationEvent' in window,
  active: false,
  permission: 'unknown', // 'unknown' | 'granted' | 'denied' | 'unsupported'
  raw: 0, // the chosen axis, degrees
  zero: 0, // captured baseline
  steer: 0, // -1..1, what the car actually gets
  invert: readInvert(),
}

function readInvert() {
  try {
    return localStorage.getItem(INVERT_KEY) === '1'
  } catch {
    return false
  }
}

export function toggleInvert() {
  tilt.invert = !tilt.invert
  try {
    localStorage.setItem(INVERT_KEY, tilt.invert ? '1' : '0')
  } catch {
    /* private mode */
  }
  return tilt.invert
}

// Which reading swings when you rotate the phone like a wheel.
function axisFor(e) {
  const angle = (typeof screen !== 'undefined' && screen.orientation?.angle) ?? window.orientation ?? 0
  if (angle === 90) return -e.beta
  if (angle === 270 || angle === -90) return e.beta
  return e.gamma // portrait, and the 0-degree landscape case on some devices
}

function onOrientation(e) {
  if (e.beta == null && e.gamma == null) return
  const raw = axisFor(e) || 0
  tilt.raw = raw
  const off = raw - tilt.zero
  const sign = tilt.invert ? -1 : 1
  const mag = Math.max(Math.abs(off) - DEAD_DEG, 0) / (RANGE_DEG - DEAD_DEG)
  // negative because tilting left should steer left, and +1 is left in the
  // car's convention (toward +X / screen-left with the chase camera)
  tilt.steer = Math.max(-1, Math.min(1, mag)) * -Math.sign(off) * sign
  input.axis = tilt.steer
}

// Capture "however I'm holding it right now" as straight ahead.
export function calibrateTilt() {
  tilt.zero = tilt.raw
  tilt.steer = 0
  input.axis = 0
}

export async function enableTilt() {
  if (!tilt.supported) {
    tilt.permission = 'unsupported'
    return false
  }
  const DOE = window.DeviceOrientationEvent
  if (typeof DOE.requestPermission === 'function') {
    try {
      const res = await DOE.requestPermission() // iOS — needs a user gesture
      tilt.permission = res
      if (res !== 'granted') return false
    } catch {
      tilt.permission = 'denied'
      return false
    }
  } else {
    tilt.permission = 'granted'
  }
  if (!tilt.active) {
    window.addEventListener('deviceorientation', onOrientation)
    tilt.active = true
  }
  // give it a moment of readings, then treat the current pose as level
  setTimeout(calibrateTilt, 400)
  return true
}

export function disableTilt() {
  if (tilt.active) window.removeEventListener('deviceorientation', onOrientation)
  tilt.active = false
  input.axis = null
}
