import { useSyncExternalStore } from 'react'
import { startTimer, resetTimer } from './timing.js'

// Tiny external store for coarse-grained race state (phase, run id, results).
// Deliberately NOT used for per-frame values like timer / speed — those are
// written straight to the DOM in the HUD to avoid re-rendering React every frame.

const listeners = new Set()

let state = {
  phase: 'menu', // 'menu' | 'countdown' | 'racing' | 'finished'
  runId: 0, // bump to force a full car + physics reset
  result: null, // { timeMs, isPB, medal, prevBest, delta }
}

function emit() {
  for (const l of listeners) l()
}

export function getState() {
  return state
}

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  emit()
}

function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function usePhase() {
  return useSyncExternalStore(subscribe, () => state.phase)
}

export function useRunId() {
  return useSyncExternalStore(subscribe, () => state.runId)
}

export function useResult() {
  return useSyncExternalStore(subscribe, () => state.result)
}

// --- transitions ---

export function startCountdown() {
  resetTimer()
  setState((s) => ({ phase: 'countdown', runId: s.runId + 1, result: null }))
}

export function beginRacing() {
  startTimer()
  setState({ phase: 'racing' })
}

export function finishRace(result) {
  setState({ phase: 'finished', result })
}

export function toMenu() {
  setState({ phase: 'menu', result: null })
}
