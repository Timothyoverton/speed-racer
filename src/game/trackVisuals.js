// Turns the track's tile list into flat arrays of box transforms, one array per
// material. Rendered as InstancedMeshes, so the whole circuit — road, lines,
// kerbs, barriers, posts — costs a handful of draw calls and survives a restart
// without rebuilding anything (this module runs once).
import * as THREE from 'three'
import { TRACK } from './track.js'

const WALL_W = 0.6
const WALL_H = 1.35
const KERB_W = 1.6
const LINE_INSET = 1.5

const dummy = new THREE.Object3D()

function tileSpace(tile) {
  dummy.position.set(tile.pos[0], tile.pos[1], tile.pos[2])
  dummy.rotation.set(tile.rot[0], tile.rot[1], tile.rot[2])
  dummy.updateMatrixWorld()
  return dummy.matrixWorld
}

function place(list, tile, local, scale) {
  const m = tileSpace(tile)
  const p = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(m)
  list.push({ p: [p.x, p.y, p.z], r: tile.rot, s: scale })
}

function build(track) {
  const road = []
  const line = []
  const dash = []
  const kerb = []
  const wall = []
  const stripeL = []
  const stripeR = []
  const post = []

  const rw = track.roadWidth
  const th = track.roadThick
  const top = th / 2 // local y of the road surface

  track.tiles.forEach((tile, i) => {
    const [w, h, len] = tile.size

    road.push({ p: tile.pos, r: tile.rot, s: [w, h, len + 0.04] })

    // solid white edge lines
    for (const s of [1, -1]) {
      place(line, tile, [s * (w / 2 - LINE_INSET), top + 0.012, 0], [0.26, 0.03, len + 0.04])
    }
    // dashed centre line
    place(dash, tile, [0, top + 0.012, 0], [0.24, 0.03, len * 0.55])

    // kerbs on the inside + outside of a corner
    if (tile.curve) {
      for (const s of [1, -1]) {
        place(
          kerb,
          tile,
          [s * (w / 2 - KERB_W / 2 - 0.05), top + 0.035, 0],
          [KERB_W, 0.09, len + 0.04],
        )
      }
    }

    // barriers — a concrete base with an emissive sponsor band on the inner face
    for (const s of [1, -1]) {
      place(wall, tile, [s * (rw / 2 + WALL_W / 2), top + WALL_H / 2, 0], [WALL_W, WALL_H, len + 0.04])
      place(
        s > 0 ? stripeR : stripeL,
        tile,
        [s * (rw / 2 + 0.03), top + WALL_H - 0.28, 0],
        [0.08, 0.3, len + 0.04],
      )
    }

    // marker posts every few tiles, outside the barrier
    if (i % 4 === 0) {
      for (const s of [1, -1]) {
        place(post, tile, [s * (rw / 2 + WALL_W + 0.5), top + 1.5, 0], [0.16, 3.0, 0.16])
      }
    }
  })

  return { road, line, dash, kerb, wall, stripeL, stripeR, post }
}

export const VISUALS = build(TRACK)
export const BARRIER = { WALL_W, WALL_H }

// centre + extent of the whole course, for aiming lights and placing scenery
export const BOUNDS = (() => {
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const t of TRACK.tiles) box.expandByPoint(v.set(t.pos[0], t.pos[1], t.pos[2]))
  const c = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  return {
    center: [c.x, c.y, c.z],
    radius: Math.max(size.x, size.z) / 2 + TRACK.roadWidth,
    size: [size.x, size.y, size.z],
  }
})()
