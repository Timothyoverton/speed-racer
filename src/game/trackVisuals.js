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

// Sponsor bands. One flat colour for a kilometre of barrier reads as a corridor
// of wallpaper, so the shade steps every few tiles — cool down the right, warm
// down the left, which keeps the side cue while breaking up the repetition.
const BAND_COOL = ['#1f7fd0', '#1c9ad0', '#2f62e0', '#17a8b8']
const BAND_WARM = ['#c22b39', '#d1452b', '#e0641b', '#b0305f']
const BAND_EVERY = 6 // tiles

const dummy = new THREE.Object3D()

function tileSpace(tile) {
  dummy.position.set(tile.pos[0], tile.pos[1], tile.pos[2])
  dummy.rotation.set(tile.rot[0], tile.rot[1], tile.rot[2], 'YXZ')
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
  const chevronL = []
  const chevronR = []
  const hazard = []
  const gateLeg = []
  const gateBeam = []
  const pylon = []
  const pylonCap = []
  const stripeLColor = []
  const stripeRColor = []
  const wallColor = []

  const rw = track.roadWidth
  const th = track.roadThick
  const top = th / 2 // local y of the road surface
  // where the grass will sit — must match GROUND_Y below
  const groundY = Math.min(...track.tiles.map((t) => t.pos[1])) - 0.1

  track.tiles.forEach((tile, i) => {
    const [w, h, len] = tile.size

    road.push({ p: tile.pos, r: tile.rot, s: [w, h, len + 0.04] })

    // solid white edge lines
    for (const s of [1, -1]) {
      place(line, tile, [s * (w / 2 - LINE_INSET), top + 0.012, 0], [0.26, 0.03, len + 0.04])
    }
    // dashed centre line
    place(dash, tile, [0, top + 0.012, 0], [0.24, 0.03, len * 0.55])

    // Red/white kerbs down both edges of a corner AND of any elevation change,
    // so a crest or a dip reads as something to be ready for from a long way
    // out — the same job the striping does on a real circuit.
    if (tile.curve || Math.abs(tile.pitch) > 1e-3) {
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
      // a touch of tonal variety so the concrete isn't one flat grey
      const shade = 0.9 + ((i * 7919) % 100) / 500
      wallColor.push(`rgb(${Math.round(255 * shade)},${Math.round(255 * shade)},${Math.round(255 * shade)})`)
      const band = Math.floor(i / BAND_EVERY)
      place(
        s > 0 ? stripeR : stripeL,
        tile,
        [s * (rw / 2 + 0.03), top + WALL_H - 0.28, 0],
        [0.08, 0.3, len + 0.04],
      )
      if (s > 0) stripeRColor.push(BAND_COOL[band % BAND_COOL.length])
      else stripeLColor.push(BAND_WARM[band % BAND_WARM.length])
    }

    // Chevron boards on the OUTSIDE of a corner, on the way in — the visual
    // cue that the road is about to turn, before you can see how much.
    const prev = track.tiles[i - 1]
    const enteringCorner = tile.curve && (!prev || !prev.curve)
    if (enteringCorner) {
      const outside = -tile.curve
      for (let k = 0; k < 3; k++) {
        place(
          tile.curve > 0 ? chevronR : chevronL,
          tile,
          [outside * (rw / 2 + WALL_W + 0.9), top + 1.5, -k * 7 - 2],
          [2.6, 1.7, 0.18],
        )
      }
    }

    // --- gap furniture ------------------------------------------------------
    // Where the road stops there is nothing at all: no barrier, no surface, no
    // colour change. At 150km/h a hole reads as more road until you're in it,
    // so mark both lips hard. This is as much fairness as decoration.
    const next = track.tiles[i + 1]
    if (next) {
      const horiz = Math.cos(tile.pitch)
      const dir = [Math.sin(tile.rot[1]) * horiz, Math.sin(tile.pitch), Math.cos(tile.rot[1]) * horiz]
      const end = tile.pos.map((c, k) => c + (dir[k] * tile.size[2]) / 2)
      const begin = next.pos.map((c, k) => c - (dir[k] * next.size[2]) / 2)
      const across = Math.hypot(end[0] - begin[0], end[1] - begin[1], end[2] - begin[2])
      if (across > 5) {
        // hazard bar across the take-off lip, and again on the landing edge
        place(hazard, tile, [0, top + 0.09, len / 2 - 0.7], [rw, 0.22, 1.4])
        place(hazard, next, [0, next.size[1] / 2 + 0.09, -next.size[2] / 2 + 0.7], [rw, 0.22, 1.4])
        // a gate over the lip: you aim at it, and it gives the jump a scale
        for (const sd of [1, -1]) {
          place(gateLeg, tile, [sd * (rw / 2 + WALL_W), top + 3.2, len / 2 - 0.4], [0.5, 6.4, 0.5])
        }
        place(gateBeam, tile, [0, top + 6.7, len / 2 - 0.4], [rw + 2 * WALL_W + 0.5, 1.0, 0.6])
        // pylons stepping back from the edge on both sides, so the lip has depth
        for (let k = 0; k < 4; k++) {
          for (const sd of [1, -1]) {
            place(hazard, tile, [sd * (rw / 2 - 0.6), top + 0.75, len / 2 - 1.8 - k * 3.4], [0.45, 1.5, 0.45])
          }
        }
      }
    }

    // --- hold the thing up ----------------------------------------------------
    // Freefall and Stunt Park run most of a lap high above the ground, and an
    // elevated ribbon with nothing under it reads as a floating decal. Trestle
    // legs down to the grass give the height somewhere to be measured against,
    // which is most of what sells a drop.
    if (i % 6 === 0) {
      const deck = tile.pos[1] - th / 2
      const h = deck - groundY
      if (h > 2.5) {
        const yaw = tile.rot[1]
        // legs are vertical in WORLD space, not raked with the road's pitch
        const rx = Math.cos(yaw)
        const rz = -Math.sin(yaw)
        for (const sd of [1, -1]) {
          const off = sd * (rw / 2 - 1.2)
          pylon.push({
            p: [tile.pos[0] + rx * off, groundY + h / 2, tile.pos[2] + rz * off],
            r: [0, yaw, 0],
            s: [0.9, h, 0.9],
          })
        }
        pylonCap.push({
          p: [tile.pos[0], deck - 0.55, tile.pos[2]],
          r: tile.rot,
          s: [rw - 0.6, 1.1, 1.6],
        })
      }
    }

    // marker posts every few tiles, outside the barrier
    if (i % 4 === 0) {
      for (const s of [1, -1]) {
        place(post, tile, [s * (rw / 2 + WALL_W + 0.5), top + 1.5, 0], [0.16, 3.0, 0.16])
      }
    }
  })

  return {
    road, line, dash, kerb, wall, stripeL, stripeR, post, chevronL, chevronR,
    stripeLColor, stripeRColor, wallColor, hazard, gateLeg, gateBeam, pylon, pylonCap,
  }
}

export const VISUALS = build(TRACK)

// Where the grass sits. Tracks can descend — Qiddiya Rush nets 3m down — and a
// fixed ground plane then covers the road and you drive along under the lawn.
// Sit it just under the LOWEST bit of road, so the low point is bedded into the
// ground exactly as before and anything higher is a raised ribbon above it.
// (Flat tracks land on -0.9, which is what this was hard-coded to.)
export const GROUND_Y = Math.min(...TRACK.tiles.map((t) => t.pos[1])) - 0.1
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
