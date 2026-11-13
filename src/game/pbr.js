// Scanned surface sets (public/assets/tex, see CREDITS.md) and the mapping that
// lays them over this game's geometry.
//
// Almost everything here is a unit box stretched by an instance matrix, so a
// box's own 0..1 uvs stretch with it. Scanned textures can't hide that the way
// flat colours do, so they are projected in world space instead: one tile is the
// same size in metres on a kerb, a wall or a kilometre of road, and adjoining
// boxes share one continuous surface with no seam at each tile.
import * as THREE from 'three'

const loader = new THREE.TextureLoader()
const cache = {}

function tex(file, srgb) {
  const t = loader.load(import.meta.env.BASE_URL + 'assets/tex/' + file)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 16
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  return t
}

// Two naming schemes:
//   Poly Haven  - {name}_diff / _nor_gl / _arm, where arm packs occlusion,
//                 roughness and metalness into r, g and b (the channels three.js
//                 reads each of them from, so one texture serves all three)
//   ambientCG   - {name}_1K-JPG_Color / _NormalGL / _Roughness, no occlusion
export function pbrSet(name, source = 'polyhaven') {
  if (!cache[name]) {
    cache[name] =
      source === 'ambientcg'
        ? {
            map: tex(`${name}_1K-JPG_Color.jpg`, true),
            normalMap: tex(`${name}_1K-JPG_NormalGL.jpg`, false),
            roughnessMap: tex(`${name}_1K-JPG_Roughness.jpg`, false),
            aoMap: null,
          }
        : (() => {
            const arm = tex(`${name}_arm_1k.jpg`, false)
            return { map: tex(`${name}_diff_1k.jpg`, true), normalMap: tex(`${name}_nor_gl_1k.jpg`, false), roughnessMap: arm, aoMap: arm }
          })()
  }
  return cache[name]
}

// A MeshStandardMaterial dressed with a scanned set, projected in world space.
//   tile  - metres covered by one repeat of the texture
//   macro - 0..1: how strongly a second, much larger sample of the same texture
//           breaks up the repeat (open ground needs it, a wall does not)
//   mean  - the scan's average brightness (0..1), so the patches centre on 1
//   tint, gain - multiply the scanned colour; gain may exceed 1
export function scannedMaterial(name, { source, tile = 3, macro = 0, mean = 0.3, tint = '#ffffff', gain = 1, normalScale = 1, roughness = 1, envMapIntensity = 1 } = {}) {
  const s = pbrSet(name, source)
  const mat = new THREE.MeshStandardMaterial({
    map: s.map,
    normalMap: s.normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: s.roughnessMap,
    aoMap: s.aoMap,
    color: new THREE.Color(tint).multiplyScalar(gain),
    roughness,
    metalness: 0,
    envMapIntensity,
  })
  const k = (1 / tile).toFixed(5)
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          wn = mat3(instanceMatrix) * wn;
        #endif
        wp = modelMatrix * wp;
        wn = abs(normalize(mat3(modelMatrix) * wn));
        vec2 wuv = wn.y >= wn.x && wn.y >= wn.z ? wp.xz : (wn.x >= wn.z ? wp.zy : wp.xy);
        wuv *= ${k};
        #ifdef USE_MAP
          vMapUv = wuv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = wuv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = wuv;
        #endif
        #ifdef USE_AOMAP
          vAoMapUv = wuv;
        #endif
      }`,
    )
    if (macro > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // the same scan seen from much further away, as light and dark patches
          vec3 far = texture2D(map, vMapUv * 0.043 + 0.31).rgb;
          vec3 mid = texture2D(map, vMapUv * 0.19 + 0.67).rgb;
          float v = (dot(far, vec3(0.2)) + dot(mid, vec3(0.1333))) / ${mean.toFixed(3)};
          diffuseColor.rgb *= mix(1.0, clamp(v, 0.6, 1.45), ${macro.toFixed(3)});
        }`,
      )
    }
  }
  mat.customProgramCacheKey = () => `scanned:${name}:${k}:${macro}`
  return mat
}
