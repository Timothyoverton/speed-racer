import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { TRACK } from '../game/track.js'
import * as net from '../game/net.js'
import { leaveRace } from '../game/mp.js'
import { PARTYKIT_CONFIGURED } from '../game/net-config.js'

export default function Lobby() {
  const [roster, setRoster] = useState(net.session.roster)
  const [connected, setConnected] = useState(net.netState.connected)
  const [qr, setQr] = useState(null)
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [oppLeft, setOppLeft] = useState(false)

  const [copied, setCopied] = useState(false)
  const code = net.session.roomCode
  const url = code ? net.joinUrl(code, TRACK.id) : ''

  function flashCopied() {
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function copyLink() {
    // navigator.clipboard fails silently on some browsers / non-focused tabs;
    // fall back to the old execCommand path, and if even that fails select the
    // text so it can be copied by hand.
    const done = () => flashCopied()
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => legacyCopy(url, done))
    } else {
      legacyCopy(url, done)
    }
  }

  function legacyCopy(text, ok) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const worked = document.execCommand('copy')
      document.body.removeChild(ta)
      if (worked) ok()
      else selectUrlField()
    } catch {
      selectUrlField()
    }
  }

  function selectUrlField() {
    const el = document.getElementById('mp-url-field')
    if (el) {
      el.focus()
      el.select()
    }
  }

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#0b1020', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [url])

  useEffect(() => {
    const offs = [
      net.on('roster', (r) => {
        setRoster([...r])
        setOppLeft(false)
        const me = r.find((p) => p.id === net.session.selfId)
        if (me) setReady(me.ready)
      }),
      net.on('open', () => setConnected(true)),
      net.on('close', () => setConnected(false)),
      net.on('start', () => setStarting(true)),
      net.on('oppLeft', () => {
        setOppLeft(true)
        setStarting(false)
      }),
      net.on('rematch', () => {
        setStarting(false)
        setReady(false)
      }),
    ]
    return () => offs.forEach((f) => f())
  }, [])

  function toggleReady() {
    const next = !ready
    setReady(next)
    net.sendReady(next)
  }

  const me = roster.find((p) => p.id === net.session.selfId)
  const them = roster.find((p) => p.id !== net.session.selfId)
  const bothHere = roster.length === 2

  return (
    <div className="overlay">
      <div className="panel">
        <div className="title">RACE A FRIEND</div>
        <div className="subtitle">{TRACK.name}</div>

        {!PARTYKIT_CONFIGURED && (
          <div className="mp-warn">
            Multiplayer server not configured for production yet — see
            net-config.js. This works on localhost.
          </div>
        )}

        <div className="mp-code-row">
          <div>
            <div className="label">Join code</div>
            <div className="mp-code">{code}</div>
            <button className="ghost" style={{ marginTop: 6 }} onClick={copyLink}>
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
          {qr && <img className="mp-qr" src={qr} alt="Scan to join" width={140} height={140} />}
        </div>

        <input
          id="mp-url-field"
          className="mp-url"
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.target.select()}
        />
        <div className="mp-hint">
          Same device? Open this link in a second tab or window. Different device?
          Scan the QR.
        </div>

        <div className="mp-players">
          <PlayerRow player={me} label="You" isSelf />
          {them ? (
            <PlayerRow player={them} label="Friend" />
          ) : (
            <div className="mp-player waiting">
              <span className="mp-dot" />
              <span>{oppLeft ? 'Friend left — waiting…' : 'Waiting for a friend to scan the code…'}</span>
            </div>
          )}
        </div>

        {!connected && <div className="mp-status">Connecting…</div>}
        {connected && starting && <div className="mp-status go">Both ready — starting!</div>}

        <button
          className="cta"
          disabled={!connected || !bothHere || starting}
          onClick={toggleReady}
        >
          {ready ? '✓ Ready — waiting for friend' : bothHere ? "I'm ready" : 'Waiting for friend…'}
        </button>
        <button className="ghost" onClick={leaveRace}>
          Leave
        </button>
      </div>
    </div>
  )
}

function PlayerRow({ player, label, isSelf }) {
  if (!player) {
    return (
      <div className="mp-player">
        <span className="mp-dot" />
        <span>{label}…</span>
      </div>
    )
  }
  return (
    <div className={'mp-player' + (isSelf ? ' self' : '')}>
      <span className="mp-swatch" style={{ background: player.colour }} />
      <span className="mp-name">{player.name}</span>
      <span className="mp-tag">{label}</span>
      <span className={'mp-ready' + (player.ready ? ' on' : '')}>
        {player.ready ? 'READY' : '…'}
      </span>
    </div>
  )
}
