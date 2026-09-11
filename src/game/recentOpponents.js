// Small localStorage list of the last couple of real "Race a friend" opponents,
// so the menu can offer a one-tap rejoin instead of a fresh invite every time
// (kids trying different tracks back-to-back kept re-hosting from scratch).
// Per-browser, informational only — there's no persistent friend identity
// beyond "whatever name they typed", and the room code only works again if
// that room is still alive (see mp.js rejoinRoom).

const KEY = 'speed-racer:recent-opponents'
const MAX = 2

export function recentOpponents() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function recordOpponent(name, code) {
  if (!name || !code) return
  try {
    const list = recentOpponents().filter((o) => o.name !== name)
    list.unshift({ name, code, ts: Date.now() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* ignore */
  }
}
