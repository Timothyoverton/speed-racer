import { useEffect, useRef, useState } from 'react'
import { input } from '../game/useKeys.js'
import { tilt, calibrateTilt, enableTilt, toggleInvert } from '../game/tilt.js'

// Thumb controls for phones. Throttle and brake are big pads under where your
// thumbs already are in landscape; steering comes from rotating the phone.
function hold(action) {
  const set = (v) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    input[action] = v
  }
  return {
    onPointerDown: set(true),
    onPointerUp: set(false),
    onPointerLeave: set(false),
    onPointerCancel: set(false),
  }
}

function tap(fn) {
  return {
    onPointerDown: (e) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    },
  }
}

export default function TouchControls() {
  const needleRef = useRef(null)
  const [invert, setInvert] = useState(tilt.invert)
  const [state, setState] = useState({ active: tilt.active, permission: tilt.permission })

  // Paint the steering indicator on its own rAF, and keep an eye on whether
  // tilt has come alive. Permission is granted asynchronously (and on iOS only
  // after the DRIVE tap), which is usually *after* this component mounts — so
  // a snapshot taken at mount would leave the fallback arrows on screen for
  // ever, which is exactly what happened.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (needleRef.current) {
        const s = input.axis ?? 0
        needleRef.current.style.transform = `translateX(${(s * 76).toFixed(1)}px)`
      }
      setState((prev) =>
        prev.active === tilt.active && prev.permission === tilt.permission
          ? prev
          : { active: tilt.active, permission: tilt.permission },
      )
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const askTilt = async () => {
    await enableTilt()
    setState({ active: tilt.active, permission: tilt.permission })
  }

  return (
    <div className="touch">
      <div className="pad brake" {...hold('back')}>
        <span>BRAKE</span>
      </div>
      <div className="pad gas" {...hold('forward')}>
        <span>GO</span>
      </div>
      <div className="pad hand" {...hold('handbrake')}>
        <span>DRIFT</span>
      </div>

      <div className="tminor">
        <button {...tap(() => (input.restart = true))}>R</button>
        <button {...tap(() => (input.camera = true))}>CAM</button>
        <button {...tap(() => (input.respawn = true))}>CP</button>
        <button {...tap(() => (input.quit = true))}>Q</button>
      </div>

      <div className="steerbar">
        {state.active ? (
          <>
            <div className="track">
              <i ref={needleRef} />
            </div>
            <div className="tiltrow">
              <button {...tap(calibrateTilt)}>Centre</button>
              <button {...tap(() => setInvert(toggleInvert()))}>
                {invert ? 'Inverted' : 'Normal'}
              </button>
            </div>
          </>
        ) : (
          <button className="tiltEnable" {...tap(askTilt)}>
            {state.permission === 'denied'
              ? 'Tilt blocked — use ◀ ▶'
              : state.permission === 'unsupported'
                ? 'No tilt on this device'
                : 'Tap to steer by tilting'}
          </button>
        )}
      </div>

      {/* fallback steering if tilt is unavailable or refused */}
      {!state.active && (
        <div className="tsteer">
          <div className="pad small" {...hold('left')}>◀</div>
          <div className="pad small" {...hold('right')}>▶</div>
        </div>
      )}
    </div>
  )
}
