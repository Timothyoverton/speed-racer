// Local persistence: personal bests + a small local leaderboard, keyed by track.
// Phase 2 will POST runs to an Azure Functions API backed by Cosmos DB and merge
// a global board in here; the read API (bestTime / topTimes / medalFor) stays.

const RECORDS_KEY = 'speed-racer:records:v1'
const NAME_KEY = 'speed-racer:name'
const MAX_ENTRIES = 8

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {}
  } catch {
    return {}
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(data))
  } catch {
    /* storage unavailable */
  }
}

export function topTimes(trackId) {
  return readAll()[trackId] || []
}

// Fastest speed ever recorded on this track, across every kept run.
export function bestTopSpeed(trackId) {
  const speeds = topTimes(trackId)
    .map((e) => e.topKmh)
    .filter((v) => v != null)
  return speeds.length ? Math.max(...speeds) : null
}

export function bestTime(trackId) {
  const list = topTimes(trackId)
  return list.length ? list[0].timeMs : null
}

// Returns { isPB, prevBest } and persists if it's a new entry worth keeping.
export function submitTime(trackId, name, timeMs, topKmh = null) {
  const all = readAll()
  const list = all[trackId] || []
  const prevBest = list.length ? list[0].timeMs : null
  const isPB = prevBest == null || timeMs < prevBest

  const next = [...list, { name: name || 'YOU', timeMs, topKmh, at: Date.now() }]
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, MAX_ENTRIES)

  all[trackId] = next
  writeAll(all)
  return { isPB, prevBest }
}

export function medalFor(timeMs, medals) {
  if (timeMs <= medals.author) return 'author'
  if (timeMs <= medals.gold) return 'gold'
  if (timeMs <= medals.silver) return 'silver'
  if (timeMs <= medals.bronze) return 'bronze'
  return 'none'
}

export function getName() {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

export function setName(name) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* ignore */
  }
}
