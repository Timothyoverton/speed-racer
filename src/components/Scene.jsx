import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Environment, Lightformer, PerformanceMonitor, AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import Race from './Race.jsx'
import Scenery from './Scenery.jsx'
import SkyDome from './SkyDome.jsx'
import { useRunId } from '../game/store.js'
import { BOUNDS } from '../game/trackVisuals.js'
import { carState } from '../game/carState.js'
import { THEME } from '../game/themes.js'

const [cx, , cz] = BOUNDS.center

// Direction comes from the track's theme. Test Pad keeps the original
// late-afternoon angle, low enough to throw long shadows down the straights.
const SUN = THEME.sun.dir
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
  // pixel-ratio ceiling, dropped automatically when the frame rate sags (two
  // game instances on one GPU, a weak phone, a heavy launch). 1.5 is the normal
  // cap — a retina panel at full dpr renders ~1.8x the pixels for no visible
  // gain on this low-poly art.
  const [dprMax, setDprMax] = useState(1.5)

  return (
    <Canvas
      shadows
      dpr={[1, dprMax]}
      camera={{ fov: 62, near: 0.3, far: 2600, position: [0, 8, -14] }}
      onCreated={(s) => {
        if (import.meta.env.DEV) window.__three = s
      }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: THEME.exposure,
      }}
    >
      <PerformanceMonitor
        onDecline={() => setDprMax(1)}
        onIncline={() => setDprMax(1.5)}
        flipflops={3}
        onFallback={() => setDprMax(0.75)}
      />
      <AdaptiveDpr pixelated />
      <color attach="background" args={[THEME.sky.horizon]} />
      {/* Haze tinted to this track's horizon, so distance reads as depth.
          The colour is the sky horizon (themes.js keeps them as one string):
          a distant hill fades into the sky behind it instead of into a
          slightly different blue. */}
      <fog attach="fog" args={[THEME.fog.color, THEME.fog.near, THEME.fog.far]} />

      <SkyDome />

      <Environment resolution={128} frames={1} background={false}>
        <mesh scale={120}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshBasicMaterial color={THEME.env.sky} side={THREE.BackSide} />
        </mesh>
        {/* ground bounce */}
        <Lightformer
          form="rect"
          intensity={THEME.env.groundIntensity}
          color={THEME.env.ground}
          scale={[80, 80, 1]}
          position={[0, -12, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
        {/* the sun */}
        <Lightformer
          form="circle"
          intensity={THEME.env.sunIntensity}
          color={THEME.env.sun}
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
            intensity={THEME.env.stripIntensity}
            color={THEME.env.strip}
            scale={[3, 40, 1]}
            position={[s * 14, 22, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          />
        ))}
        {/* soft sky fill from overhead */}
        <Lightformer
          form="rect"
          intensity={THEME.env.fillIntensity}
          color={THEME.env.fill}
          scale={[60, 60, 1]}
          position={[0, 30, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        />
      </Environment>

      <hemisphereLight args={[THEME.hemi.sky, THEME.hemi.ground, THEME.hemi.intensity]} />
      <directionalLight
        ref={sun}
        castShadow
        position={sunPos}
        target-position={[cx, 0, cz]}
        intensity={THEME.sun.intensity}
        color={THEME.sun.color}
        shadow-mapSize={[1024, 1024]}
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
