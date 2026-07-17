# Gramle — Restyle Plan (presentation only)

An implementation plan for restyling the game's UI. **Scope: styling and presentation
only.** The JS game logic, API calls, state handling, and DOM event wiring stay exactly
as they are. This app has no on-screen keyboard (it's not letter-based Wordle) — the
month/year/day pickers + Guess button are the "keyboard" equivalent and are treated as
such below.

The current implementation is a flat, half-realized version of the design spec in
ARCHITECTURE.md §8 (warm "digital scrapbook" × Wordle minimalism). This plan keeps that
direction and actually delivers it. Two screenshots drove this plan: the setup screen
(both the form AND the progress card visible at once, default-looking selects, floating
cards in dead space) and the game board (huge default `<select>` elements, a muddy
brown disabled button, no header, weak hierarchy).

---

## 0. Hard constraints (read first)

1. **Do not modify game logic.** CSS-first. You may edit `public/index.html` and the
   HTML template strings inside `public/js/components/*.js`, but ONLY to add wrappers,
   attributes, or decorative elements — every ID and class listed in §0.1 must survive
   with its current meaning, because JS queries and toggles them.
2. **No new dependencies, no build step, no framework, no external requests.** The Pi
   serves every byte. No Google Fonts, no CDN icons — system font stacks and inline SVG
   data URIs only.
3. **Animations are CSS-only** and every one of them must be disabled under
   `@media (prefers-reduced-motion: reduce)`.
4. Two stylesheets stay two stylesheets: `public/css/tokens.css` (design tokens only)
   and `public/css/app.css` (everything else). No preprocessor, no utility framework.
5. One permitted exception to "no JS": if you want the photo fade-in on load (§4), you
   may add a 2-line `load` event listener that toggles a class on `#photo-img`. That is
   presentational JS, not game logic. Nothing else.

### 0.1 Load-bearing selectors (the contract — JS references all of these)

- **Shell:** `#app`, `.screen-enter` (toggled by app.js for screen transitions)
- **Gate:** `#gate-form`, `#gate-password`, `#gate-error` (+ `hidden` attr toggling)
- **Setup:** `#setup-form`, `#profile-url`, `#day-toggle`, `#hard-toggle`, `.toggle`,
  `.toggle-knob`, `.toggle-on` (JS toggles), `#rounds-row`, `.chip-btn`,
  `.chip-btn-active` (JS toggles), `#setup-error`, `#progress-card`, `#progress-label`,
  `#progress-fill`, `#progress-count` (+ `hidden` attr toggling on form/progress)
- **Prep screen (app.js):** `#prep-label`, `#prep-fill`, `#prep-count`,
  `.progress-card`, `.progress-bar`, `.progress-fill`, `.btn-outline` (appended on error)
- **Board:** `#round-chip`, `#photo-card`, `#photo-img`, `#revealed-day`,
  `#guess-input-slot`, `#history-list`, `.photo-frame`
- **Guess input:** `#guess-month`, `#guess-year`, `#guess-day`, `#guess-btn`,
  `.picker`, `.picker-locked` (JS adds), `disabled` attribute states
- **History:** `.history-row`, `.history-cell`, `.cell-correct`, `.cell-early`,
  `.cell-late`, `.cell-wrong`
- **Reveal:** `.reveal-overlay`, `.reveal-card`, `.reveal-solved`, `.reveal-date`,
  `#reveal-points`, `#reveal-continue`
- **Results:** `.results-total`, `.dot-strip`, `.dot`, `.dot-solved`, `.dot-partial`,
  `.dot-zero`, `#play-again`, `#new-account`

### 0.2 Known CSS bug — fix this first

The setup screenshot shows the form AND the "Reading the album…" progress card visible
simultaneously. Root cause: `.progress-card { display: flex; }` **overrides the
`hidden` attribute** (whose default is only `display: none` at UA-stylesheet
specificity). Add to the base layer:

```css
[hidden] { display: none !important; }
```

This is the only `!important` allowed in the codebase.

### 0.3 Second known bug-by-styling — the muddy Guess button

`.btn:disabled { opacity: 0.5 }` over amber on dark charcoal produces the dirty brown
button in the board screenshot. Disabled must be restyled as its own neutral state
(§3.5), never faded amber.

---

## 1. Visual direction

Keep the established identity — deep charcoal, warm amber, photo-first — and add the
depth the spec promised: warmer surfaces, a faint amber wash on the page, real
elevation, print-like photo framing, and a disciplined type/spacing scale.

### 1.1 Tokens (replace `tokens.css` content with this, keeping the two existing
font tokens)

