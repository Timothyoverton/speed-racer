// args: in.hdr out.raw ; prints sun direction + stats; writes upper-hemisphere 8-bit encoded RGB
import fs from 'node:fs'
import { RGBELoader } from '../../node_modules/three/examples/jsm/loaders/RGBELoader.js'
import * as THREE from '../../node_modules/three/build/three.module.js'
const [inp, out] = process.argv.slice(2)
const buf = fs.readFileSync(inp)
const l = new RGBELoader(); l.setDataType(THREE.FloatType)
const t = l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const { width: W, height: H, data } = t
const ch = data.length / (W * H)
let best = 0, bx = 0, by = 0, sum = [0,0,0], n = 0
// sun = luminance-weighted centroid of the very brightest pixels
let wx=0, wy=0, wz=0
for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * ch
  const L = 0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]
  if (L > best) { best = L; bx = x; by = y }
}
for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * ch
  const L = 0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]
  const th = (y + 0.5) / H * Math.PI, ph = (x + 0.5) / W * 2 * Math.PI
  if (L > best * 0.25) { wx += L*Math.sin(th)*Math.cos(ph); wy += L*Math.cos(th); wz += L*Math.sin(th)*Math.sin(ph) }
  if (L < 20) { sum[0]+=data[i]*Math.sin(th); sum[1]+=data[i+1]*Math.sin(th); sum[2]+=data[i+2]*Math.sin(th); n+=Math.sin(th) }
}
const len = Math.hypot(wx,wy,wz)
// horizon band average (last 3% above horizon)
let hz=[0,0,0], hn=0
for (let y = Math.floor(H*0.47); y < H/2; y++) for (let x = 0; x < W; x++) { const i=(y*W+x)*ch; hz[0]+=data[i];hz[1]+=data[i+1];hz[2]+=data[i+2];hn++ }
console.log(JSON.stringify({ W, H, ch, peak: best, peakUV: [bx / W, by / H], sunDirEquirect: [wx/len, wy/len, wz/len], skyMean: sum.map(v=>v/n), horizon: hz.map(v=>v/hn) }))
if (out) {
  const M = 8, h2 = H / 2, o = Buffer.alloc(W * h2 * 3)
  for (let p = 0; p < W * h2; p++) for (let k = 0; k < 3; k++) o[p*3+k] = Math.round(255 * Math.pow(Math.min(1, Math.max(0, data[p*ch+k] / M)), 1 / 2.2))
  fs.writeFileSync(out, o)
}
