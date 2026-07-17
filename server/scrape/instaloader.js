const { spawn } = require("child_process");
const fs = require("fs/promises");
const { INSTALOADER_BIN } = require("../config");

const PROFILE_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,30})\/?(?:[?#].*)?$/i;
const BARE_USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
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

async function countImages(dir) {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => IMAGE_EXT_RE.test(f)).length;
  } catch {
    return 0;
  }
}

// Spawns Instaloader against a public profile, downloading photo posts only
// (videos/reels, captions, and per-post metadata JSON are all suppressed via
// flags) directly into rawDir. Instaloader has no built-in "download only the
// first N posts" flag, so the cap is enforced here by polling the directory
// and sending SIGTERM once maxPosts images are on disk — the process still
// exits cleanly and whatever was downloaded is kept (partial success).
function scrapeProfile(username, rawDir, { maxPosts, onProgress, registerChild } = {}) {
  return new Promise(async (resolve, reject) => {
    await fs.mkdir(rawDir, { recursive: true });

    const args = [
      "--no-videos",
      "--no-video-thumbnails",
      "--no-captions",
      "--no-metadata-json",
      "--no-compress-json",
      "--no-profile-pic",
      "--dirname-pattern",
      rawDir,
      username,
    ];

    const child = spawn(INSTALOADER_BIN, args, { cwd: rawDir });
    if (registerChild) registerChild(child);

    let stderrTail = "";
    let cappedByUs = false;
    let settled = false;

    const poll = setInterval(async () => {
      const count = await countImages(rawDir);
      if (onProgress) onProgress({ downloaded: count });
      if (maxPosts && count >= maxPosts && !cappedByUs) {
        cappedByUs = true;
        child.kill("SIGTERM");
      }
    }, POLL_MS);

    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    child.on("error", (err) => {
      clearInterval(poll);
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Couldn't start the scraper (${err.code === "ENOENT" ? "instaloader isn't installed" : err.message}).`
        )
      );
    });

    child.on("close", async () => {
      clearInterval(poll);
      if (settled) return;
      settled = true;
      const count = await countImages(rawDir);
      const tail = stderrTail.toLowerCase();
      // Instagram blocking an anonymous query (403/401 on the GraphQL
      // endpoint) makes Instaloader print a misleading "does not exist"
      // for profiles that are very much real — check for the block first
      // so we don't send users chasing a typo that isn't there.
      const looksBlocked = /\b40[13]\b/.test(tail) || tail.includes("json query");

      if (count > 0) {
        resolve({ count });
      } else if (looksBlocked) {
        reject(new Error("Instagram wouldn't let us in right now — try again in a few minutes."));
      } else if (tail.includes("does not exist")) {
        reject(new Error(`The profile "${username}" doesn't exist or isn't public.`));
      } else {
        reject(new Error("Instagram wouldn't let us in right now — try again in a few minutes."));
      }
    });
  });
}

module.exports = { parseProfileInput, scrapeProfile };
