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
  checkerMap, hazardMap } from './textures.js'
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
      color: '#ffffff', // tinted per instance
      emissive: '#2f9bff',
      emissiveIntensity: 0.12,
      roughness: 0.4,
    }),
    stripeL: new THREE.MeshStandardMaterial({
      color: '#ffffff', // tinted per instance
      emissive: '#ff3b4d',
      emissiveIntensity: 0.12,
      roughness: 0.4,
    }),
    post: new THREE.MeshStandardMaterial({ color: '#7e8794', roughness: 0.6, metalness: 0.5 }),
    boostPad: new THREE.MeshStandardMaterial({
      color: '#0b1a24',
      roughness: 0.5,
      metalness: 0.2,
      emissive: '#0a2b3a',
      emissiveIntensity: 0.8,
    }),
    boostArrow: new THREE.MeshStandardMaterial({
      color: '#7ffbff',
      emissive: '#25e6ff',
      emissiveIntensity: 2.6,
      roughness: 0.3,
    }),
    water: new THREE.MeshPhysicalMaterial({
      color: '#0f6f9c',
      transparent: true,
      opacity: 0.88,
      // low roughness would mirror the sky and hide the sharks; keep it readable
      roughness: 0.35,
      metalness: 0.1,
      envMapIntensity: 0.5,
    }),
    poolTile: new THREE.MeshStandardMaterial({ color: '#cfe6f2', roughness: 0.7, metalness: 0.05 }),
    shark: new THREE.MeshStandardMaterial({ color: '#39434f', roughness: 0.75, metalness: 0.1 }),
    hazard: new THREE.MeshStandardMaterial({
      map: (() => {
        const t = hazardMap()
        t.repeat.set(4, 1)
        return t
      })(),
      roughness: 0.5,
      metalness: 0.1,
      emissive: '#2a2410',
      emissiveIntensity: 0.6,
    }),
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
