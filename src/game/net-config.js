// Where the multiplayer relay lives.
//
// Local dev: `npx partykit dev` serves on 127.0.0.1:1999 and the client below
// picks that up automatically.
//
// Production: run `npm run party:deploy` once. PartyKit prints the host it
// deployed to, which looks like  speed-racer.<your-partykit-username>.partykit.dev
// Put that host here (or set VITE_PARTYKIT_HOST at build time) and redeploy the
// site. Until then, "Race a friend" will fail to connect in production only.

// Deployed with `npm run party:deploy` (PartyKit account: Timothyoverton).
const PROD_HOST = 'speed-racer.timothyoverton.partykit.dev'

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ||
  (import.meta.env.DEV ? '127.0.0.1:1999' : PROD_HOST)

// false only if the relay host was never filled in
export const PARTYKIT_CONFIGURED = !PARTYKIT_HOST.includes('CHANGE-ME')
