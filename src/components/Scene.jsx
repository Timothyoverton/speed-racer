import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Sky, Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import Race from './Race.jsx'
import Scenery from './Scenery.jsx'
import { useRunId } from '../game/store.js'
import { BOUNDS } from '../game/trackVisuals.js'
import { carState } from '../game/carState.js'

const [cx, , cz] = BOUNDS.center
const R = BOUNDS.radius

// late-afternoon sun, low enough to throw long shadows down the straights
const SUN = [-0.55, 0.32, 0.77]
const SUN_DIST = 300
const sunPos = [cx + SUN[0] * SUN_DIST, SUN[1] * SUN_DIST, cz + SUN[2] * SUN_DIST]

// The shadow camera follows the car, so it only has to cover what's near it —
// which also makes the shadows much sharper than stretching one box over the
// whole circuit. Long Ribbon is ~1km end to end; a fixed box centred on the
// track would simply run out before the ends.
const shadowSpan = 110

function SunFollow({ lightRef }) {
  useFrame(() => {
    const l = lightRef.current
    if (!l) return
    const [px, py, pz] = carState.pos
    l.position.set(px + SUN[0] * SUN_DIST, py + SUN[1] * SUN_DIST, pz + SUN[2] * SUN_DIST)
    l.target.position.set(px, py, pz)
    l.target.updateMatrixWorld()
  })
  return null
}

export default function Scene() {
  const runId = useRunId()
  const sun = useRef(null)

  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      camera={{ fov: 62, near: 0.3, far: 2600, position: [0, 8, -14] }}
      onCreated={(s) => {
        if (import.meta.env.DEV) window.__three = s
      }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.04,
      }}
    >
      <color attach="background" args={['#8fb2d8']} />
      {/* haze starts further out and is tinted to match the sky at the horizon,
          so distance reads as depth rather than as everything fading to white */}
      <fog attach="fog" args={['#a8c2dd', 420, 1750]} />

      <Sky
        distance={4000}
        sunPosition={sunPos}
        turbidity={3.2}
        rayleigh={2.6}
        mieCoefficient={0.006}
        mieDirectionalG={0.85}
      />

      {/* Image-based lighting, built in-engine — gives the car paint, glass and
          chrome something to reflect without shipping an HDR file. */}
      <Environment resolution={128} frames={1} background={false}>
        <mesh scale={120}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshBasicMaterial color="#9dbde2" side={THREE.BackSide} />
        </mesh>
        {/* ground bounce */}
        <Lightformer
          form="rect"
          intensity={0.5}
          color="#4d6a45"
          scale={[80, 80, 1]}
          position={[0, -12, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
        {/* the sun */}
        <Lightformer
          form="circle"
          intensity={9}
          color="#fff0d0"
          scale={[10, 10, 1]}
          position={[SUN[0] * 30, SUN[1] * 30 + 6, SUN[2] * 30]}
          target={[0, 0, 0]}
        />
        {/* long soft strips overhead — these are what the bodywork catches as
            it turns, and what stops metal reading as flat grey */}
        {[-1, 1].map((s) => (
          <Lightformer
            key={s}
            form="rect"
            intensity={2.6}
            color="#ffffff"
            scale={[3, 40, 1]}
            position={[s * 14, 22, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          />
        ))}
        {/* soft sky fill from overhead */}
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#cfe2ff"
          scale={[60, 60, 1]}
          position={[0, 30, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        />
      </Environment>

      <hemisphereLight args={['#cfe0ff', '#37402f', 0.55]} />
      <directionalLight
        ref={sun}
        castShadow
        position={sunPos}
        target-position={[cx, 0, cz]}
        intensity={2.6}
        color="#fff2dc"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowSpan}
        shadow-camera-right={shadowSpan}
        shadow-camera-top={shadowSpan}
        shadow-camera-bottom={-shadowSpan}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DIST * 2}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      />

      <SunFollow lightRef={sun} />
      <Scenery />

      <Physics timeStep={1 / 60} gravity={[0, -22, 0]} interpolate>
        <Race key={runId} />
      </Physics>

      {/* Bloom on the emissive gate lights, brake lights and sun highlights;
          a gentle vignette to sit the picture down at the edges. */}
    </Canvas>
  )
}
