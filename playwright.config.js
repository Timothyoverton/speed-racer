import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Browsers live outside the repo and outside /tmp (which gets wiped) — see
// docs/playwright-plan.md.
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(os.homedir(), '.cache/ms-playwright')
// Headed on Tim's real X display so he can watch the car drive.
process.env.DISPLAY ||= ':0'

export default defineConfig({
  testDir: 'tests',
  // The dev server is shared and several specs drive the multiplayer relay in
  // sequence — no parallelism.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Autopilot laps run in real time; Mission Impossible is ~50s of driving.
  timeout: 240_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://localhost:5173',
    headless: false,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
