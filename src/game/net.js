// Multiplayer client: talks to the PartyKit relay in party/server.ts.
//
// Same shape as carState / hud — a mutable module singleton the render loop can
// read every frame without going through React, plus a tiny event emitter for
// the coarse lobby/race transitions that DO belong in React.
//
// The physics is still 100% local. This module only:
//   - joins a room (the room code is the join code)
//   - relays our telemetry and buffers the opponent's for smooth playback
//   - carries the shared countdown-zero timestamp
//   - carries both finish times

import PartySocket from 'partysocket'
import { PARTYKIT_HOST } from './net-config.js'
import { TRACK } from './track.js'

// ---- config --------------------------------------------------------------

const RENDER_DELAY_MS = 110 // draw the opponent this far in the past, so we
// always have two snapshots bracketing "now" to interpolate between
const TELEM_HZ = 15
const TELEM_INTERVAL = 1000 / TELEM_HZ
const BUFFER_MAX = 40 // ~2.6s of history at 15Hz
const PING_INTERVAL = 3000

// ---- live state, read every frame --------------------------------------

export const netState = {
  connected: false,
  // per-frame opponent transform, filled by sampleOpponent(); null until we
  // have telemetry
  opp: null, // { p:[x,y,z], q:[x,y,z,w], s, prog, air }
  // signed distance in metres: + means WE are ahead of the opponent on track
  gapM: null,
  oppProg: 0,
  oppFinished: null, // { timeMs, topKmh, name }
  selfFinished: null, // { timeMs, topKmh }
}

// ---- module internals -------------------------------------------------

let socket = null
const listeners = new Map() // event -> Set<fn>
let buffer = [] // [{ recvT (perf.now), p, q, s, prog, air }]
let clockOffset = 0 // add to Date.now() to approximate server time
let pings = []
let pingTimer = null
let lastTelemAt = 0

export const session = {
  active: false,
  roomCode: null,
  isHost: false,
  selfId: null,
  track: null,
  roster: [], // [{ id, name, colour, slot, ready }]
  startAtLocal: null, // Date.now()-domain timestamp of the shared GO
}

// ---- events ----------------------------------------------------------

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(fn)
  return () => off(event, fn)
}
export function off(event, fn) {
  listeners.get(event)?.delete(fn)
}
function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(payload)
    } catch (e) {
      console.error('[net] listener error', e)
    }
  })
}

// ---- room codes -----------------------------------------------------

// no 0/O/1/I/L so a code read off a screen is unambiguous
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function newRoomCode() {
  let s = ''
  const a = crypto.getRandomValues(new Uint32Array(4))
  for (let i = 0; i < 4; i++) s += ALPHABET[a[i] % ALPHABET.length]
  return s
}

export function joinUrl(code, trackId) {
  const u = new URL(window.location.href)
  u.hash = ''
  u.search = ''
  u.searchParams.set('join', code)
  u.searchParams.set('track', trackId)
  return u.toString()
}

// Read a ?join=CODE (&track=ID) off the current URL, if present.
export function pendingJoin() {
  const p = new URLSearchParams(window.location.search)
  const code = (p.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
  if (code.length !== 4) return null
  return { code, track: p.get('track') || null }
}

export function clearJoinParams() {
  const u = new URL(window.location.href)
  u.searchParams.delete('join')
  u.searchParams.delete('track')
  window.history.replaceState({}, '', u.pathname + (u.search ? u.search : '') + u.hash)
}

// ---- connection ----------------------------------------------------

let selfProfile = { name: 'Racer', colour: '#2f6dff', track: '' }

export function connect({ roomCode, name, colour, track, isHost }) {
  disconnect()
  selfProfile = { name, colour, track }
  session.active = true
  session.roomCode = roomCode
  session.isHost = isHost
  session.track = track
  session.roster = []
  session.startAtLocal = null
  netState.oppFinished = null
  netState.selfFinished = null
  netState.gapM = null
  netState.opp = null
  buffer = []
  pings = []
  clockOffset = 0

  socket = new PartySocket({
    host: PARTYKIT_HOST,
    room: roomCode,
    // reconnect automatically; partysocket handles the backoff
  })

  socket.addEventListener('open', () => {
    netState.connected = true
    send({ type: 'hello', ...selfProfile })
    startPinging()
    emit('open')
  })

  socket.addEventListener('close', () => {
    netState.connected = false
    stopPinging()
    emit('close')
  })

  socket.addEventListener('error', () => emit('neterror'))

  socket.addEventListener('message', (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    handle(msg)
  })

  return socket
}

export function disconnect() {
  stopPinging()
  if (socket) {
    try {
      socket.close()
    } catch {
      /* ignore */
    }
    socket = null
  }
  session.active = false
  session.roomCode = null
  session.roster = []
  session.startAtLocal = null
  netState.connected = false
  netState.opp = null
  netState.gapM = null
  netState.oppFinished = null
  netState.selfFinished = null
  buffer = []
}

function send(obj) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(obj))
}

// ---- inbound -------------------------------------------------------

