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
| `POST` | `/api/scrape` | session | `{profileUrl}`. Validate/normalize URL (accept `instagram.com/<username>` forms and bare usernames; reject anything else). Enqueues an **index** job (post metadata only, no images). `409` if this session already has one queued/running. |
| `GET` | `/api/scrape/status` | session | Index job: `{state: "none"\|"queued"\|"running"\|"done"\|"error", indexed, queuePosition, postCount?, error?}`. Client polls every ~2s. No SSE/websockets. |
| `POST` | `/api/game/start` | session | `{rounds, dayMode, hardMode}`. Requires a completed index. Samples `rounds` random posts (no repeats — one entry per post), enqueues a **prep** job that downloads + resizes just those photos, returns `202 {preparing: true}`. Year-picker bounds are derived from the FULL index (all posts), so they span the account's real history without leaking which era this game's sample came from. |
| `GET` | `/api/game/status` | session | Prep job: `{state: "none"\|"queued"\|"running"\|"ready"\|"error", downloaded, resized, total, error?}`. The game is playable once `ready`. |
| `GET` | `/api/game/round` | session | Current round: `{roundIndex, totalRounds, photoUrl, guessesUsed, guessesRemaining, guesses, dayMode, hardMode, minYear, maxYear, revealedDay?}` where `revealedDay` is present only when `dayMode` is off. **True dates never leave the server until the round ends.** |
| `POST` | `/api/game/guess` | session | `{year, month, day?}` → `{feedback, roundOver, solved?, trueDate?, pointsEarned?}`. `trueDate` and points only when the round is over. |
| `POST` | `/api/game/end` | session | Final summary `{totalScore, rounds: [...]}`; deletes the session image directory immediately. |
| `GET` | `/img/:photoId.jpg` | session | Streams the resized JPEG **from the requesting session's own directory only** — session comes from the cookie, never the URL, so users cannot fetch each other's images. Sanitize `photoId` against path traversal. `Cache-Control: private, max-age=1800`. |

---

## 5. Scrape → ingest pipeline (memory-critical)

Two-phase, on-demand: a scrape only **indexes** post metadata; images are downloaded
per-game, for just the posts that game sampled. Both phases run through one global
FIFO queue with concurrency 1 (RAM + IP hygiene).

```
Phase 1 — index (POST /api/scrape):
  → spawn instaloader with:
      --no-pictures --no-videos --no-video-thumbnails --no-profile-pic
      --no-captions --no-compress-json --filename-pattern {shortcode}
      --dirname-pattern <CACHE_DIR>/<sessionId>/raw  <username>
  → one small {shortcode}.json per post, NO images
  → ingest.parseIndex: read each json → ONE ENTRY PER PHOTO, not per post —
    a carousel post contributes { shortcode, slide, isoDate } for every
    non-video slide (1-based, matching Instaloader's own sidecar order),
    all sharing the post's single taken_at_timestamp; a plain post is just
    { slide: 1 }. Individual video slides are skipped; a carousel isn't
    dropped just because one of its slides is a video. write index.json;
    delete raw/. (Confirmed on a real profile: 30 posts → 204 indexed
    photos, up to 20 slides on one carousel — this is what surfaces every
    photo in a multi-photo post as its own playable unit, not just the first.)
  → maxPosts cap counts POSTS WALKED (json files), independent of how many
    photos each one contributes — a carousel-heavy account naturally
    produces a larger index without a config change
  → ingest.writeMeta writes meta.json: { username } — the prep phase needs
    this to re-walk the profile (see below), and only index.json survives
    between phases in the session directory

Phase 2 — prep (POST /api/game/start):
  → sample N individual photos from index.json (each a distinct
    {shortcode, slide} — a single game CAN sample more than one slide from
    the same carousel, since those are genuinely different photos)
  → dedupe to the underlying unique shortcodes and spawn instaloader
    AGAINST THE PROFILE AGAIN (not a direct per-post lookup — see caveat
    below) with the same suppression flags plus:
      --post-filter 'shortcode in {"SC1", "SC2", ...}' --filename-pattern
      {shortcode}  <username>
    No --slide restriction — Instaloader can't select specific slide
    numbers per post in one run, so EVERY slide of a matched post comes
    down; ingestDownloads discards whichever ones weren't actually sampled
    (deleted straight from raw/, never resized, so the waste is a disk
    copy, not CPU). Polls the raw dir for unique shortcode coverage and
    SIGTERMs ~3s (SETTLE_MS) after every target shortcode has produced at
    least one file — the settle delay matters because a carousel's slides
    land as a burst of several files, and polling could otherwise catch it
    mid-burst and truncate the last matched post's slide set. Also bounded
    by a 5-minute hard timeout — this walk can't jump straight to a post,
    so in the worst case it re-walks up to maxPosts posts to find its targets
  → ingest.ingestDownloads, per file: resolveDownloadedFile maps filename →
    (shortcode, slide) — bare "{shortcode}.jpg" is tried as slide 1 FIRST,
    against the wanted set, before stripping any trailing "_<digits>"; only
    falls back to treating that suffix as a slide number if the bare name
    isn't something we asked for. (This ordering matters: a shortcode that
    legitimately ends in "_<digits>" of its own, on a single-image post,
    must not be misread as carrying a slide suffix it never had.) Anything
    not in the wanted (shortcode:slide) set is deleted unresized. For a
    match, strictly sequentially:
      1. sharp(rawPath).rotate().resize({ width: 500, height: 500, fit: "inside",
           withoutEnlargement: true }).jpeg({ quality: 75 })
           .toFile(<CACHE_DIR>/<sessionId>/photos/<photoId>.jpg)
      2. DELETE the raw file immediately        ← disk usage stays bounded
  → engine.initRounds(...) with the resulting photos; delete raw/
```

