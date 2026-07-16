const express = require("express");
const { requireAuth, handleLogin, handleLogout } = require("../auth");
const { loginLimiter } = require("../rateLimit");
const queue = require("../scrape/queue");
const { readManifest } = require("../scrape/ingest");
const { sessionDir, resetSessionFiles } = require("../sessions");
const engine = require("../game/engine");

const router = express.Router();

router.post("/login", loginLimiter, handleLogin);
router.post("/logout", handleLogout);

router.use(requireAuth);

router.post("/scrape", (req, res) => {
  try {
    queue.enqueue(req.session.sessionId, req.body?.profileUrl);
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get("/scrape/status", (req, res) => {
  res.json(queue.getStatus(req.session.sessionId));
});

router.post("/game/start", async (req, res) => {
  try {
    const manifest = await readManifest(sessionDir(req.session.sessionId));
    const { rounds, dayMode } = req.body || {};
    const result = engine.startGame(req.session.sessionId, manifest, { rounds, dayMode });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get("/game/round", (req, res) => {
  try {
    const view = engine.currentRoundView(req.session.sessionId);
    res.json({ ...view, photoUrl: `/img/${view.photoId}.jpg` });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post("/game/guess", (req, res) => {
  try {
    const result = engine.submitGuess(req.session.sessionId, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// "New account" flow: finalize scoring, wipe this session's images/manifest
// so the next scrape starts clean, but keep the login itself alive (no
// re-entering the password just to try a different profile).
router.post("/game/end", async (req, res) => {
  try {
    const summary = engine.endGame(req.session.sessionId);
    await resetSessionFiles(req.session.sessionId);
    res.json(summary);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
