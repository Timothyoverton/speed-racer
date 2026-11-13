// A photographed sky: the backdrop you see and the light the scene is lit by
// come from the same HDR panorama, so reflections and ambient colour match.
//
// Two files (see public/assets/CREDITS.md):
//   env - a 1k HDR, used for image-based lighting. The sun in it is clamped out:
//         the directional light is the sun, and counting it twice would both
//         over-light the scene and put fireflies in every reflection.
//   map - the upper hemisphere as an 8-bit image holding pow(radiance / 8, 1/2.2),
//         decoded back to linear here so the sun and cloud edges still bloom.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { THEME } from '../game/themes.js'

const asset = (p) => import.meta.env.BASE_URL + 'assets/' + p
const UP = new THREE.Vector3(0, 1, 0)

// The sun's direction once the panorama is turned by `yaw` about the vertical.
export function photoSunDir(photo) {
  return new THREE.Vector3(...photo.sunDir).applyAxisAngle(UP, photo.yaw || 0).toArray()
}

// Linear haze colour that meets the panorama's horizon exactly.
export function photoHorizon(photo) {
  const k = photo.gain ?? 1
  return new THREE.Color().setRGB(photo.horizon[0] * k, photo.horizon[1] * k, photo.horizon[2] * k, THREE.LinearSRGBColorSpace)
}

const VS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FS = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uYaw;
  uniform float uGain;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float c = cos(uYaw), s = sin(uYaw);
    // undo the panorama's turn to find where this direction was photographed
    vec3 q = vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
    float u = atan(q.z, q.x) * 0.15915494 + 0.5;
    float v = clamp(asin(clamp(q.y, -1.0, 1.0)) * 0.63661977, 0.004, 1.0);
    vec3 enc = texture2D(uMap, vec2(u, v)).rgb;
    vec3 col = pow(enc, vec3(2.2)) * 8.0 * uGain;
    // the last degrees above the horizon, and everything below it, settle into
    // the haze colour so distant ground has something to fade to
    col = mix(uHorizon, col, smoothstep(-0.01, 0.07, d.y));
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function PhotoSky() {
  const photo = THEME.sky.photo
  const group = useRef(null)
  const scene = useThree((s) => s.scene)
  const env = useLoader(HDRLoader, asset(photo.env), (l) => l.setDataType(THREE.FloatType))
  const map = useLoader(THREE.TextureLoader, asset(photo.map))

  useEffect(() => {
    // clamp the sun out of the lighting panorama (once; the loader caches it)
    if (!env.userData.clamped) {
      const d = env.image.data
      const cap = photo.envClamp ?? 24
      for (let i = 0; i < d.length; i++) if (d[i] > cap) d[i] = cap
      env.userData.clamped = true
      env.needsUpdate = true
    }
    env.mapping = THREE.EquirectangularReflectionMapping
    const prev = { e: scene.environment, i: scene.environmentIntensity, r: scene.environmentRotation.clone() }
    scene.environment = env
    scene.environmentIntensity = photo.envIntensity ?? 1
    scene.environmentRotation.set(0, photo.yaw || 0, 0)
    return () => {
      scene.environment = prev.e
      scene.environmentIntensity = prev.i
      scene.environmentRotation.copy(prev.r)
    }
  }, [env, scene, photo])

  const uniforms = useMemo(() => {
    map.colorSpace = THREE.NoColorSpace
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.ClampToEdgeWrapping
    map.minFilter = THREE.LinearFilter
    map.generateMipmaps = false
    map.needsUpdate = true
    return {
      uMap: { value: map },
      uYaw: { value: photo.yaw || 0 },
      uGain: { value: photo.gain ?? 1 },
      uHorizon: { value: photoHorizon(photo) },
    }
  }, [map, photo])

  useFrame(({ camera }) => {
    if (group.current) group.current.position.copy(camera.position)
  })

  return (
    <group ref={group}>
      <mesh renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[1600, 48, 32]} />
        <shaderMaterial
          vertexShader={VS}
          fragmentShader={FS}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
