import { useState } from 'react'
import { TRACK, TRACKS, selectTrack } from '../game/track.js'
import { startCountdown } from '../game/store.js'
import { bestTime, bestTopSpeed, topTimes, getName, setName, medalFor } from '../game/leaderboard.js'
import { formatTime, MEDAL_LABEL, MEDAL_ICON } from '../game/format.js'
import { initAudio } from '../game/audio.js'
import { CAR_COLOURS, getCarColourId, setCarColourId } from '../game/carColour.js'
import { touchModeSetting, setTouchMode, touchControlsActive } from '../game/device.js'
import { enableTilt } from '../game/tilt.js'
import { isMusicEnabled, setMusicEnabled } from '../game/music.js'
import { hostRace, robotRace, rejoinRoom } from '../game/mp.js'
import { recentOpponents } from '../game/recentOpponents.js'

const MEDAL_ORDER = ['author', 'gold', 'silver', 'bronze']

export default function Menu() {
  const [name, setNameState] = useState(getName())
  const [colour, setColour] = useState(getCarColourId)
  const [ctrl, setCtrl] = useState(touchModeSetting)
  const [music, setMusic] = useState(isMusicEnabled)
  const [recent] = useState(recentOpponents)
  const pb = bestTime(TRACK.id)
  const board = topTimes(TRACK.id)
  const fastest = bestTopSpeed(TRACK.id)
  const pbMedal = pb != null ? medalFor(pb, TRACK.medals) : null

  function drive() {
    setName(name.trim())
    initAudio() // browsers only allow audio to start from a gesture
    // iOS only grants motion access from a gesture too, so ask on the same tap
    if (touchControlsActive()) enableTilt()
    startCountdown()
  }

  function raceFriend() {
    setName(name.trim())
    initAudio()
    if (touchControlsActive()) enableTilt()
    hostRace()
  }

  // Dev-only: host a room like "Race a friend", then ask the vite dev server
  // (tools/robot-player.js via the robot-spawner middleware) to launch an
  // autopilot-driven browser that joins it as the guest. Same lobby, same
  // synced countdown, same live opponent car, same result screen — the robot
  // just looks like a friend who's very fast on the join. Not available on
  // the deployed build: there's no server to spawn a browser on.
  function rejoin(code) {
    setName(name.trim())
    initAudio()
    if (touchControlsActive()) enableTilt()
    rejoinRoom(code)
  }

  function raceRobot() {
    setName(name.trim())
    initAudio()
    if (touchControlsActive()) enableTilt()
    const code = hostRace()
    robotRace.active = true
    fetch(`/__robot/join?room=${encodeURIComponent(code)}&track=${encodeURIComponent(TRACK.id)}`).catch(() => {
      /* dev-only endpoint; if it's missing there's nothing more to do here */
    })
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
          <span className="label">Controls</span>
          {[['auto', 'Auto'], ['on', 'Touch'], ['off', 'Keys']].map(([v, lbl]) => (
            <button
              key={v}
              className={'ctrlmode' + (v === ctrl ? ' active' : '')}
              onClick={() => {
                setTouchMode(v)
                setCtrl(v)
              }}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="colours">
          <span className="label">Music</span>
          <button
            className={'ctrlmode' + (music ? ' active' : '')}
            onClick={() => setMusic(setMusicEnabled(!music))}
          >
            {music ? 'On' : 'Off'}
          </button>
        </div>

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
        <button className="ghost" onClick={raceFriend}>
          🏁 Race a friend
        </button>
        {import.meta.env.DEV && (
          <button className="ghost" onClick={raceRobot}>
            🤖 Race a robot
          </button>
        )}

        {recent.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="subtitle" style={{ marginBottom: 4 }}>Recently raced</div>
            {recent.map((o) => (
              <div className="row" key={o.name + o.code}>
                <span className="label">{o.name}</span>
                <button className="ghost" style={{ padding: '4px 10px' }} onClick={() => rejoin(o.code)}>
                  Rejoin
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="hint">
          <kbd>↑</kbd><kbd>↓</kbd> throttle / brake &nbsp;·&nbsp; <kbd>←</kbd><kbd>→</kbd> steer<br />
          <kbd>Space</kbd> handbrake &nbsp;·&nbsp; <kbd>R</kbd> restart instantly<br />
          <kbd>Del</kbd> back to last checkpoint &nbsp;·&nbsp; <kbd>C</kbd> camera &nbsp;·&nbsp; <kbd>Q</kbd> quit &nbsp;·&nbsp; <kbd>M</kbd> mute
        </div>
      </div>
    </div>
  )
}
