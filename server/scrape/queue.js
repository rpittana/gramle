const path = require("path");
const { indexProfile, downloadPosts, parseProfileInput } = require("./instaloader");
const { parseIndex, readIndex, writeMeta, readMeta, ingestDownloads, clearRaw } = require("./ingest");
const { sessionDir } = require("../sessions");
const { MAX_POSTS } = require("../config");
const engine = require("../game/engine");

// One Instaloader job runs at a time, globally, regardless of session or job
// kind — this is the RAM/IP-hygiene guardrail from the architecture spec.
// Two kinds share the queue:
//   "index" — walk a profile's post metadata (no images)
//   "prep"  — download + resize the handful of photos one game sampled
const jobs = new Map(); // `${sessionId}:${kind}` -> job record
const pendingQueue = []; // { sessionId, kind }, FIFO
let running = null;
let activeChild = null;

const key = (sessionId, kind) => `${sessionId}:${kind}`;

function getStatus(sessionId, kind) {
  const job = jobs.get(key(sessionId, kind));
  if (!job) return { state: "none" };
  const queuePosition =
    job.state === "queued"
      ? pendingQueue.findIndex((p) => p.sessionId === sessionId && p.kind === kind) + 1
      : 0;
  return {
    state: job.state,
    indexed: job.indexed,
    downloaded: job.downloaded,
    resized: job.resized,
    total: job.total,
    postCount: job.postCount,
    queuePosition,
    error: job.error,
  };
}

function assertNotBusy(sessionId, kind) {
  const existing = jobs.get(key(sessionId, kind));
  if (existing && (existing.state === "queued" || existing.state === "running")) {
    const err = new Error("A job is already in progress for this session.");
    err.status = 409;
    throw err;
  }
}

// Throws descriptive errors (with .status) so route handlers can turn them
// directly into 4xx responses.
function enqueueIndex(sessionId, profileInput) {
  assertNotBusy(sessionId, "index");

  const username = parseProfileInput(profileInput);
  if (!username) {
    const err = new Error("That doesn't look like a valid public Instagram profile.");
    err.status = 400;
    throw err;
  }

  jobs.set(key(sessionId, "index"), { kind: "index", state: "queued", username, indexed: 0 });
  pendingQueue.push({ sessionId, kind: "index" });
  pump();
}

// payload: { shortcodes, gameConfig: { dayMode, hardMode, minYear, maxYear } }
function enqueuePrep(sessionId, payload) {
  assertNotBusy(sessionId, "prep");
  jobs.set(key(sessionId, "prep"), {
    kind: "prep",
    state: "queued",
    downloaded: 0,
    resized: 0,
    total: payload.shortcodes.length,
    payload,
  });
  pendingQueue.push({ sessionId, kind: "prep" });
  pump();
}

async function pump() {
  if (running) return;
  const next = pendingQueue.shift();
  if (!next) return;

  const job = jobs.get(key(next.sessionId, next.kind));
  if (!job) {
    pump();
    return;
  }

  running = next;
  job.state = "running";
  const dir = sessionDir(next.sessionId);
  const rawDir = path.join(dir, "raw");

  try {
    if (job.kind === "index") {
      await indexProfile(job.username, rawDir, {
        maxPosts: MAX_POSTS,
        onProgress: ({ indexed }) => {
          job.indexed = indexed;
        },
        registerChild: (child) => {
          activeChild = child;
        },
      });
      const index = await parseIndex(dir);
      await writeMeta(dir, { username: job.username });
      await clearRaw(dir);
      if (index.length === 0) {
        throw new Error("That profile has no photo posts to play with.");
      }
      job.postCount = index.length;
      job.state = "done";
    } else {
      const { username } = await readMeta(dir);
      if (!username) {
        throw new Error("No indexed profile for this session — scrape a profile first.");
      }
      await downloadPosts(username, job.payload.shortcodes, rawDir, {
        onProgress: ({ downloaded }) => {
          job.downloaded = downloaded;
        },
        registerChild: (child) => {
          activeChild = child;
        },
      });
      const index = await readIndex(dir);
      const byShortcode = new Map(index.map((e) => [e.shortcode, e]));
      const photos = await ingestDownloads(dir, byShortcode, {
        onProgress: ({ resized }) => {
          job.resized = resized;
        },
      });
      await clearRaw(dir);
      if (photos.length === 0) {
        throw new Error("Couldn't fetch any of the selected photos — try again.");
      }
      engine.initRounds(next.sessionId, photos, job.payload.gameConfig);
      job.state = "ready";
    }
  } catch (err) {
    job.state = "error";
    job.error = err.message;
  } finally {
    activeChild = null;
    running = null;
    pump();
  }
}

// Called from sessions.destroySession(). Drops queued jobs outright, and
// kills the in-flight Instaloader child if this session owns it (the
// directory gets rm -rf'd right after by the caller).
function cancelSessionJob(sessionId) {
  for (let i = pendingQueue.length - 1; i >= 0; i--) {
    if (pendingQueue[i].sessionId === sessionId) pendingQueue.splice(i, 1);
  }
  if (running && running.sessionId === sessionId && activeChild) {
    activeChild.kill("SIGTERM");
  }
  jobs.delete(key(sessionId, "index"));
  jobs.delete(key(sessionId, "prep"));
}

module.exports = { enqueueIndex, enqueuePrep, getStatus, cancelSessionJob };
