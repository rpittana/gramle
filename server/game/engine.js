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

// Called by the prep job once the sampled photos are downloaded and resized.
// photos: [{ photoId, isoDate }]; gameConfig carries dayMode/hardMode plus
// minYear/maxYear derived from the FULL index (every post on the profile),
// so the year picker spans the account's real history rather than leaking
// which era this game's sample came from.
function initRounds(sessionId, photos, { dayMode, hardMode, minYear, maxYear }) {
  games.set(sessionId, {
    dayMode: Boolean(dayMode),
    hardMode: Boolean(hardMode),
    totalRounds: photos.length,
    currentRoundIndex: 0,
    minYear,
    maxYear,
    rounds: photos.map((p) => ({
      photoId: p.photoId,
      trueDate: isoToDateParts(p.isoDate),
      guesses: [],
      over: false,
      solved: false,
      pointsEarned: null,
    })),
  });
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
    hardMode: game.hardMode,
    minYear: game.minYear,
    maxYear: game.maxYear,
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

  // Hard mode: mask the earlier/later direction — the player only learns
  // whether each field is right or wrong. Masked BEFORE it's stored in the
  // guess history, so the round view can't leak directions either.
  if (game.hardMode) {
    for (const field of Object.keys(feedback)) {
      if (feedback[field] !== "correct") feedback[field] = "wrong";
    }
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
      hardMode: game.hardMode,
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

module.exports = { initRounds, currentRoundView, submitGuess, endGame, clearGame };
