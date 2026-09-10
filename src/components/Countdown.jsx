import { useEffect, useState } from 'react'
import { beginRacing, getState } from '../game/store.js'
import { countdownBeep } from '../game/audio.js'
import { session } from '../game/net.js'

const STEPS = [
  { at: 0, text: '3' },
  { at: 750, text: '2' },
  { at: 1500, text: '1' },
  { at: 2250, text: 'GO', go: true },
]
const GO_AT = 2250

export default function Countdown() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    // In a two-player race the server hands both clients the same GO timestamp
    // (net.session.startAtLocal, already converted to our own clock). Line the
    // steps up so GO lands exactly on it; single player just counts from now.
    const mp = getState().multiplayer
    const t0 =
      mp && session.startAtLocal != null
        ? session.startAtLocal - GO_AT
        : performance.timeOrigin + performance.now()

    const now = performance.timeOrigin + performance.now()

    const timers = STEPS.map((s, i) => {
      const delay = Math.max(0, t0 + s.at - now)
      return setTimeout(() => {
        setStep(i)
        countdownBeep(!!s.go)
        if (s.go) beginRacing()
      }, delay)
    })
    const hide = setTimeout(() => setStep(-1), Math.max(0, t0 + GO_AT - now) + 650)
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(hide)
    }
  }, [])

  if (step < 0) return null
  const s = STEPS[step]
  return (
    <div className="overlay">
      <div className={'countdown' + (s.go ? ' go' : '')} key={step}>
        {s.text}
      </div>
    </div>
  )
}
