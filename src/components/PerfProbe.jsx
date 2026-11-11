import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { perf, recordFrame, frameStats, currentTier, TIERS } from '../game/perf.js'

// Frame-time probe plus a hidden readout. Toggle with the ` key, or open the
// page with ?perf. It records every frame into a ring buffer (no React state in
// the loop) and the panel repaints itself twice a second from that buffer.
//
// It also leaves a plain-text report on window.__perfReport() so a Playwright
// run on a real device can grab the numbers without screenshots.

function gpuName(gl) {
  try {
    const ctx = gl.getContext()
    const ext = ctx.getExtension('WEBGL_debug_renderer_info')
    return ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER)
  } catch {
    return 'unknown'
  }
}

function report() {
  const s = frameStats()
  if (!s) return 'no frames yet'
  const t = TIERS[currentTier()]
  return [
    `GPU ${perf.gpu}`,
    `buffer ${perf.buffer}   quality ${t.name}   fx ${t.fx ? (t.bloom ? 'bloom+grade' : 'grade') : 'off'}`,
    `frame ms  mean ${s.mean.toFixed(1)}  median ${s.median.toFixed(1)}  p99 ${s.p99.toFixed(1)}  => ${s.fps.toFixed(0)} fps`,
    `draw calls ${perf.calls}   triangles ${perf.triangles}   geometries ${perf.geometries}   textures ${perf.textures}`,
  ].join('\n')
}

export default function PerfProbe() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    perf.gpu = gpuName(gl)
    const el = document.createElement('pre')
    el.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:99998;margin:0;padding:8px 10px;font:11px/1.45 ui-monospace,Menlo,monospace;' +
      'color:#d8ffe8;background:rgba(0,0,0,.72);border-radius:6px;pointer-events:none;display:none;white-space:pre'
    document.body.appendChild(el)

    let open = /[?&]perf\b/.test(window.location.search)
    const paint = () => {
      el.style.display = open ? 'block' : 'none'
      if (open) el.textContent = report()
    }
    const onKey = (e) => {
      if (e.code === 'Backquote' || e.key === '`') {
        open = !open
        paint()
      }
    }
    window.addEventListener('keydown', onKey)
    const timer = setInterval(paint, 500)
    window.__perfReport = report
    paint()
    return () => {
      window.removeEventListener('keydown', onKey)
      clearInterval(timer)
      el.remove()
      delete window.__perfReport
    }
  }, [gl])

  // the composer renders several passes a frame; without this renderer.info
  // would only ever show the last one
  useEffect(() => {
    const info = gl.info
    info.autoReset = false
    return () => {
      info.autoReset = true
    }
  }, [gl])

  const acc = useRef(0)
  useFrame((state, dt) => {
    recordFrame(dt)
    acc.current += dt
    const info = state.gl.info
    if (acc.current > 1) {
      acc.current = 0
      perf.calls = info.render.calls
      perf.triangles = info.render.triangles
      perf.geometries = info.memory.geometries
      perf.textures = info.memory.textures
      perf.buffer = `${state.gl.domElement.width}x${state.gl.domElement.height}`
    }
    info.reset()
  })
  return null
}
