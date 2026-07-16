const crypto = require("crypto");
const { GAME_PASSWORD } = require("./config");
const { createSession, getSession, touchSession, destroySession } = require("./sessions");

const COOKIE_NAME = "gramle_session";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 1000 * 60 * 60 * 12, // 12h ceiling; inactivity sweep expires it much sooner
};

// Hash both sides to equal-length buffers before comparing. timingSafeEqual
// throws on a length mismatch, and a throw-vs-no-throw branch is itself a
// timing side channel that leaks the correct password's length.
function constantTimeMatches(submitted) {
  const a = crypto.createHash("sha256").update(String(submitted)).digest();
  const b = crypto.createHash("sha256").update(GAME_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

async function handleLogin(req, res) {
  const { password } = req.body || {};
  if (typeof password !== "string" || !constantTimeMatches(password)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  const { token } = await createSession();
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.status(204).end();
}

async function handleLogout(req, res) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) await destroySession(token);
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.status(204).end();
}

// Applied to all /api/* (except /api/login) and /img/* routes. Attaches the
// session record to req.session and bumps lastActivity, which is what the
// inactivity sweeper reads.
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const record = token && getSession(token);
  if (!record) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  touchSession(token);
  req.sessionToken = token;
  req.session = record;
  next();
}

module.exports = { handleLogin, handleLogout, requireAuth, COOKIE_NAME };
