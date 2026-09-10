import { test, expect } from '@playwright/test'
import {
  TRACKS,
  startSolo,
  injectAutopilot,
  autopilotToFinish,
  driveLoop,
  readHud,
  readCar,
  hold,
  yawCross,
} from './helpers.js'

// The "AI completes the track" regression. Under Playwright the REAL render
// loop runs at a variable frame rate, so the autopilot is slower and less
// precise than in the offline fixed-step harness (tools/autopilot.js). That's
// fine for the flowing tracks — good enough to prove every one is drivable end
// to end. If a geometry change makes a ramp impassable or a wall un-dodgeable,
// the autopilot never reaches the finish and this fails.
const FLOWING = ['test-pad-0', 'long-ribbon-1', 'qiddiya-rush-2', 'freefall-3']
// Stunt Park has big gaps that need frame-perfect entry speed the real loop
// can't hold at sub-60fps — the autopilot completes it only sometimes. Full
// completion is the offline harness's job; here it gets a "loads and the
// opening is drivable" smoke test.
const SET_PIECE = ['stunt-park-4']

for (const id of FLOWING) {
  const refSec = TRACKS.find((t) => t.id === id).refSec
  test(`autopilot drives ${id} to the finish`, async ({ page }) => {
    await startSolo(page, id)
    await injectAutopilot(page)

    const finished = await autopilotToFinish(page, { timeoutMs: 220_000 })
    expect(finished, 'autopilot reached the finish').toBe(true)
    await expect(page.locator('.result-time')).toBeVisible()

    const lapSec = (await readHud(page)).timeMs / 1000
    console.log(`${id}: ${lapSec.toFixed(2)}s (offline ref ${refSec}s)`)
    // Loose sanity only — the offline harness owns lap-time accuracy. This just
    // catches "drove in circles for minutes then stumbled over the line".
    expect(lapSec).toBeGreaterThan(refSec * 0.6)
    expect(lapSec).toBeLessThan(refSec * 3.2)
  })
}

// Mission Impossible: the autopilot's followed line is bent around the slalom
// blocks in tools/autopilot.js install() (a racing line, not the raw
// centreline), and a respawn re-acquires the cursor. Together that's enough to
// thread the slalom cleanly and grind through every gap to the finish — slow
// (it still respawns at the jumps it can't hit at speed), so no time band, but
// it must reach all three checkpoints and the finish.
test('autopilot threads mission-impossible-5 to the finish', async ({ page }) => {
  await startSolo(page, 'mission-impossible-5')
  await injectAutopilot(page)

  const finished = await autopilotToFinish(page, { timeoutMs: 220_000 })
  expect(finished, 'autopilot reached the finish').toBe(true)
  await expect(page.locator('.result-time')).toBeVisible()
  expect((await readHud(page)).checkpoints, 'passed all three checkpoints').toBeGreaterThanOrEqual(3)
})

for (const id of SET_PIECE) {
  test(`${id} loads and the opening section is drivable`, async ({ page }) => {
    await startSolo(page, id)
    await injectAutopilot(page)
    await page.evaluate(driveLoop)
    // Autopilot gets the car off the line and through the first checkpoint.
    // Full completion is the offline harness's job (see the FLOWING note above).
    await page.waitForFunction(() => (window.__hud?.checkpoints ?? 0) >= 1, null, {
      timeout: 90_000,
      polling: 250,
    })
    await page.evaluate(() => (window.__AP._stop = true))
    expect((await readHud(page)).checkpoints, 'reached the first checkpoint').toBeGreaterThanOrEqual(1)
  })
}

// Guards the tilt/keyboard steering regression (commit 91b9aea): a held arrow
// key must actually drive and steer the car.
test('held keys drive and steer the car', async ({ page }) => {
  await startSolo(page, 'test-pad-0')

  await hold(page, 'ArrowUp', 2500)
  const hud = await readHud(page)
  expect(hud.speedKmh, 'throttle builds speed').toBeGreaterThan(60)

  await page.keyboard.down('ArrowUp')
  const before = (await readCar(page)).fwd
  await hold(page, 'ArrowLeft', 800)
  const afterLeft = (await readCar(page)).fwd
  await page.keyboard.up('ArrowUp')

  expect(Math.abs(yawCross(before, afterLeft)), 'heading changed under left steer').toBeGreaterThan(
    0.02,
  )
})
