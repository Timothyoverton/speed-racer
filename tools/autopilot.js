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
// It steers at a lookahead point on the centreline and brakes whenever a corner
// inside its scan needs a speed it can't decelerate to, using the game's own
// v^2/20.8 radius rule. It drives the centreline, not a racing line — it never
// cuts an apex — so it's "a fast clean lap", not a theoretical optimum.
// Repeatable to ~0.2%.
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
  DEFAULTS: { look0: 9, lookV: 0.42, dead: 0.02, scan: 170, decel: 14, steerSign: -1 },

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
    Object.assign(this, { P, vmax, N, cursor: 0 })
    return { track: T.id, tiles: N, lenM: Math.round(T.length) }
  },

  control(cfg) {
    const { P, vmax, N } = this, car = window.__car, inp = window.__input
    const px = car.pos[0], pz = car.pos[2]
    // Nearest tile in a bounded window AHEAD of where we were. The obvious
    // version — walk forward while the car projects past the next tile — runs
    // away: one airborne stretch, or a course that bends back near itself, and
    // the cursor ends up hundreds of metres up the track. It can only move
    // forward, so it never recovers, and the car gets steered at a point behind
    // a hill and drives off into the infield at a steady 50km/h forever.
    let i = this.cursor, best = Infinity
    for (let k = this.cursor; k < Math.min(N, this.cursor + 60); k++) {
      const dx = P[k].x - px, dz = P[k].z - pz
      const d = dx * dx + dz * dz
      if (d < best) { best = d; i = k }
    }
    this.cursor = i
    const v = car.speed

    let j = i
    const look = cfg.look0 + cfg.lookV * v
    while (j < N - 1 && P[j].d - P[i].d < look) j++
    let err = Math.atan2(P[j].x - px, P[j].z - pz) - Math.atan2(car.fwd[0], car.fwd[2])
    while (err > Math.PI) err -= 2 * Math.PI
    while (err < -Math.PI) err += 2 * Math.PI
    inp.left = err * cfg.steerSign < -cfg.dead
    inp.right = err * cfg.steerSign > cfg.dead

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
    this.log = []; this.minY = Infinity; this.respawns = 0
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
    st.setFrameloop ? st.setFrameloop('always') : (st.frameloop = 'always')
    return { finished: window.__dbg.phase === 'finished', refLapSec: +(this.steps / 60).toFixed(2),
             trackM: Math.round(window.__track.length), topKmh: Math.round(this.top),
             airSec: +(this.air / 60).toFixed(1), lowestY: +this.minY.toFixed(1),
             respawns: this.respawns,
             cp: window.__dbg.next + '/' + window.__track.checkpoints.length, log: this.log }
  },
}

if (typeof window !== 'undefined') window.__AP = AP
