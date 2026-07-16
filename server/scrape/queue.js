const path = require("path");
const { scrapeProfile, parseProfileInput } = require("./instaloader");
const { ingestSession, clearRaw } = require("./ingest");
const { sessionDir } = require("../sessions");
const { MAX_POSTS } = require("../config");

// One scrape job runs at a time, globally, regardless of which session
// requested it — this is the RAM/IP-hygiene guardrail from the architecture
// spec, not a per-session limit.
const jobs = new Map(); // sessionId -> job record
const pendingQueue = []; // sessionIds waiting their turn, FIFO
let runningSessionId = null;
let activeChild = null;

function getStatus(sessionId) {
  const job = jobs.get(sessionId);
  if (!job) return { state: "none" };
  const queuePosition = job.state === "queued" ? pendingQueue.indexOf(sessionId) + 1 : 0;
  return {
    state: job.state,
    downloaded: job.downloaded || 0,
    resized: job.resized || 0,
    queuePosition,
    photoCount: job.photoCount,
    error: job.error,
  };
}

// Throws a descriptive error (never rejects a Promise) so the route handler
// can turn it directly into a 4xx response.
function enqueue(sessionId, profileInput) {
  const existing = jobs.get(sessionId);
  if (existing && (existing.state === "queued" || existing.state === "running")) {
    const err = new Error("A scrape is already in progress for this session.");
    err.status = 409;
    throw err;
  }

  const username = parseProfileInput(profileInput);
  if (!username) {
    const err = new Error("That doesn't look like a valid public Instagram profile.");
    err.status = 400;
    throw err;
  }

  jobs.set(sessionId, { state: "queued", username, downloaded: 0, resized: 0 });
  pendingQueue.push(sessionId);
  processQueue();
}

async function processQueue() {
  if (runningSessionId) return;
  const sessionId = pendingQueue.shift();
  if (!sessionId) return;

  const job = jobs.get(sessionId);
  if (!job) {
    processQueue();
    return;
  }

  runningSessionId = sessionId;
  job.state = "running";

  try {
    const dir = sessionDir(sessionId);
    const rawDir = path.join(dir, "raw");

    await scrapeProfile(job.username, rawDir, {
      maxPosts: MAX_POSTS,
      onProgress: ({ downloaded }) => {
        job.downloaded = downloaded;
      },
      registerChild: (child) => {
        activeChild = child;
      },
    });

    const manifest = await ingestSession(dir, {
      onProgress: ({ resized }) => {
        job.resized = resized;
      },
    });
    await clearRaw(dir);

    job.state = "done";
    job.photoCount = manifest.length;
  } catch (err) {
    job.state = "error";
    job.error = err.message;
  } finally {
    activeChild = null;
    runningSessionId = null;
    processQueue();
  }
}

// Called from sessions.destroySession(). Drops a still-queued job outright,
// or kills the in-flight Instaloader child if this session is the one
// currently running (the directory gets rm -rf'd right after by the caller,
// so there's no need to let ingest finish).
function cancelSessionJob(sessionId) {
  const idx = pendingQueue.indexOf(sessionId);
  if (idx !== -1) pendingQueue.splice(idx, 1);

  if (runningSessionId === sessionId && activeChild) {
    activeChild.kill("SIGTERM");
  }

  jobs.delete(sessionId);
}

module.exports = { enqueue, getStatus, cancelSessionJob };
