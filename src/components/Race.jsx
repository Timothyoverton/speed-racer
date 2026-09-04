import { useMemo } from 'react'
import Track from './Track.jsx'
import Car from './Car.jsx'
import Ghost from './Ghost.jsx'
import Effects from './Effects.jsx'
import { resetCarState } from '../game/carState.js'
import { TRACK, CHECKPOINT_COUNT } from '../game/track.js'
import { finishRace } from '../game/store.js'
import { resetProgress } from '../game/progress.js'
import { resetHud } from '../game/hud.js'
import { resetTimer, stopTimer } from '../game/timing.js'
import { GhostRecorder, activeGhost, loadGhost } from '../game/ghost.js'
import { submitTime, medalFor, bestTime, getName } from '../game/leaderboard.js'

// Mounted fresh for every run (keyed by runId in the parent). All the reset
// logic lives in the useMemo so it runs exactly once per run, before first frame.
export default function Race() {
  const recorder = useMemo(() => {
    resetProgress()
    resetHud(CHECKPOINT_COUNT)
    resetTimer()
    resetCarState()
    activeGhost.frames = loadGhost(TRACK.id)
    return new GhostRecorder()
  }, [])

  function onFinish() {
    const timeMs = stopTimer()
    const name = getName()
    const prevBest = bestTime(TRACK.id)
    const { isPB } = submitTime(TRACK.id, name, timeMs)
    if (isPB) recorder.save(TRACK.id)
    finishRace({
      timeMs,
      isPB,
      prevBest,
      delta: prevBest != null ? timeMs - prevBest : null,
      medal: medalFor(timeMs, TRACK.medals),
    })
  }

  return (
    <>
      <Track onFinish={onFinish} />
      <Ghost />
      <Car recorder={recorder} />
      <Effects />
    </>
  )
}
