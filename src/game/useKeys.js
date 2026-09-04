import { useEffect, useRef } from 'react'

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
}

// Shared input state. Touch buttons in App also poke at this object.
export const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  handbrake: false,
  restart: false,
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__input = input
}

export function useKeyboardInput() {
  const ref = useRef(input)
  useEffect(() => {
    const down = (e) => {
      const action = MAP[e.code]
      if (!action) return
      input[action] = true
      // Space + Arrows scroll the page / activate a focused button — block that
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
      const el = document.activeElement
      if (el && el.tagName === 'BUTTON') el.blur()
    }
    const up = (e) => {
      const action = MAP[e.code]
      if (!action) return
      input[action] = false
      if (e.code === 'Space') e.preventDefault()
    }
    const blur = () => {
      for (const k of Object.keys(input)) input[k] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return ref
}
