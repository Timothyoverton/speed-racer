// Shared materials, built once. Kept out of the components so a race restart
// (which remounts the whole scene graph) doesn't recompile shaders or redraw
// the procedural textures.
import * as THREE from 'three'
import {
  asphaltMap,
  chevronMap,
  asphaltNormal,
  concreteMap,
  grassMap,
  kerbMap,
  checkerMap, hazardMap, brickMap, waterfallMap, rockMap } from './textures.js'
import { TRACK } from './track.js'

// Fish Pond's water: one clock every shader there reads (set once a frame by
// Underwater.jsx), and the caustic net the sand and the surface glow share.
export const UW = { time: { value: 0 } }

let causticTex = null

// Tileable cellular net: bright where two cells meet, which is what refracted
// sunlight looks like on a floor. Built once; shaders scroll two scales of it
// against each other, so the pattern never visibly repeats and costs two taps.
export function causticMap() {
  if (causticTex) return causticTex
  const N = 256
  const G = 8
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  const img = g.createImageData(N, N)
  const hash = (x, y, k) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453
    return s - Math.floor(s)
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = (x / N) * G
      const py = (y / N) * G
      const cx = Math.floor(px)
      const cy = Math.floor(py)
      let f1 = 9
      let f2 = 9
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const gx = (((cx + i) % G) + G) % G
          const gy = (((cy + j) % G) + G) % G
          const fx = cx + i + hash(gx, gy, 1)
          const fy = cy + j + hash(gx, gy, 2)
          const d = Math.hypot(px - fx, py - fy)
          if (d < f1) {
            f2 = f1
            f1 = d
          } else if (d < f2) f2 = d
        }
      }
      const e = Math.max(0, 1 - (f2 - f1) / 0.22)
      const v = Math.pow(e, 2.2)
      const k = (y * N + x) * 4
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(v * 255)
      img.data[k + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  causticTex = new THREE.CanvasTexture(c)
  causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping
  causticTex.anisotropy = 8
  return causticTex
}

// Two scrolling taps of the net, 0..1.
export const CAUSTIC_GLSL = /* glsl */ `
  uniform sampler2D uCaustic;
  float caustic(vec2 p, float t) {
    float a = texture2D(uCaustic, p * 0.5 + vec2(t * 0.020, t * 0.012)).r;
    float b = texture2D(uCaustic, p * 0.77 + vec2(-t * 0.016, t * 0.024) + 0.37).r;
    return clamp(a * 0.6 + b * 0.6 + a * b * 1.2, 0.0, 1.0);
  }
`

// Lit-by-the-surface patch for a MeshStandardMaterial: a soft aqua rim, the
// floor's caustics sliding over anything that faces up, and optionally
//   sway - bend with height above `floorY` (kelp), done in world space after the
//          instance matrix so every blade leans the same way
//   edge - darken the outer strip of an up-facing box top (wet sand at a road
//          edge), read from the box's own 0..1 uv.
export function litUnderwater(mat, spec, floorY, opts = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = UW.time
    shader.uniforms.uCaustic = { value: causticMap() }
    shader.uniforms.uCaustColor = { value: new THREE.Color(spec.color) }
    shader.uniforms.uCaustK = { value: spec.strength * 0.6 * (opts.k ?? 1) }
    shader.uniforms.uRim = { value: new THREE.Color(spec.rim || '#6fe3e6') }
    shader.uniforms.uFloorY = { value: floorY }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorld;\nvarying vec3 vEdge;\nuniform float uTime;\nuniform float uFloorY;',
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelMatrix * mvPosition;
        ${
          opts.sway
            ? `float bend = max(mvPosition.y - uFloorY, 0.0);
        bend *= bend * 0.0035;
        mvPosition.x += sin(uTime * 0.9 + mvPosition.z * 0.21 + mvPosition.x * 0.13) * bend;
        mvPosition.z += cos(uTime * 0.75 + mvPosition.x * 0.19) * bend * 0.7;`
            : ''
        }
        vWorld = mvPosition.xyz;
        vEdge = vec3(uv, normal.y);
        mvPosition = viewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorld;
        varying vec3 vEdge;
        uniform float uTime;
        uniform vec3 uCaustColor;
        uniform float uCaustK;
        uniform vec3 uRim;
        ${CAUSTIC_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        ${
          opts.edge
            ? `{
          float e = min(vEdge.x, 1.0 - vEdge.x);
          float wet = (1.0 - smoothstep(0.02, ${opts.edge.toFixed(3)}, e)) * step(0.5, vEdge.z);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.48, 0.5), wet);
        }`
            : ''
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float up = clamp(inverseTransformDirection(normal, viewMatrix).y, 0.0, 1.0);
          float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
          float near = 1.0 - smoothstep(30.0, 170.0, length(vWorld - cameraPosition));
          outgoingLight += uRim * rim * 0.3;
          outgoingLight += uCaustColor * diffuseColor.rgb * caustic(vWorld.xz * 0.07 + vWorld.y * 0.02, uTime * 0.9) * uCaustK * up * near;
        }
        #include <opaque_fragment>`,
      )
  }
  return mat
}

