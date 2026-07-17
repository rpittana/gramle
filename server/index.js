const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const { PORT, SESSION_TTL_MIN } = require("./config");
const { destroyAllOnDisk, sweepInactive } = require("./sessions");
const { requireAuth } = require("./auth");
const apiRouter = require("./routes/api");
const imagesRouter = require("./routes/images");

const app = express();

// Trust X-Forwarded-For only when the immediate peer is the loopback
// interface — i.e. only from a reverse proxy running on this same host.
// Without this, express-rate-limit refuses to start (it won't guess at an
// IP from a header it can't verify), and a direct LAN connection bypassing
// the proxy still can't spoof its way past the rate limiter.
app.set("trust proxy", "loopback");

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", apiRouter);
app.use("/img", requireAuth, imagesRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error." });
});

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function main() {
  // Boot reconciliation: the in-memory session Map starts empty, so any
  // directory already on disk (from a prior process) is an orphan.
  await destroyAllOnDisk();

  setInterval(() => {
    sweepInactive(SESSION_TTL_MIN * 60 * 1000).catch((err) => {
      console.error("Inactivity sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);

  app.listen(PORT, () => {
    console.log(`Gramle listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
