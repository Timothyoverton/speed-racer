// Everything around the circuit. All instanced and generated once from a fixed
// seed, so it costs a handful of draw calls and looks the same every run.
// What gets generated depends on the track theme — Test Pad keeps the original
// forest, stands and floodlights; the other five are different places.
import { useMemo } from 'react'
import * as THREE from 'three'
import Boxes, { Shapes } from './Boxes.jsx'
import { BOUNDS, GROUND_Y } from '../game/trackVisuals.js'
import { sampleTrack } from '../game/trackQuery.js'
import { TRACK } from '../game/track.js'
import { trackMaterials } from '../game/materials.js'
import { THEME } from '../game/themes.js'

const CROWD = ['#d84a4a', '#3a6ec4', '#f2f4f8', '#e0b03a', '#2f9a5a', '#8a93a6', '#1c2430', '#e8e0d4', '#c46b2f']
const CLOUD_TINT = ['#ffffff', '#f7f9fc', '#eef3f8', '#fffdf8', '#e7eef6']
const CONCRETE_TINT = ['#ffffff', '#f4f5f7', '#e8ebef', '#f7f4ef', '#eef1f4']

function rng(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rand, list) {
  return list[(rand() * list.length) | 0]
}

// Road forward at yaw 0 is +Z. +lateral (sampleTrack, yaw 0) is +X, which is
// (cos yaw, -sin yaw). Check: yaw 0 → (1, 0).
function lateralAxis(yaw) {
  return [Math.cos(yaw), -Math.sin(yaw)]
}
function forwardAxis(yaw) {
  return [Math.sin(yaw), Math.cos(yaw)]
}

// Anything scattered near the circuit has to stay off the tarmac, the barriers,
// the stunt ramps and the gaps. sampleTrack only answers "near a tile"; a gap
// is a hole with no tile, and a 40m mesa still overlaps the road when its
// centre is clear. So the test is distance to the ribbon (tiles + the voids
// between them), widened by the object's own radius.
function buildKeepOut() {
  const CELL = 48
  const buckets = new Map()
  const segs = []
  const add = (ax, az, bx, bz, radius) => segs.push({ ax, az, bx, bz, radius })

  const ends = TRACK.tiles.map((t) => {
    const [fx, fz] = forwardAxis(t.rot[1])
    const horiz = Math.cos(t.pitch || 0)
    const half = t.size[2] / 2
    const dx = fx * horiz * half
    const dz = fz * horiz * half
    return {
      a: [t.pos[0] - dx, t.pos[2] - dz],
      b: [t.pos[0] + dx, t.pos[2] + dz],
    }
  })
  const ribbon = TRACK.roadWidth / 2 + 1.4
  for (let i = 0; i < ends.length; i++) {
    add(ends[i].a[0], ends[i].a[1], ends[i].b[0], ends[i].b[1], ribbon)
    if (i + 1 < ends.length) {
      const gap = Math.hypot(ends[i + 1].a[0] - ends[i].b[0], ends[i + 1].a[1] - ends[i].b[1])
      // corner chords miss by a few tens of centimetres; a real hole is >= 5m
      if (gap > 3) add(ends[i].b[0], ends[i].b[1], ends[i + 1].a[0], ends[i + 1].a[1], ribbon)
    }
  }
  for (const p of TRACK.pools) {
    const [fx, fz] = forwardAxis(p.yaw)
    const len = p.size[1]
    add(p.pos[0] - fx * len / 2, p.pos[2] - fz * len / 2, p.pos[0] + fx * len / 2, p.pos[2] + fz * len / 2, p.size[0] / 2 + 2)
  }
  for (const rp of TRACK.ramps) {
    add(rp.start[0], rp.start[2], rp.lip[0], rp.lip[2], rp.size[0] / 2 + 3)
  }
  for (const w of TRACK.walls) {
    add(w.pos[0], w.pos[2], w.pos[0], w.pos[2], Math.max(w.size[0], w.size[2]) / 2 + 2)
  }
  for (const f of TRACK.falls) {
    const [lx, lz] = lateralAxis(f.yaw)
    const hw = f.width / 2
    add(f.pos[0] - lx * hw, f.pos[2] - lz * hw, f.pos[0] + lx * hw, f.pos[2] + lz * hw, 4)
  }

  for (const s of segs) {
    const x0 = Math.floor((Math.min(s.ax, s.bx) - s.radius) / CELL)
    const x1 = Math.floor((Math.max(s.ax, s.bx) + s.radius) / CELL)
    const z0 = Math.floor((Math.min(s.az, s.bz) - s.radius) / CELL)
    const z1 = Math.floor((Math.max(s.az, s.bz) + s.radius) / CELL)
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = x + ',' + z
        let list = buckets.get(k)
        if (!list) buckets.set(k, (list = []))
        list.push(s)
      }
    }
  }

  return function blocked(x, z, extra) {
    const on = sampleTrack(x, z)
    if (on && Math.abs(on.lateral) < TRACK.roadWidth / 2 + extra) return true
    const list = buckets.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL))
    if (!list) return false
    const lim = extra
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      const abx = s.bx - s.ax
      const abz = s.bz - s.az
      const len2 = abx * abx + abz * abz || 1
      let u = ((x - s.ax) * abx + (z - s.az) * abz) / len2
      if (u < 0) u = 0
      else if (u > 1) u = 1
      const dx = x - (s.ax + abx * u)
      const dz = z - (s.az + abz * u)
      if (dx * dx + dz * dz < (s.radius + lim) * (s.radius + lim)) return true
    }
    return false
  }
}

