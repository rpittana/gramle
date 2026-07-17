const { spawn } = require("child_process");
const fs = require("fs/promises");
const { INSTALOADER_BIN, IG_LOGIN_USER, IG_SESSION_FILE } = require("../config");

const PROFILE_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,30})\/?(?:[?#].*)?$/i;
const BARE_USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
const JSON_EXT_RE = /\.json$/i;
const POLL_MS = 1500;

// Accepts either a full profile URL or a bare username; returns null if
// neither shape matches (e.g. someone pasted a post link or a search query).
function parseProfileInput(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(PROFILE_URL_RE);
  if (urlMatch) return urlMatch[1];

  if (BARE_USERNAME_RE.test(trimmed)) return trimmed;

  return null;
}

async function countFiles(dir, re) {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => re.test(f)).length;
  } catch {
    return 0;
  }
}

async function buildAuthArgs() {
  if (!IG_LOGIN_USER) return [];
  // A missing session file means the one-time interactive login (see
  // .env.example) hasn't been run yet. Fail fast with a clear message
  // instead of spawning Instaloader, which would otherwise die on a
  // password prompt it can't answer headlessly.
  const hasSession = await fs.access(IG_SESSION_FILE).then(
    () => true,
    () => false
  );
  if (!hasSession) {
    throw new Error(
      `No saved Instagram login session for "${IG_LOGIN_USER}" at ${IG_SESSION_FILE}. ` +
        "Run the one-time login step (see .env.example) before scraping."
    );
  }
  return ["--login", IG_LOGIN_USER, "--sessionfile", IG_SESSION_FILE];
}

// Instagram blocking a query (403/401 on the GraphQL endpoint) makes
// Instaloader print a misleading "does not exist" for profiles that are very
// much real — check for the block first so we don't send users chasing a typo
// that isn't there. username may be null for post-download runs, where the
// "does not exist" phrasing wouldn't apply.
function classifyFailure(stderrTail, username) {
  const tail = stderrTail.toLowerCase();
  const looksBlocked = /\b40[13]\b/.test(tail) || tail.includes("json query");
  if (!looksBlocked && username && tail.includes("does not exist")) {
    return new Error(`The profile "${username}" doesn't exist or isn't public.`);
  }
  return new Error("Instagram wouldn't let us in right now — try again in a few minutes.");
}

// Shared spawn wrapper. stdin is closed so any interactive fallback prompt
// fails fast instead of hanging; stdout is drained so a chatty run can't
// fill the pipe buffer and stall the child.
function runInstaloader(args, cwd, { registerChild, onTick } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(INSTALOADER_BIN, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    if (registerChild) registerChild(child);

    let stderrTail = "";
    let settled = false;
    const poll = onTick ? setInterval(() => onTick(child), POLL_MS) : null;

    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    child.on("error", (err) => {
      if (poll) clearInterval(poll);
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Couldn't start the scraper (${err.code === "ENOENT" ? "instaloader isn't installed" : err.message}).`
        )
      );
    });

    child.on("close", () => {
      if (poll) clearInterval(poll);
      if (settled) return;
      settled = true;
      resolve({ stderrTail });
    });
  });
}

// Phase 1 of the pipeline: walk the profile's posts downloading METADATA ONLY
// (--no-pictures) — one small .json per post, named {shortcode}.json, no
// images. This is what lets a game know every post's date (so year bounds
// span the whole account) without ever pulling media for posts that won't be
// played. maxPosts caps how deep into the profile's history we walk; since
// this counts posts (json files), carousels no longer burn through the cap
// the way per-image counting did.
async function indexProfile(username, rawDir, { maxPosts, onProgress, registerChild } = {}) {
  await fs.mkdir(rawDir, { recursive: true });
  const auth = await buildAuthArgs();

  const args = [
    "--no-pictures",
    "--no-videos",
    "--no-video-thumbnails",
    "--no-profile-pic",
    "--no-captions",
    "--no-compress-json",
    "--filename-pattern",
    "{shortcode}",
    ...auth,
    "--dirname-pattern",
    rawDir,
    username,
  ];

  let capped = false;
  const { stderrTail } = await runInstaloader(args, rawDir, {
    registerChild,
    onTick: async (child) => {
      const n = await countFiles(rawDir, JSON_EXT_RE);
      if (onProgress) onProgress({ indexed: n });
      if (maxPosts && n >= maxPosts && !capped) {
        capped = true;
        child.kill("SIGTERM");
      }
    },
  });

  const count = await countFiles(rawDir, JSON_EXT_RE);
  if (count === 0) throw classifyFailure(stderrTail, username);
  return { count };
}

const SAFE_SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;
// Deep walks (large profile, targets near the end of the indexed window)
// shouldn't be able to pin the single-concurrency queue forever.
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

// Phase 2: download only the posts a game actually sampled. Instaloader's
// direct "-<shortcode>" post-target syntax hits a separate GraphQL query
// (single-post lookup) that's currently broken server-side on Instagram's
// end ("Fetching Post metadata failed", confirmed by manual testing even
// with a valid authenticated session) — so instead this walks the profile's
// timeline (the same query indexProfile already uses successfully) and uses
// --post-filter to only download images for posts whose shortcode is one we
// sampled. --slide 1 takes just the first image of a carousel — one image
// per post, which is also what keeps two near-identical shots from the same
// carousel out of a single game.
async function downloadPosts(username, shortcodes, rawDir, { onProgress, registerChild } = {}) {
  await fs.mkdir(rawDir, { recursive: true });
  const auth = await buildAuthArgs();

  const badShortcode = shortcodes.find((sc) => !SAFE_SHORTCODE_RE.test(sc));
  if (badShortcode) throw new Error(`Unexpected shortcode format: ${badShortcode}`);

  const filterExpr = `shortcode in {${shortcodes.map((sc) => JSON.stringify(sc)).join(", ")}}`;

  const args = [
    "--no-videos",
    "--no-video-thumbnails",
    "--no-captions",
    "--no-metadata-json",
    "--no-compress-json",
    "--no-profile-pic",
    "--slide",
    "1",
    "--post-filter",
    filterExpr,
    "--filename-pattern",
    "{shortcode}",
    ...auth,
    "--dirname-pattern",
    rawDir,
    username,
  ];

  const target = shortcodes.length;
  let foundAll = false;

  const { stderrTail } = await runInstaloader(args, rawDir, {
    registerChild: (child) => {
      if (registerChild) registerChild(child);
      setTimeout(() => {
        if (!foundAll) child.kill("SIGTERM");
      }, DOWNLOAD_TIMEOUT_MS);
    },
    onTick: async (child) => {
      const n = await countFiles(rawDir, IMAGE_EXT_RE);
      if (onProgress) onProgress({ downloaded: n });
      if (n >= target && !foundAll) {
        foundAll = true;
        child.kill("SIGTERM");
      }
    },
  });

  const count = await countFiles(rawDir, IMAGE_EXT_RE);
  if (count === 0) throw classifyFailure(stderrTail, null);
  return { count };
}

module.exports = { parseProfileInput, indexProfile, downloadPosts };
