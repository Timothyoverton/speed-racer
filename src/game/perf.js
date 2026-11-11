// Frame-time stats. Singleton, like the rest of the per-frame state: the render
// loop writes into a ring buffer here and the readout panel (PerfProbe) reads it
// on its own timer, so nothing about the 60 fps loop touches React.

// ---- frame-time ring buffer ------------------------------------------------
const N = 600
const ring = new Float32Array(N)
let head = 0
let count = 0

export const perf = {
  // renderer.info, copied in once a second by the probe
  calls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  gpu: '',
  buffer: '',
}

export function recordFrame(dtSec) {
  ring[head] = dtSec * 1000
  head = (head + 1) % N
  if (count < N) count++
}

export function frameStats() {
  if (!count) return null
  const a = Array.from(ring.subarray(0, count)).sort((x, y) => x - y)
  const sum = a.reduce((s, v) => s + v, 0)
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))]
  const mean = sum / a.length
  return { mean, median: q(0.5), p99: q(0.99), fps: 1000 / mean, samples: a.length }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__perf = { perf, frameStats }
}
