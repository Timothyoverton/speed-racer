// Shared materials, built once. Kept out of the components so a race restart
// (which remounts the whole scene graph) doesn't recompile shaders or redraw
// the procedural textures.
import * as THREE from 'three'
import {
  asphaltMap,
  chevronMap,
  asphaltNormal,
  concreteMap,
  grassMap,
  kerbMap,
  checkerMap,
} from './textures.js'
import { TRACK } from './track.js'

let cache = null

export function trackMaterials() {
  if (cache) return cache

  const rw = TRACK.roadWidth
  const map = asphaltMap()
  const nrm = asphaltNormal()
  // one texture tile every ~2.5 m of road, in both directions
  map.repeat.set(rw / 2.5, 2.4)
  nrm.repeat.set(rw / 2.5, 2.4)

  const kerb = kerbMap()
  kerb.repeat.set(1, 1.2) // ~60cm bands, the scale a real kerb uses

  const concrete = concreteMap()
  concrete.repeat.set(3, 1)

  const grass = grassMap()
  grass.repeat.set(240, 240)

  cache = {
    asphalt: new THREE.MeshStandardMaterial({
      map,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: '#8c8f96',
      roughness: 0.94,
      metalness: 0.02,
    }),
    line: new THREE.MeshStandardMaterial({
      color: '#e8ecf3',
      roughness: 0.6,
      metalness: 0,
      emissive: '#20262f',
      emissiveIntensity: 0.4,
    }),
    kerb: new THREE.MeshStandardMaterial({ map: kerb, roughness: 0.55, metalness: 0.05 }),
    concrete: new THREE.MeshStandardMaterial({
      map: concrete,
      color: '#9aa0ab',
      roughness: 0.9,
      metalness: 0.02,
    }),
    stripeR: new THREE.MeshStandardMaterial({
      color: '#1f7fd0',
      emissive: '#2f9bff',
      emissiveIntensity: 0.45,
      roughness: 0.4,
    }),
    stripeL: new THREE.MeshStandardMaterial({
      color: '#c22b39',
      emissive: '#ff3b4d',
      emissiveIntensity: 0.45,
      roughness: 0.4,
    }),
    post: new THREE.MeshStandardMaterial({ color: '#7e8794', roughness: 0.6, metalness: 0.5 }),
    metal: new THREE.MeshStandardMaterial({ color: '#98a1ae', roughness: 0.35, metalness: 0.9 }),
    grass: new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0 }),
    chevronL: new THREE.MeshStandardMaterial({ map: chevronMap(), roughness: 0.6 }),
    chevronR: new THREE.MeshStandardMaterial({
      map: (() => {
        const m = chevronMap().clone()
        m.needsUpdate = true
        m.wrapS = THREE.RepeatWrapping
        m.repeat.x = -1 // same artwork, arrows pointing the other way
        return m
      })(),
      roughness: 0.6,
    }),
    checker: new THREE.MeshStandardMaterial({
      map: checkerMap(),
      roughness: 0.7,
      metalness: 0,
    }),
  }
  return cache
}

export function gateMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}
