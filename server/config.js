const path = require("path");
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

module.exports = {
  GAME_PASSWORD,
  PORT,
  CACHE_DIR,
  MAX_POSTS,
  SESSION_TTL_MIN,
};
