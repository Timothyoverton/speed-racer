# Speed Racer

Browser Trackmania-style time-attack racer. React 19 + Vite, three.js via
`@react-three/fiber`, physics via `@react-three/rapier`, two-player relay in
`party/` (PartyKit). Deployed to GitHub Pages.

**Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first** — it covers the
render loop, the collision/physics system (how tiles, ramps, walls and steps are
represented and how climbability is decided), the mutable-singleton state model,
and where multiplayer state hooks in, all with `file:line` references.

## Commands

```bash
npm run dev            # game dev server (5173)
npm run party:dev      # multiplayer relay, local (1999)
npm run lint           # oxlint
npm run build
npm run deploy         # build + push dist/ to gh-pages
npm run party:deploy   # deploy the PartyKit relay
```

## Conventions

- The 60 fps loop never touches React state. Per-frame data lives in the
  singletons (`src/game/carState.js`, `hud.js`, `progress.js`, `net.js`); the
  only React store is the phase machine in `src/game/store.js`.
- Adding a track is one object in `TRACKS` (`src/game/track.js`); switching
  tracks reloads the page.
- Medal times are derived from a measured reference lap, not hand-written — see
  `medalsFor` / `medalsFromAuthor` in `src/game/track.js`.

## Game Dev — Verify Before Declaring Done

For any change to the racing game's physics, collision, or geometry (e.g.
ramps, walls, terrain steps), do not report success until you have driven the
change in the browser preview and confirmed the behaviour visually. State
explicitly what you observed. Visual distinctness (color/texture) and
functional behaviour are separate requirements — confirm both.
