import { test, expect } from '@playwright/test'

// Tilt steering, driven through the CDP device-orientation override. Guards:
//   1. the phone-tilt axis reaches window.__input.axis and tracks the gyro
//   2. a held arrow key still overrides that axis — the regression from commit
//      91b9aea, where tilt calibrating to 0 killed keyboard steering.
//
// carState.steer is the smoothed value the physics reads: -1 = full right,
// +1 = full left. Asserting on it directly avoids depending on driving
// dynamics.

async function setGamma(client, gamma) {
  await client.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma })
}

test('tilt axis tracks the gyro and yields to a held key', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const client = await context.newCDPSession(page)

  await setGamma(client, 0)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('speed-racer:name', 'Tilt')
      localStorage.setItem('speed-racer:track', 'test-pad-0')
      localStorage.setItem('speed-racer:touch-mode', 'on') // force the touch/tilt UI
    } catch {
      /* ignore */
    }
  })
  await page.goto('/')
  await expect(page.locator('.panel .title')).toHaveText('SPEED RACER')

  // DRIVE calls enableTilt() (touch mode is on); with readings flowing it
  // captures a baseline ~600ms later. Wait for that — sweeping the gyro before
  // calibration would just move the "level" reference.
  await page.getByRole('button', { name: 'DRIVE' }).click()
  await page.waitForFunction(() => window.__tilt?.active && window.__tilt.calibrated, null, {
    timeout: 10_000,
  })
  expect(await page.evaluate(() => window.__input.axis), 'axis is live after calibration').toBe(0)

  // --- 1. axis follows the gyro, in sign and magnitude ------------------
  await setGamma(client, 26)
  await page.waitForFunction(() => window.__input.axis > 0.4, null, { timeout: 5000 })
  await setGamma(client, -26)
  await page.waitForFunction(() => window.__input.axis < -0.4, null, { timeout: 5000 })

  // --- 2. a held key overrides the axis --------------------------------
  await page.waitForFunction(() => window.__dbg?.phase === 'racing', null, { timeout: 20_000 })

  // tilt hard left (+), no keys -> the physics steer goes left (+)
  await setGamma(client, 26)
  await page.waitForFunction(() => window.__car.steer > 0.3, null, { timeout: 5000 })

  // same tilt, now hold the RIGHT arrow -> steer must flip negative
  await page.keyboard.down('ArrowRight')
  await page.waitForFunction(() => window.__car.steer < -0.3, null, { timeout: 5000 })
  await page.keyboard.up('ArrowRight')

  // releasing the key hands control back to the tilt axis
  await page.waitForFunction(() => window.__car.steer > 0.3, null, { timeout: 5000 })

  await context.close()
})
