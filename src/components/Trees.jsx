// Modelled trees for themes whose forest asks for them (`forest.model`).
//
// Each species is grown once by ez-tree (bark and needle textures included) and
// then drawn as instances. Two grades of each: a full one for trees close enough
// to the road to be looked at, and a much lighter one for the rest of the forest,
// which is most of it. Which grade a tree gets is fixed by its distance from the
// circuit, so there is no popping while driving.
import { useMemo } from 'react'
import * as THREE from 'three'
import { Tree, TreePreset } from '@dgreenheck/ez-tree'
import { Shapes } from './Boxes.jsx'

const up = new THREE.Vector3()

function grow(preset, seed, lite) {
  const t = new Tree()
  if (!TreePreset[preset]) throw new Error(`unknown tree preset: ${preset}`)
  t.options.copy(structuredClone(TreePreset[preset]))
  const o = t.options
  o.seed = seed
  // The presets are built to be looked at one at a time. A forest of them needs
  // far fewer triangles each: thin the twigs out and make the leaf cards bigger
  // to cover the same crown.
  const cut = lite
    ? { sections: 0.3, segments: 0.4, children: 0.38, leaves: 0.3, size: 1.9 }
    : { sections: 0.6, segments: 0.75, children: 0.7, leaves: 0.65, size: 1.25 }
  for (const k in o.branch.sections) o.branch.sections[k] = Math.max(2, Math.round(o.branch.sections[k] * cut.sections))
  for (const k in o.branch.segments) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * cut.segments))
  for (const k in o.branch.children) o.branch.children[k] = Math.max(2, Math.round(o.branch.children[k] * cut.children))
  o.leaves.count = Math.max(3, Math.round(o.leaves.count * cut.leaves))
  o.leaves.size *= cut.size
  if (lite) o.leaves.billboard = 'single'
  t.generate()
  const bg = t.branchesMesh.geometry
  const lg = t.leavesMesh.geometry
  bg.computeBoundingBox()
  lg.computeBoundingBox()
  const height = Math.max(bg.boundingBox.max.y, lg.boundingBox.max.y)
  const bm = t.branchesMesh.material
  const lm = t.leavesMesh.material
  // the library's own materials are Phong and not instancing-aware; keep its
  // textures, light them the way the rest of the scene is lit
  const bark = new THREE.MeshStandardMaterial({ map: bm.map, normalMap: lite ? null : bm.normalMap, roughness: 0.95, metalness: 0 })
  const leaves = new THREE.MeshStandardMaterial({
    map: lm.map,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
    envMapIntensity: 0.7,
  })
  // needles are flat cards: light them as if they faced mostly up and out, or
  // half of every tree goes black
  lg.computeVertexNormals()
  const n = lg.attributes.normal
  const p = lg.attributes.position
  for (let i = 0; i < n.count; i++) {
    up.set(p.getX(i), (p.getY(i) - height * 0.45) * 0.6 + height * 0.25, p.getZ(i)).normalize()
    n.setXYZ(i, up.x, up.y, up.z)
  }
  return { bg, lg, bark, leaves, height, tris: ((bg.index?.count || 0) + (lg.index?.count || 0)) / 3 }
}

export default function Trees({ spots, species }) {
  const groups = useMemo(() => {
    const out = []
    species.forEach((sp, si) => {
      for (const lite of [false, true]) {
        const mine = spots.filter((s) => s.species === si && s.lite === lite)
        if (!mine.length) continue
        const t0 = performance.now()
        const g = grow(sp.preset, sp.seed, lite)
        const took = Math.round(performance.now() - t0)
        const items = mine.map((s) => {
          const k = s.h / g.height
          return { p: [s.x, s.y, s.z], r: [0, s.yaw, 0], s: [k * s.girth, k, k * s.girth] }
        })
        const tints = mine.map((s) => s.tint)
        out.push({ key: `${si}${lite ? 'l' : 'f'}`, g, items, tints, lite })
        if (import.meta.env.DEV) console.info(`[trees] ${sp.preset}${lite ? ' lite' : ''}: ${mine.length} x ${Math.round(g.tris)} tris, grown in ${took}ms`)
      }
    })
    return out
  }, [spots, species])

  return (
    <group>
      {groups.map(({ key, g, items, tints, lite }) => (
        <group key={key}>
          <Shapes items={items} geometry={g.bg} material={g.bark} castShadow={!lite} receiveShadow />
          <Shapes items={items} geometry={g.lg} material={g.leaves} colors={tints} castShadow={!lite} receiveShadow />
        </group>
      ))}
    </group>
  )
}
