import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

const col = new THREE.Color()

const o = new THREE.Object3D()

function useInstanceMatrices(ref, items, colors) {
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      o.position.set(it.p[0], it.p[1], it.p[2])
      o.rotation.set(it.r[0], it.r[1], it.r[2], 'YXZ')
      o.scale.set(it.s[0], it.s[1], it.s[2])
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    // per-instance tint, so one mesh can carry a whole palette
    if (colors && colors.length === items.length) {
      for (let i = 0; i < colors.length; i++) mesh.setColorAt(i, col.set(colors[i]))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    mesh.computeBoundingSphere()
  }, [ref, items, colors])
}

// One InstancedMesh from a list of { p, r, s } box transforms.
export default function Boxes({ items, material, colors, castShadow = false, receiveShadow = false }) {
  const ref = useRef(null)
  useInstanceMatrices(ref, items, colors)

  if (!items.length) return null

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled={false}
    >
      <boxGeometry />
      <primitive object={material} attach="material" />
    </instancedMesh>
  )
}

// Same, for an arbitrary shared geometry (trees, floodlights, crowd blocks).
export function Shapes({ items, geometry, material, castShadow = false, receiveShadow = false }) {
  const ref = useRef(null)
  useInstanceMatrices(ref, items)

  if (!items.length) return null

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled={false}
    >
      <primitive object={geometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </instancedMesh>
  )
}
