// The car. Built from procedural geometry (no GLTF to download) but shaped
// properly: a moulded body from an extruded plan-view outline, a glass canopy,
// aero, and real wheels that steer, spin and glow under braking.
//
// Faces local +Z. Animates from the mutable `carState` bag when `live`.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { carState } from '../game/carState.js'

const WHEEL_R = 0.42
const TRACK_HALF = 0.95 // wheels sit proud of the bodywork, like a race car
const WHEELBASE_F = 1.34
const WHEELBASE_R = -1.36
const WHEEL_Y = -0.16 // puts the contact patch at -0.58, just under the collider

// --- geometry helpers -------------------------------------------------------

// Extrude a plan-view (top-down) outline upwards, with a bevel so the edges
// read as moulded sheet metal rather than a cut box.
function planExtrude(shape, depth, bevel) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 14,
    steps: 1,
  })
  geo.rotateX(Math.PI / 2)
  geo.translate(0, depth, 0)
  geo.computeVertexNormals()
  return geo
}

function mirroredShape(points) {
  // points: [x, z] along the right-hand side, nose first, described as
  // [x, z, cx, cz] where cx/cz is the quadratic control point to reach it.
  const s = new THREE.Shape()
  const [first] = points
  s.moveTo(first[0], first[1])
  for (let i = 1; i < points.length; i++) {
    const [x, z, cx, cz] = points[i]
    if (cx == null) s.lineTo(x, z)
    else s.quadraticCurveTo(cx, cz, x, z)
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const [x, z] = points[i]
    const nx = -x
    if (i === points.length - 1) s.lineTo(nx, z)
    else {
      const next = points[i + 1]
      if (next[2] == null) s.lineTo(nx, z)
      else s.quadraticCurveTo(-next[2], next[3], nx, z)
    }
  }
  s.closePath()
  return s
}

function useCarGeometry() {
  return useMemo(() => {
    // main body plan: pointed nose, waisted over the wheels, wide haunches
    const body = mirroredShape([
      [0.0, 2.12],
      [0.42, 1.62, 0.18, 2.02],
      [0.8, 1.34, 0.66, 1.5], // front arch
      [0.78, 1.02, 0.82, 1.2],
      [0.64, 0.3, 0.66, 0.66], // waist, so the wheels stand proud
      [0.68, -0.7, 0.62, -0.2],
      [0.86, -1.32, 0.84, -1.0], // rear haunch
      [0.8, -1.86, 0.86, -1.7],
      [0.5, -2.06, 0.66, -2.05],
      [0.0, -2.1],
    ])

    // greenhouse: a long, low canopy rather than a bubble
    const cabin = mirroredShape([
      [0.0, 0.98],
      [0.3, 0.62, 0.16, 0.92],
      [0.44, 0.05, 0.44, 0.34],
      [0.45, -0.72, 0.46, -0.4],
      [0.3, -1.16, 0.42, -1.08],
      [0.0, -1.24],
    ])

    // tyre cross-section, revolved — rounded shoulders, not a flat cylinder
    const tyreProfile = [
      new THREE.Vector2(0.2, -0.175),
      new THREE.Vector2(0.34, -0.175),
      new THREE.Vector2(0.405, -0.14),
      new THREE.Vector2(WHEEL_R, -0.07),
      new THREE.Vector2(WHEEL_R, 0.07),
      new THREE.Vector2(0.405, 0.14),
      new THREE.Vector2(0.34, 0.175),
      new THREE.Vector2(0.2, 0.175),
    ]
    const tyre = new THREE.LatheGeometry(tyreProfile, 24)
    tyre.rotateZ(Math.PI / 2)

    const rim = new THREE.CylinderGeometry(0.27, 0.27, 0.3, 20)
    rim.rotateZ(Math.PI / 2)
    const disc = new THREE.CylinderGeometry(0.25, 0.25, 0.045, 20)
    disc.rotateZ(Math.PI / 2)
    const spoke = new THREE.BoxGeometry(0.09, 0.05, 0.25)

    return {
      bodyGeo: planExtrude(body, 0.34, 0.07),
      cabinGeo: planExtrude(cabin, 0.2, 0.05),
      tyre,
      rim,
      disc,
      spoke,
    }
  }, [])
}

// --- materials --------------------------------------------------------------

