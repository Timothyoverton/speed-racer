import { useEffect, useRef } from 'react'
import { toggleMute } from './audio.js'

const MAP = {
  ArrowUp: 'forward',
  KeyW: 'forward',
  ArrowDown: 'back',
  KeyS: 'back',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'handbrake',
  KeyR: 'restart',
  Backspace: 'respawn',
  Delete: 'respawn',
  KeyQ: 'quit',
  KeyC: 'camera',
}

// Fallback lookup on e.key. Not every keydown carries a usable e.code —
// remote-desktop sessions, on-screen/virtual keyboards and synthetic events
// routinely leave it empty, and then a code-only lookup silently drops the key.
const KEY_MAP = {
  ' ': 'handbrake',
  spacebar: 'handbrake',
  arrowup: 'forward',
  arrowdown: 'back',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'forward',
  s: 'back',
  a: 'left',
  d: 'right',
  r: 'restart',
  backspace: 'respawn',
  delete: 'respawn',
  q: 'quit',
  c: 'camera',
}

function actionFor(e) {
  if (e.code && MAP[e.code]) return MAP[e.code]
  if (!e.key) return null
  return KEY_MAP[e.key === ' ' ? ' ' : e.key.toLowerCase()] || null
}

function isMuteKey(e) {
  return e.code === 'KeyM' || e.key?.toLowerCase() === 'm'
}

// Shared input state. Touch buttons in App also poke at this object.
export const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  handbrake: false,
  restart: false,
  respawn: false,
  quit: false,
  camera: false,
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__input = input
}

export function useKeyboardInput() {
  const ref = useRef(input)
  useEffect(() => {
    const down = (e) => {
      if (isMuteKey(e) && document.activeElement?.tagName !== 'INPUT') {
        toggleMute()
        return
      }
      const action = actionFor(e)
      if (!action) return
      // Backspace in the name field must still delete characters
      if ((action === 'respawn' || action === 'quit' || action === 'camera') &&
        document.activeElement?.tagName === 'INPUT') {
        return
      }
      input[action] = true
      // Space scrolls the page and activates a focused button; arrows scroll too
      if (action === 'handbrake' || action === 'respawn' || /^Arrow/.test(e.key || '')) {
        e.preventDefault()
      }
      const el = document.activeElement
      if (el && el.tagName === 'BUTTON') el.blur()
    }
    const up = (e) => {
      const action = actionFor(e)
      if (!action) return
      input[action] = false
      if (action === 'handbrake') e.preventDefault()
    }
    const blur = () => {
      for (const k of Object.keys(input)) input[k] = false
    }
    // Capture phase: a focused button or a host container that handles Space
    // itself would otherwise stop the event before it bubbles up to window.
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return ref
}
