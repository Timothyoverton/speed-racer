// One look per circuit. The active track is chosen once at load (see track.js),
// so this is a plain object the scene reads — nothing here changes per frame.
//
// The sky's horizon colour and the fog colour are the same string on purpose:
// a distant hill has to fade into the sky behind it, and two near-matches still
// leave a seam.
import { TRACK } from './track.js'

const LEAF = ['#2c5a33', '#356b3a', '#24512e', '#3d7442', '#2a6340', '#1f4a2b', '#437a46']
const HILL_NEAR = ['#3f5a55', '#47635c', '#38534f', '#4e6b62', '#334d4a']
const HILL_FAR = ['#5f7887', '#687f92', '#57707f', '#71879a']
const SCRUB = ['#3c5f34', '#456b3b', '#33512c', '#4d7340']
const BARK = ['#4a3a2c', '#5c4632', '#3b2e22', '#6a5140', '#2e261c']

// Test Pad keeps the original afternoon: these are the hard-coded values Scene
// and SkyDome used when every circuit shared one look.
const TEST_SUN = [-0.55, 0.32, 0.77]

export const THEMES = {
  // Proving ground. Same light as before, so the default circuit doesn't shift,
  // with the forest pulled back enough to read as an open pad.
  'test-pad-0': {
    sky: { zenith: '#2f6fbe', horizon: '#cddff0', sun: '#ffdca6', warm: 1, glow: 1, stars: 0 },
    sun: { dir: TEST_SUN, color: '#fff2dc', intensity: 2.6, disc: '#fff8e6', discSize: 13 },
    fog: { color: '#cddff0', near: 620, far: 2200 },
    hemi: { sky: '#cfe0ff', ground: '#37402f', intensity: 0.55 },
    env: {
      sky: '#9dbde2',
      ground: '#4d6a45',
      groundIntensity: 0.5,
      sun: '#fff0d0',
      sunIntensity: 9,
      strip: '#ffffff',
      stripIntensity: 2.6,
      fill: '#cfe2ff',
      fillIntensity: 1.4,
    },
    exposure: 1.04,
    ground: { kind: 'grass', color: '#ffffff' },
    scenery: {
      forest: { count: 900, clear: 26, reach: 280, snow: 0, palette: LEAF, bark: BARK },
      scrub: { count: 160, clear: 14, minOff: 14, maxOff: 120, palette: SCRUB },
      hills: {
        near: { count: 30, min: 600, span: 240, sink: 10, h0: 0.2, h1: 0.16, palette: HILL_NEAR },
        far: { count: 22, min: 1000, span: 420, sink: 24, h0: 0.24, h1: 0.2, palette: HILL_FAR },
      },
      clouds: { count: 20, opacity: 0.32, emissive: '#c9dcf2', emissiveIntensity: 0.25 },
      stands: { mode: 'bounds' },
      masts: { count: 8 },
      sheds: { count: 5, palette: ['#d5dbe3', '#c3cad4', '#e4e0d4', '#b7c3b8', '#cfd6df'] },
    },
  },

  // Open, fast, coastal. High sun, pale sand, a sea ringing the land, and a few
  // wind-bent palms instead of a forest.
  'long-ribbon-1': {
    sky: { zenith: '#3e8fe2', horizon: '#d4eef8', sun: '#fff6dc', warm: 0.35, glow: 1, stars: 0 },
    sun: { dir: [-0.22, 0.8, 0.56], color: '#fff8ec', intensity: 2.55, disc: '#fffdf4', discSize: 12 },
    fog: { color: '#d4eef8', near: 780, far: 2400 },
    hemi: { sky: '#e5f5ff', ground: '#3d6e68', intensity: 0.62 },
    env: {
      sky: '#b7daf2',
      ground: '#3f7a72',
      groundIntensity: 0.45,
      sun: '#fff6e0',
      sunIntensity: 8,
      strip: '#f4fbff',
      stripIntensity: 2.4,
      fill: '#d7eeff',
      fillIntensity: 1.6,
    },
    exposure: 1.05,
    ground: { kind: 'sand', color: '#d8c690' },
    scenery: {
      sea: { inner: 70, color: '#2f93cc', shallow: '#78cfd6' },
      forest: {
        count: 150,
        clear: 18,
        band: [16, 120],
        snow: 0,
        palm: true,
        palette: ['#1f8a4a', '#27a05a', '#146b38', '#3cb56a', '#0f6a40', '#54c07a'],
        bark: ['#8a6a42', '#a07c4e', '#6e5434', '#b89060', '#5c482c'],
      },
      scrub: {
        count: 220,
        clear: 10,
        minOff: 10,
        maxOff: 70,
        palette: ['#c8bb6a', '#a7b45a', '#d8cc80', '#8ea352', '#bfae5c'],
      },
      dunes: {
        count: 90,
        minOff: 16,
        maxOff: 200,
        palette: ['#e6d2a4', '#f0e0b8', '#d4c08a', '#cbb888', '#f4e8c8', '#d8c49a'],
      },
      hills: {
        far: { count: 10, min: 1300, span: 400, sink: 40, h0: 0.12, h1: 0.08, palette: ['#9ebcc8', '#a9c6d0', '#8eb0bc', '#b7d0da'] },
      },
      clouds: { count: 26, opacity: 0.4, emissive: '#e7f4ff', emissiveIntensity: 0.3 },
    },
  },

  // Qiddiya: sandstone, a low golden sun, and a dry haze that eats the mesas.
  'qiddiya-rush-2': {
    sky: { zenith: '#3d6fbe', horizon: '#e4c49a', sun: '#ffb15a', warm: 0.7, glow: 1, stars: 0 },
    sun: { dir: [0.86, 0.18, 0.47], color: '#ffc27a', intensity: 2.5, disc: '#ffe0a8', discSize: 15 },
    fog: { color: '#e4c49a', near: 280, far: 1500 },
    hemi: { sky: '#ffd7a8', ground: '#8a5a32', intensity: 0.5 },
    env: {
      sky: '#e7c49a',
      ground: '#a86b3a',
      groundIntensity: 0.55,
      sun: '#ffb060',
      sunIntensity: 10,
      strip: '#ffe6c4',
      stripIntensity: 2.2,
      fill: '#f0d2a4',
      fillIntensity: 1.3,
    },
    exposure: 1.06,
    ground: { kind: 'sand', color: '#d2b074' },
    scenery: {
      scrub: {
        count: 200,
        clear: 9,
        minOff: 9,
        maxOff: 80,
        palette: ['#6d6a38', '#7d7444', '#5a5c30', '#8a7c48', '#4e542c', '#948456'],
      },
      cacti: { count: 150, minOff: 8, maxOff: 60 },
      mesas: {
        count: 34,
        minOff: 36,
        maxOff: 260,
        palette: ['#c4885a', '#a86c44', '#d4a06e', '#8d5a38', '#b07848', '#e0b484', '#7a4e34'],
        caps: ['#e4c8a0', '#c9a078', '#f0d8b4', '#b88860', '#d8b890'],
      },
      spires: {
        count: 18,
        minOff: 28,
        maxOff: 180,
        palette: ['#a86848', '#8a5438', '#c48460', '#6e4030', '#b07050'],
      },
      dunes: {
        count: 80,
        minOff: 12,
        maxOff: 140,
        palette: ['#e6c98a', '#f0d7a4', '#d4b56e', '#c9a25c', '#f4e2b8', '#deb86e'],
      },
      hills: {
        far: {
          count: 20,
          min: 900,
          span: 500,
          sink: 30,
          h0: 0.22,
          h1: 0.16,
          palette: ['#c4a07a', '#b89070', '#d4b48c', '#a88868'],
        },
      },
      clouds: { count: 8, opacity: 0.18, emissive: '#f0ddc0', emissiveIntensity: 0.15 },
    },
  },

  // High alpine. Cool, bright, thin haze so the peaks stay readable a long way out.
  'freefall-3': {
    sky: { zenith: '#79b4f0', horizon: '#d7e6f4', sun: '#f7fbff', warm: 0.15, glow: 1, stars: 0 },
    sun: { dir: [-0.32, 0.78, 0.54], color: '#f4f8ff', intensity: 2.35, disc: '#ffffff', discSize: 12 },
    fog: { color: '#d7e6f4', near: 880, far: 2400 },
    hemi: { sky: '#eaf3ff', ground: '#c5d2e0', intensity: 0.66 },
    env: {
      sky: '#c5dff5',
      ground: '#d5e0ea',
      groundIntensity: 0.4,
      sun: '#ffffff',
      sunIntensity: 7,
      strip: '#f5f9ff',
      stripIntensity: 2.2,
      fill: '#e4f0ff',
      fillIntensity: 1.7,
    },
    exposure: 1.05,
    ground: { kind: 'snow', color: '#e3ebf3' },
    scenery: {
      forest: {
        count: 850,
        clear: 18,
        band: [16, 110],
        snow: 1,
        palette: ['#1c3c28', '#244832', '#163224', '#2c5438', '#1a3828'],
        snowPalette: ['#f4f7fb', '#e4eaf2', '#f7f8f6', '#d5dee8', '#eef3ea'],
        bark: ['#4a4038', '#5c5148', '#3a332e', '#6a5c50'],
      },
      scrub: {
        count: 180,
        clear: 12,
        minOff: 12,
        maxOff: 90,
        palette: ['#d5ddd4', '#c5d0c8', '#e4ebe4', '#b7c4bc', '#9aada4'],
      },
      peaks: {
        count: 28,
        minOff: 70,
        maxOff: 420,
        rock: ['#4e5c6a', '#3d4c5c', '#5c6c7c', '#2f3e4e', '#647484'],
        snow: ['#f7f9fb', '#e8eef4', '#ffffff', '#dfe7f0'],
      },
      massifs: {
        near: {
          count: 14,
          min: 380,
          span: 420,
          size: [260, 220],
          rock: ['#4f6178', '#44566e', '#5a6c82', '#3c4e66'],
          snow: ['#f7f9fc', '#e9eff6', '#ffffff'],
        },
        far: {
          count: 16,
          min: 950,
          span: 600,
          size: [420, 380],
          rock: ['#8499b3', '#7a90ab', '#90a4bb', '#6f86a2'],
          snow: ['#f4f8fc', '#e6eef7', '#ffffff'],
        },
      },
      clouds: { count: 18, opacity: 0.42, emissive: '#f4f8ff', emissiveIntensity: 0.35 },
    },
  },

  // Theme park at the end of the afternoon: banners, towers, inflatable arches.
  'stunt-park-4': {
    sky: { zenith: '#3d6ed2', horizon: '#f0c7a4', sun: '#ffb060', warm: 1, glow: 1, stars: 0 },
    sun: { dir: [-0.64, 0.26, 0.72], color: '#ffd0a0', intensity: 2.75, disc: '#ffe6c0', discSize: 14 },
    fog: { color: '#f0c7a4', near: 520, far: 2000 },
    hemi: { sky: '#ffe0c2', ground: '#3e4a32', intensity: 0.58 },
    env: {
      sky: '#f0c8a0',
      ground: '#4e6a40',
      groundIntensity: 0.5,
      sun: '#ffb060',
      sunIntensity: 10,
      strip: '#fff2e0',
      stripIntensity: 2.8,
      fill: '#ffd8b0',
      fillIntensity: 1.5,
    },
    exposure: 1.06,
    ground: { kind: 'grass', color: '#d5eea8' },
    scenery: {
      scrub: {
        count: 140,
        clear: 10,
        minOff: 10,
        maxOff: 50,
        round: true,
        palette: ['#3aaa4a', '#f0c400', '#2f8fd4', '#e05070', '#7dcb4a', '#ff8a3a'],
      },
      hills: {
        near: { count: 14, min: 650, span: 180, sink: 12, h0: 0.12, h1: 0.08, palette: ['#6d8a58', '#5e7a62', '#7e9460', '#88a070'] },
        far: { count: 16, min: 1000, span: 360, sink: 22, h0: 0.16, h1: 0.1, palette: ['#e4c2a4', '#d8b898', '#efd0b4', '#c9aa90'] },
      },
      clouds: { count: 16, opacity: 0.34, emissive: '#ffe6d0', emissiveIntensity: 0.28 },
      stands: { mode: 'track', count: 6 },
      flags: {
        every: 4,
        off: 8,
        palette: ['#e23b4a', '#f0c400', '#2f9bff', '#23c07a', '#ff7a1a', '#c86bff', '#ffffff', '#14304a'],
      },
      towers: {
        every: 22,
        off: 16,
        palette: ['#ffe38a', '#9ad8ff', '#ffb0c4', '#ffffff', '#ffd0a0'],
      },
      arches: {
        every: 28,
        off: 15,
        palette: ['#ff4d6d', '#ffd23a', '#3ec6ff', '#7dff6b', '#ff8a3d', '#c86bff'],
      },
      balloons: {
        count: 36,
        minOff: 12,
        maxOff: 70,
        palette: ['#ff5a6a', '#ffd23a', '#4ec3ff', '#b388ff', '#7dff6b', '#ff9a3c', '#ffffff'],
      },
    },
  },

  // Night industrial. The moon is bright enough that the asphalt stays readable;
  // the sky itself stays dark, with stars in the dome rather than a second mesh.
  'mission-impossible-5': {
    sky: { zenith: '#070b18', horizon: '#1a2236', sun: '#d5def8', warm: 0, glow: 0.42, stars: 1, tone: true },
    sun: { dir: [-0.4, 0.82, 0.42], color: '#d0dcff', intensity: 2.25, disc: '#eef3ff', discSize: 8 },
    fog: { color: '#1a2236', near: 260, far: 1500 },
    hemi: { sky: '#2a3658', ground: '#141820', intensity: 0.42 },
    env: {
      sky: '#12182c',
      ground: '#1a1e28',
      groundIntensity: 0.2,
      sun: '#c9d6ff',
      sunIntensity: 3.2,
      strip: '#8aa0c8',
      stripIntensity: 0.55,
      fill: '#1c2744',
      fillIntensity: 0.35,
    },
    exposure: 1.12,
    ground: { kind: 'night', color: '#2a3142' },
    scenery: {
      skyline: {
        count: 60,
        min: 120,
        span: 600,
        palette: ['#1c2232', '#232a3c', '#171c2a', '#2a3248', '#1f2638'],
        windows: ['#ffd98a', '#9ad4ff', '#ff8ac4', '#fff4d0', '#7dffe0', '#c4b0ff'],
      },
      blocks: {
        count: 48,
        minOff: 22,
        maxOff: 110,
        palette: ['#2a303c', '#343b4a', '#232830', '#3a4254', '#1e242e', '#404858'],
      },
      lamps: {
        every: 3,
        off: 6.5,
        sides: 2,
        palette: ['#fff1c4', '#ffd98a', '#fff8e0', '#ffe0a0'],
      },
      neon: {
        every: 2,
        off: 5.2,
        sides: 2,
        palette: ['#25e6ff', '#ff3d8a', '#7d5cff', '#39ffb0', '#ffb020', '#ff4d4d'],
      },
    },
  },

  // The bottom of an aquarium. Teal water overhead, pale sand underfoot, and the
  // seabed furniture: coral, kelp, rock stacks, a sunken castle, a chest with a
  // gold lid. Fish and bubbles come from the `fish` spec (FishSchool.jsx).
  'fish-pond-7': {
    sky: { zenith: '#2f9fc4', horizon: '#3aa7bd', sun: '#f2ffff', warm: 0.1, glow: 0.7, stars: 0 },
    sun: { dir: [-0.1, 0.9, 0.4], color: '#fffbea', intensity: 2.3, disc: '#f7ffff', discSize: 11 },
    fog: { color: '#3aa7bd', near: 60, far: 650 },
    hemi: { sky: '#bdf3f5', ground: '#2e6f70', intensity: 0.6 },
    env: {
      sky: '#7fd4dc',
      ground: '#3b8f93',
      groundIntensity: 0.5,
      sun: '#fff8e0',
      sunIntensity: 7,
      strip: '#e6fdff',
      stripIntensity: 1.8,
      fill: '#c5f5f8',
      fillIntensity: 1.5,
    },
    exposure: 1.05,
    ground: { kind: 'sand', color: '#d8c9a0' },
    scenery: {
      dunes: {
        count: 70,
        minOff: 14,
        maxOff: 150,
        palette: ['#e6d3a6', '#f0e2bc', '#d9c28e', '#cbb27e', '#f4e8c8'],
      },
      mesas: {
        count: 14,
        minOff: 30,
        maxOff: 170,
        palette: ['#7d8a8c', '#8f9a98', '#6e7b7e', '#a09b8c', '#5f6e70'],
        caps: ['#b8c2bf', '#a4b0ad', '#c9cfc9', '#8e9a92', '#aab5b0'],
      },
      spires: {
        count: 20,
        minOff: 22,
        maxOff: 150,
        palette: ['#8b8f8a', '#9aa096', '#7a817e', '#b0a890', '#6f7a78'],
      },
      scrub: {
        count: 120,
        clear: 8,
        minOff: 8,
        maxOff: 60,
        round: true,
        palette: ['#ff6f91', '#ff9a6b', '#c77dff', '#ff7aa2', '#ffb347', '#e05d9a', '#8ee3d4'],
      },
      coral: {
        count: 110,
        minOff: 8,
        maxOff: 70,
        palette: ['#ff6f7a', '#ff8c5a', '#e0609c', '#b98cff', '#ff9f6b', '#f7a1c4'],
      },
      kelp: {
        count: 80,
        minOff: 12,
        maxOff: 130,
        hMin: 9,
        hMax: 22,
        palette: ['#4f7a2e', '#5f8a36', '#3d6b2a', '#6b8f3a', '#7a9a44', '#2f5e34'],
      },
      castles: {
        count: 2,
        minOff: 45,
        maxOff: 150,
        palette: ['#e2c7a8', '#d3b9a0', '#c2b7b0', '#e6d8c0'],
        roofs: ['#2f6f8a', '#8a3d4a', '#3d5a80'],
      },
      chests: { count: 4, minOff: 9, maxOff: 40 },
      wrecks: { count: 2, minOff: 40, maxOff: 160 },
      clouds: { count: 10, opacity: 0.16, emissive: '#c8fbff', emissiveIntensity: 0.4 },
    },
    fish: {
      schools: 16,
      darters: 8,
      big: 3,
      palette: ['#ff8a2a', '#ff6b3d', '#2f7fd8', '#4fc3f7', '#ffd23a', '#ffffff', '#f2f2f2', '#ff4d6d'],
      bigPalette: ['#5b7a8c', '#6d8f7a', '#7f7f8f'],
      bubbles: { columns: 18, perColumn: 6, minOff: 3, maxOff: 21, height: 40 },
    },
  },
}

for (const id in THEMES) {
  const t = THEMES[id]
  if (t.sky.horizon !== t.fog.color) throw new Error(`${id}: sky horizon must equal fog colour`)
}

export const THEME = THEMES[TRACK.id] || THEMES['test-pad-0']