// The Fish Pond road: sand, not tarmac. Fine grain with the odd shell chip and
// pebble, soft diagonal ripples, slow blotches of damp and dry. Everything is
// periodic in the tile, so the 2.5m repeat never shows a seam. The height field
// doubles as a bump map so low light rakes the ripples.
let sandTex = null
function sandRoadTextures() {
  if (sandTex) return sandTex
  const N = 256
  const TAU = Math.PI * 2
  const cc = document.createElement('canvas')
  cc.width = cc.height = N
  const cg = cc.getContext('2d')
  const ci = cg.createImageData(N, N)
  const h = new Float32Array(N * N)
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N
      const v = y / N
      const r1 = Math.sin(TAU * (3 * u + v + 0.35 * Math.sin(TAU * (u + 2 * v))))
      const r2 = Math.sin(TAU * (5 * u - 2 * v + 0.22 * Math.sin(TAU * (2 * u - v))))
      const blot = Math.sin(TAU * (u + 0.3 * Math.sin(TAU * v))) * Math.sin(TAU * (v + 0.25 * Math.sin(TAU * u * 2)))
      const grain = rnd()
      const hh = 0.5 + 0.28 * r1 + 0.12 * r2 + (grain - 0.5) * 0.12
      h[y * N + x] = hh
      // warm sand, dark in the ripple troughs, pale on the crests
      const t = Math.min(1, Math.max(0, 0.5 + 0.22 * r1 + 0.09 * r2 + 0.12 * blot + (grain - 0.5) * 0.3))
      let R = 142 + 56 * t
      let G = 99 + 52 * t
      let B = 55 + 40 * t
      const spec = rnd()
      if (spec > 0.994) {
        R = 238
        G = 226
        B = 204 // shell chip
      } else if (spec < 0.004) {
        R = 96
        G = 78
        B = 62 // pebble
      }
      const k = (y * N + x) * 4
      ci.data[k] = R
      ci.data[k + 1] = G
      ci.data[k + 2] = B
      ci.data[k + 3] = 255
    }
  }
  cg.putImageData(ci, 0, 0)
  const nc = document.createElement('canvas')
  nc.width = nc.height = N
  const ng = nc.getContext('2d')
  const ni = ng.createImageData(N, N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = h[y * N + ((x - 1 + N) % N)]
      const r = h[y * N + ((x + 1) % N)]
      const u = h[((y - 1 + N) % N) * N + x]
      const d = h[((y + 1) % N) * N + x]
      const nx = (l - r) * 1.6
      const ny = (u - d) * 1.6
      const len = Math.hypot(nx, ny, 1)
      const k = (y * N + x) * 4
      ni.data[k] = (nx / len) * 127 + 128
      ni.data[k + 1] = (ny / len) * 127 + 128
      ni.data[k + 2] = (1 / len) * 255
      ni.data[k + 3] = 255
    }
  }
  ng.putImageData(ni, 0, 0)
  const map = new THREE.CanvasTexture(cc)
  const nrm = new THREE.CanvasTexture(nc)
  map.colorSpace = THREE.SRGBColorSpace
  for (const t of [map, nrm]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
  }
  sandTex = { map, nrm }
  return sandTex
}

// `repeat` is [across, along] tiles for the surface it dresses. Cached by key.
const sandMats = {}
export function sandRoadMaterial(key, repeat, spec, floorY) {
  if (sandMats[key]) return sandMats[key]
  const { map, nrm } = sandRoadTextures()
  const m = map.clone()
  const n = nrm.clone()
  for (const t of [m, n]) {
    t.needsUpdate = true
    t.repeat.set(repeat[0], repeat[1])
  }
  const mat = new THREE.MeshStandardMaterial({
    map: m,
    normalMap: n,
    normalScale: new THREE.Vector2(0.7, 0.7),
    color: '#ffffff',
    roughness: 0.96,
    metalness: 0,
  })
  sandMats[key] = litUnderwater(mat, spec, floorY, { edge: 0.14, k: 0.55 })
  return mat
}

let cache = null

