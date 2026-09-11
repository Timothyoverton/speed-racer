// Glue between the network layer (net.js) and the game store (store.js).
//
// Kept out of net.js so that module stays a pure transport, and out of the
// React components so the lobby/race/result screens only ever read state.

import { useEffect } from 'react'
import * as net from './net.js'
import { TRACK, TRACKS } from './track.js'
import { getName } from './leaderboard.js'
import { getCarColour, CAR_COLOURS, setCarColourId } from './carColour.js'
import {
  enterLobby,
  toMenu,
  startMultiplayerCountdown,
  getState,
} from './store.js'

const RESUME_KEY = 'speed-racer:mp-join'
const TRACK_KEY = 'speed-racer:track'

// Called once on app start. If the page was opened from a "race a friend" link
// (?join=CODE&track=ID), get onto the right track and into the room.
//
// Returns true if it kicked off a multiplayer join (so the caller can skip
// other first-load work if it wants).
export function bootstrapMultiplayer() {
  // 1. a resume handoff we stashed before a track-switch reload
  let resume = null
  try {
    const raw = sessionStorage.getItem(RESUME_KEY)
    if (raw) resume = JSON.parse(raw)
  } catch {
    /* ignore */
  }
  if (resume) {
    try {
      sessionStorage.removeItem(RESUME_KEY)
    } catch {
      /* ignore */
    }
    net.clearJoinParams()
    joinAsGuest(resume.code)
    return true
  }

  // 2. a fresh link in the URL
  const pending = net.pendingJoin()
  if (!pending) return false

  const wantTrack = pending.track && TRACKS.some((t) => t.id === pending.track) ? pending.track : null

  if (wantTrack && wantTrack !== TRACK.id) {
    // we need that track loaded first — stash intent and reload once
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ code: pending.code }))
      localStorage.setItem(TRACK_KEY, wantTrack)
    } catch {
      /* ignore */
    }
    window.location.reload()
    return true
  }

  net.clearJoinParams()
  joinAsGuest(pending.code)
  return true
}

// Set true by Menu.jsx right after hostRace() when the room was opened via
// "Race a robot" (not a plain "Race a friend"). Race.jsx reads it to skip the
// self-ghost — with a live robot opponent already on track, the ghost is just
// visual clutter, not a second thing to race. Per-browser-session state, so
// it only affects what the host who clicked "Race a robot" sees; a real
// friend joining that room still sees their own ghost as normal.
export const robotRace = { active: false }

export function hostRace() {
  robotRace.active = false
  const code = net.newRoomCode()
  net.connect({
    roomCode: code,
    name: getName() || 'Racer',
    colour: getCarColour(),
    track: TRACK.id,
    isHost: true,
  })
  enterLobby()
  return code
}

function joinAsGuest(code) {
  robotRace.active = false
  net.connect({
    roomCode: code,
    name: getName() || 'Racer',
    colour: getCarColour(),
    track: TRACK.id,
    isHost: false,
  })
  enterLobby()
}

export function leaveRace() {
  net.disconnect()
  robotRace.active = false
  toMenu()
}

// Wires net events -> store transitions. Mount once, near the app root.
// If both players picked the same paint, nudge the guest (slot 2) onto a
// free colour so the two cars are always distinguishable on track.
function dedupeColour(roster) {
  const me = roster.find((p) => p.id === net.session.selfId)
  const them = roster.find((p) => p.id !== net.session.selfId)
  if (!me || !them || me.slot === 1) return
  if (me.colour.toLowerCase() !== them.colour.toLowerCase()) return
  const free = CAR_COLOURS.find((c) => c.hex.toLowerCase() !== them.colour.toLowerCase())
  if (free) {
    setCarColourId(free.id)
    net.updateProfile({ colour: free.hex })
  }
}

export function useMultiplayerCoordinator() {
  useEffect(() => {
    const offs = [
      net.on('roster', dedupeColour),
      net.on('start', () => {
        // only react if we're still sitting in the lobby (or a stale race)
        if (getState().phase === 'lobby' || getState().phase === 'finished') {
          startMultiplayerCountdown()
        }
      }),
      net.on('rematch', () => {
        enterLobby()
      }),
      net.on('full', () => {
        net.disconnect()
        toMenu()
        setTimeout(() => alert('That race is already full.'), 0)
      }),
      net.on('oppLeft', () => {
        // if we're mid-countdown the race can't happen; drop back to the lobby
        const ph = getState().phase
        if (ph === 'countdown') enterLobby()
      }),
    ]
    return () => offs.forEach((f) => f())
  }, [])
}
