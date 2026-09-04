import { useEffect, useState } from 'react'
import { beginRacing } from '../game/store.js'

const STEPS = [
  { at: 0, text: '3' },
  { at: 750, text: '2' },
  { at: 1500, text: '1' },
  { at: 2250, text: 'GO', go: true },
]

export default function Countdown() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timers = STEPS.map((s, i) =>
      setTimeout(() => {
        setStep(i)
        if (s.go) beginRacing()
      }, s.at),
    )
    const hide = setTimeout(() => setStep(-1), 2900)
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
