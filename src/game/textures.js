// Procedural canvas textures. No binary assets — everything is drawn once at
// startup and cached, so the build stays a couple of hundred KB and there is
// nothing to 404 on GitHub Pages.
import * as THREE from 'three'

const cache = new Map()

function make(key, fn) {
  if (cache.has(key)) return cache.get(key)
  const tex = fn()
  tex.colorSpace = tex.isDataTexture ? THREE.NoColorSpace : tex.colorSpace
  cache.set(key, tex)
  return tex
}

function canvas(size) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return [c, c.getContext('2d')]
}

function toTexture(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat[0], repeat[1])
  tex.anisotropy = aniso
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// value noise on a grid, smoothed — cheap stand-in for perlin
function noiseField(n, seed = 1) {
  const rnd = mulberry(seed)
  const raw = new Float32Array(n * n)
  for (let i = 0; i < raw.length; i++) raw[i] = rnd()
  const out = new Float32Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sum = 0
      let w = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = ((y + dy + n) % n) * n + ((x + dx + n) % n)
          const weight = dx === 0 && dy === 0 ? 4 : 1
          sum += raw[k] * weight
          w += weight
        }
      }
      out[y * n + x] = sum / w
    }
  }
  return out
}

function mulberry(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- asphalt ---
export function asphaltMap() {
  return make('asphalt', () => {
    const N = 512
    const [c, g] = canvas(N)
    g.fillStyle = '#33363d'
    g.fillRect(0, 0, N, N)

    // broad tonal patches — old repairs, dried-out sections
    const patch = noiseField(32, 7)
    const img = g.getImageData(0, 0, N, N)
    const fine = noiseField(N, 21)
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4
        const p = patch[Math.floor((y / N) * 32) * 32 + Math.floor((x / N) * 32)]
        const f = fine[y * N + x]
        // aggregate speckle: a few bright chips of stone in the mix
        const chip = f > 0.86 ? (f - 0.86) * 5 : 0
        const v = 42 + p * 16 + (f - 0.5) * 26 + chip * 90
        img.data[i] = v * 0.97
        img.data[i + 1] = v
        img.data[i + 2] = v * 1.06
        img.data[i + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)

    // a couple of tar seams
    g.strokeStyle = 'rgba(20,21,25,0.55)'
    g.lineWidth = 3
    for (let i = 0; i < 3; i++) {
      g.beginPath()
      const y0 = (i + 0.3) * (N / 3)
      g.moveTo(0, y0)
      for (let x = 0; x <= N; x += 32) g.lineTo(x, y0 + Math.sin(x * 0.05 + i) * 5)
      g.stroke()
    }
    return toTexture(c)
  })
}

// matching normal map so the tarmac actually catches the low sun
export function asphaltNormal() {
  return make('asphalt-n', () => {
    const N = 256
    const [c, g] = canvas(N)
    const h = noiseField(N, 21)
    const img = g.createImageData(N, N)
    const s = 2.2
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const l = h[y * N + ((x - 1 + N) % N)]
        const r = h[y * N + ((x + 1) % N)]
        const u = h[((y - 1 + N) % N) * N + x]
        const d = h[((y + 1) % N) * N + x]
        const nx = (l - r) * s
        const ny = (u - d) * s
        const len = Math.hypot(nx, ny, 1)
        const i = (y * N + x) * 4
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
        img.data[i + 2] = (1 / len) * 255
        img.data[i + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    return toTexture(c, { srgb: false })
  })
}

// ------------------------------------------------------------------ grass ---
export function grassMap() {
  return make('grass', () => {
    const N = 256
    const [c, g] = canvas(N)
    const a = noiseField(N, 3)
    const b = noiseField(32, 11)
    const img = g.createImageData(N, N)
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4
        const patch = b[Math.floor((y / N) * 32) * 32 + Math.floor((x / N) * 32)]
        const n = a[y * N + x]
        // mown stripes, like a stadium infield
        const stripe = Math.sin((x / N) * Math.PI * 8) > 0 ? 1.12 : 0.9
        img.data[i] = (26 + patch * 22 + n * 26) * stripe
        img.data[i + 1] = (58 + patch * 40 + n * 34) * stripe
        img.data[i + 2] = (30 + patch * 16 + n * 18) * stripe
        img.data[i + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    return toTexture(c)
  })
}

// ------------------------------------------------------------------- kerb ---
export function kerbMap() {
  return make('kerb', () => {
    const N = 128
    const [c, g] = canvas(N)
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f2f4f8' : '#e01b28'
      g.fillRect(0, (i * N) / 8, N, N / 8)
    }
    // grime so it doesn't read as plastic
    g.fillStyle = 'rgba(0,0,0,0.10)'
    for (let i = 0; i < 260; i++) {
      g.fillRect(Math.random() * N, Math.random() * N, 3, 2)
    }
    return toTexture(c)
  })
}

// ---------------------------------------------------------- chevron board ---
// The yellow arrow boards that sit on the outside of a corner, warning you the
// road is about to turn. Drawn pointing left; the right-hand version reuses the
// same canvas with the map mirrored.
export function chevronMap() {
  return make('chevron', () => {
    const N = 256
    const [c, g] = canvas(N)
    g.fillStyle = '#f2c500'
    g.fillRect(0, 0, N, N)
    g.fillStyle = '#14161d'
    g.lineWidth = 0
    const arrows = 3
    for (let a = 0; a < arrows; a++) {
      const x0 = (a * N) / arrows
      const w = N / arrows
      g.beginPath()
      g.moveTo(x0 + w * 0.75, N * 0.12)
      g.lineTo(x0 + w * 0.3, N * 0.5)
      g.lineTo(x0 + w * 0.75, N * 0.88)
      g.lineTo(x0 + w * 0.95, N * 0.88)
      g.lineTo(x0 + w * 0.5, N * 0.5)
      g.lineTo(x0 + w * 0.95, N * 0.12)
      g.closePath()
      g.fill()
    }
    g.strokeStyle = '#14161d'
    g.lineWidth = 10
    g.strokeRect(5, 5, N - 10, N - 10)
    return toTexture(c)
  })
}

// ---------------------------------------------------------------- checker ---
// Diagonal hazard stripes — what marks the lip of a gap and the arch beams.
export function hazardMap() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  g.fillStyle = '#f4c518'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = '#15171c'
  g.lineWidth = 22
  for (let i = -128; i < 256; i += 44) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 128, 128)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// Brick, for the blocks you have to go around. They were plain concrete and
// at distance you couldn't tell them from the launch ramp — which is a fairness
// problem, not a decoration one, since one you drive up and one ends your run.
export function brickMap() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#3b2b26' // mortar
  g.fillRect(0, 0, 256, 256)
  const bw = 64
  const bh = 32
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? -bw / 2 : 0
    for (let col = -1; col < 5; col++) {
      const x = col * bw + off + 2
      const y = row * bh + 2
      // vary each brick a little so it isn't a printed grid
      const v = 0.82 + Math.random() * 0.32
      const r = Math.round(150 * v)
      const gg = Math.round(66 * v)
      const b = Math.round(52 * v)
      g.fillStyle = `rgb(${r},${gg},${b})`
      g.fillRect(x, y, bw - 4, bh - 4)
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export function checkerMap() {
  return make('checker', () => {
    const N = 128
    const [c, g] = canvas(N)
    const s = N / 8
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 2 ? '#f2f4f8' : '#14161d'
        g.fillRect(x * s, y * s, s, s)
      }
    }
    return toTexture(c)
  })
}

// --------------------------------------------------------------- concrete ---
export function concreteMap() {
  return make('concrete', () => {
    const N = 256
    const [c, g] = canvas(N)
    const n = noiseField(N, 5)
    const img = g.createImageData(N, N)
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4
        const v = 116 + (n[y * N + x] - 0.5) * 40
        img.data[i] = v
        img.data[i + 1] = v * 1.01
        img.data[i + 2] = v * 1.04
        img.data[i + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    // panel joints
    g.strokeStyle = 'rgba(50,52,58,0.7)'
    g.lineWidth = 3
    g.strokeRect(1.5, 1.5, N - 3, N - 3)
    // streaks of dirt running down the panel
    g.fillStyle = 'rgba(60,58,54,0.14)'
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * N
      g.fillRect(x, 0, 2 + Math.random() * 6, N)
    }
    return toTexture(c)
  })
}

// ------------------------------------------------------------ smoke puff ---
export function smokeMap() {
  return make('smoke', () => {
    const N = 64
    const [c, g] = canvas(N)
    const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.45, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, N, N)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  })
}
