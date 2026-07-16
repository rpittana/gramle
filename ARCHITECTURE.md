# Gramle — Architecture & Implementation Spec

A Wordle-style guessing game built from a public Instagram account's photos. A user enters
an Instagram profile URL, the app scrapes that account's photo posts (images only, no
videos/reels), and players guess the month + year each photo was posted (optionally the day).

**Target hardware: Raspberry Pi, ~1GB RAM, 128GB microSD.** Every design decision below is
constrained by that. Do not add caching layers, databases, worker processes, build tooling,
or frameworks beyond what this document specifies — this is a small-scale app for a handful
of concurrent users and must stay lean.

This document is the authoritative spec. Implement it as written; where it is silent, prefer
the simplest option that respects the RAM constraint.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | Node 20 + Express, single process | ~80–120MB footprint. No cluster, no PM2 workers. Run under systemd. |
| Scraper | Python 3 **Instaloader**, spawned via `child_process.spawn` | See §6 — the Node scraping ecosystem is dead. |
| Images | `sharp` (libvips), file→file only | `sharp.cache(false)` and `sharp.concurrency(1)` at startup. Never buffer whole image sets in memory. |
| Frontend | Vanilla ES modules + one CSS file, served statically by Express | **No build step, no framework, no bundler.** |
| State | In-memory `Map`s (sessions, games, jobs) + per-session `manifest.json` on disk | **No database.** Process restart loses active games — acceptable; boot cleanup handles orphans. |
| Config | `.env` via `dotenv` | `GAME_PASSWORD` (required — fail fast at startup if missing), `PORT` (default 3000), `CACHE_DIR` (default `/var/cache/game`), `MAX_POSTS` (default 150, hard cap 300), `SESSION_TTL_MIN` (default 30). |

---

## 2. Folder structure

```
gramle/
├── .env                      # never committed; .env.example is
├── .env.example
├── package.json
├── ARCHITECTURE.md           # this file
├── server/
│   ├── index.js              # Express bootstrap, middleware wiring, sweeper interval, boot cleanup
│   ├── config.js             # env parsing + validation; throw on missing GAME_PASSWORD
│   ├── auth.js               # login handler (timingSafeEqual), cookie/session middleware
│   ├── rateLimit.js          # express-rate-limit config for /api/login
│   ├── sessions.js           # session Map, lastActivity tracking, destroySession()
│   ├── scrape/
│   │   ├── queue.js          # FIFO, concurrency=1 promise-chain job queue
│   │   ├── instaloader.js    # spawn + stdout progress parsing + profile URL validation
│   │   └── ingest.js         # sharp resize pipeline, manifest writing, raw-file deletion
│   ├── game/
│   │   ├── engine.js         # round state, guess evaluation, per-field feedback
│   │   └── scoring.js        # pure functions: points table + consolation formula
│   └── routes/
│       ├── api.js            # all /api/* routes
│       └── images.js         # gated image streaming for /img/*
├── public/
│   ├── index.html
│   ├── css/
│   │   ├── tokens.css        # design tokens (palette, radii, shadows) as CSS custom properties
│   │   └── app.css
│   └── js/
│       ├── app.js            # screen router: gate → setup → game → results
│       ├── api.js            # fetch wrapper; any 401 response routes back to gate
│       └── components/
│           ├── gate.js
│           ├── setup.js      # includes scrape progress view
│           ├── board.js      # composes photoCard + guessInput + history + round chip
│           ├── guessInput.js
│           ├── history.js
│           ├── reveal.js
│           └── results.js
├── scripts/
│   └── setup-pi.sh           # apt deps, python3 + pip install instaloader, mkdir/chown CACHE_DIR, install systemd unit
└── systemd/
    └── gramle.service        # Restart=always, EnvironmentFile=.env, runs as non-root service user
```

---

## 3. Access control

- **Password check:** single shared password from `GAME_PASSWORD` env var. Compare with
  `crypto.timingSafeEqual`. Hash both the submitted value and the stored value (e.g. SHA-256)
  to equal-length buffers *before* comparing — `timingSafeEqual` throws on length mismatch,
  which itself leaks length.
- **Session on success:** generate a random 32-byte token (`crypto.randomBytes`), set as
  `HttpOnly; SameSite=Lax; Path=/` cookie (add `Secure` if ever behind TLS). Store token →
  `{ sessionId, createdAt, lastActivity }` in an in-memory `Map`. The `sessionId` (also
  random) names the on-disk directory.
- **Rate limiting:** `express-rate-limit` on `POST /api/login` only, keyed by IP:
  **5 failed attempts → 15-minute lockout.** Return 429 with a retry-after so the UI can
  show "Try again in N min". Successful logins should not count against the limit.
