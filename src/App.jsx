import { useEffect } from 'react'
import Scene from './components/Scene.jsx'
import Hud from './components/Hud.jsx'
import Menu from './components/Menu.jsx'
import Countdown from './components/Countdown.jsx'
import Result from './components/Result.jsx'
import TouchControls from './components/TouchControls.jsx'
import { usePhase } from './game/store.js'
import { useKeyboardInput } from './game/useKeys.js'

export default function App() {
  const phase = usePhase()
  useKeyboardInput()

  // keep the page from scrolling on arrow / space
  useEffect(() => {
    document.body.style.overscrollBehavior = 'none'
  }, [])

  const showHud = phase === 'racing' || phase === 'countdown'

  return (
    <>
      <Scene />
      {showHud && <Hud />}
      {showHud && <TouchControls />}
      {phase === 'menu' && <Menu />}
      {phase === 'countdown' && <Countdown />}
      {phase === 'finished' && <Result />}
    </>
  )
}