function useMaterials(ghost, color) {
  return useMemo(() => {
    if (ghost) {
      const g = (c, o) =>
        new THREE.MeshStandardMaterial({
          color: c,
          emissive: c,
          emissiveIntensity: 0.5,
          transparent: true,
          opacity: o,
          depthWrite: false,
          roughness: 0.4,
        })
      const shell = g('#6cf0c4', 0.26)
      return {
        paint: shell,
        trim: g('#4fd8ae', 0.22),
        glass: g('#8ffbd8', 0.16),
        carbon: g('#4fd8ae', 0.2),
        tyre: g('#3ad39f', 0.22),
        rim: g('#8ffbd8', 0.24),
        head: g('#c8fff0', 0.3),
        tail: g('#8ffbd8', 0.3),
        disc: g('#8ffbd8', 0.2),
        ghost: true,
      }
    }
    return {
      paint: new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.9,
        roughness: 0.19,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 2.0,
      }),
      trim: new THREE.MeshPhysicalMaterial({
        color: '#0e131d',
        metalness: 0.4,
        roughness: 0.35,
        clearcoat: 0.8,
        envMapIntensity: 1.2,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: '#101c2c',
        metalness: 0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.62,
        clearcoat: 1,
        envMapIntensity: 2.4,
      }),
      carbon: new THREE.MeshStandardMaterial({
        color: '#15181f',
        metalness: 0.65,
        roughness: 0.42,
        envMapIntensity: 1,
      }),
      tyre: new THREE.MeshStandardMaterial({
        color: '#101116',
        roughness: 0.92,
        metalness: 0,
      }),
      rim: new THREE.MeshStandardMaterial({
        color: '#cfd6e2',
        metalness: 1,
        roughness: 0.16,
        envMapIntensity: 2.2,
      }),
      head: new THREE.MeshStandardMaterial({
        color: '#eaf4ff',
        emissive: '#cfe6ff',
        emissiveIntensity: 2.2,
        roughness: 0.2,
      }),
      tail: new THREE.MeshStandardMaterial({
        color: '#3a0a10',
        emissive: '#ff2233',
        emissiveIntensity: 0.9,
        roughness: 0.3,
      }),
      disc: new THREE.MeshStandardMaterial({
        color: '#3a3d44',
        emissive: '#ff3300',
        emissiveIntensity: 0,
        metalness: 0.8,
        roughness: 0.5,
      }),
      ghost: false,
    }
  }, [ghost, color])
}

// --- wheel ------------------------------------------------------------------

function Wheel({ geo, mat, position, steerRef, spinRef, flip = false }) {
  return (
    <group position={position}>
      <group ref={steerRef}>
        <group ref={spinRef} rotation={[0, flip ? Math.PI : 0, 0]}>
          <mesh geometry={geo.tyre} material={mat.tyre} castShadow />
          <mesh geometry={geo.rim} material={mat.rim} castShadow />
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh
              key={i}
              geometry={geo.spoke}
              material={mat.rim}
              position={[0, 0, 0]}
              rotation={[(i / 5) * Math.PI * 2, 0, 0]}
            />
          ))}
          <mesh geometry={geo.disc} material={mat.disc} scale={[0.7, 1, 1]} />
        </group>
      </group>
    </group>
  )
}

// --- car --------------------------------------------------------------------

