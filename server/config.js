const path = require("path");
const os = require("os");
require("dotenv").config();

const GAME_PASSWORD = process.env.GAME_PASSWORD;
if (!GAME_PASSWORD) {
  throw new Error(
    "GAME_PASSWORD is not set. Create a .env file (see .env.example) before starting the server."
  );
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const CACHE_DIR = process.env.CACHE_DIR
  ? path.resolve(process.env.CACHE_DIR)
  : path.resolve("/var/cache/game");
const MAX_POSTS = Math.min(parseInt(process.env.MAX_POSTS, 10) || 150, 300);
const SESSION_TTL_MIN = parseInt(process.env.SESSION_TTL_MIN, 10) || 30;

// Debian/Raspberry Pi OS (PEP 668) blocks system-wide pip installs, so
// setup-pi.sh installs Instaloader into a dedicated venv instead of relying
// on PATH. Defaults to the bare command for anyone who installed it globally
// anyway (e.g. via pipx or an already-unmanaged environment).
const INSTALOADER_BIN = process.env.INSTALOADER_BIN || "instaloader";

// Optional authenticated-scraping mode: Instagram increasingly 403s anonymous
// GraphQL queries outright. If IG_LOGIN_USER is set, the scraper reuses a
// previously-saved Instaloader session file instead of scraping anonymously.
// That session file is created by a one-time interactive login the operator
// runs themselves (see .env.example) — this app never sees or stores the
// account's actual password, only the resulting session cookie file.
const IG_LOGIN_USER = process.env.IG_LOGIN_USER || null;
const IG_SESSION_FILE =
  process.env.IG_SESSION_FILE || path.join(os.homedir(), ".config", "gramle", "instaloader-session");

module.exports = {
  GAME_PASSWORD,
  PORT,
  CACHE_DIR,
  MAX_POSTS,
  SESSION_TTL_MIN,
  INSTALOADER_BIN,
  IG_LOGIN_USER,
  IG_SESSION_FILE,
};