```css
:root {
  /* color */
  --bg: #1a1a1d;
  --surface: #2c2a28;      /* cards */
  --surface-2: #343130;    /* raised bits on cards (segmented control track, etc.) */
  --field: #201f1e;        /* input/select/photo-frame backgrounds — darker than card */
  --border: rgba(242, 239, 233, 0.10);
  --border-strong: rgba(242, 239, 233, 0.18);
  --accent: #e8a54b;
  --accent-strong: #f2c879;
  --accent-glow: rgba(232, 165, 75, 0.35);
  --early: #5b8dbe;
  --late: #d97757;
  --danger: #d97757;       /* errors reuse the coral */
  --text: #f2efe9;
  --text-dim: #9b9691;
  --text-on-accent: #241a0e;  /* dark text on amber fills */
  --win-gradient: linear-gradient(135deg, #e8a54b, #f2c879);

  /* elevation */
  --shadow-1: 0 2px 8px rgba(0, 0, 0, 0.25);
  --shadow-2: 0 8px 28px rgba(0, 0, 0, 0.40);
  --frame-ring: inset 0 0 0 1px rgba(232, 165, 75, 0.14);

  /* radius */
  --radius-card: 16px;
  --radius-field: 10px;
  --radius-cell: 8px;
  --radius-pill: 999px;

  /* spacing — 4pt scale; use these, stop hardcoding px */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px;  --s-4: 16px;
  --s-5: 20px; --s-6: 24px; --s-8: 32px;

  /* type scale */
  --font-ui: -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
  --font-accent: Georgia, "Times New Roman", serif;
  --fs-micro: 0.72rem;   /* uppercase micro-labels, letter-spacing 0.08em */
  --fs-small: 0.85rem;
  --fs-body: 1rem;
  --fs-title: 1.25rem;
  --fs-display: 2rem;
  --fs-hero: 2.75rem;

  /* motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* toggle knob, pops */
  --t-fast: 140ms;
  --t-med: 240ms;
}
```

### 1.2 Page atmosphere

- Body keeps `--bg` but add a fixed, very faint warm wash so the page isn't a dead
  flat black: `background: radial-gradient(1200px 600px at 50% -10%,
  rgba(232,165,75,0.05), transparent 60%), var(--bg);`
- All cards: `background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow-2);` — the 1px border is what makes surfaces read as
  edges on dark UIs; the current cards float ambiguously.

### 1.3 Typography rules

- UI text: `--font-ui` only. `--font-accent` (serif) appears in exactly three places:
  the new wordmark (§3.1), the reveal date/points, and the results total. Nowhere else.
- Section labels ("Instagram profile", "Rounds") become uppercase micro-labels:
  `--fs-micro`, `letter-spacing: 0.08em`, `text-transform: uppercase`, `--text-dim`.
- Numbers players read (points, years) get `font-variant-numeric: tabular-nums`.

---

## 2. Layout system

- Keep the single centered column, `max-width: 520px`. Add fluid horizontal padding:
  `padding-inline: clamp(12px, 4vw, 24px)`.
- Vertical rhythm between stacked cards/sections: `--s-6` (24px), consistently — the
  current screens mix 8/16/24 arbitrarily.
- Every interactive element ≥ 44px tall (touch target floor). Pickers and primary
  buttons: 52px.

---

## 3. Component-level changes

### 3.1 App shell & header

- Add a slim header row to `index.html` (no JS touches it):
  `<header class="wordmark">gramle</header>` — lowercase, `--font-accent`, `--fs-title`,
  `--accent`, `letter-spacing: 0.02em`, centered, `margin-block: var(--s-4) var(--s-6)`.
  It gives every screen an anchor; currently the app has no identity anywhere.
- Optional nicety: inline SVG data-URI favicon (amber rounded square, serif "g").

### 3.2 Password gate

- Card gets the §1.2 surface treatment; width caps at 360px (it currently stretches to
  the full 520 column and feels empty).
- Input: `--field` background, `--radius-field`, 1px `--border`, and a visible focus
  state: `border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow);`
  (this focus recipe applies to ALL inputs/selects app-wide).
- Error text `--danger`, slides in (§4). Lockout copy stays `--text-dim`.

### 3.3 Setup screen

- **One card, two states.** With the `[hidden]` bug fixed (§0.2), only the form OR the
  progress view shows. Style the progress card identically to the form card so the
  submit feels like the card transforming, not a second card appearing.
- Micro-labels per §1.3 for "Instagram profile" and "Rounds".
- **Toggles:** keep structure; enlarge to 48×28 track / 22px knob; knob transition
  `transform var(--t-med) var(--ease-spring)`; when `.toggle-on`, track gets
  `background: rgba(232,165,75,0.35)` plus `box-shadow: 0 0 12px var(--accent-glow)`.
  Make the whole `.toggle-row` a comfortable 48px tall with the label vertically
  centered.
