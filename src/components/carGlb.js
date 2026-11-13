import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// The modelled cars (credits and licences in public/assets/CREDITS.md). Each is
// fitted to the game's wheel radius and axle line, with the wheels hung on
// steer > spin pivots.
//
//   paint      - material names that take the player's colour (second is trim)
//   brake      - material names lit by the brake pedal
//   hide       - material names not drawn (plates, badges)
//   wheelNodes - one node per wheel, already separate
//   wheelParts - node or material names whose geometry is all four wheels in
//                one piece; it is cut into four by which corner each triangle is in
//   flip       - the model's nose points along -Z after loading

const BASE = import.meta.env.BASE_URL
const DRACO = BASE + 'draco/'

const CARS = {
  concept: {
    url: 'assets/car/CarConcept.glb',
    paint: ['Paint 1', 'Paint 2'],
    brake: ['Brakelight'],
    hide: ['License'],
    wheelNodes: ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'],
    pads: /BrakePad/,
  },
  coupe: {
    url: 'assets/car/porsche911.glb',
    paint: ['paint'],
    brake: [],
    hide: ['license', 'logo'],
    wheelParts: { nodes: ['Cylinder000', 'Cylinder001', 'Cylinder.000', 'Cylinder.001'] },
    glass: ['window', 'glass'],
  },
  classic: {
    url: 'assets/car/datsun240k.glb',
    paint: ['paint'],
    brake: ['red_glass'],
    hide: ['license', 'stickers'],
    wheelParts: { materials: ['tire', 'alloy'] },
    glass: ['glass'],
  },
}

const starts = (name, list) => (list || []).findIndex((p) => name.startsWith(p))

// Cut a world-space geometry into four by corner: [front-left, front-right,
// rear-left, rear-right] in the model's own frame (x across, z along).
function quarter(geo, cx, cz) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const p = g.attributes.position
  const buckets = [[], [], [], []]
  for (let t = 0; t < p.count; t += 3) {
    const x = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3
    const z = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3
    buckets[(z > cz ? 0 : 2) + (x > cx ? 0 : 1)].push(t)
  }
  return buckets.map((tris) => {
    const out = new THREE.BufferGeometry()
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name]
      const arr = new a.array.constructor(tris.length * 3 * a.itemSize)
      tris.forEach((t, i) => {
        for (let k = 0; k < 3 * a.itemSize; k++) arr[i * 3 * a.itemSize + k] = a.array[t * a.itemSize + k]
      })
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized))
    }
    return out
  })
}

