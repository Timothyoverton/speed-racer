// Generative synth beds — one per circuit.
//
// Written in the idiom Tim asked for (slow detuned drones, open fifths, a sub
// pulse, long cavernous reverb) rather than reproducing any existing music.
// Everything is synthesised at runtime, so there are no audio files to ship.
//
// Shares the AudioContext with audio.js and hangs off its music bus, so mute
// and the master fade cover it for free.

import { audioCtx, musicBus } from './audio.js'

const ENABLED_KEY = 'speed-racer:music'

let voices = null
let timer = null
let current = null

export function isMusicEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

export function setMusicEnabled(on) {
  try {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0')
  } catch {
    /* private mode */
  }
  if (!on) stopMusic()
  return on
}

// semitone -> frequency, A4 = 440
const hz = (semis) => 440 * Math.pow(2, semis / 12)

// Each track gets its own key, chord movement, timbre and pulse.
const PRESETS = {
  'test-pad-0': {
    root: -21, // C2-ish, warm and neutral
    chords: [[0, 7, 12], [0, 7, 14], [-2, 5, 12], [0, 7, 12]],
    wave: 'sawtooth',
    cutoff: 420,
    sweep: 260,
    pulseSec: 3.2,
    shimmer: 0.16,
    gain: 0.075,
  },
  'long-ribbon-1': {
    root: -24, // lower, wider — the long fast one
    chords: [[0, 7, 12], [3, 10, 15], [-4, 3, 8], [0, 7, 12], [5, 12, 17]],
    wave: 'sawtooth',
    cutoff: 340,
    sweep: 420,
    pulseSec: 2.4,
    shimmer: 0.22,
    gain: 0.08,
  },
  'qiddiya-rush-2': {
    root: -19, // brighter, a touch more tension
    chords: [[0, 7, 12], [1, 8, 13], [0, 7, 12], [-3, 4, 11]],
    wave: 'square',
    cutoff: 300,
    sweep: 520,
    pulseSec: 2.0,
    shimmer: 0.3,
    gain: 0.07,
  },
}

// A big soft reverb from a decaying noise burst — what gives it the space.
function makeReverb(ctx, seconds = 3.4) {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, len, rate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
    }
  }
  const conv = ctx.createConvolver()
  conv.buffer = buf
  return conv
}

export function startMusic(trackId) {
  if (!isMusicEnabled()) return
  const ctx = audioCtx()
  const bus = musicBus()
  if (!ctx || !bus) return
  if (current === trackId && voices) return
  stopMusic()

  const p = PRESETS[trackId] || PRESETS['test-pad-0']
  current = trackId

  const out = ctx.createGain()
  out.gain.value = 0
  const reverb = makeReverb(ctx)
  const wet = ctx.createGain()
  wet.gain.value = 0.55
  out.connect(bus)
  out.connect(reverb)
  reverb.connect(wet)
  wet.connect(bus)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = p.cutoff
  filter.Q.value = 1.1
  filter.connect(out)

  // three pad voices, each a pair of detuned oscillators
  const pads = [0, 1, 2].map((i) => {
    const g = ctx.createGain()
    g.gain.value = 0.3
    g.connect(filter)
    const oscs = [-6, 6].map((cents) => {
      const o = ctx.createOscillator()
      o.type = p.wave
      o.detune.value = cents
      o.frequency.value = hz(p.root + p.chords[0][i])
      o.connect(g)
      o.start()
      return o
    })
    return { g, oscs }
  })

  // sub pulse — the heartbeat under it
  const subGain = ctx.createGain()
  subGain.gain.value = 0
  subGain.connect(bus)
  const sub = ctx.createOscillator()
  sub.type = 'sine'
  sub.frequency.value = hz(p.root - 12)
  sub.connect(subGain)
  sub.start()

  // high shimmer, drifting slowly across the top
  const shimGain = ctx.createGain()
  shimGain.gain.value = p.shimmer * 0.02
  const shim = ctx.createOscillator()
  shim.type = 'triangle'
  shim.frequency.value = hz(p.root + 36)
  const shimLfo = ctx.createOscillator()
  shimLfo.frequency.value = 0.05
  const shimLfoGain = ctx.createGain()
  shimLfoGain.gain.value = 4
  shimLfo.connect(shimLfoGain)
  shimLfoGain.connect(shim.frequency)
  shim.connect(shimGain)
  shimGain.connect(reverb)
  shim.start()
  shimLfo.start()

  out.gain.setTargetAtTime(p.gain, ctx.currentTime, 2.2) // fade in

  // walk the progression, moving the pad voices and breathing the filter
  let step = 0
  const advance = () => {
    const t = ctx.currentTime
    const chord = p.chords[step % p.chords.length]
    step++
    pads.forEach((v, i) => {
      const f = hz(p.root + chord[i])
      v.oscs.forEach((o) => o.frequency.setTargetAtTime(f, t, 1.4))
    })
    sub.frequency.setTargetAtTime(hz(p.root - 12 + chord[0]), t, 1.0)
    // pulse: open the filter and thump the sub, then let both settle
    filter.frequency.cancelScheduledValues(t)
    filter.frequency.setTargetAtTime(p.cutoff + p.sweep, t, 0.25)
    filter.frequency.setTargetAtTime(p.cutoff, t + 0.9, 1.3)
    subGain.gain.cancelScheduledValues(t)
    subGain.gain.setTargetAtTime(0.09, t, 0.05)
    subGain.gain.setTargetAtTime(0.0, t + 0.35, 0.5)
  }
  advance()
  timer = setInterval(advance, p.pulseSec * 1000)

  voices = { out, filter, pads, sub, subGain, shim, shimLfo, shimGain, reverb, wet }
}

export function stopMusic() {
  if (timer) clearInterval(timer)
  timer = null
  current = null
  if (!voices) return
  const ctx = audioCtx()
  const v = voices
  voices = null
  if (!ctx) return
  const t = ctx.currentTime
  v.out.gain.setTargetAtTime(0, t, 0.4)
  v.shimGain.gain.setTargetAtTime(0, t, 0.4)
  v.subGain.gain.setTargetAtTime(0, t, 0.3)
  setTimeout(() => {
    try {
      v.pads.forEach((p) => p.oscs.forEach((o) => o.stop()))
      v.sub.stop()
      v.shim.stop()
      v.shimLfo.stop()
    } catch {
      /* already stopped */
    }
  }, 2000)
}
