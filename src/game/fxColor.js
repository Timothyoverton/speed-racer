import * as THREE from 'three'

// With the post-processing composer on, fog and sky are mixed in linear light
// and then tone-mapped along with everything else. The plain renderer mixes fog
// in AFTER tone mapping, so a fog colour comes out exactly as written. Run
// through ACES instead, a mid-blue fog turns minty and washes the picture out.
//
// So in the fx path the "display colours" (fog, background, sky gradient) are
// pushed backwards through the same ACES curve first, and come out of the
// composer as the colour the theme actually asked for.

// three.js's ACESFilmicToneMapping, matrices and all (they are column-major in
// GLSL; Matrix3.set takes rows)
const IN = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.0760, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777)
const OUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602)
const V = new THREE.Vector3()

function aces(rgb, exposure) {
  V.set(rgb[0], rgb[1], rgb[2]).multiplyScalar(exposure / 0.6).applyMatrix3(IN)
  const fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081)
  V.set(fit(V.x), fit(V.y), fit(V.z)).applyMatrix3(OUT)
  return [Math.min(1, Math.max(0, V.x)), Math.min(1, Math.max(0, V.y)), Math.min(1, Math.max(0, V.z))]
}

// The scene-linear colour that ACES maps to `target` (a THREE.Color or hex).
export function fxColor(target, exposure = 1) {
  const t = new THREE.Color(target)
  const goal = [t.r, t.g, t.b]
  let x = goal.slice()
  for (let i = 0; i < 80; i++) {
    const y = aces(x, exposure)
    let err = 0
    for (let k = 0; k < 3; k++) {
      const d = goal[k] - y[k]
      err = Math.max(err, Math.abs(d))
      x[k] = Math.max(0, x[k] + d * 0.8)
    }
    if (err < 1e-5) break
  }
  return new THREE.Color().setRGB(x[0], x[1], x[2])
}

// Fish Pond (and any theme that sets grade.tone = false) is built from custom
// shader materials whose colours are already the final picture: tone mapping
// them a second time washes them out. Those themes run the composer without a
// tone-mapping stage and need no compensation.
export function fxTones(theme) {
  return !theme.grade || theme.grade.tone !== false
}

// A display colour (fog, background, sky gradient) as the active path wants it
export function displayColor(hex, theme, fx) {
  return fx && fxTones(theme) ? fxColor(hex) : new THREE.Color(hex)
}
