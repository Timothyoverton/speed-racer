import { useSyncExternalStore } from 'react'
import { detectTouch } from './device.js'

// Quality tiers and frame-time stats. Singleton, like the rest of the per-frame
// state: the render loop writes into a ring buffer here and the readout panel
// reads it on its own timer, so nothing about the 60 fps loop touches React.

const KEY = 'speed-racer:quality'

// What each tier turns on. `dpr` is the pixel-ratio ceiling; `fx` switches the
// post-processing grade (bloom + colour grade + vignette) on or off.
export const TIERS = {
  low: { name: 'Low', dpr: 1, fx: false, bloom: false },
  medium: { name: 'Medium', dpr: 1.25, fx: true, bloom: false },
  high: { name: 'High', dpr: 1.5, fx: true, bloom: true },
}
export const TIER_ORDER = ['low', 'medium', 'high']

function readSetting() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'low' || v === 'medium' || v === 'high' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

let setting = readSetting() // 'auto' | a tier name
// where auto currently sits: phones start low, everything else high, and the
// PerformanceMonitor in Scene steps it down (or back up) if frames sag
let autoTier = detectTouch() ? 'low' : 'high'
let snapshot = null
const listeners = new Set()

function tierNow() {
  return setting === 'auto' ? autoTier : setting
}

function emit() {
  snapshot = null
  listeners.forEach((l) => l())
}

export function qualitySetting() {
  return setting
}

export function setQualitySetting(v) {
  setting = v
  try {
    if (v === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, v)
  } catch {
    /* private mode */
  }
  emit()
}

// PerformanceMonitor hooks. Only auto mode moves; a manual choice is respected.
export function stepAutoTier(dir) {
  const i = TIER_ORDER.indexOf(autoTier)
  const j = Math.max(0, Math.min(TIER_ORDER.length - 1, i + dir))
  if (j === i) return
  autoTier = TIER_ORDER[j]
  if (setting === 'auto') emit()
}

export function currentTier() {
  return tierNow()
}

function getSnapshot() {
  if (!snapshot) snapshot = { setting, tier: tierNow(), ...TIERS[tierNow()] }
  return snapshot
}

function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

// React hook for the few places that rebuild on a tier change (Scene, Menu)
export function useQuality() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

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
  window.__perf = { perf, frameStats, currentTier, setQualitySetting }
}
