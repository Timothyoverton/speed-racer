import { useState } from 'react'
import { TRACK, TRACKS, selectTrack } from '../game/track.js'
import { startCountdown } from '../game/store.js'
import { bestTime, bestTopSpeed, topTimes, getName, setName, medalFor } from '../game/leaderboard.js'
import { formatTime, MEDAL_LABEL, MEDAL_ICON } from '../game/format.js'
import { initAudio } from '../game/audio.js'
import { CAR_COLOURS, getCarColourId, setCarColourId } from '../game/carColour.js'

const MEDAL_ORDER = ['author', 'gold', 'silver', 'bronze']

export default function Menu() {
  const [name, setNameState] = useState(getName())
  const [colour, setColour] = useState(getCarColourId)
  const pb = bestTime(TRACK.id)
  const board = topTimes(TRACK.id)
  const fastest = bestTopSpeed(TRACK.id)
  const pbMedal = pb != null ? medalFor(pb, TRACK.medals) : null

  function drive() {
    setName(name.trim())
    initAudio() // browsers only allow audio to start from a gesture
    startCountdown()
  }

  return (
    <div className="overlay">
      <div className="panel">
        <div className="title">SPEED RACER</div>
        <div className="subtitle">{TRACK.name} — chase the track record</div>

        <div className="tracks">
          {TRACKS.map((t) => (
            <button
              key={t.id}
              className={'track' + (t.id === TRACK.id ? ' active' : '')}
              onClick={() => t.id !== TRACK.id && selectTrack(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="row">
            <span className="label">Your best</span>
            <span className="value">
              {pb != null ? formatTime(pb) : '—'}{' '}
              {pbMedal && pbMedal !== 'none' && (
                <span className={`medal-badge ${pbMedal}`}>{MEDAL_ICON[pbMedal]}</span>
              )}
            </span>
          </div>
          {fastest != null && (
            <div className="row">
              <span className="label">Fastest speed</span>
              <span className="value">{fastest} km/h</span>
            </div>
          )}
          {MEDAL_ORDER.map((m) => (
            <div className="row" key={m}>
              <span className="label">
                <span className={`medal-badge ${m}`}>{MEDAL_ICON[m]} {MEDAL_LABEL[m]}</span>
              </span>
              <span className="value">{formatTime(TRACK.medals[m])}</span>
            </div>
          ))}
        </div>

        {board.length > 0 && (
          <div style={{ marginTop: 14 }}>
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
        )}

        <div className="colours">
          <span className="label">Car</span>
          {CAR_COLOURS.map((c) => (
            <button
              key={c.id}
              className={'swatch' + (c.id === colour ? ' active' : '')}
              style={{ background: c.hex }}
              title={c.name}
              aria-label={c.name}
              onClick={() => {
                setCarColourId(c.id)
                setColour(c.id)
              }}
            />
          ))}
        </div>

        <input
          className="name"
          placeholder="Your name"
          maxLength={16}
          value={name}
          onChange={(e) => setNameState(e.target.value)}
        />
        <button className="cta" onClick={drive}>DRIVE</button>

        <div className="hint">
          <kbd>↑</kbd><kbd>↓</kbd> throttle / brake &nbsp;·&nbsp; <kbd>←</kbd><kbd>→</kbd> steer<br />
          <kbd>Space</kbd> handbrake &nbsp;·&nbsp; <kbd>R</kbd> restart instantly<br />
          <kbd>Del</kbd> back to last checkpoint &nbsp;·&nbsp; <kbd>C</kbd> camera &nbsp;·&nbsp; <kbd>Q</kbd> quit &nbsp;·&nbsp; <kbd>M</kbd> mute
        </div>
      </div>
    </div>
  )
}