- **Auth middleware:** everything under `/api/*` (except `/api/login`) and `/img/*` requires
  a valid session cookie; the middleware also bumps `lastActivity` on every authenticated
  request — this feeds the inactivity timeout. `GET /` and static assets are public (the
  SPA renders the gate screen client-side when unauthenticated).

---

## 4. Routes

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/` + static | none | SPA shell |
| `POST` | `/api/login` | rate-limited | `{password}` → sets cookie, `204`. Wrong password → `401`. Locked out → `429` + retry-after. |
| `POST` | `/api/logout` | session | Destroys session (incl. its directory), clears cookie. |
| `POST` | `/api/scrape` | session | `{profileUrl, maxPosts?}`. Validate/normalize URL (accept `instagram.com/<username>` forms and bare usernames; reject anything else). Enqueue job, return `{jobId}`. `409` if this session already has a queued/running job. |
| `GET` | `/api/scrape/status` | session | `{state: "queued"\|"running"\|"done"\|"error", downloaded, resized, queuePosition, photoCount?, error?}`. Client polls every ~2s. No SSE/websockets. |
| `POST` | `/api/game/start` | session | `{rounds, dayMode}`. Requires a completed scrape. Samples `rounds` random photos from the manifest (no repeats). Also returns `{minYear, maxYear}` derived from the manifest to bound the year picker — this does not leak per-round answers. |
| `GET` | `/api/game/round` | session | Current round: `{roundIndex, totalRounds, photoUrl, guessesUsed, guessesRemaining, dayMode, revealedDay?}` where `revealedDay` is present only when `dayMode` is off. **True dates never leave the server until the round ends.** |
| `POST` | `/api/game/guess` | session | `{year, month, day?}` → `{feedback, roundOver, solved?, trueDate?, pointsEarned?}`. `trueDate` and points only when the round is over. |
| `POST` | `/api/game/end` | session | Final summary `{totalScore, rounds: [...]}`; deletes the session image directory immediately. |
| `GET` | `/img/:photoId.jpg` | session | Streams the resized JPEG **from the requesting session's own directory only** — session comes from the cookie, never the URL, so users cannot fetch each other's images. Sanitize `photoId` against path traversal. `Cache-Control: private, max-age=1800`. |

---

## 5. Scrape → ingest pipeline (memory-critical)

```
POST /api/scrape
  → queue.js: FIFO promise chain, concurrency = 1 (one scrape job at a time, globally)
  → spawn python3 -m instaloader with flags:
      --no-videos --no-video-thumbnails --no-captions --no-compress-json
      --count=<maxPosts> --dirname-pattern=<CACHE_DIR>/<sessionId>/raw
      <username>
  → Instaloader downloads full-res JPEGs sequentially to raw/
  → ingest.js, per file, strictly sequentially:
      1. sharp(rawPath).rotate().resize({ width: 500, height: 500, fit: "inside",
           withoutEnlargement: true }).jpeg({ quality: 75 })
           .toFile(<CACHE_DIR>/<sessionId>/photos/<photoId>.jpg)
      2. Parse post timestamp from Instaloader's filename pattern
         (YYYY-MM-DD_HH-MM-SS_UTC.jpg) — sufficient; ignore the .json metadata files.
      3. Append { photoId, isoDate } to manifest.json
      4. DELETE the raw file immediately        ← disk usage stays bounded
  → When the Python process exits, delete the entire raw/ directory.
