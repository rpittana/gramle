const express = require("express");
const { requireAuth, handleLogin, handleLogout } = require("../auth");
const { loginLimiter } = require("../rateLimit");
const queue = require("../scrape/queue");
const { readIndex } = require("../scrape/ingest");
const { sessionDir, resetSessionFiles } = require("../sessions");
const engine = require("../game/engine");

const router = express.Router();

router.post("/login", loginLimiter, handleLogin);
router.post("/logout", handleLogout);

router.use(requireAuth);

router.post("/scrape", (req, res) => {
  try {
    queue.enqueueIndex(req.session.sessionId, req.body?.profileUrl);
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get("/scrape/status", (req, res) => {
  res.json(queue.getStatus(req.session.sessionId, "index"));
});

function shuffled(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Samples this game's PHOTOS (index.json has one entry per photo — every
// carousel slide is its own entry, not just the post) and queues the
// on-demand download+resize ("prep") job. The client polls /game/status
// until ready.
router.post("/game/start", async (req, res) => {
  try {
    const index = await readIndex(sessionDir(req.session.sessionId));
    if (index.length === 0) {
      return res.status(400).json({ error: "No photos available — scrape a profile first." });
    }

    const { rounds, dayMode, hardMode } = req.body || {};
    const roundCount = Math.max(1, Math.min(Number(rounds) || 8, index.length));
    const sample = shuffled(index).slice(0, roundCount);
    const years = index.map((e) => Number(e.isoDate.slice(0, 4)));

    engine.clearGame(req.session.sessionId);
    queue.enqueuePrep(req.session.sessionId, {
      sampledPhotos: sample,
      gameConfig: {
        dayMode: Boolean(dayMode),
        hardMode: Boolean(hardMode),
        minYear: Math.min(...years),
        maxYear: Math.max(...years),
      },
    });
    res.status(202).json({ preparing: true, totalRounds: roundCount });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get("/game/status", (req, res) => {
  res.json(queue.getStatus(req.session.sessionId, "prep"));
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

// "New account" flow: finalize scoring, wipe this session's images/index so
// the next scrape starts clean, but keep the login itself alive (no
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
