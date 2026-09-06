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
const TRACK_HALF = 0.95 // the tub is 0.16-0.21 wide at the axles, so these stand clear
const WHEELBASE_F = 1.48
const WHEELBASE_R = -1.42
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
    // An F1 plan, not a sports-car plan. The old shape was a closed shell whose
    // widest point (0.86) sat 9cm inside the wheels — so the wheels were half
    // swallowed and the car read as a covered prototype. A real F1 car is
    // OPEN WHEEL: a slim tub with a nose boom, sidepods that bulge only
    // BETWEEN the axles, and a coke-bottle taper to a narrow gearbox, with the
    // wheels standing right out in the air on exposed wishbones.
    //
    // Reference proportions (Wikipedia, Formula One car): 5.6m x 2.0m x 0.95m
    // overall — so length:width ~2.8, and the body is far narrower than the
    // track. Scaled here to a 4.6m body on a 1.9m track.
    const body = mirroredShape([
      [0.0, 2.4],
      [0.13, 2.02, 0.05, 2.3], // nose boom, barely wider than a leg
      [0.16, 1.48, 0.15, 1.75], // front axle line — nothing here but tub
      [0.21, 0.98, 0.18, 1.24],
      [0.32, 0.66, 0.26, 0.8], // cockpit sides
      [0.38, 0.18, 0.36, 0.42],
      [0.7, -0.14, 0.66, -0.02], // sidepod, and this is the widest it ever gets
      [0.68, -0.8, 0.72, -0.5],
      [0.38, -1.3, 0.58, -1.12], // coke bottle in to the rear axle
      [0.25, -1.8, 0.27, -1.55],
      [0.21, -2.14, 0.23, -2.0], // gearbox
      [0.0, -2.2],
    ])

    // greenhouse: a long, low canopy rather than a bubble
    const cabin = mirroredShape([
      [0.0, 0.86],
      [0.19, 0.56, 0.1, 0.8],
      [0.27, 0.06, 0.27, 0.32],
      [0.28, -0.5, 0.29, -0.24],
      [0.2, -0.86, 0.27, -0.78],
      [0.0, -0.94],
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

    // a disc that fades in over the spokes once they'd be a blur anyway
    const blurDisc = new THREE.CylinderGeometry(0.3, 0.3, 0.02, 20)
    blurDisc.rotateZ(Math.PI / 2)

    const rim = new THREE.CylinderGeometry(0.27, 0.27, 0.3, 20)
    rim.rotateZ(Math.PI / 2)
    const disc = new THREE.CylinderGeometry(0.25, 0.25, 0.045, 20)
    disc.rotateZ(Math.PI / 2)
    const spoke = new THREE.BoxGeometry(0.055, 0.045, 0.26)
    // polished lip around the outer face — catches the sun as the wheel turns
    const lip = new THREE.CylinderGeometry(0.305, 0.305, 0.05, 24)
    lip.rotateZ(Math.PI / 2)

    return {
      bodyGeo: planExtrude(body, 0.34, 0.07),
      cabinGeo: planExtrude(cabin, 0.2, 0.05),
      tyre,
      rim,
      disc,
      spoke,
      lip,
      blurDisc,
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
        blur: g('#8ffbd8', 0),
        livery: g('#8ffbd8', 0.16),
        caliper: g('#8ffbd8', 0.16),
        helmet: g('#8ffbd8', 0.16),
        exhaust: g('#8ffbd8', 0.16),
        visor: g('#8ffbd8', 0.16),
        ghost: true,
      }
    }
    return {
      paint: new THREE.MeshPhysicalMaterial({
        color,
        // Metallic paint takes the environment's colour more than its own —
        // the blue car came out looking white against a bright sky.
        //
        // Re-tuned after the sky rework. THE CAR AND THE SKY ARE COUPLED: a
        // brighter sky and a visible sun push more energy into the env map, and
        // a dark glossy panel is a mirror, so the roof and the deck went back to
        // reading as blank white paper. If you touch the sky, look at the car
        // afterwards from a rear three-quarter — the flanks stay blue and hide
        // it, the horizontal surfaces are where it shows.
        metalness: 0.5,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 0.85,
      }),
      // The canopy is the worst offender: nearly black, nearly horizontal, and
      // pointed straight at the sky, so any gloss at all turns it into a mirror
      // of a big uniform bright dome and it renders as a blank white panel.
      // ROUGHNESS is the lever that matters here, not envMapIntensity — 0.62
      // still washed out completely with env at 0.22; 0.9 holds. Verified by
      // raycasting the pixel to confirm which mesh it actually was, after three
      // wrong guesses (paint, ghost car, livery decals).
      trim: new THREE.MeshPhysicalMaterial({
        color: '#1a2130',
        metalness: 0,
        roughness: 0.9,
        clearcoat: 0.25,
        clearcoatRoughness: 0.5,
        envMapIntensity: 0.15,
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
      // Livery. A single flat colour reads as a bath toy from the chase camera,
      // and the body is an ExtrudeGeometry whose UVs aren't worth fighting, so
      // the stripes are thin geometry laid over the shell instead of a texture.
      livery: new THREE.MeshPhysicalMaterial({
        color: '#f2f5fa',
        metalness: 0.3,
        roughness: 0.3,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.3,
      }),
      // A driver in the cockpit. Nothing sells scale on a jump like a helmet.
      helmet: new THREE.MeshPhysicalMaterial({
        color: '#e8412f',
        metalness: 0.1,
        roughness: 0.35,
        clearcoat: 0.7,
        clearcoatRoughness: 0.2,
        envMapIntensity: 0.5,
      }),
      visor: new THREE.MeshPhysicalMaterial({
        color: '#0b1220',
        metalness: 0.6,
        roughness: 0.15,
        envMapIntensity: 0.5,
      }),
      exhaust: new THREE.MeshStandardMaterial({
        color: '#14161b',
        emissive: '#ff4a12',
        emissiveIntensity: 0,
        metalness: 0.7,
        roughness: 0.55,
      }),
      caliper: new THREE.MeshStandardMaterial({
        color: '#c8342c',
        metalness: 0.5,
        roughness: 0.45,
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
      blur: new THREE.MeshStandardMaterial({
        color: '#8f97a5',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        roughness: 0.5,
        metalness: 0.6,
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
        {/* The caliper is bolted to the upright, so it must sit OUTSIDE the
            spinning group — inside it, the brakes rotate with the wheel. */}
        <mesh position={[0, 0.19, -0.1]} castShadow>
          <boxGeometry args={[0.11, 0.15, 0.17]} />
          <primitive object={mat.caliper} attach="material" />
        </mesh>
        <group ref={spinRef} rotation={[0, flip ? Math.PI : 0, 0]}>
          <mesh geometry={geo.tyre} material={mat.tyre} castShadow />
          <mesh geometry={geo.rim} material={mat.rim} castShadow />
          <mesh geometry={geo.lip} material={mat.rim} position={[0.15, 0, 0]} />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <mesh
              key={i}
              geometry={geo.spoke}
              material={mat.rim}
              rotation={[(i / 10) * Math.PI * 2, 0, 0]}
            />
          ))}
          <mesh geometry={geo.disc} material={mat.disc} scale={[0.7, 1, 1]} />
          <mesh geometry={geo.blurDisc} material={mat.blur} />
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

    // pipes glow while the NOS is lit
    mat.exhaust.emissiveIntensity = THREE.MathUtils.lerp(
      mat.exhaust.emissiveIntensity,
      s.boost > 0 ? 2.4 : 0,
      1 - Math.exp(-8 * dt),
    )

    // spokes become a smear once the wheel is turning fast enough
    mat.blur.opacity = THREE.MathUtils.clamp((s.speed - 12) / 26, 0, 0.55)
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

        {/* Livery: twin stripes over the spine and a nose flash. Sits a hair
            proud of the shell and follows its curve in steps, which is enough
            to read as paint at any distance you actually see the car from. */}
        {[1, -1].map((sd) => (
          <group key={sd}>
            <mesh position={[sd * 0.2, 0.005, 1.62]} rotation={[-0.22, 0, 0]}>
              <boxGeometry args={[0.2, 0.015, 0.5]} />
              <primitive object={mat.livery} attach="material" />
            </mesh>
            <mesh position={[sd * 0.2, 0.075, 1.2]} rotation={[-0.05, 0, 0]}>
              <boxGeometry args={[0.2, 0.015, 0.42]} />
              <primitive object={mat.livery} attach="material" />
            </mesh>
            <mesh position={[sd * 0.2, 0.04, -1.34]} rotation={[0.12, 0, 0]}>
              <boxGeometry args={[0.2, 0.015, 0.62]} />
              <primitive object={mat.livery} attach="material" />
            </mesh>
            {/* haunch flash, angled back along the body line */}
            <mesh position={[sd * 0.7, -0.16, -0.72]} rotation={[0, 0, sd * 0.22]}>
              <boxGeometry args={[0.015, 0.1, 1.0]} />
              <primitive object={mat.livery} attach="material" />
            </mesh>
          </group>
        ))}
        {/* nose flash */}
        <mesh position={[0, -0.16, 1.94]} rotation={[0.1, 0, 0]}>
          <boxGeometry args={[0.5, 0.09, 0.16]} />
          <primitive object={mat.livery} attach="material" />
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

        {/* Exposed suspension. Open-wheel cars connect the wheels to the tub
            with visible wishbones, and without them the wheels just float
            beside the body — which is what the first pass looked like. */}
        {[[WHEELBASE_F, 0.34], [WHEELBASE_R, 0.5]].map(([z, tubX]) => (
          <group key={z}>
            {[1, -1].map((sd) => (
              <group key={sd}>
                <mesh position={[sd * (TRACK_HALF + tubX) / 2, -0.2, z + 0.16]} rotation={[0, sd * 0.28, 0]} castShadow>
                  <boxGeometry args={[TRACK_HALF - tubX + 0.3, 0.055, 0.09]} />
                  <primitive object={mat.carbon} attach="material" />
                </mesh>
                <mesh position={[sd * (TRACK_HALF + tubX) / 2, -0.38, z - 0.1]} rotation={[0, -sd * 0.22, 0]} castShadow>
                  <boxGeometry args={[TRACK_HALF - tubX + 0.3, 0.055, 0.09]} />
                  <primitive object={mat.carbon} attach="material" />
                </mesh>
              </group>
            ))}
          </group>
        ))}

        {/* Airbox over the driver's head, feeding the engine — the tall fin
            behind the helmet that makes an F1 car unmistakable from behind. */}
        <mesh position={[0, 0.3, -0.62]} rotation={[0.14, 0, 0]} castShadow>
          <boxGeometry args={[0.26, 0.34, 0.86]} />
          <primitive object={mat.trim} attach="material" />
        </mesh>
        <mesh position={[0, 0.36, -0.26]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.19, 0.17, 0.14]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        {/* engine cover fin running back to the wing */}
        <mesh position={[0, 0.14, -1.42]} castShadow>
          <boxGeometry args={[0.05, 0.3, 1.5]} />
          <primitive object={mat.livery} attach="material" />
        </mesh>

        {/* Halo. Mandatory on a modern F1 car and very visible from behind. */}
        <mesh position={[0, 0.3, 0.24]} rotation={[0.2, 0, 0]}>
          <torusGeometry args={[0.33, 0.028, 8, 20, Math.PI]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        <mesh position={[0, 0.22, 0.58]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.05, 0.24, 0.05]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>

        {/* Driver. A helmet in the cockpit is the cheapest thing on this car
            and does the most: it gives every other part a human scale, which
            is what makes a 40m jump read as 40m. */}
        <mesh position={[0, 0.12, -0.16]} castShadow>
          <sphereGeometry args={[0.17, 16, 14]} />
          <primitive object={mat.helmet} attach="material" />
        </mesh>
        <mesh position={[0, 0.11, 0.0]} rotation={[-0.15, 0, 0]}>
          <boxGeometry args={[0.235, 0.09, 0.05]} />
          <primitive object={mat.visor} attach="material" />
        </mesh>
        {/* roll hoop behind the head */}
        <mesh position={[0, 0.16, -0.42]} rotation={[0.12, 0, 0]} castShadow>
          <boxGeometry args={[0.3, 0.26, 0.1]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>

        {/* wing mirrors, out on stalks */}
        {[1, -1].map((sd) => (
          <group key={sd}>
            <mesh position={[sd * 0.4, 0.04, 0.34]} rotation={[0, 0, sd * 0.3]}>
              <boxGeometry args={[0.3, 0.02, 0.03]} />
              <primitive object={mat.carbon} attach="material" />
            </mesh>
            <mesh position={[sd * 0.55, 0.07, 0.34]}>
              <boxGeometry args={[0.05, 0.1, 0.12]} />
              <primitive object={mat.livery} attach="material" />
            </mesh>
          </group>
        ))}

        {/* sidepod intakes — dark mouths that break up the flanks */}
        {[1, -1].map((sd) => (
          <mesh key={sd} position={[sd * 0.62, -0.16, 0.12]} rotation={[0, sd * 0.06, 0]} castShadow>
            <boxGeometry args={[0.16, 0.22, 0.62]} />
            <primitive object={mat.carbon} attach="material" />
          </mesh>
        ))}

        {/* Front wing. Two planes and endplates out past the nose — it's the
            first thing over a crest and the last thing you see landing. */}
        <mesh position={[0, -0.34, 2.02]} rotation={[-0.08, 0, 0]} castShadow>
          <boxGeometry args={[1.5, 0.035, 0.3]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        <mesh position={[0, -0.27, 2.1]} rotation={[-0.22, 0, 0]} castShadow>
          <boxGeometry args={[1.42, 0.03, 0.16]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        {[1, -1].map((sd) => (
          <group key={sd}>
            <mesh position={[sd * 0.75, -0.3, 2.04]} castShadow>
              <boxGeometry args={[0.03, 0.24, 0.42]} />
              <primitive object={mat.carbon} attach="material" />
            </mesh>
            <mesh position={[sd * 0.757, -0.19, 2.04]}>
              <boxGeometry args={[0.034, 0.05, 0.42]} />
              <primitive object={mat.livery} attach="material" />
            </mesh>
          </group>
        ))}

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
        {/* rear diffuser, with strakes — you stare straight at these */}
        <mesh position={[0, -0.31, -1.9]} rotation={[0.24, 0, 0]} castShadow>
          <boxGeometry args={[1.2, 0.07, 0.42]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        {[-0.42, -0.14, 0.14, 0.42].map((x) => (
          <mesh key={x} position={[x, -0.25, -1.92]} rotation={[0.24, 0, 0]} castShadow>
            <boxGeometry args={[0.03, 0.16, 0.4]} />
            <primitive object={mat.carbon} attach="material" />
          </mesh>
        ))}

        {/* Rear wing — the signature from a chase camera, so it earns the
            extra boxes: a two-element stack, endplates that stand proud of
            both, and swan-neck mounts off the deck. */}
        <mesh position={[0, 0.38, -1.8]} rotation={[0.19, 0, 0]} castShadow>
          <boxGeometry args={[1.72, 0.045, 0.36]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        <mesh position={[0, 0.25, -1.9]} rotation={[0.34, 0, 0]} castShadow>
          <boxGeometry args={[1.66, 0.035, 0.19]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
        {[1, -1].map((sd) => (
          <group key={sd}>
            {/* carbon plate with a livery edge — all-white endplates this size
                read as paddles bolted to the back of the car */}
            <mesh position={[sd * 0.86, 0.3, -1.84]} castShadow>
              <boxGeometry args={[0.03, 0.36, 0.46]} />
              <primitive object={mat.carbon} attach="material" />
            </mesh>
            <mesh position={[sd * 0.868, 0.44, -1.84]}>
              <boxGeometry args={[0.034, 0.07, 0.46]} />
              <primitive object={mat.livery} attach="material" />
            </mesh>
            {/* swan-neck: mount over the wing, not under it */}
            <mesh position={[sd * 0.34, 0.2, -1.7]} rotation={[0.2, 0, 0]} castShadow>
              <boxGeometry args={[0.05, 0.34, 0.05]} />
              <primitive object={mat.carbon} attach="material" />
            </mesh>
          </group>
        ))}

        {/* head + tail lights */}
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * 0.27, -0.14, 1.84]} rotation={[0, s * 0.18, 0]}>
            <boxGeometry args={[0.3, 0.09, 0.06]} />
            <primitive object={mat.head} attach="material" />
          </mesh>
        ))}
        {/* One continuous light bar across the whole tail, Tesla style, with
            the ends turned down the corners so it wraps rather than stopping
            dead. Replaces a 0.98m stub that read as two dots at distance. */}
        <mesh position={[0, -0.06, -2.04]}>
          <boxGeometry args={[1.66, 0.075, 0.05]} />
          <primitive object={mat.tail} attach="material" />
        </mesh>
        {[1, -1].map((sd) => (
          <mesh key={sd} position={[sd * 0.845, -0.06, -1.95]} rotation={[0, sd * 0.9, 0]}>
            <boxGeometry args={[0.22, 0.075, 0.05]} />
            <primitive object={mat.tail} attach="material" />
          </mesh>
        ))}
        {/* a dark inset so the bar has something to sit in */}
        <mesh position={[0, -0.06, -2.0]}>
          <boxGeometry args={[1.72, 0.16, 0.05]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>

        {/* Exhausts. Four proper pipes standing off the diffuser with dark
            burnt tips, not the two 7cm stubs that were here — from a chase
            camera they're dead centre of frame and they were invisible. */}
        {[-0.46, -0.17, 0.17, 0.46].map((x) => (
          <group key={x}>
            <mesh position={[x, -0.26, -2.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.105, 0.115, 0.42, 12]} />
              <primitive object={mat.rim} attach="material" />
            </mesh>
            {/* sooted tip, so the ends read as holes rather than chrome dots */}
            <mesh position={[x, -0.26, -2.21]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.082, 0.082, 0.06, 12]} />
              <primitive object={mat.exhaust} attach="material" />
            </mesh>
          </group>
        ))}
        {/* heat shield they sit against */}
        <mesh position={[0, -0.26, -1.92]} castShadow>
          <boxGeometry args={[1.22, 0.26, 0.12]} />
          <primitive object={mat.carbon} attach="material" />
        </mesh>
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
