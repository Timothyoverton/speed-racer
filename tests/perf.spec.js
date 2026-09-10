import { test, expect } from '@playwright/test'
import { startSolo, injectAutopilot, readHud } from './helpers.js'

// Sample requestAnimationFrame deltas for `ms` and return frame-time stats.
async function sampleFrames(page, ms = 3000) {
  return page.evaluate((dur) => {
    return new Promise((resolve) => {
      const deltas = []
      let last = performance.now()
      const stop = last + dur
      const tick = (now) => {
        deltas.push(now - last)
        last = now
        if (now < stop) requestAnimationFrame(tick)
        else {
          deltas.sort((a, b) => a - b)
          const q = (p) => deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))]
          resolve({
            frames: deltas.length,
            fps: Math.round(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)),
            mean: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1),
            p50: +q(0.5).toFixed(1),
            p95: +q(0.95).toFixed(1),
            p99: +q(0.99).toFixed(1),
            longFrames: deltas.filter((d) => d > 20).length,
          })
        }
      }
      requestAnimationFrame(tick)
    })
  }, ms)
}

test('single-player frame times on the heaviest track', async ({ page }) => {
  await startSolo(page, 'mission-impossible-5')
  await injectAutopilot(page)
  await page.evaluate(() => {
    const AP = window.__AP
    AP._stop = false
    const tick = () => {
      if (AP._stop) return
      if (window.__dbg?.phase === 'racing') {
        try {
          AP.control(AP.DEFAULTS)
        } catch {
          /* not ready */
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  await page.waitForTimeout(4000) // let it get up to speed and into the scenery
  const stats = await sampleFrames(page, 4000)
  await page.evaluate(() => {
    window.__AP._stop = true
  })

  const hud = await readHud(page)
  console.log('perf single:', JSON.stringify(stats), 'speed', Math.round(hud.speedKmh))
  test.info().annotations.push({ type: 'perf-single', description: JSON.stringify(stats) })

  // Soft gate. The machine and GL backend vary; this only catches a
  // catastrophic regression, not a few-ms drift. Tighten once there is a
  // baseline from Tim's box with real GPU.
  expect(stats.p50, `p50 frame time (${stats.p50}ms, ~${stats.fps}fps)`).toBeLessThan(45)
})

test('side-by-side: two instances driving at once', async ({ browser }) => {
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 720 } })
    const page = await ctx.newPage()
    await startSolo(page, 'stunt-park-4')
    await injectAutopilot(page)
    await page.evaluate(() => {
      const AP = window.__AP
      AP._stop = false
      const tick = () => {
        if (AP._stop) return
        if (window.__dbg?.phase === 'racing') {
          try {
            AP.control(AP.DEFAULTS)
          } catch {
            /* not ready */
          }
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    return { ctx, page }
  }

  const a = await mk()
  const b = await mk()
  await a.page.waitForTimeout(3000)

  const [sa, sb] = await Promise.all([sampleFrames(a.page, 3500), sampleFrames(b.page, 3500)])
  await Promise.all([
    a.page.evaluate(() => (window.__AP._stop = true)),
    b.page.evaluate(() => (window.__AP._stop = true)),
  ])
  console.log('perf sideBySide A:', JSON.stringify(sa))
  console.log('perf sideBySide B:', JSON.stringify(sb))
  test.info().annotations.push({
    type: 'perf-side-by-side',
    description: `A ${JSON.stringify(sa)} | B ${JSON.stringify(sb)}`,
  })

  await a.ctx.close()
  await b.ctx.close()

  // Both windows must still be interactive — this is the "jerky when two tabs"
  // case Tim reported. Very loose bound; the value in the log is what matters.
  expect(Math.max(sa.p50, sb.p50), 'worst p50 across the two windows').toBeLessThan(80)
})
