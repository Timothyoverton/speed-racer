import { useEffect } from 'react'
import Scene from './components/Scene.jsx'
import Hud from './components/Hud.jsx'
import Menu from './components/Menu.jsx'
import Lobby from './components/Lobby.jsx'
import Countdown from './components/Countdown.jsx'
import Result from './components/Result.jsx'
import TouchControls from './components/TouchControls.jsx'
import { usePhase } from './game/store.js'
import { useKeyboardInput } from './game/useKeys.js'
import { touchControlsActive } from './game/device.js'
import { bootstrapMultiplayer, useMultiplayerCoordinator } from './game/mp.js'

// pick up a ?join= link before React renders, so we land straight in the lobby
// (may reload the page once to switch onto the friend's track)
bootstrapMultiplayer()

export default function App() {
  const phase = usePhase()
  useKeyboardInput()
  useMultiplayerCoordinator()
  const showHud = phase === 'racing' || phase === 'countdown'
  const touch = touchControlsActive()

  useEffect(() => {
    document.body.style.overscrollBehavior = 'none'
  }, [])

  useEffect(() => {
    document.body.classList.toggle('touch-mode', touch)
  }, [touch])

  return (
    <>
      <Scene />
      {showHud && <Hud />}
      {showHud && touch && <TouchControls />}
      {phase === 'menu' && <Menu />}
      {phase === 'lobby' && <Lobby />}
      {phase === 'countdown' && <Countdown />}
      {phase === 'finished' && <Result />}
    </>
  )
}
