# Dust Hex

A haunted Old West fight on a small board. Standalone port of [dust-hex.grok.me](https://dust-hex.grok.me) (grok project `01a128e5-4f18-71b1-a28a-954146fa27c5`).

Live: https://dust-hex.vercel.app

## How this port was made

No source export was available from grok.me, so this is a **mirror of the deployed build**:

- `public/index.html` — the server-rendered porch (title) page captured from grok.me, with the grok.com
  `extensions.js` script and grok project meta tags removed. TanStack Router hydrates it on the client.
- `public/assets/` — the original minified Vite bundles (`index-*.js`, `routes-*.js`, lazy `Codex-*.js`, CSS)
  plus every image, map, story panel, voice line and sound effect the bundles reference that exists on grok.me.
  Two small patches to the bundles: the PWA manifest/icon links point at local files, and the card-art
  fallback that used `https://occultwar.grok.me/assets/images/…` now uses the local copies in
  `public/assets/images-ow/`.
- `public/manifest.webmanifest`, `public/icons/` — local PWA manifest and icons (replacing `/__grok/…`).
- `vercel.json` — static output from `public/`, SPA rewrite for everything except files and `/api`.

Because the game code is minified bundles, gameplay changes mean editing minified JS (or rebuilding the
game as a proper Vite + React source tree, the way Occult Wars was).

## Server doors (`api/[fn].ts`, one Vercel function)

| Door | What it does here |
|------|-------------------|
| `/api/table` | Presence, challenges, live-match reports (shared code with Occult Wars) |
| `/api/account` | Accounts — shut until an Upstash Redis store is connected (same as on grok.me) |
| `/api/ranked` | Ranked ladder — shut (same answer grok.me gave) |
| `/api/watch` | Owner Portal spectating |
| `/api/meeting` | Shared message board |
| `/api/relay` | Best-effort in-memory mailbox relay for Friend rooms and Quick match (WebRTC via PeerJS is tried first) |

Without Upstash (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) state lives in the warm function's memory only.
