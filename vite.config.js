import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

// Dev-only: "Race a robot" needs something to spawn a second, autopilot-driven
// browser that joins the hosted room as a guest (see tools/robot-player.js).
// The game itself is a static client with nowhere to run a process, so this
// middleware is the one place that can do it — it only exists under `vite
// dev`, never in the production build served from GitHub Pages.
function robotSpawnerPlugin() {
  return {
    name: 'robot-spawner',
    configureServer(server) {
      server.middlewares.use('/__robot/join', (req, res) => {
        const url = new URL(req.url, 'http://x')
        const room = url.searchParams.get('room')
        const track = url.searchParams.get('track') || 'test-pad-0'
        const difficulty = url.searchParams.get('difficulty') || 'normal'
        if (!room) {
          res.statusCode = 400
          res.end('missing room')
          return
        }
        const port = server.config.server.port
        const script = fileURLToPath(new URL('./tools/robot-player.js', import.meta.url))
        const logPath = fileURLToPath(new URL('./.robot-player.log', import.meta.url))
        const log = fs.openSync(logPath, 'a')
        const child = spawn(
          process.execPath,
          [script, room, track, `--url=http://localhost:${port}`, `--difficulty=${difficulty}`],
          { detached: true, stdio: ['ignore', log, log], env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' } },
        )
        child.unref()
        console.log(`[robot-spawner] launched robot-player.js pid=${child.pid} room=${room} track=${track}`)
        res.statusCode = 202
        res.end('ok')
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), command === 'serve' && robotSpawnerPlugin()],
  base: command === 'build' ? '/speed-racer/' : '/',
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
}))