Spawn hygiene (both phases): `stdio: ["ignore", "pipe", "pipe"]` — stdin closed so
any interactive fallback prompt (e.g. Instaloader re-asking for a password when its
session check fails) dies fast instead of hanging; stdout drained so a chatty run
can't fill the pipe buffer and stall the child.

**Caveat confirmed by manual testing:** Instaloader's direct single-post lookup
(`-<shortcode>` as a CLI target) hits a separate GraphQL query than the profile-timeline
walk indexing uses, and that query currently fails outright (`Fetching Post metadata
failed`) even with a valid authenticated session — this looked identical in kind to the
already-known broken-session-check bug (upstream, not ours) but is a distinct endpoint.
`--post-filter` on a normal profile walk avoids it entirely by reusing the query that's
known to work, at the cost of the walk-depth tradeoff described above. If a future
Instaloader release fixes direct post lookup, the walk-and-filter approach can be dropped
for something more direct — but don't switch back without re-confirming it actually works.

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
even to public profiles (observed in practice: a blanket 403 on the anonymous GraphQL query,
which Instaloader itself misreports as "profile does not exist" — classify on stderr content
rather than trusting that message literally). Keep the scraper behind a narrow interface —
`scrape(username, destDir, { maxPosts, onProgress }) → Promise<{count}>` — so it can be
swapped (gallery-dl, manual photo-zip upload) without touching the game engine. Surface
failures to the user; do not retry automatically.

**Optional authenticated mode:** if anonymous requests get blanket-blocked, `IG_LOGIN_USER` +
`IG_SESSION_FILE` (see `.env.example`) switch the scraper to `--login --sessionfile`,
reusing a session created by a one-time *interactive* login the operator runs themselves.
The app never sees or stores the account's password — only the resulting session cookie
file. Use a throwaway account; it risks getting flagged for scraping. If the session file
is missing, fail fast with a clear error rather than spawning Instaloader, which would
otherwise block forever on a password prompt with no TTY to answer it.

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
- **Sticky correct fields:** once a field comes back `"correct"`, the UI keeps it
  pre-filled and disabled (amber-tinted) for the rest of the round — the player never
  re-enters a field they've already nailed. Server-side, the feedback history in the
  round view is what the client derives locks from, so a page refresh preserves them.
- **Hard mode (toggle at setup):** directional hints are masked server-side — any
  non-correct field comes back `"wrong"` (rendered as a dim ✕ cell, no arrow) *before*
  being stored in the guess history, so the round view can't leak directions either.
  In exchange, every round's points (solve or consolation) are multiplied by **1.5×**
  and rounded.
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
