// Speed Racer multiplayer relay.
//
// This server is deliberately dumb. Speed Racer runs its physics entirely on
// the client and a race result is each player's own local lap time, measured
// start-line to finish-line exactly as in single player. So the server never
// simulates anything, never validates a time, and never needs to be
// authoritative. Its whole job is:
//
//   1. pair two players into a room (the room name IS the join code)
//   2. relay telemetry between them so each sees the other's car move
//   3. agree on a single countdown-zero timestamp so the start feels shared
//   4. collect both finish times and declare a winner
//
// A room is one PartyKit room. Max two players. First in is the host.

import type * as Party from 'partykit/server'

type Colour = string

interface PlayerState {
  id: string
  name: string
  colour: Colour
  slot: 1 | 2
  ready: boolean
  finished: null | { timeMs: number; topKmh: number }
}

// client -> server
type In =
  | { type: 'hello'; name: string; colour: Colour; track: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'ping'; t: number }
  | { type: 'telem'; t: number; p: [number, number, number]; q: [number, number, number, number]; s: number; prog: number; air: boolean }
  | { type: 'finish'; timeMs: number; topKmh: number }
  | { type: 'rematch' }
  | { type: 'changeTrack'; track: string }

// server -> client
type Out =
  | { type: 'joined'; selfId: string; isHost: boolean; track: string; roster: RosterEntry[] }
  | { type: 'roster'; roster: RosterEntry[] }
  | { type: 'full' }
  | { type: 'pong'; t: number; s: number }
  | { type: 'start'; startAt: number }
  | { type: 'oppTelem'; t: number; p: [number, number, number]; q: [number, number, number, number]; s: number; prog: number; air: boolean }
  | { type: 'oppFinish'; timeMs: number; topKmh: number; name: string }
  | { type: 'oppLeft' }
  | { type: 'rematch' }
  | { type: 'trackChanged'; track: string }

interface RosterEntry {
  id: string
  name: string
  colour: Colour
  slot: 1 | 2
  ready: boolean
}

const IDLE_ROOM_MS = 15 * 60 * 1000

export default class RaceServer implements Party.Server {
  players = new Map<string, PlayerState>()
  hostId: string | null = null
  track = ''
  started = false
  idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    this.bumpIdle()
    if (this.players.size >= 2) {
      this.send(conn, { type: 'full' })
      // give the message a tick to flush, then drop the socket
      setTimeout(() => conn.close(), 50)
      return
    }
    const slot: 1 | 2 = this.players.size === 0 ? 1 : 2
    this.players.set(conn.id, {
      id: conn.id,
      name: 'Racer',
      colour: '#2f6dff',
      slot,
      ready: false,
      finished: null,
    })
    if (!this.hostId) this.hostId = conn.id
  }

  onMessage(raw: string, sender: Party.Connection) {
    this.bumpIdle()
    let msg: In
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const me = this.players.get(sender.id)
    if (!me) return

    switch (msg.type) {
      case 'hello': {
        me.name = String(msg.name || 'Racer').slice(0, 16)
        me.colour = String(msg.colour || '#2f6dff').slice(0, 12)
        // the host's track is authoritative; the guest's is only used if it
        // somehow arrives first
        if (sender.id === this.hostId || !this.track) this.track = String(msg.track || '')
        this.send(sender, {
          type: 'joined',
          selfId: sender.id,
          isHost: sender.id === this.hostId,
          track: this.track,
          roster: this.roster(),
        })
        this.broadcastRoster()
        break
      }
      case 'ready': {
        me.ready = !!msg.ready
        this.broadcastRoster()
        this.maybeStart()
        break
      }
      case 'ping': {
        this.send(sender, { type: 'pong', t: msg.t, s: Date.now() })
        break
      }
      case 'telem': {
        // straight relay to the other player, untouched
        this.relay(sender.id, {
          type: 'oppTelem',
          t: msg.t,
          p: msg.p,
          q: msg.q,
          s: msg.s,
          prog: msg.prog,
          air: msg.air,
        })
        break
      }
      case 'finish': {
        me.finished = { timeMs: msg.timeMs, topKmh: msg.topKmh }
        this.relay(sender.id, {
          type: 'oppFinish',
          timeMs: msg.timeMs,
          topKmh: msg.topKmh,
          name: me.name,
        })
        break
      }
      case 'rematch': {
        // either player asking for a rematch drops everyone back to the lobby
        this.started = false
        for (const p of this.players.values()) {
          p.ready = false
          p.finished = null
        }
        this.room.broadcast(JSON.stringify({ type: 'rematch' } satisfies Out))
        this.broadcastRoster()
        break
      }
      case 'changeTrack': {
        // Either player can propose a track; the whole room follows. Each
        // client reloads onto the new track and rejoins this same room code
        // (see mp.js), so there's nothing else to reconcile here beyond
        // remembering which track is now authoritative for the next 'hello'.
        this.track = String(msg.track || '').slice(0, 64)
        this.room.broadcast(JSON.stringify({ type: 'trackChanged', track: this.track } satisfies Out))
        break
      }
    }
  }

  onClose(conn: Party.Connection) {
    this.bumpIdle()
    if (!this.players.has(conn.id)) return
    this.players.delete(conn.id)
    this.started = false
    if (this.hostId === conn.id) {
      // promote whoever is left; if nobody, the room just goes quiet
      this.hostId = this.players.size ? [...this.players.values()][0].id : null
    }
    // reset the remaining player back to a clean lobby
    for (const p of this.players.values()) {
      p.ready = false
      p.finished = null
      p.slot = 1
    }
    this.room.broadcast(JSON.stringify({ type: 'oppLeft' } satisfies Out))
    this.broadcastRoster()
  }

  // --- helpers ---------------------------------------------------------------

  private maybeStart() {
    if (this.started) return
    if (this.players.size !== 2) return
    if (![...this.players.values()].every((p) => p.ready)) return
    this.started = true
    for (const p of this.players.values()) p.finished = null
    // three seconds from now, on the server clock; clients convert to their own
    const startAt = Date.now() + 3200
    this.room.broadcast(JSON.stringify({ type: 'start', startAt } satisfies Out))
  }

  private roster(): RosterEntry[] {
    return [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({ id: p.id, name: p.name, colour: p.colour, slot: p.slot, ready: p.ready }))
  }

  private broadcastRoster() {
    this.room.broadcast(JSON.stringify({ type: 'roster', roster: this.roster() } satisfies Out))
  }

  private relay(fromId: string, msg: Out) {
    const s = JSON.stringify(msg)
    for (const c of this.room.getConnections()) {
      if (c.id !== fromId) c.send(s)
    }
  }

  private send(conn: Party.Connection, msg: Out) {
    conn.send(JSON.stringify(msg))
  }

  private bumpIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      for (const c of this.room.getConnections()) c.close()
    }, IDLE_ROOM_MS)
  }
}