- **Rounds selector → segmented control.** Style `#rounds-row` as one connected track:
  `background: var(--field); border-radius: var(--radius-pill); padding: var(--s-1);`
  and each `.chip-btn` as a borderless pill segment; `.chip-btn-active` = amber fill,
  `--text-on-accent` text, `--shadow-1`. (Pure CSS; JS class toggling is unchanged.)
- **Progress bar:** track `--field`, fill amber with a shimmer sweep (§4). Label
  `--fs-body`, count `--fs-small` `--text-dim`.

### 3.4 Game board

- **Status bar instead of a floating chip.** Keep `#round-chip` but style it as a
  full-width flex row above the photo: "PHOTO 3 / 8" as a micro-label left, points
  right in tabular nums. (Its text is one string set by JS — acceptable; render the
  whole string right-aligned in a bordered pill if splitting is not possible without
  JS. Do not touch the JS.)
- **Photo as a print.** `#photo-card`: matte padding `--s-3`, `--frame-ring` + border
  per §1.2. `.photo-frame`: background near-black `#141416` (letterboxing reads as
  intentional), `border-radius: calc(var(--radius-card) - 6px)`, keep
  `aspect-ratio: 1/1` BUT cap it: `max-height: min(58vh, 520px); margin-inline: auto;`
  — in the current build a tall viewport produces a huge photo that shoves the pickers
  below the fold (visible in the screenshot).
- `#revealed-day` becomes a caption strip inside the matte: `--fs-small`, `--text-dim`,
  centered, `font-style: italic` — like a pencil note under a print.

### 3.5 Guess input (the "keyboard")

This is the worst offender in the screenshots — raw OS `<select>` chrome.

- **Selects:** `appearance: none;` + custom chevron as an inline SVG data URI
  (`background: var(--field) url("data:image/svg+xml,...") no-repeat right 14px
  center / 12px`), height 52px, `--radius-field`, 1px `--border`, `--fs-body` text,
  padding-inline `--s-4`, shared focus recipe from §3.2. **Font-size must be ≥16px
  to prevent iOS zoom-on-focus.**
- **Locked pickers** (`.picker-locked`, set by JS when a field is guessed right):
  amber border, `background: rgba(232,165,75,0.10)`, amber text, and a ✓ replacing the
  chevron (second SVG data URI). Kill the default disabled-select dimming
  (`opacity: 1; -webkit-text-fill-color: var(--accent);`) so locked reads as "won",
  not "broken".
- **Guess button:** default = solid amber, `--text-on-accent`, 52px, `--shadow-1`;
  hover = `--accent-strong` + translateY(-1px); active = scale(0.98);
  **disabled = `background: var(--surface-2); color: var(--text-dim); box-shadow:
  none;`** — this replaces the muddy 50%-opacity amber (§0.3).

### 3.6 History tiles

Make them read as game tiles, not list rows:

- Cells: min-height 44px, centered content, `--fs-body` value in weight 700 +
  tabular nums, arrow/glyph in a `--fs-small` span (already separate text — style via
  `::first-line`? No — the arrow is inline text; just size the whole cell text and let
  the glyph inherit; acceptable).
- `.cell-correct`: **solid amber fill, `--text-on-accent` text** (Wordle-green
  equivalent — the current translucent amber is too quiet for the win state).
- `.cell-early` / `.cell-late`: keep translucent tints but add a 1px border of the
  same hue at 40% alpha so tiles have edges.
- `.cell-wrong` (hard mode): `--field` background, `--text-dim` text, no border —
  visually "dead".
- Row gap `--s-2`; rows sit directly under the guess button with a `--s-4` gap.

### 3.7 Reveal overlay

- Backdrop: `rgba(26,26,29,0.7)` + `backdrop-filter: blur(6px)` (with the rgba as
  the no-support fallback).
- Card entrance: scale 0.94→1 + fade, `--t-med` `--ease-out`.
- `.reveal-date`: `--font-accent`, `--fs-title`. `#reveal-points`: `--fs-hero`.
- `.reveal-solved #reveal-points`: keep gradient text, add a soft radial gold glow
  behind it (`::before` with a blurred radial gradient, no animation lib) that pulses
  once (§4). No confetti — it fights the scrapbook tone.

### 3.8 Results

- `.results-total`: `--fs-hero`, gradient text (exists), plus the same one-shot glow
  as the reveal.
- Dots: 16px, gap `--s-3`. `.dot-partial` becomes an amber **ring** (2px border, no
  fill) instead of half-opacity amber — much clearer at a glance than alpha shading.
