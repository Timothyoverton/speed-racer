// Reference-lap autopilot. Dev tool, not shipped — nothing imports this.
//
// Medal times come from medalsFor(refLapSec) in track.js, and this is what
// measures refLapSec. Paste into the console on the dev server (or
// `await import('/tools/autopilot.js')`), start a run, then:
//
//   __AP.install()
//   __AP.begin(__AP.DEFAULTS)
//   __AP.chunk(2400)        // repeat until .done
//   __AP.end()
//
// It aims at a lookahead point on the centreline and steers toward it with a PD
// law on the heading error (P eases onto the line, D damps the swing so it
// settles instead of sawing full-lock either side — which also keeps yaw rate
// low going over a jump lip). It brakes whenever a corner inside its scan needs
// a speed it can't decelerate to, using the game's own v^2/20.8 radius rule. It
// drives the centreline, not a racing line — it never cuts an apex — so it's
// "a fast clean lap", not a theoretical optimum. Repeatable to ~0.2%.
// (Exception: where a track has wall blocks ON the road — only Mission
// Impossible — install() bends the followed line around them, so through the
// slalom it does drive a racing line.)
//
// TWO THINGS THAT WILL WASTE YOUR AFTERNOON IF YOU REWRITE THIS:
//
//  1. advance() takes SECONDS. Under frameloop:'never' R3F computes
//     delta = timestamp - clock.elapsedTime, and elapsedTime is in seconds.
//     Hand it performance.now() milliseconds and the delta is enormous, Rapier
//     clamps it to 0.5s and runs 30 physics steps per frame. The car covers 76m
//     in a "second", trips the stuck-respawn, and the lap time is fiction.
//     Nothing warns you. Assert it: exactly 1 world.step per advance.
//  2. The race timer is performance.now() wall-clock, so it has to be stubbed
//     to sim time or you record how long your loop took, not the lap.