export function useCarGlb(id, ghost, color, wheelR, wheelY) {
  const spec = CARS[id] || CARS.concept
  const { scene } = useGLTF(BASE + spec.url, DRACO)
  return useMemo(() => {
    const root = scene.clone(true)
    root.updateMatrixWorld(true)

    const ghostMat = ghost
      ? new THREE.MeshStandardMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.4, metalness: 0.2 })
      : null
    const paint = new THREE.Color(color)
    const cache = new Map()
    const brake = []
    const fix = (m) => {
      if (cache.has(m.uuid)) return cache.get(m.uuid)
      const c = m.clone()
      const n = m.name || ''
      const pi = starts(n, spec.paint)
      if (pi === 0) {
        // metallic paint under a clear coat, so the sky rolls over the panels
        c.color.copy(paint)
        c.map = null
        c.metalness = 0.75
        c.roughness = 0.34
        c.clearcoat = 1
        c.clearcoatRoughness = 0.04
        c.envMapIntensity = 1.25
      } else if (pi > 0) {
        c.color.copy(paint).multiplyScalar(0.35)
        c.map = null
      }
      // real transmission costs a second render of the whole scene per frame;
      // plain tinted alpha reads the same at driving distance
      const glassy = c.transmission > 0 || starts(n, spec.glass) >= 0
      if (glassy) {
        const dark = n === 'Glass' || n === 'window' || n === 'glass'
        c.transmission = 0
        c.thickness = 0
        c.transparent = true
        c.opacity = dark ? 0.6 : 0.75
        c.depthWrite = false
        if (dark) c.color.set('#0c1116')
        c.roughness = 0.05
        c.metalness = 0
      }
      if (starts(n, spec.brake) >= 0) {
        c.emissive.set('#ff1408')
        c.emissiveMap = null
        c.emissiveIntensity = 0.7
        brake.push(c)
      }
      cache.set(m.uuid, c)
      return c
    }
    const dress = (o) => {
      if (ghost) {
        o.material = ghostMat
        return
      }
      o.material = fix(o.material)
      o.castShadow = !o.name.startsWith('Interior') && !o.material.transparent
      o.receiveShadow = true
    }

    // meshes that are all four wheels in one piece
    const lumps = []
    const P = spec.wheelParts
    root.traverse((o) => {
      if (!o.isMesh) return
      // plates and badges carry marks the licences don't cover
      if (starts(o.material?.name || '', spec.hide) >= 0 || o.name === 'License Plate') {
        o.visible = false
        return
      }
      if (P && ((P.nodes && P.nodes.includes(o.parent?.name)) || (P.materials && P.materials.includes(o.material?.name)))) {
        lumps.push(o)
        return
      }
      dress(o)
    })

    const body = new THREE.Group()
    const wheels = new THREE.Group()
    body.add(root)
    const box = new THREE.Box3()
    const steer = []
    const spin = []
    const centres = []
    let r = 0.384
    const hang = (c) => {
      const st = new THREE.Group()
      const sp = new THREE.Group()
      st.position.copy(c)
      st.add(sp)
      wheels.add(st)
      st.updateMatrixWorld(true)
      steer.push(st)
      spin.push(sp)
      centres.push(c)
      return [st, sp]
    }

    // which way the car lies: its long axis becomes z
    const all = new THREE.Box3().setFromObject(root)
    const size = all.getSize(new THREE.Vector3())
    const quarterTurn = size.x > size.z

    if (spec.wheelNodes) {
      for (const name of spec.wheelNodes) {
        const w = root.getObjectByName(name)
        box.setFromObject(w)
        const c = box.getCenter(new THREE.Vector3())
        r = (box.max.y - box.min.y) / 2
        const [st, sp] = hang(c)
        const pads = spec.pads ? w.children.filter((k) => spec.pads.test(k.name)) : []
        sp.attach(w)
        for (const p of pads) st.attach(p)
      }
    } else {
      const turn = new THREE.Matrix4().makeRotationY(quarterTurn ? Math.PI / 2 : 0)
      const mid = all.getCenter(new THREE.Vector3()).applyMatrix4(turn)
      // per corner: the pieces of every lump, in the turned frame
      const corner = [[], [], [], []]
      for (const o of lumps) {
        o.visible = false
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(turn)
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
        quarter(g, mid.x, mid.z).forEach((q, i) => corner[i].push({ q, o }))
      }
      const back = turn.clone().invert()
      corner.forEach((parts) => {
        box.makeEmpty()
        for (const { q } of parts) {
          q.computeBoundingBox()
          box.union(q.boundingBox)
        }
        const c = box.getCenter(new THREE.Vector3())
        // the tyre sets the radius; arches or discs in the lump can't exceed it
        r = (box.max.y - box.min.y) / 2
        const [, sp] = hang(c.clone().applyMatrix4(back))
        for (const { q, o } of parts) {
          q.translate(-c.x, -c.y, -c.z)
          const m = new THREE.Mesh(q, o.material)
          m.name = 'wheel'
          dress(m)
          const holder = new THREE.Group()
          holder.rotation.y = quarterTurn ? -Math.PI / 2 : 0
          holder.add(m)
          sp.add(holder)
        }
      })
      if (quarterTurn) {
        // pivots must spin about the car's own axle, so turn the whole car instead
        for (const g of [body, wheels]) g.userData.turn = Math.PI / 2
      }
    }

    // In the frame after the optional quarter turn: z along, x across.
    const turnY = body.userData.turn || 0
    const T = new THREE.Matrix4().makeRotationY(turnY)
    const cz = centres.map((c) => c.clone().applyMatrix4(T))
    const zf = (cz[0].z + cz[1].z) / 2
    const zr = (cz[2].z + cz[3].z) / 2
    const flip = spec.flip ?? zf < zr
    const s = wheelR / r
    const mid = new THREE.Vector3((cz[0].x + cz[1].x) / 2, cz[0].y, (zf + zr) / 2)
    const sign = flip ? -1 : 1
    const allT = all.clone().applyMatrix4(T)
    for (const g of [body, wheels]) {
      // outer: fit; inner: the quarter turn
      const inner = new THREE.Group()
      inner.rotation.y = turnY
      for (const k of [...g.children]) inner.add(k)
      g.add(inner)
      g.scale.setScalar(s)
      g.rotation.y = flip ? Math.PI : 0
      g.position.set(-mid.x * s * sign, wheelY - mid.y * s, -mid.z * s * sign)
    }
    const tailZ = flip ? -(allT.max.z - mid.z) * s : (allT.min.z - mid.z) * s
    // steer and spin axes are the pivots' own; with a quarter turn the axle is z
    return {
      body,
      wheels,
      // cut wheels are ordered by position, so a flipped model's fronts are the last two
      steer: P && flip ? steer.slice(2) : steer.slice(0, 2),
      spin,
      spinAxis: turnY ? 'z' : 'x',
      spinSign: (flip ? -1 : 1) * (turnY ? -1 : 1),
      brake,
      tailZ,
    }
  }, [scene, spec, ghost, color, wheelR, wheelY])
}
