const rateLimit = require("express-rate-limit");

const WINDOW_MS = 15 * 60 * 1000;

// Only failed login attempts count toward the limit (skipSuccessfulRequests),
// so a user who eventually enters the right password isn't penalized for
// earlier typos. 5 failures within the window locks the IP out for 15 min.
const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler(req, res) {
    const retryAfterSec = Math.ceil(WINDOW_MS / 1000);
    res.status(429).json({
      error: "Too many attempts. Try again later.",
      retryAfterSec,
    });
  },
});

module.exports = { loginLimiter };
