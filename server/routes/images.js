const express = require("express");
const path = require("path");
const { sessionDir } = require("../sessions");

const router = express.Router();

// photoId is always a crypto.randomBytes(8).toString("hex") value minted by
// ingest.js — validate the shape strictly before touching the filesystem.
const SAFE_ID_RE = /^[a-f0-9]{16}$/;

// The session comes from the auth cookie (requireAuth ran upstream), never
// from the URL, so one player can never fetch another session's images.
router.get("/:photoId.jpg", (req, res) => {
  const { photoId } = req.params;
  if (!SAFE_ID_RE.test(photoId)) {
    return res.status(400).end();
  }

  const filePath = path.join(sessionDir(req.session.sessionId), "photos", `${photoId}.jpg`);

  res.set("Cache-Control", "private, max-age=1800");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).end();
    }
  });
});

module.exports = router;