- Buttons: `#play-again` primary amber; `#new-account` stays `.btn-outline` but with
  `--border-strong` and hover state (border → amber, text → amber).

---

## 4. Animations & microinteractions (all CSS, all reduced-motion-gated)

Keep: screen fade/slide (`.screen-enter`), reveal fade-in, points count-up (JS,
already exists). Add:

1. **Tile flip-in on the newest guess row.** `renderHistory` re-renders the whole
   list with newest first, so scope the animation to `.history-row:first-child` only
   (older rows re-mount without animating):
   ```css
   .history-row:first-child .history-cell {
     animation: flip-in 320ms var(--ease-out) backwards;
   }
   .history-row:first-child .history-cell:nth-child(2) { animation-delay: 90ms; }
   .history-row:first-child .history-cell:nth-child(3) { animation-delay: 180ms; }
   @keyframes flip-in { from { transform: rotateX(90deg); opacity: 0; } }
   ```
2. **Shake on wrong password.** No JS hook exists, but the error element flips its
   `hidden` attribute, so: `.gate-card:has(#gate-error:not([hidden])) { animation:
   shake 360ms; }` — `display:none → visible` re-triggers the animation on every
   failed attempt. `:has()` unsupported → graceful no-shake, error text still appears.
3. **Button press** `:active { transform: scale(0.98); }` on all `.btn`.
4. **Toggle knob spring** via `--ease-spring` (§3.3).
5. **Progress shimmer:** `.progress-fill::after` = translucent white gradient sweep,
   1.2s loop — signals liveness during the long index/prep waits.
6. **Photo fade-in on load** — the one permitted 2-line JS exception (§0.5): add
   `loaded` class on the img `load` event; CSS transitions opacity 0→1. Skip entirely
   if you'd rather stay 100% JS-free.
7. **Gold glow pulse** (one-shot, ~600ms) behind reveal points / results total on
   solved states.

Blanket kill-switch:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;   /* second !important exception, scoped here only */
    transition: none !important;
  }
}
```

---

## 5. Responsive & mobile

- **Photo height clamp** (§3.4) is the most important mobile fix: photo + pickers +
  button must fit one 667px-tall viewport without scrolling to guess.
- Selects ≥16px font (iOS zoom), all targets ≥44px.
- Short viewports (`max-height: 700px`): make `.guess-input` `position: sticky;
  bottom: 0;` with a `linear-gradient(transparent, var(--bg) 30%)` backdrop and
  `padding-bottom: env(safe-area-inset-bottom)` so the Guess button stays under the
  thumb while history scrolls beneath.
- Reveal overlay becomes a bottom sheet under 480px width (border-radius only on top
  corners, card pinned to bottom) — feels native on phones.
- Desktop (≥900px) optional stretch goal: CSS-grid two-column board (photo left,
  input+history right), no JS or markup changes required if `#photo-card` /
  `#guess-input-slot` / `#history-list` become grid areas of `.board-screen`. Only do
  this if everything else is done.

---

## 6. CSS architecture

- **Two files, no more.** `tokens.css` = §1.1 block only. `app.css` organized in
  commented layers, in this order: base/reset (incl. the `[hidden]` fix) → shell/
  header → shared primitives (`.card`, `.btn`, `.picker`, focus recipe) → per-screen
  sections (gate, setup, board, input, history, reveal, results) → motion (all
  keyframes together) → media queries last.
- Every color/space/radius/duration comes from a token. If you need a value that has
  no token, add the token.
- Naming stays component-prefixed as-is (`.gate-*`, `.reveal-*`); no BEM migration,
  no utility classes.
- Exactly two `!important`s in the codebase: the `[hidden]` fix and the
  reduced-motion block.

---

## 7. Acceptance checklist

- [ ] Setup screen: form and progress card are never visible simultaneously
- [ ] Disabled Guess button is neutral gray, not faded amber
- [ ] Selects show custom chrome (no OS default arrows) on Chrome + Safari
- [ ] Locked picker reads amber/✓, not disabled-gray
- [ ] Hard-mode `.cell-wrong` tiles are visually distinct from `.cell-early/late`
- [ ] Newest guess row flip-animates; older rows don't re-animate
- [ ] Wrong password shakes the card (Chrome) and degrades silently where `:has()` is unsupported
- [ ] 375×667 viewport: photo, pickers, and Guess all visible without scrolling
- [ ] No iOS zoom when focusing a select
- [ ] `prefers-reduced-motion: reduce` disables every animation and transition
- [ ] No network request leaves the Pi's origin (check DevTools network tab)
- [ ] Every selector in §0.1 still exists and JS behavior is byte-identical
