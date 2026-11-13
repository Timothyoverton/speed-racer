import { useMemo, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom, ToneMapping, N8AO } from '@react-three/postprocessing'
import { Effect, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { UnsignedByteType } from 'three'
import { THEME } from '../game/themes.js'
import { carState } from '../game/carState.js'

// The grade: bloom on the things that should glow, ACES tone mapping, then a
// split-tone colour grade and a vignette. Always on.
//
// While this is mounted the composer takes over tone mapping from the renderer
// (it parks gl.toneMapping at None and puts it back on unmount). Everything is
// rendered linear into a half-float target and tone-mapped once, at the end, so
// the sky dome, the fog and the ground all go through the same curve and meet
// without the seam tricks the plain path needs (see SkyDome.jsx).

const FRAG = /* glsl */ `
  uniform vec3 uShadow;
  uniform vec3 uHigh;
  uniform float uSplit;
  uniform float uContrast;
  uniform float uSat;
  uniform float uVig;
  uniform float uVigPunch;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = max(inputColor.rgb, 0.0);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);

    // work in a perceptual space for the curve and the tints
    vec3 g = pow(c, vec3(1.0 / 2.2));
    float lg = dot(g, vec3(0.2126, 0.7152, 0.0722));
    g *= mix(vec3(1.0), uShadow, (1.0 - smoothstep(0.0, 0.55, lg)) * uSplit);
    g *= mix(vec3(1.0), uHigh, smoothstep(0.35, 1.0, lg) * uSplit);
    g = clamp(g, 0.0, 1.0);
    g = mix(g, g * g * (3.0 - 2.0 * g), uContrast);

    // vignette; the boost punch pulls the corners in a little further
    float d = distance(uv, vec2(0.5)) * 1.2;
    g *= 1.0 - (uVig + uVigPunch) * smoothstep(0.32, 0.95, d);

    outputColor = vec4(pow(g, vec3(2.2)), inputColor.a);
  }
`

// the tints are multipliers applied in the grade's own gamma space, so they are
// taken as written, not colour-managed into linear
const tint = (hex) => new THREE.Color().setHex(parseInt(hex.slice(1), 16), THREE.LinearSRGBColorSpace)

class GradeEffect extends Effect {
  constructor(p) {
    super('GradeEffect', FRAG, {
      uniforms: new Map([
        ['uShadow', new THREE.Uniform(tint(p.shadow))],
        ['uHigh', new THREE.Uniform(tint(p.high))],
        ['uSplit', new THREE.Uniform(p.split)],
        ['uContrast', new THREE.Uniform(p.contrast)],
        ['uSat', new THREE.Uniform(p.sat)],
        ['uVig', new THREE.Uniform(p.vignette)],
        ['uVigPunch', new THREE.Uniform(0)],
      ]),
    })
  }
}

// Defaults suit a bright day; a theme overrides any of it with `grade: {...}`.
// Tints are near-white multipliers: teal in the shadows, warm in the highlights.
const DEFAULT_GRADE = {
  shadow: '#d9f2f4',
  high: '#fff1dc',
  split: 0.18,
  contrast: 0.05,
  sat: 1.0,
  vignette: 0.16,
  bloom: { intensity: 0.4, threshold: 1.0, smoothing: 0.2, radius: 0.7 },
}

function gradeFor(theme) {
  const g = theme.grade || {}
  return { ...DEFAULT_GRADE, ...g, bloom: { ...DEFAULT_GRADE.bloom, ...(g.bloom || {}) } }
}

export default function PostFx() {
  const grade = useMemo(() => gradeFor(THEME), [])
  const effect = useMemo(() => new GradeEffect(grade), [grade])
  const bloomRef = useRef(null)
  useEffect(() => () => effect.dispose(), [effect])

  // boost: a touch more glow and a tighter frame while it burns
  const k = useRef(0)
  useFrame((_, dt) => {
    const on = carState.nos || carState.boost > 0 ? 1 : 0
    k.current += (on - k.current) * Math.min(1, dt * 6)
    effect.uniforms.get('uVigPunch').value = 0.16 * k.current
    if (bloomRef.current) bloomRef.current.intensity = grade.bloom.intensity * (1 + 0.6 * k.current)
  })

  return (
    <EffectComposer multisampling={4} enableNormalPass={false} frameBufferType={grade.tone === false ? UnsignedByteType : undefined}>
      {grade.ao ? <N8AO aoRadius={grade.ao.radius} intensity={grade.ao.intensity} distanceFalloff={1} quality="medium" halfRes /> : <></>}
      <Bloom
        ref={bloomRef}
        mipmapBlur
        intensity={grade.bloom.intensity}
        luminanceThreshold={grade.bloom.threshold}
        luminanceSmoothing={grade.bloom.smoothing}
        radius={grade.bloom.radius}
      />
      {grade.tone !== false ? <ToneMapping mode={ToneMappingMode.ACES_FILMIC} /> : <></>}
      <primitive object={effect} />
    </EffectComposer>
  )
}
