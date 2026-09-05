// Is this a phone/tablet? Auto-detected, but overridable so the touch layout
// can be exercised on a desktop without lying about the hardware.

const KEY = 'speed-racer:touch-mode'

export function detectTouch() {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const touch = navigator.maxTouchPoints > 0
  return !!(coarse && touch)
}

// 'auto' | 'on' | 'off'
export function touchModeSetting() {
  try {
    return localStorage.getItem(KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

export function setTouchMode(mode) {
  try {
    if (mode === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    /* private mode */
  }
}

export function touchControlsActive() {
  const mode = touchModeSetting()
  if (mode === 'on') return true
  if (mode === 'off') return false
  return detectTouch()
}
