const {
  GUESSES_PER_ROUND,
  fieldDirection,
  isExactGuess,
  computeRoundScore,
} = require("./scoring");

// sessionId -> game record
const games = new Map();

function isoToDateParts(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}

function shuffled(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// manifest: [{ photoId, isoDate }, ...] for the session's full scraped set.
// Samples `rounds` photos without repeats (capped to what's available) and
// resets any prior game state for this session.
function startGame(sessionId, manifest, { rounds, dayMode }) {
  if (!manifest || manifest.length === 0) {
    const err = new Error("No photos available — scrape a profile first.");
    err.status = 400;
    throw err;
  }

  const roundCount = Math.max(1, Math.min(rounds || 8, manifest.length));
  const sample = shuffled(manifest).slice(0, roundCount);
  const years = manifest.map((p) => isoToDateParts(p.isoDate).year);

  const game = {
    dayMode: Boolean(dayMode),
    totalRounds: roundCount,
    currentRoundIndex: 0,
    rounds: sample.map((p) => ({
      photoId: p.photoId,
      trueDate: isoToDateParts(p.isoDate),
      guesses: [],
      over: false,
      solved: false,
      pointsEarned: null,
    })),
    minYear: Math.min(...years),
    maxYear: Math.max(...years),
  };

  games.set(sessionId, game);
  return { totalRounds: game.totalRounds, minYear: game.minYear, maxYear: game.maxYear };
}

function getGame(sessionId) {
  const game = games.get(sessionId);
  if (!game) {
    const err = new Error("No active game for this session.");
    err.status = 400;
    throw err;
  }
  return game;
}

function currentRoundView(sessionId) {
  const game = getGame(sessionId);
  const round = game.rounds[game.currentRoundIndex];
  if (!round) {
    const err = new Error("Game is already complete.");
    err.status = 400;
    throw err;
  }

  return {
    roundIndex: game.currentRoundIndex,
    totalRounds: game.totalRounds,
    photoId: round.photoId,
    dayMode: game.dayMode,
    guessesUsed: round.guesses.length,
    guessesRemaining: GUESSES_PER_ROUND - round.guesses.length,
    guesses: round.guesses,
    over: round.over,
    revealedDay: game.dayMode ? undefined : round.trueDate.day,
  };
}

function submitGuess(sessionId, guess) {
  const game = getGame(sessionId);
  const round = game.rounds[game.currentRoundIndex];
  if (!round) {
    const err = new Error("Game is already complete.");
    err.status = 400;
    throw err;
  }
  if (round.over) {
    const err = new Error("This round is already over.");
    err.status = 400;
    throw err;
  }

  const normalizedGuess = {
    year: Number(guess.year),
    month: Number(guess.month),
    day: game.dayMode ? Number(guess.day) : undefined,
  };

  const feedback = {
    year: fieldDirection(normalizedGuess.year, round.trueDate.year),
    month: fieldDirection(normalizedGuess.month, round.trueDate.month),
  };
  if (game.dayMode) {
    feedback.day = fieldDirection(normalizedGuess.day, round.trueDate.day);
  }

  const solved = isExactGuess(normalizedGuess, round.trueDate, game.dayMode);
  round.guesses.push({ guess: normalizedGuess, feedback });

  const exhausted = round.guesses.length >= GUESSES_PER_ROUND;
  const roundOver = solved || exhausted;

  const response = { feedback, roundOver, guessesRemaining: GUESSES_PER_ROUND - round.guesses.length };

  if (roundOver) {
    round.over = true;
    round.solved = solved;
    round.pointsEarned = computeRoundScore({
      solved,
      guessNumber: round.guesses.length,
      finalGuess: normalizedGuess,
      trueDate: round.trueDate,
      dayMode: game.dayMode,
    });

    response.solved = solved;
    response.trueDate = round.trueDate;
    response.pointsEarned = round.pointsEarned;

    game.currentRoundIndex += 1;
    response.gameOver = game.currentRoundIndex >= game.totalRounds;
  }

  return response;
}

function endGame(sessionId) {
  const game = getGame(sessionId);
  const summary = {
    totalScore: game.rounds.reduce((sum, r) => sum + (r.pointsEarned || 0), 0),
    rounds: game.rounds.map((r) => ({
      solved: r.solved,
      pointsEarned: r.pointsEarned,
      trueDate: r.trueDate,
    })),
  };
  games.delete(sessionId);
  return summary;
}

function clearGame(sessionId) {
  games.delete(sessionId);
}

module.exports = { startGame, currentRoundView, submitGuess, endGame, clearGame };
