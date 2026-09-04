// Shared visual for the player car and the ghost. Faces local +Z.

export default function CarModel({ ghost = false, color = '#3ba7ff' }) {
  const bodyProps = ghost
    ? { color: '#7cf3c1', transparent: true, opacity: 0.32, depthWrite: false }
    : { color, metalness: 0.35, roughness: 0.4 }
  const trimProps = ghost
    ? { color: '#7cf3c1', transparent: true, opacity: 0.32, depthWrite: false }
    : { color: '#04122a', metalness: 0.2, roughness: 0.6 }

  return (
    <group>
      {/* chassis */}
      <mesh castShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[1.7, 0.5, 3.6]} />
        <meshStandardMaterial {...bodyProps} />
      </mesh>
      {/* cabin */}
      <mesh castShadow position={[0, 0.42, -0.15]}>
        <boxGeometry args={[1.2, 0.45, 1.5]} />
        <meshStandardMaterial {...trimProps} />
      </mesh>
      {/* pointed nose — bright, marks "forward" */}
      <mesh castShadow position={[0, 0.05, 2.1]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.7, 1.1, 4]} />
        <meshStandardMaterial
          color={ghost ? '#7cf3c1' : '#7cf3c1'}
          transparent={ghost}
          opacity={ghost ? 0.32 : 1}
          depthWrite={!ghost}
          emissive="#2e6b52"
          emissiveIntensity={0.4}
        />
      </mesh>
      {/* rear wing — red, marks "back" */}
      <mesh castShadow position={[0, 0.55, -1.9]}>
        <boxGeometry args={[1.8, 0.09, 0.5]} />
        <meshStandardMaterial
          color="#ff4d5a"
          transparent={ghost}
          opacity={ghost ? 0.32 : 1}
          depthWrite={!ghost}
          emissive="#5c1016"
          emissiveIntensity={0.5}
        />
      </mesh>
      <mesh position={[0.7, 0.3, -1.9]}>
        <boxGeometry args={[0.09, 0.5, 0.3]} />
        <meshStandardMaterial color="#ff4d5a" transparent={ghost} opacity={ghost ? 0.3 : 1} />
      </mesh>
      <mesh position={[-0.7, 0.3, -1.9]}>
        <boxGeometry args={[0.09, 0.5, 0.3]} />
        <meshStandardMaterial color="#ff4d5a" transparent={ghost} opacity={ghost ? 0.3 : 1} />
      </mesh>
      {/* wheels */}
      {[
        [0.92, -0.15, 1.25],
        [-0.92, -0.15, 1.25],
        [0.92, -0.15, -1.3],
        [-0.92, -0.15, -1.3],
      ].map((p, i) => (
        <mesh key={i} castShadow position={p} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.42, 0.42, 0.34, 16]} />
          <meshStandardMaterial
            color="#0a0e1a"
            transparent={ghost}
            opacity={ghost ? 0.3 : 1}
            depthWrite={!ghost}
          />
        </mesh>
      ))}
    </group>
  )
}
