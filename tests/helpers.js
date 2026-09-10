import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTOPILOT = path.resolve(__dirname, '../tools/autopilot.js')

const TRACK_KEY = 'speed-racer:track'
const TOUCH_KEY = 'speed-racer:touch-mode'

// All track ids, and the autopilot reference lap each was tuned against
// (seconds). Used to sanity-band a driven lap.
export const TRACKS = [
  { id: 'test-pad-0', refSec: 14.9 },
  { id: 'long-ribbon-1', refSec: 26.65 },
  { id: 'qiddiya-rush-2', refSec: 23.1 },
  { id: 'freefall-3', refSec: 59.7 },
  { id: 'stunt-park-4', refSec: 56.9 },
  { id: 'mission-impossible-5', refSec: 50 },
]

// Land on the menu with a known track selected and keyboard controls forced.
// selectTrack() reloads the page, so we set localStorage first and load once.
export async function gotoMenu(page, { trackId = 'test-pad-0', touch = 'off', name } = {}) {
  await page.addInitScript(
    ([tk, tv, ck, cv, nm]) => {
      try {
        localStorage.setItem(tk, tv)
        localStorage.setItem(ck, cv)
        if (nm) localStorage.setItem('speed-racer:name', nm)
      } catch {
        /* ignore */
      }
    },
    [TRACK_KEY, trackId, TOUCH_KEY, touch, name],
  )
  await page.goto('/')
  await expect(page.locator('.panel .title')).toHaveText('SPEED RACER')
}

// Menu -> countdown -> racing. Resolves once window.__dbg reports 'racing'.
export async function startSolo(page, trackId = 'test-pad-0') {
  await gotoMenu(page, { trackId })
  await page.getByRole('button', { name: 'DRIVE' }).click()
  await page.waitForFunction(() => window.__dbg?.phase === 'racing', null, {
    timeout: 20_000,
    polling: 100,
  })
}

export async function readHud(page) {
  return page.evaluate(() => ({ ...window.__hud }))
}

export async function readDbg(page) {
  return page.evaluate(() => ({ ...window.__dbg }))
}

export async function readCar(page) {
  return page.evaluate(() => ({
    pos: [...window.__car.pos],
    fwd: [...window.__car.fwd],
    speed: window.__car.speed,
  }))
}

// Press and HOLD a key for `ms`, then release. This is the thing the in-app
// Browser pane cannot do (its synthetic keydown is instantly followed by keyup).
export async function hold(page, key, ms) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

// Load tools/autopilot.js into the page and prime it against the active track.
// The file is an ES module; strip the `export` keywords and inject it as a
// classic script so it runs synchronously and sets window.__AP.
export async function injectAutopilot(page) {
  const src = fs.readFileSync(AUTOPILOT, 'utf8').replace(/^export\s+/gm, '')
  await page.addScriptTag({ content: src })
  await page.waitForFunction(() => !!window.__AP)
  return page.evaluate(() => window.__AP.install())
}

// page.evaluate body: run the autopilot with the REAL render/physics loop (no
// frameloop:'never' hack — that is for the offline harness). Sets inputs once
// per animation frame while the race is in 'racing'. Stop with __AP._stop.
export function driveLoop() {
  const AP = window.__AP
  AP._stop = false
  const tick = () => {
    if (AP._stop) return
    if (window.__dbg?.phase === 'racing') {
      try {
        AP.control(AP.DEFAULTS)
      } catch {
        /* a frame where globals aren't ready yet */
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// Drive the autopilot until the race leaves 'racing', or the timeout trips.
export async function autopilotToFinish(page, { timeoutMs = 200_000 } = {}) {
  await page.evaluate(driveLoop)

  let finished = false
  try {
    await page.waitForFunction(
      () => {
        const ph = window.__dbg?.phase
        return ph === 'finished' || ph === 'menu'
      },
      null,
      { timeout: timeoutMs, polling: 250 },
    )
    finished = true
  } finally {
    // Best-effort: by here the page may have torn down to the menu (a set-piece
    // respawn-out) and lost window.__AP, and the context may be closing.
    await page
      .evaluate(() => {
        if (window.__AP) window.__AP._stop = true
        const i = window.__input
        if (i) {
          i.forward = i.back = i.left = i.right = false
          i.axis = null // autopilot steers via the analog axis; hand control back
        }
      })
      .catch(() => {})
  }
  return finished
}

// Yaw direction between two forward vectors: sign of the Y-axis cross product.
// >0 turned one way, <0 the other. Magnitude ~ angle for small turns.
export function yawCross(before, after) {
  return before[0] * after[2] - before[2] * after[0]
}
