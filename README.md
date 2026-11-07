# dustype

A clean-rebuild typing test web app, built with the same stack family as
the reference project it was inspired by — but with its own code, its own
branding, and its own word list.

Live demo: https://dustype.pages.dev

## Stack

- Monorepo: pnpm 11.21.0 workspaces + Turborepo 2.9.14
- Language: TypeScript, Node.js >= 24 < 25
- Frontend: SolidJS 1.9 + Vite 8 + Tailwind CSS 4
- Backend: Express 5 + Zod, with optional MongoDB / Redis via env
- Shared: `@dustype/schemas` (Zod), `@dustype/util` (typing maths),
  `@dustype/contracts` (ts-rest contract types)

## Layout

```
frontend/   SolidJS typing app (port 3000 in dev)
backend/    Express API (port 5005 in dev, /api/health, /api/words, /api/results)
packages/   schemas, util, contracts
```

## Phase 1 scope

- Time modes: 15 / 30 / 60 / 120 seconds
- Words modes: 10 / 25 / 50 / 100 words
- Live timer, per-character correct / incorrect highlighting
- Results: WPM, raw WPM, accuracy, correct / incorrect chars, time taken
- Backend: health check, word list, and in-memory results submission
  (MongoDB / Redis persistence is Phase 2, behind env flags)

## Phase 2–3 and UI matching (done)

- Backend: MongoDB persistence behind `DB_URI` (in-memory fallback),
  scrypt + HMAC-JWT auth (`/api/auth/register`, `/api/auth/login`,
  `/api/me`), owner-scoped results, in-memory rate limiting
  (auth 10/15 min, results 60/hour), result sanity + duplicate
  validation, `/api/users/me/bests` and public `/api/leaderboards`
  (displayName only, never email/ownerId/hash)
- Frontend: live WPM/accuracy during a test, own canvas result chart
  (per-second speed + error axis), 5 own themes (Midnight Ink default,
  Paper Dawn, Ember Dusk, Sea Glass, Lilac Field, persisted in
  localStorage), blinking caret, own Web Audio key sounds with a
  toggle, focus warning + autofocus, Backspace across words,
  Ctrl+Backspace to clear a word, Esc to restart, extra letters in red,
  responsive text sizes, `prefers-reduced-motion` support
- Production auth needs a long random `JWT_SECRET`; without it the
  backend uses a dev-only fallback (see `backend/example.env`).
  Without `DB_URI`, data is in-memory and lost on restart.

## Deploy

Every push to `main` auto-deploys the static frontend to Cloudflare
Pages via GitHub Actions (`.github/workflows/deploy.yml`):
`frontend/dist` is uploaded to the Pages project `dustype`
(https://dustype.pages.dev). The Express backend is not part of a
Pages deploy — on the live site, result submission falls back to
local-only results.

## Commands (from the repo root)

```sh
pnpm install
pnpm build
pnpm dev-fe
pnpm dev-be
```

Dev servers are intentionally not started by the build itself.

## License

GPL-3.0 — see `LICENSE`.
Tip: press `Esc` to restart a test instantly, and use `Ctrl+Backspace` to clear the current word.
Note: without a `DB_URI` the backend keeps results in memory only, so all results are lost on restart.
The live site serves only the static frontend — the Express backend is not part of a Pages deploy, so result submission there falls back to local-only results.
Public leaderboards show display names only — never email, owner ID or password hash.
