// Wall-clock race timer.
//
// Phase 1 uses performance.now(). This is good enough for local play but is NOT
// deterministic across machines — Phase 2 (verified global leaderboard) will
// switch to counting fixed physics steps so a replay always yields the same
// time regardless of frame rate. Keep the API surface small so that swap is easy.

let startedAt = 0
let stoppedMs = 0
let running = false

export function startTimer() {
  startedAt = performance.now()
  stoppedMs = 0
  running = true
}

export function stopTimer() {
  if (running) {
    stoppedMs = performance.now() - startedAt
    running = false
  }
  return stoppedMs
}

export function resetTimer() {
  startedAt = 0
  stoppedMs = 0
  running = false
}

export function elapsedMs() {
  return running ? performance.now() - startedAt : stoppedMs
}

export function isRunning() {
  return running
}
