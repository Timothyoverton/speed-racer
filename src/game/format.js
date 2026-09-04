export function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '--:--.---'
  const sign = ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  const m = Math.floor(abs / 60000)
  const s = Math.floor((abs % 60000) / 1000)
  const cs = Math.floor(abs % 1000)
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`
}

export function formatDelta(ms) {
  if (ms == null || !isFinite(ms)) return ''
  const sign = ms > 0 ? '+' : '-'
  const abs = Math.abs(ms)
  const s = Math.floor(abs / 1000)
  const cs = Math.floor(abs % 1000)
  return `${sign}${s}.${String(cs).padStart(3, '0')}`
}

export const MEDAL_LABEL = {
  author: 'Author',
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
  none: 'No medal',
}

export const MEDAL_ICON = {
  author: '★',
  gold: '🥇',
  silver: '🥈',
  bronze: '🥉',
  none: '–',
}