export const AP = {
  DEFAULTS: { look0: 9, lookV: 0.42, dead: 0.02, scan: 170, decel: 14, steerSign: -1, steerFull: 0.12, damp: 11 },

  install() {
    const T = window.__track
    const P = T.tiles.map((t) => ({ x: t.pos[0], z: t.pos[2], yaw: t.rot[1], d: t.dist }))
    const N = P.length
    // fastest speed holdable at each tile, from the game's own turn-rate cap
    const vmax = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const a = P[Math.max(0, i - 2)], b = P[Math.min(N - 1, i + 2)]
      let dy = b.yaw - a.yaw
      while (dy > Math.PI) dy -= 2 * Math.PI
      while (dy < -Math.PI) dy += 2 * Math.PI
      const k = Math.abs(dy) / Math.max(b.d - a.d, 0.01)
      vmax[i] = k < 2e-4 ? 999 : Math.sqrt(20.8 / k)
    }
    // Bend the followed line around the wall blocks — a racing line through the
    // slalom, like a real track, instead of the raw centreline the blocks sit
    // on top of. Pure pursuit then threads them with no last-moment dodge.
    // Only Mission Impossible has walls and its medals are hand-set, so this
    // never moves a reference lap.
    const half = T.roadWidth / 2
    const CAR_HALF = 1.4 // car half-width + a little slack
    const WEAVE = []
    for (const w of T.walls || []) {
      // tile nearest the block, and the block's lateral offset from the line
      let bi = 0, bd = Infinity
      for (let k = 0; k < N; k++) {
        const d = (P[k].x - w.pos[0]) ** 2 + (P[k].z - w.pos[2]) ** 2
        if (d < bd) { bd = d; bi = k }
      }
      const b = P[bi]
      const lat = (w.pos[0] - b.x) * Math.cos(b.yaw) - (w.pos[2] - b.z) * Math.sin(b.yaw)
      const wHalf = w.size[0] / 2
      const lo = lat - wHalf - CAR_HALF // block's near edges, in the car's terms
      const hi = lat + wHalf + CAR_HALF
      // aim for the middle of whichever gap (block-edge to barrier) is wider
      const leftGap = lo - -half
      const rightGap = half - hi
      let off = leftGap > rightGap ? (lo + -half) / 2 : (hi + half) / 2
      off = Math.max(-half + CAR_HALF, Math.min(half - CAR_HALF, off))
      WEAVE.push({ bi, off })
    }
    // apply the bumps after measuring them all, so overlapping ones (the 60m
    // slalom) add into a smooth S rather than each seeing a moved line
    const SPAN = 9 // tiles of smoothstep falloff each side of a block
    const bent = P.map((p) => ({ ...p }))
    for (const { bi, off } of WEAVE) {
      for (let k = Math.max(0, bi - SPAN); k < Math.min(N, bi + SPAN + 1); k++) {
        const tt = 1 - Math.abs(k - bi) / SPAN
        const s = tt * tt * (3 - 2 * tt)
        bent[k].x += Math.cos(P[k].yaw) * off * s
        bent[k].z += -Math.sin(P[k].yaw) * off * s
        vmax[k] = Math.min(vmax[k], 34) // ~122 km/h through the weave
      }
    }
    for (let k = 0; k < N; k++) { P[k].x = bent[k].x; P[k].z = bent[k].z }
    Object.assign(this, { P, vmax, N, cursor: 0, roadHalf: half })
    return { track: T.id, tiles: N, lenM: Math.round(T.length), weave: WEAVE.length }
  },

  control(cfg) {
    const { P, vmax, N } = this, car = window.__car, inp = window.__input
    const px = car.pos[0], pz = car.pos[2]
    // Nearest tile. Normally a bounded window AHEAD of where we were — the
    // forward-only walk keeps a course that bends back near itself from
    // snapping the cursor hundreds of metres up the track. But a respawn
    // teleports the car backwards, and the window can't follow it, so detect
    // the teleport (one frame's move is far larger than driving can manage) and
    // rescan the whole line that frame.
    const lp = this._lastPos
    const teleported = lp && Math.hypot(px - lp[0], pz - lp[1]) > 15
    this._lastPos = [px, pz]
    if (teleported) this._lastErr = null // don't let the position jump spike D
    let i = this.cursor, best = Infinity
    const from = teleported ? 0 : this.cursor
    const to = teleported ? N : Math.min(N, this.cursor + 60)
    for (let k = from; k < to; k++) {
      const dx = P[k].x - px, dz = P[k].z - pz
      const d = dx * dx + dz * dz
      if (d < best) { best = d; i = k }
    }
    this.cursor = i
    const v = car.speed

    let j = i
    const look = cfg.look0 + cfg.lookV * v
    while (j < N - 1 && P[j].d - P[i].d < look) j++

    // Aim point: just the followed line, which install() has already bent
    // around any wall blocks.
    const tx = P[j].x
    const tz = P[j].z
    let err = Math.atan2(tx - px, tz - pz) - Math.atan2(car.fwd[0], car.fwd[2])
    while (err > Math.PI) err -= 2 * Math.PI
    while (err < -Math.PI) err += 2 * Math.PI
    // PD steering via input.axis (-1..1), NOT full-lock left/right booleans.
    // P eases the car onto the line; D (the frame-to-frame change in heading
    // error) damps the swing so it settles instead of sawing full-lock past the
    // line each time — which is what wrecked jump approaches, where any yaw rate
    // at the lip throws the whole flight. cfg.steerFull is the error (rad) that
    // asks for full P lock; sharper saturates, like the old booleans. Sign
    // matches the old booleans: they set left (keySteer +1 in Car.jsx) when
    // err*steerSign was negative, i.e. keySteer = -sign(err*steerSign).
    const derr = this._lastErr == null ? 0 : err - this._lastErr
    this._lastErr = err
    const cmd = err / cfg.steerFull + derr * cfg.damp
    let steer = Math.abs(err) < cfg.dead && Math.abs(derr) < cfg.dead ? 0 : -(cmd * cfg.steerSign)
    steer = Math.max(-1, Math.min(1, steer))
    if (this._lastSteer != null && steer * this._lastSteer < 0) this._steerFlips = (this._steerFlips || 0) + 1
    this._lastSteer = steer
    inp.left = false
    inp.right = false
    inp.axis = steer

    let brake = false
    for (let k = i; k < N && P[k].d - P[i].d < cfg.scan; k++) {
      const L = Math.max(P[k].d - P[i].d, 0.5)
      if (v > Math.sqrt(vmax[k] * vmax[k] + 2 * cfg.decel * L)) { brake = true; break }
    }
    inp.forward = !brake
    inp.back = brake
  },

  begin(cfg) {
    const st = window.__three
    this.cfg = cfg; this.steps = 0; this.top = 0; this.air = 0; this.cursor = 0
    this.log = []; this.minY = Infinity; this.respawns = 0; this._lastPos = null
    this._lastErr = null; this._lastSteer = null; this._steerFlips = 0
    this.lastXZ = [window.__car.pos[0], window.__car.pos[2]]
    st.setFrameloop ? st.setFrameloop('never') : (st.frameloop = 'never')
    this._sec = st.clock.elapsedTime          // SECONDS. see the note above.
    this._now = performance.now.bind(performance)
    this._ms = this._now()
    performance.now = () => this._ms
    this._render = st.gl.render.bind(st.gl)
    st.gl.render = () => {}                   // physics only; rendering is ~95% of the cost
    return { phase: window.__dbg.phase, cp: window.__dbg.next }
  },

  chunk(n) {
    const st = window.__three, car = window.__car
    for (let k = 0; k < n; k++) {
      this.control(this.cfg)
      this._sec += 1 / 60
      this._ms += 1000 / 60
      st.advance(this._sec)
      this.steps++
      if (window.__hud.speedKmh > this.top) this.top = window.__hud.speedKmh
      if (!car.grounded) this.air++
      if (car.pos[1] < this.minY) this.minY = car.pos[1]
      // a respawn teleports; nothing else moves the car >10m in one step
      const dx = car.pos[0] - this.lastXZ[0], dz = car.pos[2] - this.lastXZ[2]
      if (Math.sqrt(dx * dx + dz * dz) > 10) this.respawns++
      this.lastXZ[0] = car.pos[0]; this.lastXZ[1] = car.pos[2]
      this.lastXZ = [car.pos[0], car.pos[2]]
      if (this.steps % 120 === 0)
        this.log.push(`${(this.steps / 60) | 0}s ${window.__hud.speedKmh.toFixed(0)}k t${this.cursor} c${window.__dbg.next}`)
      if (window.__dbg.phase !== 'racing') break
    }
    return { simSec: +(this.steps / 60).toFixed(2), tile: this.cursor + '/' + this.N,
             cp: window.__dbg.next, done: window.__dbg.phase !== 'racing' }
  },

  end() {
    const st = window.__three, inp = window.__input
    performance.now = this._now
    st.gl.render = this._render
    inp.forward = inp.back = inp.left = inp.right = false
    inp.axis = null
    st.setFrameloop ? st.setFrameloop('always') : (st.frameloop = 'always')
    return { finished: window.__dbg.phase === 'finished', refLapSec: +(this.steps / 60).toFixed(2),
             trackM: Math.round(window.__track.length), topKmh: Math.round(this.top),
             airSec: +(this.air / 60).toFixed(1), lowestY: +this.minY.toFixed(1),
             respawns: this.respawns, steerFlips: this._steerFlips,
             cp: window.__dbg.next + '/' + window.__track.checkpoints.length, log: this.log }
  },
}

if (typeof window !== 'undefined') window.__AP = AP
