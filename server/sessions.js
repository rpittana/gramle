const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { CACHE_DIR } = require("./config");

// token -> { sessionId, createdAt, lastActivity }
const sessions = new Map();

function sessionDir(sessionId) {
  return path.join(CACHE_DIR, sessionId);
}

async function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const sessionId = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  sessions.set(token, { sessionId, createdAt: now, lastActivity: now });

  const dir = sessionDir(sessionId);
  await fs.mkdir(path.join(dir, "raw"), { recursive: true });
  await fs.mkdir(path.join(dir, "photos"), { recursive: true });

  return { token, sessionId };
}

function getSession(token) {
  return sessions.get(token);
}

function touchSession(token) {
  const record = sessions.get(token);
  if (record) record.lastActivity = Date.now();
}

// Deferred requires avoid a circular dependency at module-load time: queue.js
// and engine.js don't need to know about sessions.js, but sessions.js needs to
// tell them to drop any in-memory state for a session being destroyed.
async function destroySession(token) {
  const record = sessions.get(token);
  if (!record) return;
  sessions.delete(token);

  const { cancelSessionJob } = require("./scrape/queue");
  const { clearGame } = require("./game/engine");
  cancelSessionJob(record.sessionId);
  clearGame(record.sessionId);

  await fs.rm(sessionDir(record.sessionId), { recursive: true, force: true });
}

// Wipes a session's images/manifest but keeps the login (auth cookie) alive —
// used when a game ends and the player wants to start over with a new
// Instagram profile without re-entering the password. Full session teardown
// (including the auth cookie) only happens via destroySession/logout/timeout.
async function resetSessionFiles(sessionId) {
  const dir = sessionDir(sessionId);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, "raw"), { recursive: true });
  await fs.mkdir(path.join(dir, "photos"), { recursive: true });
}

// Called once at boot: the in-memory Map is empty after a restart, so any
// directory left on disk is orphaned by definition.
async function destroyAllOnDisk() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const entries = await fs.readdir(CACHE_DIR, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map((e) => fs.rm(path.join(CACHE_DIR, e.name), { recursive: true, force: true }))
  );
}

// Sweeps sessions inactive longer than ttlMs. Returns the list of destroyed tokens.
async function sweepInactive(ttlMs) {
  const now = Date.now();
  const stale = [];
  for (const [token, record] of sessions.entries()) {
    if (now - record.lastActivity > ttlMs) stale.push(token);
  }
  await Promise.all(stale.map((token) => destroySession(token)));
  return stale;
}

module.exports = {
  sessionDir,
  createSession,
  getSession,
  touchSession,
  destroySession,
  resetSessionFiles,
  destroyAllOnDisk,
  sweepInactive,
};
