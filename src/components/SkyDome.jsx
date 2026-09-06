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
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

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
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    // ease the gradient so the blue holds well down the sky instead of
    // washing out the moment you look below the zenith
    float t = pow(clamp(d.y, 0.0, 1.0), 0.42);
    vec3 col = mix(uHorizon, uZenith, t);
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSun * pow(s, 200.0) * 0.65;   // tight core
    col += uSun * pow(s, 9.0) * 0.22;     // the glow around it
    col += uSun * pow(s, 2.0) * 0.06;     // broad warmth across that half
    // warm the last few degrees above the horizon, like late afternoon
    col = mix(col, mix(col, uSun, 0.30), pow(1.0 - abs(d.y), 8.0));
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function SkyDome({ sunDir }) {
  const group = useRef(null)

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
          toneMapped={false}
          uniforms={{
            uZenith: { value: new THREE.Color('#2f6fbe') },
            uHorizon: { value: new THREE.Color('#cddff0') },
            uSun: { value: new THREE.Color('#ffdca6') },
            uSunDir: { value: new THREE.Vector3(...sunDir) },
          }}
        />
      </mesh>

      {/* the disc itself, sized to read as a sun rather than a dinner plate */}
      <mesh position={sunDir.map((v) => v * 1400)} renderOrder={-9}>
        <sphereGeometry args={[13, 20, 20]} />
        <meshBasicMaterial color="#fff8e6" fog={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
