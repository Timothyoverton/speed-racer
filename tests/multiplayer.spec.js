import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { test, expect } from '@playwright/test'
import { gotoMenu, injectAutopilot, autopilotToFinish, driveLoop } from './helpers.js'

// Multiplayer needs a relay. In a DEV build net-config.js hard-wires the client
// to 127.0.0.1:1999 (local `partykit dev`), which cannot run in this sandbox
// (workerd gets SIGTERM'd). So this spec runs its OWN Vite server on a separate
// port with VITE_PARTYKIT_HOST pointed at the DEPLOYED relay
// (speed-racer.timothyoverton.partykit.dev), which is always up. The shared
// webServer from playwright.config.js is left alone.
//
// If the relay is unreachable the lobby never fills; the test fails on the
// "two players" wait rather than hanging.

const MP_PORT = 5273
const MP_URL = `http://localhost:${MP_PORT}`
const RELAY_HOST = 'speed-racer.timothyoverton.partykit.dev'

let viteProc

test.beforeAll(async () => {
  viteProc = spawn(
    './node_modules/.bin/vite',
    ['--port', String(MP_PORT), '--strictPort'],
    { env: { ...process.env, VITE_PARTYKIT_HOST: RELAY_HOST }, stdio: 'ignore' },
  )
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      const r = await fetch(MP_URL + '/')
      if (r.ok) break
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('mp vite server did not start')
    await sleep(300)
  }
})

test.afterAll(() => {
  viteProc?.kill('SIGTERM')
})

test.use({ baseURL: MP_URL })

test('two players: lobby, synced start, live opponent, result, rematch', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()

  // --- Alice hosts -------------------------------------------------------
  await gotoMenu(alice, { trackId: 'test-pad-0', name: 'Alice' })
  await alice.getByRole('button', { name: /Race a friend/ }).click()
  await expect(alice.locator('.mp-code')).toBeVisible()
  const code = (await alice.locator('.mp-code').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{4}$/)

  // --- Bob joins via the deep link ------------------------------------
  await bob.addInitScript(
    (nm) => {
      try {
        localStorage.setItem('speed-racer:name', nm)
        localStorage.setItem('speed-racer:track', 'test-pad-0')
        localStorage.setItem('speed-racer:touch-mode', 'off')
      } catch {
        /* ignore */
      }
    },
    'Bob',
  )
  await bob.goto(`/?join=${code}&track=test-pad-0`)

  // both sides see two players in the roster
  for (const p of [alice, bob]) {
    await p.waitForFunction(() => window.__net?.session?.roster?.length === 2, null, {
      timeout: 20_000,
    })
  }

  // --- both ready -> synced countdown -> racing --------------------------
  await alice.getByRole('button', { name: /ready/i }).click()
  await bob.getByRole('button', { name: /ready/i }).click()

  for (const p of [alice, bob]) {
    await p.waitForFunction(() => window.__dbg?.phase === 'racing', null, { timeout: 25_000 })
  }

  // timers started together (countdown is paced off one shared timestamp)
  const [ta, tb] = await Promise.all([
    alice.evaluate(() => window.__hud.timeMs),
    bob.evaluate(() => window.__hud.timeMs),
  ])
  expect(Math.abs(ta - tb), `race clocks agree (Alice ${ta}ms, Bob ${tb}ms)`).toBeLessThan(600)

  // --- Alice drives; Bob should see her car move -----------------------
  await alice.keyboard.down('ArrowUp')
  await bob.waitForFunction(() => !!window.__net?.netState?.opp?.p, null, { timeout: 15_000 })
  const opp1 = await bob.evaluate(() => [...window.__net.netState.opp.p])
  await bob.waitForTimeout(1500)
  const opp2 = await bob.evaluate(() => [...window.__net.netState.opp.p])
  await alice.keyboard.up('ArrowUp')

  const moved = Math.hypot(opp2[0] - opp1[0], opp2[2] - opp1[2])
  expect(moved, 'opponent car position advanced on Bob').toBeGreaterThan(2)

  // gap HUD is populated on at least one side
  await expect
    .poll(async () => (await bob.locator('.opp-gap').innerText()).trim().length, { timeout: 10_000 })
    .toBeGreaterThan(0)

  // --- both finish -> head-to-head result -----------------------------
  await Promise.all([injectAutopilot(alice), injectAutopilot(bob)])
  await Promise.all([alice.evaluate(driveLoop), bob.evaluate(driveLoop)])
  await Promise.all([
    autopilotToFinish(alice, { timeoutMs: 90_000 }),
    autopilotToFinish(bob, { timeoutMs: 90_000 }),
  ])

  for (const p of [alice, bob]) {
    await expect(p.locator('.mp-scoreline')).toBeVisible({ timeout: 20_000 })
    const times = await p.locator('.mp-score-time').allInnerTexts()
    expect(times).toHaveLength(2)
    for (const t of times) expect(t.trim()).toMatch(/^\d:\d\d\.\d{3}$/)
  }
  // exactly one winner, or an explicit dead heat, on Alice's screen
  const decided =
    (await alice.locator('.mp-score.win').count()) === 1 ||
    (await alice.locator('.result-pb', { hasText: /heat/i }).count()) === 1
  expect(decided, 'result declares a winner or a dead heat').toBe(true)

  // --- rematch -> back to the lobby ----------------------------------
  // The relay is one-sided: either player hitting REMATCH drops BOTH back to
  // the lobby (party/server.ts 'rematch'). So only Alice clicks; Bob is pulled
  // along by the broadcast. Clicking on both races the button's unmount.
  await alice.getByRole('button', { name: /rematch/i }).click()
  for (const p of [alice, bob]) {
    await expect(p.locator('.mp-code')).toBeVisible({ timeout: 15_000 })
  }
})