export function trackMaterials() {
  if (cache) return cache

  const rw = TRACK.roadWidth
  const map = asphaltMap()
  const nrm = asphaltNormal()
  // one texture tile every ~2.5 m of road, in both directions
  map.repeat.set(rw / 2.5, 2.4)
  nrm.repeat.set(rw / 2.5, 2.4)

  const kerb = kerbMap()
  kerb.repeat.set(1, 1.2) // ~60cm bands, the scale a real kerb uses

  const concrete = concreteMap()
  concrete.repeat.set(3, 1)

  const grass = grassMap()
  grass.repeat.set(240, 240)

  cache = {
    asphalt: new THREE.MeshStandardMaterial({
      map,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: '#8c8f96',
      roughness: 0.94,
      metalness: 0.02,
    }),
    line: new THREE.MeshStandardMaterial({
      color: '#e8ecf3',
      roughness: 0.6,
      metalness: 0,
      emissive: '#20262f',
      emissiveIntensity: 0.4,
    }),
    kerb: new THREE.MeshStandardMaterial({ map: kerb, roughness: 0.55, metalness: 0.05 }),
    concrete: new THREE.MeshStandardMaterial({
      map: concrete,
      color: '#9aa0ab',
      roughness: 0.9,
      metalness: 0.02,
    }),
    stripeR: new THREE.MeshStandardMaterial({
      color: '#ffffff', // tinted per instance
      emissive: '#2f9bff',
      emissiveIntensity: 0.12,
      roughness: 0.4,
    }),
    stripeL: new THREE.MeshStandardMaterial({
      color: '#ffffff', // tinted per instance
      emissive: '#ff3b4d',
      emissiveIntensity: 0.12,
      roughness: 0.4,
    }),
    post: new THREE.MeshStandardMaterial({ color: '#7e8794', roughness: 0.6, metalness: 0.5 }),
    boostPad: new THREE.MeshStandardMaterial({
      color: '#0b1a24',
      roughness: 0.5,
      metalness: 0.2,
      emissive: '#0a2b3a',
      emissiveIntensity: 0.8,
    }),
    boostArrow: new THREE.MeshStandardMaterial({
      color: '#7ffbff',
      emissive: '#25e6ff',
      emissiveIntensity: 2.6,
      roughness: 0.3,
    }),
    water: new THREE.MeshPhysicalMaterial({
      color: '#0f6f9c',
      transparent: true,
      opacity: 0.88,
      // low roughness would mirror the sky and hide the sharks; keep it readable
      roughness: 0.35,
      metalness: 0.1,
      envMapIntensity: 0.5,
    }),
    poolTile: new THREE.MeshStandardMaterial({ color: '#cfe6f2', roughness: 0.7, metalness: 0.05 }),
    shark: new THREE.MeshStandardMaterial({ color: '#39434f', roughness: 0.75, metalness: 0.1 }),
    rock: new THREE.MeshStandardMaterial({
      map: (() => {
        const t = rockMap()
        t.repeat.set(2, 2)
        return t
      })(),
      color: '#ffffff', // tinted per instance
      roughness: 1,
      metalness: 0,
    }),
    brick: new THREE.MeshStandardMaterial({
      map: (() => {
        const t = brickMap()
        t.repeat.set(3, 1)
        return t
      })(),
      roughness: 0.95,
      metalness: 0,
    }),
    // the ramp gets real tarmac, so it reads as something you drive on
    rampTop: new THREE.MeshStandardMaterial({
      map: (() => {
        const t = asphaltMap()
        t.repeat.set(1, 3)
        return t
      })(),
      color: '#8c8f96',
      roughness: 0.94,
      metalness: 0.02,
    }),
    fallWater: new THREE.MeshPhysicalMaterial({
      map: (() => {
        const t = waterfallMap()
        t.repeat.set(3, 2)
        return t
      })(),
      color: '#dff2fa',
      transparent: true,
      opacity: 0.62,
      roughness: 0.3,
      metalness: 0,
      envMapIntensity: 0.6,
      depthWrite: false,
    }),
    mist: new THREE.MeshStandardMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      roughness: 1,
    }),
    hazard: new THREE.MeshStandardMaterial({
      map: (() => {
        const t = hazardMap()
        t.repeat.set(4, 1)
        return t
      })(),
      roughness: 0.5,
      metalness: 0.1,
      emissive: '#2a2410',
      emissiveIntensity: 0.6,
    }),
    metal: new THREE.MeshStandardMaterial({ color: '#98a1ae', roughness: 0.35, metalness: 0.9 }),
    grass: new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0 }),
    chevronL: new THREE.MeshStandardMaterial({ map: chevronMap(), roughness: 0.6 }),
    chevronR: new THREE.MeshStandardMaterial({
      map: (() => {
        const m = chevronMap().clone()
        m.needsUpdate = true
        m.wrapS = THREE.RepeatWrapping
        m.repeat.x = -1 // same artwork, arrows pointing the other way
        return m
      })(),
      roughness: 0.6,
    }),
    checker: new THREE.MeshStandardMaterial({
      map: checkerMap(),
      roughness: 0.7,
      metalness: 0,
    }),
  }
  return cache
}

export function gateMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}
