import { useEffect } from 'react'
import Scene from './components/Scene.jsx'
import Hud from './components/Hud.jsx'
import Menu from './components/Menu.jsx'
import Countdown from './components/Countdown.jsx'
import Result from './components/Result.jsx'
import TouchControls from './components/TouchControls.jsx'
import { usePhase } from './game/store.js'
import { useKeyboardInput } from './game/useKeys.js'
import { touchControlsActive } from './game/device.js'

export default function App() {
  const phase = usePhase()
  useKeyboardInput()
  const showHud = phase === 'racing' || phase === 'countdown'
  const touch = touchControlsActive()

  // keep the page from scrolling on arrow / space
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
      {phase === 'countdown' && <Countdown />}
      {phase === 'finished' && <Result />}
    </>
  )
}