function noiseGround(kind, color) {
  const N = 128
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  const img = g.createImageData(N, N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0.84
        + 0.07 * Math.sin(x * 0.37 + y * 0.13)
        + 0.05 * Math.sin(y * 0.29 - x * 0.07)
        + 0.03 * Math.sin((x + y) * 0.85)
      if (kind === 'sand') v += 0.04 * Math.sin(x * 0.08 + y * 0.05)
      const byte = Math.max(0, Math.min(255, v * 255))
      const i = (y * N + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = byte
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(150, 150)
  tex.anisotropy = 8
  tex.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshStandardMaterial({ map: tex, color, roughness: 1, metalness: 0 })
}

export default function Scenery() {
  const mats = useMemo(() => trackMaterials(), [])
  const [cx, , cz] = BOUNDS.center
  const R = BOUNDS.radius
  // scenery was authored against a ground plane at -0.9; keep it planted on the
  // ground wherever that now sits
  const gy = GROUND_Y + 0.9
  const spec = THEME.scenery

  const ground = useMemo(() => {
    const g = THEME.ground
    if (g.kind === 'grass') {
      mats.grass.color.set(g.color)
      return mats.grass
    }
    return noiseGround(g.kind, g.color)
  }, [mats])

  const extra = useMemo(() => {
    const rand = rng(1337)
    const blocked = buildKeepOut()
    const out = {
      trunks: [], trunkColors: [], posts: [], postColors: [], crowns: [], crownColors: [],
      scrub: [], scrubColors: [], hills: [], hillColors: [],
      rocks: [], rockColors: [], spires: [], spireColors: [],
      snow: [], snowColors: [], dunes: [], duneColors: [],
      cacti: [], cactusColors: [],
      stands: [], standColors: [], crowd: [], crowdColors: [],
      metal: [], metalColors: [], solid: [], solidColors: [],
      fronds: [], frondColors: [],
      banners: [], bannerColors: [],
      glow: [], glowColors: [], floods: [],
      clouds: [], cloudColors: [], arches: [], archColors: [],
      balloons: [], balloonColors: [],
      palm: !!(spec.forest && spec.forest.palm),
      roundScrub: !!(spec.scrub && spec.scrub.round),
    }

    const put = (list, colors, item, color) => {
      list.push(item)
      if (colors) colors.push(color)
    }

    // Disc around the circuit's bounds, clumped so thickets and clearings form.
    // Rejecting anything near the ribbon is what keeps the infield full without
    // planting a cone on the racing line.
    function scatterDisc(count, reach, clearance, fn) {
      for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
        const a = rand() * Math.PI * 2
        const u = rand()
        const clump = u * u * 0.55 + u * 0.45
        const rad = Math.sqrt(clump) * reach
        const x = cx + Math.cos(a) * rad
        const z = cz + Math.sin(a) * rad
        if (blocked(x, z, clearance)) continue
        fn(x, z)
        i++
      }
    }

    // A band following the road, so a few hundred props are actually visible
    // from the cockpit instead of scattered into the fog.
    function scatterBeside(count, minOff, maxOff, clearance, fn) {
      const tiles = TRACK.tiles
      for (let i = 0, tries = 0; i < count && tries < count * 24; tries++) {
        const tile = tiles[(rand() * tiles.length) | 0]
        const yaw = tile.rot[1]
        const [lx, lz] = lateralAxis(yaw)
        const [fx, fz] = forwardAxis(yaw)
        const side = rand() < 0.5 ? 1 : -1
        const dist = TRACK.roadWidth / 2 + minOff + rand() * (maxOff - minOff)
        const along = (rand() - 0.5) * 16
        const x = tile.pos[0] + lx * side * dist + fx * along
        const z = tile.pos[2] + lz * side * dist + fz * along
        if (blocked(x, z, clearance)) continue
        if (fn(x, z, yaw, tile) === false) continue
        i++
      }
    }

    function eachTile(every, off, sides, fn) {
      const tiles = TRACK.tiles
      for (let i = 0; i < tiles.length; i += every) {
        const tile = tiles[i]
        if (Math.abs(tile.pitch) > 0.05) continue
        const yaw = tile.rot[1]
        const choices = sides === 2 ? [1, -1] : [(i / every) % 2 === 0 ? 1 : -1]
        for (const side of choices) {
          const [lx, lz] = lateralAxis(yaw)
          const dist = TRACK.roadWidth / 2 + off
          const x = tile.pos[0] + lx * side * dist
          const z = tile.pos[2] + lz * side * dist
          if (blocked(x, z, 2)) continue
          fn({ x, z, yaw, side, lx, lz, tile })
        }
      }
    }

    // Road surface can sit well above the valley floor (Freefall, Stunt Park).
    // Props beside a tile grow from that surface, and anything with a trunk or
    // pole keeps going down to the ground so it doesn't hang in the air.
    const footOf = (tile) => (tile ? Math.max(gy, tile.pos[1] + 0.9) : gy)
    const spin = new THREE.Object3D()
    const frondDir = new THREE.Vector3()

    if (spec.forest) {
      const f = spec.forest
      const placeTree = (x, z, _yaw, tile) => {
        const h = f.palm ? 6.5 + rand() * 4 : 4.5 + rand() * 9.5
        const w = f.palm ? 2.4 + rand() * 1.4 : 2.0 + rand() * 2.4
        const bark = pick(rand, f.bark)
        const tint = pick(rand, f.palette)
        const foot = footOf(tile)
        if (f.palm) {
          const trunkH = Math.max(h, foot - gy + h * 0.55)
          put(out.trunks, out.trunkColors, { p: [x, gy + trunkH * 0.5, z], r: [0, rand() * 3, 0], s: [0.42, trunkH, 0.42] }, bark)
          const top = gy + trunkH
          // fronds, not a cone: a cone crown reads as another pine
          for (let k = 0; k < 6; k++) {
            const ay = (k / 6) * Math.PI * 2 + rand() * 0.35
            const pitch = -0.45 - rand() * 0.4
            spin.rotation.set(pitch, ay, 0, 'YXZ')
            spin.updateMatrix()
            frondDir.set(0, 0, 1).applyQuaternion(spin.quaternion)
            const len = w * (1.5 + rand() * 0.6)
            put(out.fronds, out.frondColors, {
              p: [x + frondDir.x * len * 0.46, top + frondDir.y * len * 0.46, z + frondDir.z * len * 0.46],
              r: [pitch, ay, 0],
              s: [0.22, 0.07, len],
            }, tint)
          }
        } else {
          const crown = foot + h * 0.55
          const trunkH = Math.max(h * 0.45, crown - gy)
          // a cone trunk comes to a point, so on a raised road you only see the
          // tip. A cylinder keeps its thickness up at the roadside.
          const raised = trunkH > h + 3
          const bulk = raised ? 1.7 : 1
          if (raised) {
            put(out.posts, out.postColors, {
              p: [x, gy + trunkH * 0.5, z], r: [0, rand(), 0], s: [1.7, trunkH, 1.7],
            }, bark)
          } else {
            put(out.trunks, out.trunkColors, {
              p: [x, gy + trunkH * 0.5, z], r: [0, rand() * 3, 0], s: [0.5, trunkH, 0.5],
            }, bark)
          }
          // two stacked cones give a conifer a waist instead of a single triangle
          put(out.crowns, out.crownColors, { p: [x, crown, z], r: [0, rand() * 3, 0], s: [w * bulk, h * 0.8, w * bulk] }, tint)
          const top = f.snow ? pick(rand, f.snowPalette) : tint
          put(out.crowns, out.crownColors, {
            p: [x, crown + h * 0.36, z], r: [0, rand() * 3, 0], s: [w * 0.66 * bulk, h * 0.55, w * 0.66 * bulk],
          }, top)
        }
      }
      if (f.band) scatterBeside(f.count, f.band[0], f.band[1], f.clear, placeTree)
      else scatterDisc(f.count, R + (f.reach || 320), f.clear, placeTree)
    }

    if (spec.scrub) {
      const s = spec.scrub
      const place = (x, z) => {
        const w = s.round ? 1.4 + rand() * 2.2 : 0.9 + rand() * 1.7
        const h = s.round ? w * (0.7 + rand() * 0.35) : w * 0.8
        put(out.scrub, out.scrubColors, { p: [x, gy + h * 0.35, z], r: [0, rand() * 3, 0], s: [w, h, w] }, pick(rand, s.palette))
      }
      if (s.minOff != null) scatterBeside(s.count, s.minOff, s.maxOff, s.clear, place)
      else scatterDisc(s.count, R * 1.15, s.clear, place)
    }

    if (spec.dunes) {
      const d = spec.dunes
      scatterBeside(d.count, d.minOff, d.maxOff, 8, (x, z) => {
        const w = 16 + rand() * 26
        const h = 1.6 + rand() * 3.4
        if (blocked(x, z, w * 0.5 + 4)) return false
        put(out.dunes, out.duneColors, {
          p: [x, gy - h * 0.15, z], r: [0, rand() * 6, 0], s: [w, h, w * (0.55 + rand() * 0.4)],
        }, pick(rand, d.palette))
      })
    }

    if (spec.cacti) {
      const c = spec.cacti
      const greens = ['#2c6b3c', '#3c7e48', '#1f5a30', '#4a8a50', '#245c34', '#5a9458']
      scatterBeside(c.count, c.minOff, c.maxOff, 4, (x, z, yaw) => {
        const h = 2.4 + rand() * 3.4
        const tint = pick(rand, greens)
        put(out.cacti, out.cactusColors, { p: [x, gy + h * 0.5, z], r: [0, yaw + rand(), 0], s: [0.85, h, 0.85] }, tint)
        const arms = rand() < 0.3 ? 1 : 2
        for (let a = 0; a < arms; a++) {
          const side = a === 0 ? 1 : -1
          const aw = 0.55 + rand() * 0.55
          const [lx, lz] = lateralAxis(yaw)
          put(out.solid, out.solidColors, {
            p: [x + lx * side * (0.35 + aw * 0.45), gy + h * (0.45 + rand() * 0.25), z + lz * side * (0.35 + aw * 0.45)],
            r: [0, yaw, 0],
            s: [aw, 0.32, 0.32],
          }, tint)
        }
      })
    }

    if (spec.mesas) {
      const m = spec.mesas
      scatterBeside(m.count, m.minOff, m.maxOff, 10, (x, z) => {
        const w = 14 + rand() * 32
        const d = 12 + rand() * 26
        const h = 7 + rand() * 22
        if (blocked(x, z, Math.hypot(w, d) * 0.5 + 6)) return false
        const yaw = rand() * Math.PI
        put(out.rocks, out.rockColors, { p: [x, gy + h * 0.32, z], r: [0, yaw, 0], s: [w, h, d] }, pick(rand, m.palette))
        put(out.rocks, out.rockColors, {
          p: [x, gy + h * 0.32 + h * 0.46, z], r: [0, yaw + 0.2, 0], s: [w * 0.7, h * 0.18, d * 0.7],
        }, pick(rand, m.caps))
      })
    }

    if (spec.spires) {
      const s = spec.spires
      scatterBeside(s.count, s.minOff, s.maxOff, 8, (x, z) => {
        const w = 4 + rand() * 8
        const h = 14 + rand() * 28
        if (blocked(x, z, w * 0.5 + 4)) return false
        put(out.spires, out.spireColors, {
          p: [x, gy + h * 0.35, z], r: [0, rand() * 3, 0], s: [w, h, w * (0.7 + rand() * 0.4)],
        }, pick(rand, s.palette))
      })
    }

    if (spec.peaks) {
      const p = spec.peaks
      scatterBeside(p.count, p.minOff, p.maxOff, 12, (x, z) => {
        const sz = 70 + rand() * 130
        const sy = sz * (0.42 + rand() * 0.3)
        if (blocked(x, z, sz * 0.5 + 8)) return false
        const yaw = rand() * 6
        put(out.spires, out.spireColors, { p: [x, gy - sy * 0.05, z], r: [0, yaw, 0], s: [sz, sy, sz] }, pick(rand, p.rock))
        put(out.snow, out.snowColors, {
          p: [x, gy - sy * 0.05 + sy * 0.32, z], r: [0, yaw, 0], s: [sz * 0.32, sy * 0.28, sz * 0.32],
        }, pick(rand, p.snow))
      })
    }

    if (spec.hills) {
      const placeRing = (ring) => {
        if (!ring) return
        for (let i = 0, tries = 0; i < ring.count && tries < ring.count * 12; tries++) {
          const a = rand() * Math.PI * 2
          const rad = Math.max(ring.min, R + 80) + rand() * ring.span
          const sz = 120 + rand() * (ring === spec.hills.far ? 340 : 220)
          const x = cx + Math.cos(a) * rad
          const z = cz + Math.sin(a) * rad
          // cone radius is half the scale (ConeGeometry is authored at r=0.5)
          if (blocked(x, z, sz * 0.5 + 10)) continue
          put(out.hills, out.hillColors, {
            p: [x, gy - ring.sink, z],
            r: [0, rand() * 6, 0],
            s: [sz, sz * (ring.h0 + rand() * ring.h1), sz],
          }, pick(rand, ring.palette))
          i++
        }
      }
      placeRing(spec.hills.near)
      placeRing(spec.hills.far)
    }

    if (spec.clouds) {
      const c = spec.clouds
      for (let i = 0; i < c.count; i++) {
        const a = rand() * Math.PI * 2
        const rad = rand() * Math.max(700, R)
        const bx = cx + Math.cos(a) * rad
        const bz = cz + Math.sin(a) * rad
        const by = gy + 160 + rand() * 110
        const spread = 40 + rand() * 70
        const puffs = 5 + ((rand() * 5) | 0)
        const tint = pick(rand, CLOUD_TINT)
        for (let k = 0; k < puffs; k++) {
          const w = 34 + rand() * 46
          put(out.clouds, out.cloudColors, {
            p: [bx + (rand() - 0.5) * spread * 2.4, by + (rand() - 0.5) * 14, bz + (rand() - 0.5) * spread],
            r: [0, rand() * 3, 0],
            s: [w, w * (0.32 + rand() * 0.22), w * (0.7 + rand() * 0.5)],
          }, tint)
        }
      }
    }

    if (spec.stands && spec.stands.mode === 'bounds') {
      const spots = [
        { x: cx, z: cz - R - 26, rot: 0 },
        { x: cx, z: cz + R + 26, rot: Math.PI },
        { x: cx - R - 26, z: cz, rot: Math.PI / 2 },
        { x: cx + R + 26, z: cz, rot: -Math.PI / 2 },
      ]
      for (const s of spots) {
        for (let step = 0; step < 6; step++) {
          const depth = 3.2
          const off = 2 + step * depth
          const h = 2.5 + step * 2.2
          const dx = Math.sin(s.rot) * off
          const dz = Math.cos(s.rot) * off
          put(out.stands, out.standColors, {
            p: [s.x - dx, gy + h / 2, s.z - dz], r: [0, s.rot, 0], s: [70, h, depth],
          }, pick(rand, CONCRETE_TINT))
          for (let k = 0; k < 34; k++) {
            const along = (k / 33 - 0.5) * 66
            put(out.crowd, out.crowdColors, {
              p: [s.x - dx + Math.cos(s.rot) * along, gy + h + 0.5, s.z - dz - Math.sin(s.rot) * along],
              r: [0, s.rot, 0],
              s: [1.1, 0.85 + rand() * 0.3, 1.1],
            }, pick(rand, CROWD))
          }
        }
      }
    }

    if (spec.stands && spec.stands.mode === 'track') {
      // Sit a stand on the longest flat runs, stepped away from the road,
      // so the terraces are something you drive past rather than a ring at the
      // horizon of the bounding box.
      const tiles = TRACK.tiles
      const runs = []
      let start = -1
      for (let i = 0; i <= tiles.length; i++) {
        const flat = i < tiles.length && Math.abs(tiles[i].pitch) < 0.02
        if (flat && start < 0) start = i
        if (!flat && start >= 0) {
          if (i - start >= 8) runs.push([start, i])
          start = -1
        }
      }
      runs.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
      const used = runs.slice(0, spec.stands.count)
      used.forEach(([a, b], n) => {
        const tile = tiles[(a + b) >> 1]
        const yaw = tile.rot[1]
        const side = n % 2 === 0 ? 1 : -1
        const [lx, lz] = lateralAxis(yaw)
        const [fx, fz] = forwardAxis(yaw)
        const len = Math.min(56, (b - a) * 5)
        const foot = footOf(tile)
        const steps = []
        let clear = true
        for (let step = 0; step < 5; step++) {
          const depth = 2.8
          const off = TRACK.roadWidth / 2 + 12 + step * depth
          const h = 2.2 + step * 1.7
          const px = tile.pos[0] + lx * side * off
          const pz = tile.pos[2] + lz * side * off
          const half = len / 2
          if (
            blocked(px, pz, 6) ||
            blocked(px + fx * half, pz + fz * half, 6) ||
            blocked(px - fx * half, pz - fz * half, 6)
          ) {
            clear = false
            break
          }
          steps.push({ px, pz, h, depth })
        }
        if (!clear) return
        for (const step of steps) {
          const { px, pz, h, depth } = step
          const span = foot + h - gy
          put(out.stands, out.standColors, {
            p: [px, gy + span / 2, pz], r: [0, yaw, 0], s: [depth, span, len],
          }, pick(rand, CONCRETE_TINT))
          for (let k = 0; k < 14; k++) {
            const along = (k / 13 - 0.5) * (len - 4)
            put(out.crowd, out.crowdColors, {
              p: [px + fx * along, foot + h + 0.45, pz + fz * along],
              r: [0, yaw, 0],
              s: [1.0, 0.8 + rand() * 0.35, 1.0],
            }, pick(rand, CROWD))
          }
        }
      })
    }

    if (spec.masts) {
      for (let i = 0; i < spec.masts.count; i++) {
        const a = (i / spec.masts.count) * Math.PI * 2 + 0.3
        let dist = R + 46
        let x = cx + Math.cos(a) * dist
        let z = cz + Math.sin(a) * dist
        if (blocked(x, z, 4)) {
          dist += 50
          x = cx + Math.cos(a) * dist
          z = cz + Math.sin(a) * dist
        }
        put(out.metal, out.metalColors, { p: [x, gy + 15, z], r: [0, -a, 0], s: [1.0, 30, 1.0] }, pick(rand, ['#b7c0cc', '#c5ced8', '#aeb6c2', '#d0d6de']))
        out.floods.push({ p: [x, gy + 30.5, z], r: [0, -a, 0], s: [9, 3.4, 1.2] })
      }
    }

    if (spec.sheds) {
      scatterBeside(spec.sheds.count, 28, 90, 8, (x, z, yaw) => {
        const w = 14 + rand() * 16
        const h = 5.5 + rand() * 4
        const d = 9 + rand() * 8
        if (blocked(x, z, Math.hypot(w, d) * 0.5 + 4)) return false
        const tint = pick(rand, spec.sheds.palette)
        put(out.solid, out.solidColors, { p: [x, gy + h / 2, z], r: [0, yaw, 0], s: [w, h, d] }, tint)
        // a darker bay door on the face toward the pad
        const [lx, lz] = lateralAxis(yaw)
        put(out.solid, out.solidColors, {
          p: [x - lx * (w * 0.5 - 0.2), gy + h * 0.32, z - lz * (w * 0.5 - 0.2)],
          r: [0, yaw, 0],
          s: [0.4, h * 0.55, d * 0.46],
        }, '#6a7380')
      })
    }

    if (spec.flags) {
      const f = spec.flags
      eachTile(f.every, f.off, 1, ({ x, z, yaw, side, lx, lz, tile }) => {
        const [fx, fz] = forwardAxis(yaw)
        const poleH = 6.5 + rand() * 3.5
        const top = footOf(tile) + poleH
        const span = top - gy
        put(out.metal, out.metalColors, { p: [x, gy + span / 2, z], r: [0, yaw, 0], s: [0.16, span, 0.16] }, '#f2f4f7')
        const bw = 2.0 + rand() * 1.6
        const bh = 1.05 + rand() * 0.45
        put(out.banners, out.bannerColors, {
          p: [x + lx * side * 0.15 + fx * bw * 0.42, top - bh * 0.65, z + lz * side * 0.15 + fz * bw * 0.42],
          r: [0.2, yaw, side * 0.35],
          s: [0.08, bh, bw],
        }, pick(rand, f.palette))
      })
    }

    if (spec.towers) {
      const t = spec.towers
      eachTile(t.every, t.off, 1, ({ x, z, yaw, tile }) => {
        const head = footOf(tile) + 18
        const span = head - gy
        put(out.metal, out.metalColors, { p: [x, gy + span / 2, z], r: [0, yaw, 0], s: [0.9, span, 0.9] }, pick(rand, ['#d5dbe3', '#c5ccd6', '#e4e8ee']))
        const tint = pick(rand, t.palette)
        put(out.glow, out.glowColors, { p: [x, head + 0.6, z], r: [0, yaw, 0], s: [8.5, 2.2, 1.15] }, tint)
      })
    }

    if (spec.arches) {
      const a = spec.arches
      eachTile(a.every, a.off, 1, ({ x, z, yaw, tile }) => {
        // torus is authored upright in XY; yaw + 90° turns its hole toward the road
        // so the ring reads side-on from the cockpit, and the whole thing sits
        // clear of the ribbon (centre is `off` metres past the road edge).
        const s = 0.88 + rand() * 0.28
        put(out.arches, out.archColors, {
          p: [x, footOf(tile) + 4.4 * s, z],
          r: [0, yaw + Math.PI / 2, 0],
          s: [s, s, s],
        }, pick(rand, a.palette))
      })
    }

    if (spec.balloons) {
      const b = spec.balloons
      scatterBeside(b.count, b.minOff, b.maxOff, 4, (x, z, _yaw, tile) => {
        const s = 2.4 + rand() * 2.4
        put(out.balloons, out.balloonColors, {
          p: [x, footOf(tile) + 12 + rand() * 22, z], r: [0, rand() * 3, 0], s: [s, s * (1.05 + rand() * 0.15), s],
        }, pick(rand, b.palette))
      })
    }

    if (spec.blocks) {
      const b = spec.blocks
      const wins = ['#ffd98a', '#9ad4ff', '#ff8ac4', '#fff4d0', '#7dffe0', '#c4b0ff']
      scatterBeside(b.count, b.minOff, b.maxOff, 6, (x, z, yaw, tile) => {
        const w = 7 + rand() * 14
        const h = 8 + rand() * 16
        const d = 6 + rand() * 10
        if (blocked(x, z, Math.hypot(w, d) * 0.5 + 4)) return false
        // grow up to the road when the ribbon is raised, so the block reads
        // from the cockpit instead of sitting in the valley under it
        const top = Math.max(gy + h, footOf(tile) + 3)
        const span = top - gy
        put(out.solid, out.solidColors, { p: [x, gy + span / 2, z], r: [0, yaw, 0], s: [w, span, d] }, pick(rand, b.palette))
        const n = 3 + ((rand() * 4) | 0)
        for (let k = 0; k < n; k++) {
          const lx = (rand() - 0.5) * w * 0.7
          const ly = top - 1.2 - rand() * Math.min(8, span * 0.4)
          const [ax, az] = lateralAxis(yaw)
          // local +X is lateral; park the window on that face, just proud of the wall
          put(out.glow, out.glowColors, {
            p: [x + ax * (w / 2 + 0.08) + Math.sin(yaw) * lx, ly, z + az * (w / 2 + 0.08) + Math.cos(yaw) * lx],
            r: [0, yaw, 0],
            s: [0.2, 1.3, 1.15],
          }, pick(rand, wins))
        }
      })
    }

    if (spec.lamps) {
      const L = spec.lamps
      eachTile(L.every, L.off, L.sides || 1, ({ x, z, yaw, tile }) => {
        const h = 7.5
        const top = footOf(tile) + h
        const span = top - gy
        put(out.metal, out.metalColors, { p: [x, gy + span / 2, z], r: [0, yaw, 0], s: [0.22, span, 0.22] }, '#3c4452')
        const tint = pick(rand, L.palette)
        put(out.glow, out.glowColors, { p: [x, top + 0.15, z], r: [0, yaw, 0], s: [1.5, 0.28, 0.5] }, tint)
      })
    }

    if (spec.neon) {
      const n = spec.neon
      eachTile(n.every, n.off, n.sides || 1, ({ x, z, yaw, tile }) => {
        put(out.glow, out.glowColors, {
          p: [x, footOf(tile) + 1.15 + rand() * 1.6, z],
          r: [0, yaw, 0],
          s: [0.18, 0.32, 4.2],
        }, pick(rand, n.palette))
      })
    }

    return out
  }, [cx, cz, R, gy, spec])

  const geos = useMemo(
    () => ({
      cone: new THREE.ConeGeometry(0.5, 1, 7),
      hill: new THREE.ConeGeometry(0.5, 1, 9),
      puff: new THREE.SphereGeometry(0.5, 10, 7),
      ball: new THREE.SphereGeometry(0.5, 8, 6),
      cyl: new THREE.CylinderGeometry(0.5, 0.55, 1, 6),
      arch: new THREE.TorusGeometry(4.4, 0.72, 8, 18),
    }),
    [],
  )

  const mat = useMemo(
    () => ({
      white: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
      solid: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0.02 }),
      metal: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.42, metalness: 0.7 }),
      banner: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.02 }),
      snow: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 }),
      arch: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.04 }),
      cloud: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: spec.clouds ? spec.clouds.opacity : 0.32,
        depthWrite: false,
        roughness: 1,
        emissive: spec.clouds ? spec.clouds.emissive : '#c9dcf2',
        emissiveIntensity: spec.clouds ? spec.clouds.emissiveIntensity : 0.25,
      }),
      // floodlight head — one warm source, same as the original pylons
      flood: new THREE.MeshStandardMaterial({
        color: '#fffbe8',
        emissive: '#fff3c4',
        emissiveIntensity: 1.4,
        roughness: 0.3,
      }),
      // self-coloured signs and lamps. Basic so a dark theme still shows them;
      // instance colour tints each one, which a shared emissive cannot.
      glow: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: true }),
    }),
    [spec.clouds],
  )

  const span = Math.max(2600, (R + 800) * 2)
  const trunkGeo = extra.palm ? geos.cyl : geos.cone
  const scrubGeo = extra.roundScrub ? geos.ball : geos.cone

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, GROUND_Y, cz]} receiveShadow>
        <planeGeometry args={[span, span]} />
        <primitive object={ground} attach="material" />
      </mesh>

      <Shapes items={extra.hills} geometry={geos.hill} material={mat.white} colors={extra.hillColors} />
      <Shapes items={extra.spires} geometry={geos.hill} material={mats.rock} colors={extra.spireColors} />
      <Shapes items={extra.snow} geometry={geos.cone} material={mat.snow} colors={extra.snowColors} />
      <Shapes items={extra.dunes} geometry={geos.hill} material={mat.white} colors={extra.duneColors} />
      <Boxes items={extra.rocks} material={mats.rock} colors={extra.rockColors} castShadow receiveShadow />

      <Shapes items={extra.trunks} geometry={trunkGeo} material={mat.white} colors={extra.trunkColors} />
      <Shapes items={extra.posts} geometry={geos.cyl} material={mat.white} colors={extra.postColors} />
      <Shapes items={extra.crowns} geometry={geos.cone} material={mat.white} colors={extra.crownColors} castShadow />
      <Shapes items={extra.cacti} geometry={geos.cyl} material={mat.white} colors={extra.cactusColors} />
      <Shapes items={extra.scrub} geometry={scrubGeo} material={mat.white} colors={extra.scrubColors} />

      <Boxes items={extra.stands} material={mats.concrete} colors={extra.standColors} castShadow receiveShadow />
      <Boxes items={extra.crowd} material={mat.white} colors={extra.crowdColors} />
      <Boxes items={extra.metal} material={mat.metal} colors={extra.metalColors} castShadow />
      <Boxes items={extra.solid} material={mat.solid} colors={extra.solidColors} castShadow />
      <Boxes items={extra.fronds} material={mat.solid} colors={extra.frondColors} />
      <Boxes items={extra.banners} material={mat.banner} colors={extra.bannerColors} />
      <Boxes items={extra.glow} material={mat.glow} colors={extra.glowColors} />
      <Boxes items={extra.floods} material={mat.flood} />

      <Shapes items={extra.arches} geometry={geos.arch} material={mat.arch} colors={extra.archColors} castShadow />
      <Shapes items={extra.balloons} geometry={geos.ball} material={mat.white} colors={extra.balloonColors} />
      <Shapes items={extra.clouds} geometry={geos.puff} material={mat.cloud} colors={extra.cloudColors} />
    </group>
  )
}
