// What makes the fish pond feel like water rather than blue air: slanting shafts
// of sunlight from the surface, and a drift of marine snow that streaks past as
// you speed up. Both are single instanced / point draws with additive blending,
// and the only per-frame work is writing one shared clock uniform.
//
// Nothing here has a collider, and the shafts keep off the ribbon so they never
// wash over the road you're reading.
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { TRACK } from '../game/track.js'
import { THEME } from '../game/themes.js'
import { GROUND_Y } from '../game/trackVisuals.js'
import { sampleTrack } from '../game/trackQuery.js'
import { UW } from '../game/materials.js'

function rng(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A shaft is a camera-facing strip (turned about the vertical only), sheared
// toward the sun's side as it climbs so the light reads as slanting.
const SHAFT_VS = /* glsl */ `
  uniform vec2 uSlant;
  varying vec2 vUv;
  varying float vDist;
  varying float vSeed;
  void main() {
    vUv = uv;
    vec3 c = instanceMatrix[3].xyz;
    vSeed = fract(sin(dot(c.xz, vec2(12.9898, 78.233))) * 43758.5453);
    float sx = length(instanceMatrix[0].xyz);
    float sy = length(instanceMatrix[1].xyz);
    vec3 toCam = cameraPosition - c;
    vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
    vec3 p = c + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
    p.xz += uSlant * position.y * sy;
    vDist = length(cameraPosition - p);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`

const SHAFT_FS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uNear;
  uniform float uFar;
  varying vec2 vUv;
  varying float vDist;
  varying float vSeed;
  void main() {
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float a = pow(across, 1.6);
    // brightest toward the surface, dissolving into the murk on the way down
    float up = vUv.y;
    a *= smoothstep(0.0, 0.7, up) * (1.0 - smoothstep(0.88, 1.0, up));
    // slow swell, out of step shaft to shaft
    a *= 0.65 + 0.35 * sin(uTime * 0.55 + vSeed * 40.0 + up * 3.0);
    // no fog on additive light, so fade by distance by hand (and from the lens)
    a *= (1.0 - smoothstep(uNear, uFar, vDist)) * smoothstep(4.0, 26.0, vDist);
    gl_FragColor = vec4(uColor * a * (0.55 + 0.9 * vSeed), 1.0);
  }
`

// Marine snow: positions are a pure function of the clock, wrapped into a box that
// rides with the camera, so there is nothing to update per particle.
const SNOW_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uBox;
  uniform float uSize;
  varying float vA;
  void main() {
    vec3 drift = vec3(sin(uTime * 0.21 + aSeed.w * 30.0) * 0.6, -0.35 - aSeed.w * 0.3, cos(uTime * 0.17 + aSeed.w * 21.0) * 0.6);
    vec3 world = aSeed.xyz * uBox + drift * uTime;
    vec3 rel = mod(world - cameraPosition, uBox) - uBox * 0.5;
    vec4 mv = viewMatrix * vec4(cameraPosition + rel, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * (0.6 + aSeed.w) * 320.0 / max(-mv.z, 1.0), 1.5, 14.0);
    float edge = 1.0 - smoothstep(0.35, 0.5, length(rel) / uBox);
    vA = edge * smoothstep(1.5, 8.0, -mv.z) * (0.4 + 0.6 * aSeed.w);
  }
`

const SNOW_FS = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`

function buildShafts(spec) {
  const rand = rng(777)
  const half = TRACK.roadWidth / 2
  const tiles = TRACK.tiles
  const out = []
  for (let i = 0, tries = 0; i < spec.count && tries < spec.count * 30; tries++) {
    const tile = tiles[(rand() * tiles.length) | 0]
    const yaw = tile.rot[1]
    const side = rand() < 0.5 ? 1 : -1
    const dist = half + spec.minOff + rand() * (spec.maxOff - spec.minOff)
    const along = (rand() - 0.5) * 24
    const x = tile.pos[0] + Math.cos(yaw) * side * dist + Math.sin(yaw) * along
    const z = tile.pos[2] - Math.sin(yaw) * side * dist + Math.cos(yaw) * along
    const on = sampleTrack(x, z)
    if (on && Math.abs(on.lateral) < half + spec.minOff * 0.6) continue
    const w = 9 + rand() * 20
    const h = spec.height * (0.8 + rand() * 0.4)
    out.push({ x, z, w, h })
    i++
  }
  return out
}

export default function Underwater() {
  const spec = THEME.water
  const dir = THEME.sun.dir

  const shafts = useMemo(() => buildShafts(spec.shafts), [spec])

  // matrices once; the shader only reads the translation and the two scales
  const shaftMesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.translate(0, 0.5, 0) // anchored at the base, growing up
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHAFT_VS,
      fragmentShader: SHAFT_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(spec.shafts.color) },
        uTime: UW.time,
        uNear: { value: spec.shafts.fadeNear },
        uFar: { value: spec.shafts.fadeFar },
        // light travels away from the sun, so the shaft leans toward it as it rises
        uSlant: { value: new THREE.Vector2(dir[0] / dir[1], dir[2] / dir[1]) },
      },
    })
    const mesh = new THREE.InstancedMesh(geo, mat, shafts.length)
    const o = new THREE.Object3D()
    shafts.forEach((s, i) => {
      o.position.set(s.x, GROUND_Y + 0.9, s.z)
      o.scale.set(s.w, s.h, 1)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    return mesh
  }, [shafts, spec, dir])

  const snowPoints = useMemo(() => {
    const rand = rng(31)
    const n = spec.snow.count
    const seed = new Float32Array(n * 4)
    for (let i = 0; i < seed.length; i++) seed[i] = rand()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    const mat = new THREE.ShaderMaterial({
      vertexShader: SNOW_VS,
      fragmentShader: SNOW_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(spec.snow.color) },
        uTime: UW.time,
        uBox: { value: spec.snow.box },
        uSize: { value: spec.snow.size },
      },
    })
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false
    pts.renderOrder = 6
    return pts
  }, [spec])

  useFrame((state) => {
    UW.time.value = state.clock.elapsedTime
  })

  return (
    <group>
      <primitive object={shaftMesh} />
      <primitive object={snowPoints} />
    </group>
  )
}
