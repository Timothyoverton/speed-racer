import { useEffect, useRef, useState } from 'react'
import { hud } from '../game/hud.js'
import { formatTime, formatDelta } from '../game/format.js'
import { isMuted, toggleMute } from '../game/audio.js'

// Reads the mutable `hud` bag on its own rAF and paints straight into refs.
// Never triggers a React render (the mute toggle is the one exception).
export default function Hud() {
  const timeRef = useRef(null)
  const deltaRef = useRef(null)
  const speedRef = useRef(null)
  const cpRef = useRef(null)
  const gearRef = useRef(null)
  const revRef = useRef(null)
  const rushRef = useRef(null)
  const hbRef = useRef(null)
  const topRef = useRef(null)
  const [muted, setMuted] = useState(isMuted)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (timeRef.current) timeRef.current.textContent = formatTime(hud.timeMs)
      if (speedRef.current) speedRef.current.textContent = String(Math.round(hud.speedKmh))
      if (cpRef.current) cpRef.current.textContent = `${hud.checkpoints} / ${hud.totalCheckpoints}`
      if (gearRef.current) {
        gearRef.current.textContent = hud.gear < 0 ? 'R' : String(hud.gear)
      }
      if (revRef.current) {
        revRef.current.style.transform = `scaleX(${hud.rpm01.toFixed(3)})`
        revRef.current.style.background =
          hud.rpm01 > 0.93 ? 'var(--danger)' : 'linear-gradient(90deg, var(--accent), var(--accent-2))'
      }
      if (rushRef.current) {
        // vignette + edge blur that closes in as the car gets quick
        const v = Math.min(Math.max((hud.speedKmh - 90) / 130, 0), 1)
        rushRef.current.style.opacity = (v * 0.85 + hud.drift * 0.25).toFixed(3)
      }
      if (hbRef.current) hbRef.current.classList.toggle('on', hud.handbrake)
      if (topRef.current) topRef.current.textContent = String(Math.round(hud.topSpeedKmh))
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
      <div className="rush" ref={rushRef} />

      <div className="timer">
        <span ref={timeRef}>0:00.000</span>
        <span ref={deltaRef} className="delta" />
      </div>

      <div className="progress">
        checkpoints <b ref={cpRef}>0 / 0</b>
      </div>

      <div className="speed">
        <div className="revbar">
          <i ref={revRef} />
        </div>
        <div className="readout">
          <span className="gear" ref={gearRef}>1</span>
          <b ref={speedRef}>0</b>
          <span className="unit">km/h</span>
        </div>
        <div className="topspeed">
          top <b ref={topRef}>0</b>
        </div>
      </div>

      <div className="restart-hint">
        <kbd>R</kbd> restart &nbsp;·&nbsp; <kbd ref={hbRef}>Space</kbd> handbrake &nbsp;·&nbsp;{' '}
        <kbd>Del</kbd> back to checkpoint &nbsp;·&nbsp; <kbd>C</kbd> camera &nbsp;·&nbsp; <kbd>Q</kbd> quit
      </div>

      <button
        className="mute"
        onClick={() => setMuted(toggleMute())}
        title="Mute (M)"
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  )
}
