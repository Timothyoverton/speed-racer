import { TRACK, CHECKPOINT_COUNT } from './track.js'

// Per-run progression: which checkpoints have been cleared, and where to drop
// the car back on a respawn.

export const progress = {
  next: 0, // index of the next checkpoint that counts
  respawn: null, // { pos:[x,y,z], yaw } — last cleared gate (or start)
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__progress = progress

export function resetProgress() {
  progress.next = 0
  progress.respawn = { pos: TRACK.start.pos.slice(), yaw: TRACK.start.yaw }
}

// Called by a checkpoint sensor. Returns true if this was the awaited gate.
export function clearCheckpoint(index) {
  if (index !== progress.next) return false
  progress.next += 1
  const cp = TRACK.checkpoints[index]
  progress.respawn = { pos: [cp.pos[0], cp.pos[1] + 0.6, cp.pos[2]], yaw: cp.yaw }
  return true
}

export function allCheckpointsCleared() {
  return progress.next >= CHECKPOINT_COUNT
}
