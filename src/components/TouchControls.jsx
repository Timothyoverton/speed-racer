import { input } from '../game/useKeys.js'

// Simple thumb controls for coarse-pointer devices (shown via CSS media query).
function bind(action) {
  return {
    onPointerDown: (e) => {
      e.preventDefault()
      input[action] = true
    },
    onPointerUp: () => {
      input[action] = false
    },
    onPointerLeave: () => {
      input[action] = false
    },
    onPointerCancel: () => {
      input[action] = false
    },
  }
}

export default function TouchControls() {
  return (
    <div className="touch">
      <button className="left" {...bind('left')}>◀</button>
      <button className="right" {...bind('right')}>▶</button>
      <button className="brake" {...bind('back')}>▼</button>
      <button className="gas" {...bind('forward')}>▲</button>
    </div>
  )
}
