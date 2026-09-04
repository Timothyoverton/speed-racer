import { useEffect, useRef } from 'react'
import { hud } from '../game/hud.js'
import { formatTime, formatDelta } from '../game/format.js'

// Reads the mutable `hud` bag on its own rAF and paints straight into refs.
// Never triggers a React render.
export default function Hud() {
  const timeRef = useRef(null)
  const deltaRef = useRef(null)
  const speedRef = useRef(null)
  const cpRef = useRef(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (timeRef.current) timeRef.current.textContent = formatTime(hud.timeMs)
      if (speedRef.current) speedRef.current.textContent = String(Math.round(hud.speedKmh))
      if (cpRef.current) cpRef.current.textContent = `${hud.checkpoints} / ${hud.totalCheckpoints}`
      const d = deltaRef.current
      if (d) {
        if (hud.ghostDeltaMs == null) {
          d.textContent = ''
          d.className = 'delta'
        } else {
          d.textContent = formatDelta(hud.ghostDeltaMs)
          d.className = 'delta ' + (hud.ghostDeltaMs <= 0 ? 'ahead' : 'behind')
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="hud">
      <div className="timer">
        <span ref={timeRef}>0:00.000</span>
        <span ref={deltaRef} className="delta" />
      </div>
      <div className="progress">
        checkpoints <b ref={cpRef}>0 / 0</b>
      </div>
      <div className="speed">
        km/h
        <b ref={speedRef}>0</b>
      </div>
      <div className="restart-hint">
        <kbd>R</kbd> restart &nbsp;·&nbsp; <kbd>Space</kbd> handbrake
      </div>
    </div>
  )
}
