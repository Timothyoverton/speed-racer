// "Race a robot": a real Playwright browser that joins a hosted multiplayer
// room as a second player and drives it with tools/autopilot.js over the
// REAL render loop — the same trick tests/multiplayer.spec.js already proves
// works end-to-end (lobby, synced countdown, live opponent, result). Nothing
// about the relay or the game's multiplayer code needs to know the second
// player isn't human; it just looks like a guest who joined via the deep
// link (?join=CODE&track=ID) and never touches the keyboard except through
// the autopilot's input.axis.
//
// Usage:
//   node tools/robot-player.js <roomCode> [trackId] [--url=http://host:port] [--difficulty=easy|normal|hard] [--headless]
//
// Dev-only tool (like tools/autopilot.js and tests/). Not imported by the
// game, not shipped in the build.

import { chromium } from 'playwright'

const DIFFICULTY = {
  // Multiplies the autopilot's own top-speed sense — see speedCap below.
  // Everything else (line-following, braking for corners) stays identical;
  // an "easy" robot is a slower robot, not a worse driver, so it still looks
  // like a real opponent on screen instead of weaving.
  easy: 0.82,
  normal: 1.0,
  hard: 1.12,
}

function parseArgs(argv) {
  const pos = []
  const opts = {}
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      opts[k] = v ?? true
    } else pos.push(a)
  }
  return { pos, opts }
}

async function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2))
  const roomCode = pos[0]
  if (!roomCode) {
    console.error('usage: node tools/robot-player.js <roomCode> [trackId] [--url=...] [--difficulty=normal] [--headless]')
    process.exit(1)
  }
  const trackId = pos[1] || 'test-pad-0'
  const baseUrl = opts.url || process.env.ROBOT_URL || 'http://localhost:5173'
  const difficulty = String(opts.difficulty || 'normal').toLowerCase()
  const speedMul = DIFFICULTY[difficulty] ?? DIFFICULTY.normal
  // Headed by default, like the rest of this repo's Playwright tooling
  // (tests/README.md) — headless Chromium falls back to swiftshader software
  // WebGL, which pegs a CPU core and runs three.js/Rapier's real-time loop
  // far slower than wall clock, so the "robot" never finishes a lap. Headed
  // needs a display; DISPLAY=:0 is the convention here.
  const headless = !!opts.headless

  console.log(`[robot] joining room ${roomCode} on ${trackId} @ ${baseUrl} (difficulty=${difficulty})`)

  const browser = await chromium.launch({ headless })
  const page = await browser.newPage()

  try {
    await page.addInitScript(
      ([nm, trk]) => {
        try {
          localStorage.setItem('speed-racer:name', nm)
          localStorage.setItem('speed-racer:track', trk)
          localStorage.setItem('speed-racer:touch-mode', 'off')
        } catch {
          /* ignore */
        }
      },
      ['Robot', trackId],
    )

    await page.goto(`${baseUrl}/?join=${encodeURIComponent(roomCode)}&track=${encodeURIComponent(trackId)}`)
    await page.waitForFunction(() => window.__net?.session?.roster?.length === 2, null, { timeout: 30_000 })
    console.log('[robot] joined lobby, both players present')

    await page.getByRole('button', { name: /ready/i }).click()
    await page.waitForFunction(() => window.__dbg?.phase === 'racing', null, { timeout: 30_000 })
    console.log('[robot] racing')

    // Load the autopilot and prime it against this track.
    const src = (await import('node:fs')).readFileSync(
      new URL('./autopilot.js', import.meta.url),
      'utf8',
    ).replace(/^export\s+/gm, '')
    await page.addScriptTag({ content: src })
    await page.waitForFunction(() => !!window.__AP)
    await page.evaluate(() => window.__AP.install())

    // Drive the real render loop, throttled by speedMul so difficulty reads
    // as "a slower/faster robot" rather than a differently-skilled one.
    await page.evaluate((mul) => {
      const AP = window.__AP
      AP._stop = false
      const MAX_SPEED_KMH = 62 * 3.6 // Car.jsx MAX_SPEED, m/s -> km/h
      const cap = MAX_SPEED_KMH * mul
      const tick = () => {
        if (AP._stop) return
        if (window.__dbg?.phase === 'racing') {
          try {
            AP.control(AP.DEFAULTS)
            const inp = window.__input
            const kmh = (window.__hud?.speedKmh) || 0
            if (mul < 1 && kmh > cap) inp.forward = false
          } catch {
            /* a frame where globals aren't ready yet */
          }
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, speedMul)

    await page.waitForFunction(
      () => window.__dbg?.phase === 'finished' || window.__dbg?.phase === 'menu',
      null,
      { timeout: 200_000, polling: 250 },
    )
    const timeMs = await page.evaluate(() => window.__hud?.timeMs ?? null)
    console.log(`[robot] finished — lap time ${timeMs != null ? (timeMs / 1000).toFixed(3) + 's' : '?'}`)

    // Stay connected a bit so the human sees the result screen populate
    // (relay needs both sides' finish to render the head-to-head).
    await page.waitForTimeout(4000)
  } catch (err) {
    console.error('[robot] error:', err)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
