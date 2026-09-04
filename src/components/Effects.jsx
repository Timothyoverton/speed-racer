// Tyre smoke and skid marks. Both are fixed-size pools written straight from
// the car telemetry each frame — no allocation, no React state.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { carState } from '../game/carState.js'
import { getState } from '../game/store.js'
import { smokeMap } from '../game/textures.js'

const SMOKE = 200
const MARKS = 420
const SLIP_ON = 0.16 // slip above this and the tyres start protesting
const WHEEL_X = 0.94
const WHEEL_Z = -1.38
const CONTACT_Y = -0.4 // car origin sits ~0.4 above the road surface

const SMOKE_VS = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 420.0 / max(-mv.z, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`

const SMOKE_FS = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    if (t.a * vAlpha < 0.004) discard;
    gl_FragColor = vec4(uColor, t.a * vAlpha);
  }
`

export default function Effects() {
  const points = useRef(null)
  const marks = useRef(null)
  const cursor = useRef(0)
  const markCursor = useRef(0)
  const emitAcc = useRef(0)

  const smoke = useMemo(() => {
    const pos = new Float32Array(SMOKE * 3)
    const vel = new Float32Array(SMOKE * 3)
    const size = new Float32Array(SMOKE)
    const alpha = new Float32Array(SMOKE)
    const life = new Float32Array(SMOKE)
    // park everything far below the world until it's used
    for (let i = 0; i < SMOKE; i++) pos[i * 3 + 1] = -1000
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeMap() },
        uColor: { value: new THREE.Color('#aeb4bd') },
      },
      vertexShader: SMOKE_VS,
      fragmentShader: SMOKE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    return { geo, mat, pos, vel, size, alpha, life }
  }, [])

  const markMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#0b0c10',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    [],
  )

  const dummy = useMemo(() => {
    const o = new THREE.Object3D()
    o.rotation.order = 'YXZ'
    return o
  }, [])

  // start with every skid mark collapsed to nothing
  useLayoutEffect(() => {
    const mesh = marks.current
    if (!mesh) return
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < MARKS; i++) mesh.setMatrixAt(i, zero)
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const s = carState
    const racing = getState().phase === 'racing'

    // --- advect existing smoke -------------------------------------------
    const { pos, vel, size, alpha, life } = smoke
    for (let i = 0; i < SMOKE; i++) {
      if (life[i] <= 0) continue
      life[i] -= dt
      const i3 = i * 3
      pos[i3] += vel[i3] * dt
      pos[i3 + 1] += vel[i3 + 1] * dt
      pos[i3 + 2] += vel[i3 + 2] * dt
      vel[i3] *= 1 - 1.4 * dt
      vel[i3 + 2] *= 1 - 1.4 * dt
      size[i] += 4.2 * dt
      alpha[i] = Math.max(life[i] / 1.5, 0) * 0.3
      if (life[i] <= 0) {
        alpha[i] = 0
        pos[i3 + 1] = -1000
      }
    }

    // --- emit ---------------------------------------------------------------
    const slipping = racing && s.grounded && s.slip > SLIP_ON
    const spinning = racing && s.grounded && s.throttle > 0.5 && s.speed < 6
    if (slipping || spinning) {
      const strength = Math.min((s.slip - SLIP_ON) * 3 + (spinning ? 0.6 : 0), 1.4)
      emitAcc.current += strength * 90 * dt
      const n = Math.floor(emitAcc.current)
      emitAcc.current -= n
      for (let k = 0; k < n; k++) {
        const i = cursor.current
        cursor.current = (cursor.current + 1) % SMOKE
        const side = k % 2 === 0 ? 1 : -1
        const i3 = i * 3
        pos[i3] =
          s.pos[0] + s.right[0] * side * WHEEL_X + s.fwd[0] * WHEEL_Z + (Math.random() - 0.5) * 0.4
        pos[i3 + 1] = s.pos[1] + CONTACT_Y + 0.25 + Math.random() * 0.2
        pos[i3 + 2] =
          s.pos[2] + s.right[2] * side * WHEEL_X + s.fwd[2] * WHEEL_Z + (Math.random() - 0.5) * 0.4
        // thrown backwards out of the contact patch, plus a little lift
        vel[i3] = -s.fwd[0] * (2 + s.speed * 0.12) + (Math.random() - 0.5) * 2.2
        vel[i3 + 1] = 1.1 + Math.random() * 1.2
        vel[i3 + 2] = -s.fwd[2] * (2 + s.speed * 0.12) + (Math.random() - 0.5) * 2.2
        size[i] = 0.9 + Math.random() * 0.7
        life[i] = 0.9 + Math.random() * 0.7
        alpha[i] = 0.3
      }

      // --- lay rubber ------------------------------------------------------
      const mesh = marks.current
      if (mesh) {
        for (const side of [1, -1]) {
          const j = markCursor.current
          markCursor.current = (markCursor.current + 1) % MARKS
          dummy.position.set(
            s.pos[0] + s.right[0] * side * WHEEL_X + s.fwd[0] * WHEEL_Z,
            s.pos[1] + CONTACT_Y + 0.03,
            s.pos[2] + s.right[2] * side * WHEEL_X + s.fwd[2] * WHEEL_Z,
          )
          dummy.rotation.set(-Math.PI / 2, Math.atan2(s.fwd[0], s.fwd[2]), 0)
          const len = Math.max(0.6, s.speed * dt * 2.2)
          dummy.scale.set(0.36, len, 1)
          dummy.updateMatrix()
          mesh.setMatrixAt(j, dummy.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
      }
    }

    const geo = points.current?.geometry
    if (geo) {
      geo.attributes.position.needsUpdate = true
      geo.attributes.aSize.needsUpdate = true
      geo.attributes.aAlpha.needsUpdate = true
    }
  })

  return (
    <group>
      <points ref={points} frustumCulled={false}>
        <primitive object={smoke.geo} attach="geometry" />
        <primitive object={smoke.mat} attach="material" />
      </points>

      <instancedMesh
        ref={marks}
        args={[undefined, undefined, MARKS]}
        frustumCulled={false}
        renderOrder={2}
      >
        <planeGeometry args={[1, 1]} />
        <primitive object={markMat} attach="material" />
      </instancedMesh>
    </group>
  )
}