export default function CarModel({ ghost = false, color = '#2f6dff', live = false }) {
  const geo = useCarGeometry()
  const mat = useMaterials(ghost, color)

  const chassis = useRef(null)
  const attitude = useRef(null)
  const fl = useRef(null)
  const fr = useRef(null)
  const spin = [useRef(null), useRef(null), useRef(null), useRef(null)]
  const roll = useRef(0)
  const pitch = useRef(0)
  const gPitch = useRef(0)
  const gRoll = useRef(0)

  useFrame((_, delta) => {
    if (!live) return
    const dt = Math.min(delta, 1 / 30)
    const s = carState

    // body roll / dive, lagged so it looks like springs rather than a rig
    const targetRoll = THREE.MathUtils.clamp(-s.lateralG * 0.055, -0.13, 0.13)
    const targetPitch = THREE.MathUtils.clamp(-s.longG * 0.02, -0.07, 0.07)
    const k = 1 - Math.exp(-9 * dt)
    roll.current = THREE.MathUtils.lerp(roll.current, targetRoll, k)
    pitch.current = THREE.MathUtils.lerp(pitch.current, targetPitch, k)
    if (chassis.current) {
      chassis.current.rotation.z = roll.current
      chassis.current.rotation.x = pitch.current
      // body drops onto the springs when it lands, then rebounds
      chassis.current.position.y = -Math.abs(roll.current) * 0.12 - s.landing * 0.13
      const squash = 1 - s.landing * 0.06
      chassis.current.scale.set(1, squash, 1)
    }

    // lay the whole car (wheels included) along the road surface
    const gk = 1 - Math.exp(-12 * dt)
    gPitch.current = THREE.MathUtils.lerp(gPitch.current, s.groundPitch, gk)
    gRoll.current = THREE.MathUtils.lerp(gRoll.current, s.groundRoll, gk)
    if (attitude.current) {
      attitude.current.rotation.x = -gPitch.current
      attitude.current.rotation.z = -gRoll.current
    }

    // front wheels follow the steering input
    const steerAngle = s.steer * 0.44
    if (fl.current) fl.current.rotation.y = steerAngle
    if (fr.current) fr.current.rotation.y = steerAngle

    for (const r of spin) if (r.current) r.current.rotation.x = -s.wheelSpin

    // discs glow under braking
    mat.disc.emissiveIntensity = THREE.MathUtils.lerp(
      mat.disc.emissiveIntensity,
      s.brake * 1.6 + (s.handbrake ? 1.1 : 0),
      1 - Math.exp(-5 * dt),
    )
    mat.tail.emissiveIntensity = 0.7 + (s.brake > 0.05 || s.handbrake ? 2.6 : 0)
  })

  return (
    <group ref={attitude}>
      <group ref={chassis}>
        {/* main body */}
        <mesh geometry={geo.bodyGeo} position={[0, -0.3, 0]} castShadow receiveShadow>
          <primitive object={mat.paint} attach="material" />
        </mesh>

        {/* bonnet panel — breaks up the paint and points the eye forward */}
        <mesh position={[0, -0.03, 1.28]} rotation={[-0.04, 0, 0]}>
          <boxGeometry args={[0.62, 0.02, 0.9]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>

        {/* greenhouse + glass */}
        <mesh geometry={geo.cabinGeo} position={[0, -0.02, -0.06]} castShadow>
          <primitive object={mat.trim} attach="material" />
        </mesh>
        <mesh position={[0, 0.11, 0.66]} rotation={[-0.78, 0, 0]}>
          <planeGeometry args={[0.68, 0.56]} />
          <primitive object={mat.glass} attach="material" />
        </mesh>
        <mesh position={[0, 0.12, -1.02]} rotation={[0.85, 0, 0]}>
          <planeGeometry args={[0.62, 0.44]} />
          <primitive object={mat.glass} attach="material" />
        </mesh>
        {/* roof intake */}
        <mesh position={[0, 0.17, -0.66]} rotation={[0.1, 0, 0]} castShadow>
          <boxGeometry args={[0.3, 0.12, 0.5]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>

        {/* front splitter */}
        <mesh position={[0, -0.35, 1.78]} castShadow>
          <boxGeometry args={[1.24, 0.05, 0.42]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        {/* side skirts */}
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * 0.76, -0.32, -0.05]} castShadow>
            <boxGeometry args={[0.12, 0.14, 1.9]} />
            <primitive object={mat.carbon} attach="material" />
          </mesh>
        ))}
        {/* rear diffuser */}
        <mesh position={[0, -0.31, -1.9]} rotation={[0.24, 0, 0]} castShadow>
          <boxGeometry args={[1.2, 0.07, 0.42]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>

        {/* rear wing */}
        <mesh position={[0, 0.34, -1.82]} rotation={[0.17, 0, 0]} castShadow>
          <boxGeometry args={[1.7, 0.05, 0.4]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * 0.78, 0.14, -1.82]} castShadow>
            <boxGeometry args={[0.06, 0.42, 0.4]} />
            <primitive object={mat.carbon} attach="material" />
          </mesh>
        ))}

        {/* head + tail lights */}
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * 0.27, -0.14, 1.84]} rotation={[0, s * 0.18, 0]}>
            <boxGeometry args={[0.3, 0.09, 0.06]} />
            <primitive object={mat.head} attach="material" />
          </mesh>
        ))}
        <mesh position={[0, -0.08, -2.06]}>
          <boxGeometry args={[0.98, 0.1, 0.06]} />
          <primitive object={mat.tail} attach="material" />
        </mesh>

        {/* exhausts */}
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * 0.34, -0.34, -2.06]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.14, 10]} />
            <primitive object={mat.rim} attach="material" />
          </mesh>
        ))}
      </group>

      {/* wheels sit outside the rolling chassis so they stay planted */}
      <Wheel
        geo={geo}
        mat={mat}
        position={[TRACK_HALF, WHEEL_Y, WHEELBASE_F]}
        steerRef={fl}
        spinRef={spin[0]}
      />
      <Wheel
        geo={geo}
        mat={mat}
        position={[-TRACK_HALF, WHEEL_Y, WHEELBASE_F]}
        steerRef={fr}
        spinRef={spin[1]}
        flip
      />
      <Wheel geo={geo} mat={mat} position={[TRACK_HALF, WHEEL_Y, WHEELBASE_R]} spinRef={spin[2]} />
      <Wheel
        geo={geo}
        mat={mat}
        position={[-TRACK_HALF, WHEEL_Y, WHEELBASE_R]}
        spinRef={spin[3]}
        flip
      />
    </group>
  )
}

export { WHEEL_R, TRACK_HALF, WHEELBASE_R }
