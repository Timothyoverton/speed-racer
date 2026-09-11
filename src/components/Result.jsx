import { useEffect, useState } from 'react'
import { TRACK } from '../game/track.js'
import { useResult, startCountdown, toMenu, getState } from '../game/store.js'
import { topTimes } from '../game/leaderboard.js'
import { formatTime, formatDelta, MEDAL_LABEL, MEDAL_ICON } from '../game/format.js'
import * as net from '../game/net.js'
import { leaveRace, robotRace } from '../game/mp.js'

export default function Result() {
  const result = useResult()
  const mp = getState().multiplayer
  if (!result) return null
  if (mp) return <MultiplayerResult result={result} />
  return <SoloResult result={result} />
}

function MultiplayerResult({ result }) {
  const { timeMs, isPB, topKmh } = result
  const [opp, setOpp] = useState(net.netState.oppFinished)
  const [oppGone, setOppGone] = useState(false)

  useEffect(() => {
    const offs = [
      net.on('oppFinish', (o) => setOpp({ ...o })),
      net.on('oppLeft', () => setOppGone(true)),
    ]
    return () => offs.forEach((f) => f())
  }, [])

  const decided = !!opp
  const won = decided && timeMs < opp.timeMs
  const draw = decided && timeMs === opp.timeMs

  return (
    <div className="overlay">
      <div className="panel">
        <div className="subtitle">{TRACK.name} — head to head</div>

        {decided ? (
          <div className={'result-pb ' + (won ? 'win' : draw ? '' : 'lose')}>
            {draw ? 'Dead heat!' : won ? '🏆 You win!' : 'You lose'}
          </div>
        ) : oppGone ? (
          <div className="result-pb">Friend left the race</div>
        ) : (
          <div className="mp-status">Waiting for your friend to finish…</div>
        )}

        <div className="mp-scoreline">
          <div className={'mp-score' + (decided && won ? ' win' : '')}>
            <div className="mp-score-name">You{isPB ? ' ★' : ''}</div>
            <div className="mp-score-time">{formatTime(timeMs)}</div>
            {topKmh != null && <div className="mp-score-sub">top {topKmh} km/h</div>}
          </div>
          <div className={'mp-score' + (decided && !won && !draw ? ' win' : '')}>
            <div className="mp-score-name">{opp?.name || 'Friend'}</div>
            <div className="mp-score-time">{opp ? formatTime(opp.timeMs) : '—'}</div>
            {opp?.topKmh != null && <div className="mp-score-sub">top {opp.topKmh} km/h</div>}
          </div>
        </div>

        {decided && !draw && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="label">Margin</span>
            <span className={'delta ' + (won ? 'ahead' : 'behind')} style={{ fontWeight: 700 }}>
              {formatDelta(timeMs - opp.timeMs)}
            </span>
          </div>
        )}

        {!robotRace.active && (
          <button className="cta" onClick={() => net.sendRematch()}>
            REMATCH
          </button>
        )}
        <button className="ghost" onClick={leaveRace}>
          Back to menu
        </button>
      </div>
    </div>
  )
}

function SoloResult({ result }) {
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
