// Synthesised engine / tyre / wind audio. No sample files — everything is
// WebAudio oscillators and filtered noise, driven from carState each frame.
//
// Browsers only allow an AudioContext to start from a user gesture, so init()
// is called from the DRIVE button and from the restart key.

const MUTE_KEY = 'speed-racer:muted'

let ctx = null
let master = null
let nodes = null
let muted = readMuted()
let running = false

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function isMuted() {
  return muted
}

export function toggleMute() {
  muted = !muted
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* private mode — just don't persist */
  }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05)
  return muted
}

function noiseBuffer(context, seconds = 2) {
  const buf = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume()
    return
  }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  ctx = new AC()

  master = ctx.createGain()
  master.gain.value = muted ? 0 : 1
  master.connect(ctx.destination)

  // ---- engine: three detuned oscillators through a resonant lowpass --------
  const engineGain = ctx.createGain()
  engineGain.gain.value = 0
  const engineFilter = ctx.createBiquadFilter()
  engineFilter.type = 'lowpass'
  engineFilter.frequency.value = 500
  engineFilter.Q.value = 6
  // a little drive/harshness on top
  const shaper = ctx.createWaveShaper()
  const curve = new Float32Array(1024)
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1
    curve[i] = Math.tanh(x * 2.2)
  }
  shaper.curve = curve
  engineGain.connect(engineFilter)
  engineFilter.connect(shaper)
  shaper.connect(master)

  const oscs = [
    { type: 'sawtooth', mult: 1, detune: 0, level: 0.5 },
    { type: 'sawtooth', mult: 1, detune: 11, level: 0.35 },
    { type: 'square', mult: 0.5, detune: -6, level: 0.4 },
    { type: 'sawtooth', mult: 2, detune: 4, level: 0.16 },
  ].map((o) => {
    const osc = ctx.createOscillator()
    osc.type = o.type
    osc.detune.value = o.detune
    const g = ctx.createGain()
    g.gain.value = o.level
    osc.connect(g)
    g.connect(engineGain)
    osc.start()
    return { osc, mult: o.mult }
  })

  const nb = noiseBuffer(ctx)

  // ---- wind: bandpassed noise that opens up with speed --------------------
  const wind = ctx.createBufferSource()
  wind.buffer = nb
  wind.loop = true
  const windFilter = ctx.createBiquadFilter()
  windFilter.type = 'bandpass'
  windFilter.frequency.value = 700
  windFilter.Q.value = 0.7
  const windGain = ctx.createGain()
  windGain.gain.value = 0
  wind.connect(windFilter)
  windFilter.connect(windGain)
  windGain.connect(master)
  wind.start()

  // ---- tyres: sharp resonant noise while sliding --------------------------
  const skid = ctx.createBufferSource()
  skid.buffer = nb
  skid.loop = true
  const skidFilter = ctx.createBiquadFilter()
  skidFilter.type = 'bandpass'
  skidFilter.frequency.value = 1500
  skidFilter.Q.value = 9
  const skidGain = ctx.createGain()
  skidGain.gain.value = 0
  skid.connect(skidFilter)
  skidFilter.connect(skidGain)
  skidGain.connect(master)
  skid.start()

  // ---- rumble: road roar, grows with speed, cuts in the air ---------------
  const road = ctx.createBufferSource()
  road.buffer = nb
  road.loop = true
  const roadFilter = ctx.createBiquadFilter()
  roadFilter.type = 'lowpass'
  roadFilter.frequency.value = 320
  const roadGain = ctx.createGain()
  roadGain.gain.value = 0
  road.connect(roadFilter)
  roadFilter.connect(roadGain)
  roadGain.connect(master)
  road.start()

  nodes = { oscs, engineGain, engineFilter, windFilter, windGain, skidFilter, skidGain, roadGain }
  running = true
}

// Called every frame from the physics loop.
export function updateAudio(s) {
  if (!running || !ctx || muted) return
  const t = ctx.currentTime
  const k = 0.04 // smoothing time constant

  // engine note: base frequency tracks rpm, ~1 cycle per 2 revs of a V8-ish thing
  const f = 26 + s.rpm * 0.019
  for (const { osc, mult } of nodes.oscs) {
    osc.frequency.setTargetAtTime(f * mult, t, 0.02)
  }
  const load = Math.max(s.throttle, 0.18)
  nodes.engineGain.gain.setTargetAtTime(0.06 + load * 0.11 + s.rpm01 * 0.05, t, k)
  nodes.engineFilter.frequency.setTargetAtTime(
    340 + s.rpm * 0.32 + s.throttle * 1500,
    t,
    k,
  )

  const speed01 = Math.min(s.speed / 62, 1.2)
  nodes.windGain.gain.setTargetAtTime(speed01 * speed01 * 0.09, t, k)
  nodes.windFilter.frequency.setTargetAtTime(500 + speed01 * 900, t, k)

  const rumble = s.grounded ? speed01 * 0.07 : 0
  nodes.roadGain.gain.setTargetAtTime(rumble, t, k)

  const screech = s.grounded ? Math.min(Math.max(s.slip - 0.12, 0) * 1.9, 1) : 0
  nodes.skidGain.gain.setTargetAtTime(screech * 0.13, t, 0.06)
  nodes.skidFilter.frequency.setTargetAtTime(1200 + screech * 700 + speed01 * 300, t, k)
}

// Quieten everything without tearing the graph down (menus, result screen).
export function idleAudio() {
  if (!running || !ctx) return
  const t = ctx.currentTime
  nodes.engineGain.gain.setTargetAtTime(0.05, t, 0.1)
  nodes.engineFilter.frequency.setTargetAtTime(320, t, 0.1)
  for (const { osc, mult } of nodes.oscs) osc.frequency.setTargetAtTime(43 * mult, t, 0.1)
  nodes.windGain.gain.setTargetAtTime(0, t, 0.1)
  nodes.roadGain.gain.setTargetAtTime(0, t, 0.1)
  nodes.skidGain.gain.setTargetAtTime(0, t, 0.1)
}

// One-shots -----------------------------------------------------------------
export function blip(freq = 660, duration = 0.12, gain = 0.16) {
  if (!running || !ctx || muted) return
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = freq
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, ctx.currentTime)
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
  osc.connect(g)
  g.connect(master)
  osc.start()
  osc.stop(ctx.currentTime + duration + 0.02)
}

export function thud(gain = 0.3) {
  if (!running || !ctx || muted) return
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.18)
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, ctx.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
  osc.connect(g)
  g.connect(master)
  osc.start()
  osc.stop(ctx.currentTime + 0.3)
}
