import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Sky } from '@react-three/drei'
import Race from './Race.jsx'
import { useRunId } from '../game/store.js'
import { TRACK } from '../game/track.js'

// rough centre of the course, for aiming the shadow camera / ground
const cx = TRACK.finish.pos[0] / 2
const cz = TRACK.finish.pos[2] / 2

export default function Scene() {
  const runId = useRunId()

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ fov: 62, near: 0.3, far: 900, position: [0, 8, -14] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#0b1024']} />
      <fog attach="fog" args={['#0b1024', 120, 460]} />

      <Sky sunPosition={[80, 40, -60]} turbidity={6} rayleigh={1.2} mieCoefficient={0.006} />
      <hemisphereLight args={['#bcd2ff', '#1a2038', 0.8]} />
      <directionalLight
        castShadow
        position={[60, 80, -30]}
        intensity={2.1}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-160}
        shadow-camera-right={160}
        shadow-camera-top={160}
        shadow-camera-bottom={-160}
        shadow-camera-near={1}
        shadow-camera-far={320}
        shadow-bias={-0.0004}
      />

      {/* grass / stadium floor (visual only) */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, -0.65, cz]}
        receiveShadow
      >
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color="#16351f" roughness={1} />
      </mesh>
      <gridHelper
        args={[600, 120, '#24506a', '#183042']}
        position={[cx, -0.62, cz]}
      />

      <Physics timeStep={1 / 60} gravity={[0, -22, 0]} interpolate>
        <Race key={runId} />
      </Physics>
    </Canvas>
  )
}
