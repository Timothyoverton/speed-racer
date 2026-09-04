import { TRACK } from '../game/track.js'
import { useResult, startCountdown, toMenu } from '../game/store.js'
import { topTimes } from '../game/leaderboard.js'
import { formatTime, formatDelta, MEDAL_LABEL, MEDAL_ICON } from '../game/format.js'

export default function Result() {
  const result = useResult()
  if (!result) return null
  const { timeMs, isPB, delta, medal, topKmh } = result
  const board = topTimes(TRACK.id)

  return (
    <div className="overlay">
      <div className="panel">
        <div className="subtitle">{TRACK.name} — finish</div>
        {isPB && <div className="result-pb">★ New personal best</div>}
        <div className="result-time">{formatTime(timeMs)}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span className={`medal-badge ${medal}`}>
            {MEDAL_ICON[medal]} {MEDAL_LABEL[medal]}
          </span>
          {topKmh != null && (
            <span className="value" style={{ color: 'var(--muted)' }}>
              top <b style={{ color: 'var(--text)' }}>{topKmh}</b> km/h
            </span>
          )}
          {delta != null && (
            <span className={'delta ' + (delta <= 0 ? 'ahead' : 'behind')} style={{ fontWeight: 700 }}>
              {formatDelta(delta)} vs previous best
            </span>
          )}
        </div>

        {medal !== 'author' && (
          <div className="row">
            <span className="label">Next target — {MEDAL_LABEL[nextMedal(medal)]}</span>
            <span className="value">{formatTime(TRACK.medals[nextMedal(medal)])}</span>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <div className="subtitle" style={{ marginBottom: 4 }}>Local leaderboard</div>
          {board.slice(0, 5).map((e, i) => (
            <div className="row" key={i}>
              <span className="label">{i + 1}. {e.name}</span>
              <span className="value">
                {formatTime(e.timeMs)}
                <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                  {e.topKmh != null ? ` · ${e.topKmh} km/h` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>

        <button className="cta" onClick={() => startCountdown()}>RACE AGAIN</button>
        <button className="ghost" onClick={() => toMenu()}>Back to menu</button>
      </div>
    </div>
  )
}

function nextMedal(medal) {
  const order = ['none', 'bronze', 'silver', 'gold', 'author']
  const i = order.indexOf(medal)
  return order[Math.min(i + 1, order.length - 1)]
}
