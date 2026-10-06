// The sky, and the sun you can see in it.
//
// This replaces drei's <Sky>. That one is a physical (Preetham) model whose
// output is HDR and very bright: against our ACES tone mapping at exposure
// ~1.0 it flattened to near-white at every turbidity/rayleigh pairing worth
// having, so the whole picture lost its lid. A hand-rolled gradient is less
// clever and completely predictable — the colours below are the colours you
// get, and they can be matched to the fog exactly.
//
// The dome rides with the camera, so it behaves like sky rather than like a
// very large ball the car can approach. That matters here: Freefall and Stunt
// Park cover 2km, which is most of the radius drei's Sky was using.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { THEME } from '../game/themes.js'

const VS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FS = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform float uWarm;
  uniform float uGlow;
  uniform float uStars;
  varying vec3 vDir;

  float hash13(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  void main() {
    vec3 d = normalize(vDir);
    // ease the gradient so the blue holds well down the sky instead of
    // washing out the moment you look below the zenith
    float t = pow(clamp(d.y, 0.0, 1.0), 0.42);
    vec3 col = mix(uHorizon, uZenith, t);
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSun * pow(s, 200.0) * 0.65 * uGlow;   // tight core
    col += uSun * pow(s, 9.0) * 0.22 * uGlow;     // the glow around it
    col += uSun * pow(s, 2.0) * 0.06 * uGlow;     // broad warmth across that half
    // warm the last few degrees above the horizon, like late afternoon.
    // uWarm is 0 at night so the horizon stays the fog colour.
    col = mix(col, mix(col, uSun, 0.30), pow(1.0 - abs(d.y), 8.0) * uWarm);
    if (uStars > 0.0 && d.y > 0.0) {
      vec3 cell = floor(d * 220.0);
      float n = hash13(cell);
      float tw = hash13(cell + 19.2);
      float spark = smoothstep(0.972, 0.995, n) * (0.35 + 0.65 * tw);
      col += vec3(0.82, 0.88, 1.0) * spark * smoothstep(0.0, 0.22, d.y);
    }
    gl_FragColor = vec4(col, 1.0);
    // Night: run the dome through the same tone-map + encode as the ground, or
    // the fogged horizon (tone-mapped, so lighter) shows as a slab against it.
    #ifdef SKY_TONED
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    #endif
  }
`

export default function SkyDome() {
  const group = useRef(null)
  const sky = THEME.sky
  const sunDir = THEME.sun.dir

  const uniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color(sky.zenith) },
      uHorizon: { value: new THREE.Color(sky.horizon) },
      uSun: { value: new THREE.Color(sky.sun) },
      uSunDir: { value: new THREE.Vector3(...sunDir) },
      uWarm: { value: sky.warm },
      uGlow: { value: sky.glow },
      uStars: { value: sky.stars },
    }),
    [sky, sunDir],
  )

  // sky is at infinity: keep it centred on the camera every frame
  useFrame(({ camera }) => {
    if (group.current) group.current.position.copy(camera.position)
  })

  return (
    <group ref={group}>
      <mesh renderOrder={-10}>
        <sphereGeometry args={[1600, 32, 20]} />
        <shaderMaterial
          vertexShader={VS}
          fragmentShader={FS}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={!!sky.tone}
          defines={sky.tone ? { SKY_TONED: 1 } : {}}
          uniforms={uniforms}
        />
      </mesh>

      {/* the disc itself, sized to read as a sun rather than a dinner plate */}
      <mesh position={sunDir.map((v) => v * 1400)} renderOrder={-9}>
        <sphereGeometry args={[THEME.sun.discSize, 20, 20]} />
        <meshBasicMaterial color={THEME.sun.disc} fog={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
