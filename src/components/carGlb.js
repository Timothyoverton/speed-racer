import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// The scanned-quality car: Khronos "Car Concept" (CC-BY 4.0, see
// public/assets/CREDITS.md). Fitted to the game's wheel radius and axle
// positions, with the wheels re-hung on pivots so they can steer and spin.

const URL = import.meta.env.BASE_URL + 'assets/car/CarConcept.glb'
const WHEELS = ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']

export function useCarGlb(ghost, color, wheelR, wheelY) {
  const { scene } = useGLTF(URL, false)
  return useMemo(() => {
    const root = scene.clone(true)
    root.updateMatrixWorld(true)

    const ghostMat = ghost
      ? new THREE.MeshStandardMaterial({
          color: '#cfe6ff',
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          roughness: 0.4,
          metalness: 0.2,
        })
      : null
    const paint = new THREE.Color(color)
    const cache = new Map()
    const brake = []
    const fix = (m) => {
      if (cache.has(m.uuid)) return cache.get(m.uuid)
      const c = m.clone()
      const n = m.name || ''
      if (n.startsWith('Paint 1')) {
        // metallic paint under a clear coat, so the sky rolls over the panels
        c.color.copy(paint)
        c.map = null
        c.metalness = 0.75
        c.roughness = 0.34
        c.clearcoat = 1
        c.clearcoatRoughness = 0.04
        c.envMapIntensity = 1.25
      } else if (n.startsWith('Paint 2')) {
        c.color.copy(paint).multiplyScalar(0.35)
        c.map = null
      }
      // real transmission costs a second render of the whole scene per frame;
      // plain tinted alpha reads the same at driving distance
      if (c.transmission > 0) {
        c.transmission = 0
        c.thickness = 0
        c.transparent = true
        c.opacity = n === 'Glass' ? 0.55 : 0.75
        c.depthWrite = false
        if (n === 'Glass') c.color.set('#0c1116')
        c.roughness = 0.05
      }
      if (n === 'Brakelight') {
        c.emissive.set('#ff1408')
        c.emissiveIntensity = 0.7
        brake.push(c)
      }
      cache.set(m.uuid, c)
      return c
    }
    root.traverse((o) => {
      if (!o.isMesh) return
      // the plate carries a trademarked logo that the licence excludes
      if (o.name === 'License Plate' || o.material?.name === 'License') {
        o.visible = false
        return
      }
      if (ghost) {
        o.material = ghostMat
        return
      }
      o.material = fix(o.material)
      o.castShadow = !o.name.startsWith('Interior') && !o.material.transparent
      o.receiveShadow = true
    })

    // wheels: find each one's centre, then hang it on steer > spin pivots
    const body = new THREE.Group()
    const wheels = new THREE.Group()
    body.add(root)
    const box = new THREE.Box3()
    const steer = []
    const spin = []
    const centres = []
    let r = 0.384
    for (const name of WHEELS) {
      const w = root.getObjectByName(name)
      box.setFromObject(w)
      const c = box.getCenter(new THREE.Vector3())
      r = (box.max.y - box.min.y) / 2
      const st = new THREE.Group()
      const sp = new THREE.Group()
      st.position.copy(c)
      st.add(sp)
      wheels.add(st)
      st.updateMatrixWorld(true)
      const pads = w.children.filter((k) => /BrakePad/.test(k.name))
      sp.attach(w)
      for (const p of pads) st.attach(p)
      steer.push(st)
      spin.push(sp)
      centres.push(c)
    }
    const all = new THREE.Box3().setFromObject(root)
    for (const st of steer) all.expandByObject(st)
    const zf = (centres[0].z + centres[1].z) / 2
    const zr = (centres[2].z + centres[3].z) / 2
    const flip = zf < zr // model faces -Z: turn it round
    const s = wheelR / r
    const mid = new THREE.Vector3((centres[0].x + centres[1].x) / 2, centres[0].y, (zf + zr) / 2)
    for (const g of [body, wheels]) {
      g.scale.setScalar(s)
      g.rotation.y = flip ? Math.PI : 0
      const sign = flip ? -1 : 1
      g.position.set(-mid.x * s * sign, wheelY - mid.y * s, -mid.z * s * sign)
    }
    const tailZ = flip ? -(all.max.z - mid.z) * s : (all.min.z - mid.z) * s
    return {
      body,
      wheels,
      steer: steer.slice(0, 2),
      spin,
      spinSign: flip ? -1 : 1,
      brake,
      tailZ,
      halfWheelbase: (Math.abs(zf - zr) / 2) * s,
    }
  }, [scene, ghost, color, wheelR, wheelY])
}

useGLTF.preload(URL, false)
