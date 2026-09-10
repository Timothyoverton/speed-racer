// Glue between the network layer (net.js) and the game store (store.js).
//
// Kept out of net.js so that module stays a pure transport, and out of the
// React components so the lobby/race/result screens only ever read state.

import { useEffect } from 'react'
import * as net from './net.js'
import { TRACK, TRACKS } from './track.js'
import { getName } from './leaderboard.js'
import { getCarColour } from './carColour.js'
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

export function hostRace() {
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
  toMenu()
}

// Wires net events -> store transitions. Mount once, near the app root.
export function useMultiplayerCoordinator() {
  useEffect(() => {
    const offs = [
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