function handle(msg) {
  switch (msg.type) {
    case 'full':
      emit('full')
      break

    case 'joined':
      session.selfId = msg.selfId
      session.isHost = msg.isHost
      if (msg.track) session.track = msg.track
      session.roster = msg.roster
      emit('roster', msg.roster)
      emit('joined', msg)
      break

    case 'roster':
      session.roster = msg.roster
      emit('roster', msg.roster)
      break

    case 'pong': {
      const now = Date.now()
      const rtt = now - msg.t
      // server time at "now" ~= msg.s + rtt/2
      pings.push({ offset: msg.s + rtt / 2 - now, rtt })
      if (pings.length > 7) pings.shift()
      // use the sample with the lowest RTT — least jittered estimate
      clockOffset = pings.reduce((best, p) => (p.rtt < best.rtt ? p : best)).offset
      break
    }

    case 'start': {
      // convert the server timestamp into our own Date.now() domain
      session.startAtLocal = msg.startAt - clockOffset
      emit('start', session.startAtLocal)
      break
    }

    case 'oppTelem': {
      buffer.push({
        recvT: performance.now(),
        p: msg.p,
        q: msg.q,
        s: msg.s,
        prog: msg.prog,
        air: msg.air,
      })
      if (buffer.length > BUFFER_MAX) buffer.shift()
      netState.oppProg = msg.prog
      break
    }

    case 'oppFinish':
      netState.oppFinished = { timeMs: msg.timeMs, topKmh: msg.topKmh, name: msg.name }
      emit('oppFinish', netState.oppFinished)
      break

    case 'oppLeft':
      netState.opp = null
      buffer = []
      session.startAtLocal = null
      emit('oppLeft')
      break

    case 'rematch':
      session.startAtLocal = null
      netState.oppFinished = null
      netState.selfFinished = null
      netState.opp = null
      netState.gapM = null
      buffer = []
      emit('rematch')
      break
  }
}

// ---- outbound helpers --------------------------------------------

// Change your display name / colour while in the lobby. Re-uses `hello`, which
// the server treats as a profile update and re-broadcasts the roster.
export function updateProfile({ name, colour }) {
  if (name != null) selfProfile.name = name
  if (colour != null) selfProfile.colour = colour
  send({ type: 'hello', ...selfProfile })
}

export function sendReady(ready) {
  send({ type: 'ready', ready })
}

export function sendRematch() {
  send({ type: 'rematch' })
}

// Called every physics frame; self-throttles to TELEM_HZ.
export function sendTelemetry({ pos, quat, speed, prog, air, raceMs }) {
  if (!session.active) return
  const now = performance.now()
  if (now - lastTelemAt < TELEM_INTERVAL) return
  lastTelemAt = now
  send({
    type: 'telem',
    t: Math.round(raceMs),
    p: [r(pos[0]), r(pos[1]), r(pos[2])],
    q: [r4(quat[0]), r4(quat[1]), r4(quat[2]), r4(quat[3])],
    s: r(speed),
    prog: r4(prog),
    air: !!air,
  })
}

export function sendFinish({ timeMs, topKmh }) {
  netState.selfFinished = { timeMs, topKmh }
  send({ type: 'finish', timeMs, topKmh })
}

function r(n) {
  return Math.round(n * 100) / 100
}
function r4(n) {
  return Math.round(n * 10000) / 10000
}

// ---- opponent interpolation ------------------------------------

// Call once per rendered frame. Fills netState.opp with an interpolated
// transform ~RENDER_DELAY_MS in the past, or leaves it null if we don't have
// enough history yet. `selfProg` (0..1) is our own progress, used for the gap.
export function sampleOpponent(selfProg) {
  if (buffer.length === 0) {
    netState.opp = null
    return null
  }
  const target = performance.now() - RENDER_DELAY_MS

  // newest snapshot older than target, and the one after it
  let a = null
  let b = null
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].recvT <= target) {
      a = buffer[i]
      b = buffer[i + 1] || null
      break
    }
  }
  let out
  if (!a) {
    // target is before everything we have — clamp to the oldest
    out = snap(buffer[0])
  } else if (!b) {
    // target is past the newest — hold the last known pose (brief freeze on a
    // dropped packet; cheaper and less wrong than extrapolating a physics car)
    out = snap(a)
  } else {
    const t = clamp((target - a.recvT) / (b.recvT - a.recvT || 1), 0, 1)
    out = {
      p: [lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)],
      q: slerp(a.q, b.q, t),
      s: lerp(a.s, b.s, t),
      prog: lerp(a.prog, b.prog, t),
      air: b.air,
    }
  }
  netState.opp = out
  netState.oppProg = out.prog
  if (typeof selfProg === 'number') {
    netState.gapM = (selfProg - out.prog) * (TRACK.length || 1)
  }
  return out
}

function snap(f) {
  return { p: f.p.slice(), q: f.q.slice(), s: f.s, prog: f.prog, air: f.air }
}

// ---- clock sync loop ------------------------------------------

function startPinging() {
  stopPinging()
  const tick = () => send({ type: 'ping', t: Date.now() })
  tick()
  pingTimer = setInterval(tick, PING_INTERVAL)
}
function stopPinging() {
  if (pingTimer) clearInterval(pingTimer)
  pingTimer = null
}

// ---- math ---------------------------------------------------

function lerp(a, b, t) {
  return a + (b - a) * t
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}
function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  let bx = b[0]
  let by = b[1]
  let bz = b[2]
  let bw = b[3]
  if (dot < 0) {
    dot = -dot
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
  }
  if (dot > 0.9995) {
    return norm([lerp(a[0], bx, t), lerp(a[1], by, t), lerp(a[2], bz, t), lerp(a[3], bw, t)])
  }
  const th0 = Math.acos(dot)
  const th = th0 * t
  const s0 = Math.cos(th) - (dot * Math.sin(th)) / Math.sin(th0)
  const s1 = Math.sin(th) / Math.sin(th0)
  return [a[0] * s0 + bx * s1, a[1] * s0 + by * s1, a[2] * s0 + bz * s1, a[3] * s0 + bw * s1]
}
function norm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

// dev-only handle for driving the multiplayer flow from the console
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__net = { netState, session, sampleOpponent, sendTelemetry, connect, disconnect }
}