```

Rules:

- Ingest may run after the child process exits (simplest) or incrementally as files appear;
  either way, **one image at a time**, file→file. Never `readFile` a full-res image into a
  buffer, never hold arrays of buffers.
- Skip non-image files Instaloader emits (`.json.xz`, `.txt`); skip anything that isn't `.jpg`/`.jpeg`/`.png`/`.webp`.
- Parse the child's stdout lines to update job progress for the status endpoint.
- `maxPosts`: default `MAX_POSTS` env (150), hard cap 300 regardless of client input.
- **Partial success is success:** non-zero exit with ≥1 downloaded photo → state `done`
  with whatever was fetched. Zero photos → state `error` with a friendly message
  ("Instagram wouldn't let us in right now — try again in a few minutes"). Never auto-retry
  in a loop — Instagram throttles per IP, and hammering makes it worse.
- Worst-case RAM: Node (~100MB) + Python child (~60–80MB) + one libvips resize (~30MB)
  — well under 400MB. Preserve this by never parallelizing any stage.

### Why Instaloader / Python (context for the implementer)

There is no well-maintained Node library for anonymous Instagram scraping. The old public
endpoints (`?__a=1`, anonymous GraphQL query_hash) are dead; `instagram-private-api`
requires a real logged-in account and is ban-prone; headless Chromium is a nonstarter on
1GB RAM. Instaloader (`pip install instaloader`) is the maintained standard and downloads
sequentially (low-memory) by nature.

**Caveat to preserve in code structure:** Instagram intermittently blocks anonymous access
even to public profiles. Keep the scraper behind a narrow interface —
`scrape(username, destDir, { maxPosts, onProgress }) → Promise<{count}>` — so it can be
swapped (gallery-dl, manual photo-zip upload) without touching the game engine. Surface
failures to the user; do not retry automatically.

---

## 6. Storage & cleanup lifecycle

Per-session directory: `<CACHE_DIR>/<sessionId>/` containing `photos/`, `manifest.json`,
and transiently `raw/`. **Nothing on disk outlives a session; there is no permanent image
storage.**

All deletion funnels through one idempotent `destroySession(sessionId)` in `sessions.js`
(removes Map entries, kills any running scrape child for that session, `rm -rf`s the
directory). Three triggers:

1. **Explicit:** `POST /api/game/end` and `POST /api/logout`.
2. **Inactivity:** a single `setInterval` sweeper (every 5 min) in `index.js` destroys any
   session whose `lastActivity` is older than `SESSION_TTL_MIN` (30 min). No cron — the
   process is long-running under systemd.
3. **Boot reconciliation:** on startup, delete **every** directory under `CACHE_DIR` —
   after a restart the in-memory session Map is empty, so every surviving directory is an
   orphan by definition.

Additionally, `raw/` is deleted as soon as ingest finishes, even mid-session.

---

## 7. Game engine

- **Rounds:** user picks round count at setup (offer 5 / 8 / 10, default 8, capped at
  available photo count). One photo per round, sampled without repeats.
- **Guesses:** 6 per round in both modes. Day mode is simply harder; that's the point of
  the toggle.
- **Feedback — per-field, Wordle-style.** Each field (year, month, and day when dayMode is
  on) is compared **independently as a number**:
  - exact → `"correct"` (amber ✓)
  - guess too early (true value is later) → `"later"` (blue ↑)
  - guess too late → `"earlier"` (coral ↓)
  - Known quirk: independent month comparison can point "later" while year points
    "earlier" (guess Jan 2020 vs. actual Dec 2019). This is intentional — it's per-field
    information, like Wordle tiles. Mention it in the in-app how-to-play blurb.
- **Day mode OFF:** the true day of month is shown from the start of the round
  ("Posted on the **2nd** of ?/?") so scheduling gaps (a Halloween photo posted Nov 2)
  don't distort month guessing, and it doubles as a clue. Day mode ON: day is a third
  guessed field; a round is solved only when all three fields are exact.
- **Round ends** when solved or when 6 guesses are exhausted; only then does the response
  include `trueDate` and points.

### Scoring (`scoring.js`, pure functions — write unit tests for these)

- Solved on guess *n* (1-indexed): `[500, 400, 300, 220, 150, 90][n-1]` points.
- All 6 exhausted → consolation based on the **final** guess:
  `max(0, 60 − 6 × |monthsOff|)` where `monthsOff = (guessYear − trueYear) × 12 + (guessMonth − trueMonth)`.
- Day mode adds a consolation day term **only when the final guess's month and year are
  both exact**: `+ max(0, 20 − 2 × |daysOff|)`. One combined number — never a separate
  day score.
- Game total = sum of rounds. Results screen shows a per-round dot strip:
  solved / consolation / zero.

Game state lives in an in-memory Map keyed by session: current round index, sampled photo
IDs + true dates, guesses so far, per-round results.

---

## 8. Frontend & visual design

**Vibe:** warm, nostalgic, photo-first — "digital scrapbook" meets Wordle's clean
minimalism. The photo is the hero; UI frames it rather than competes with it.

### Design tokens (`public/css/tokens.css` — all components use tokens, never raw hex)

```css
:root {
  --bg:        #1A1A1D;  /* page background, deep charcoal */
  --surface:   #2C2A28;  /* cards, warm dark gray */
  --accent:    #E8A54B;  /* correct/close, buttons — warm amber-gold */
  --early:     #5B8DBE;  /* "too early" feedback, soft blue */
  --late:      #D97757;  /* "too late" feedback, muted coral */
  --text:      #F2EFE9;  /* primary, off-white */
  --text-dim:  #9B9691;  /* secondary, muted gray */
  --win-gradient: linear-gradient(135deg, #E8A54B, #F2C879); /* gold→amber, win states */
  --radius-card: 14px;
  --radius-cell: 8px;
  --shadow-card: 0 6px 24px rgba(0,0,0,0.35);
}
```

### Layout & type

- Centered single column, mobile-first, `max-width: 520px`, `--bg` behind everything.
- UI font: system geometric sans — `-apple-system, "Segoe UI", Inter, Roboto, sans-serif`.
- Accent font (rounded serif, e.g. a self-hosted Fraunces subset — **no CDN/external
  requests**, the Pi serves everything) appears in exactly two places: the round-reveal
  date/points and the final score. Nowhere else. If self-hosting a font is a hassle,
  fall back to the system serif stack for those two spots.
- Motion: CSS-only, subtle. 200ms fade + small translate-Y between screens; guess rows pop
  in with `transform: scale(0.96→1)` over 150ms; a small pop on correct guesses. Respect
  `prefers-reduced-motion`. No animation libraries.

### Screens/components

1. **`gate.js` — password gate.** Lone centered card (`--surface`, `--radius-card`,
   `--shadow-card`), one password input, one amber button. Nothing else — it should feel
   like a door, not a page. On 429, quiet `--text-dim` copy: "Try again in N min".
2. **`setup.js` — scrape setup + progress.** URL input, "guess the day" toggle (knob turns
   amber when on), round-count select, start button. After submit it becomes the progress
   view: thin amber progress bar, running photo count, queue position if queued. Warm copy
   ("gathering the album…"). On scrape error, the friendly message + a try-again button.
3. **`board.js` — game board.** Composes:
   - **Round chip** — small `--text-dim` chip, top-right: "Photo 3 / 8 · 1,240 pts".
   - **PhotoCard** — the hero. Full column width, `--radius-card` corners, `--shadow-card`,
     plus a 1px warm inner border (e.g. `rgba(232,165,75,0.15)`) so it reads as a framed
     print against the charcoal. Use an `aspect-ratio` placeholder box so layout doesn't
     jump while the image loads. Below it, when dayMode is off: "Posted on the **12th** of ?/?".
4. **`guessInput.js`** — large touch-friendly pickers, **not raw text fields**: month as a
   dropdown or 12-segment picker, year as a stepper/dropdown bounded to
   `[minYear, maxYear]` from `/api/game/start`, day (when on) as a 1–31 picker. Amber
   "Guess" button, disabled until all fields are set.
5. **`history.js` — guess rows.** Compact Wordle-style stack, newest on top. Each row shows
   the guessed value per field in a rounded cell (`--radius-cell`): blue tint + ↑ for
   "later", coral tint + ↓ for "earlier", amber fill + ✓ for exact. Rows animate in with
   the small pop.
6. **`reveal.js` — round reveal.** Shown when a round ends: true date in the accent font,
   points counting up via a tiny `requestAnimationFrame` ticker, photo re-shown small.
   Solved → `--win-gradient` text (via `background-clip: text`); consolation → plain amber;
   zero → `--text-dim`. "Next photo" button advances with the screen transition.
7. **`results.js` — final score.** Total in gradient accent type, per-round dot strip
   (amber = solved, half-amber = consolation, gray = zero), then "Play again" (new random
   sample from the same manifest — no re-scrape) and "New account" (calls `/api/game/end`,
   returns to setup).

`api.js`: thin `fetch` wrapper; any 401 anywhere → clear local state, show gate screen.

---

## 9. Explicit non-goals / guardrails

- No database, no Redis, no job-queue library, no websockets, no SSE, no React/Vue/build
  step, no Docker. All are over-engineering at this scale and cost RAM.
- No in-memory caching of image sets — images live on disk, streamed per request.
- No permanent storage of scraped content; everything is session-scoped and ephemeral.
- No automatic scrape retries; no concurrent scrape jobs (queue is global concurrency 1).
- No external network requests from the frontend (fonts, CDNs, analytics). The Pi serves
  every byte.
- README should note: unofficial scraping of public content, personal/small-scale use,
  contrary to Instagram's ToS — expect intermittent breakage.

## 10. Suggested build order

1. `config.js` + `auth.js` + `sessions.js` + rate limiter — everything hangs off sessions.
2. Scrape queue + `instaloader.js` + `ingest.js`, tested against a real public profile.
3. `game/engine.js` + `game/scoring.js` as pure logic with unit tests (no UI needed yet).
4. Routes wiring + gated image streaming.
5. Frontend screens in the order players meet them: gate → setup → board → reveal → results.
6. `scripts/setup-pi.sh` + systemd unit last.
