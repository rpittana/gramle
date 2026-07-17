// Pure functions only — no I/O, no session state. Keeps this file trivially
// unit-testable in isolation from Express/session plumbing.

const POINTS_BY_GUESS = [500, 400, 300, 220, 150, 90];
const GUESSES_PER_ROUND = POINTS_BY_GUESS.length;

// Hard mode (no earlier/later hints, only right/wrong) pays out extra.
const HARD_MODE_MULTIPLIER = 1.5;

function pointsForSolve(guessNumber) {
  return POINTS_BY_GUESS[guessNumber - 1] ?? 0;
}

function monthsBetween(guessYear, guessMonth, trueYear, trueMonth) {
  return (guessYear - trueYear) * 12 + (guessMonth - trueMonth);
}

function consolationPoints(monthsOffAbs) {
  return Math.max(0, 60 - 6 * monthsOffAbs);
}

function dayBonus(daysOffAbs) {
  return Math.max(0, 20 - 2 * daysOffAbs);
}

// direction: -1 means the guess needs to move later, 1 means earlier, 0 exact.
function fieldDirection(guessValue, trueValue) {
  if (guessValue === trueValue) return "correct";
  return guessValue < trueValue ? "later" : "earlier";
}

function isExactGuess(guess, trueDate, dayMode) {
  if (guess.year !== trueDate.year || guess.month !== trueDate.month) return false;
  if (dayMode && guess.day !== trueDate.day) return false;
  return true;
}

// Called once, when a round ends (solved or guesses exhausted).
function computeRoundScore({ solved, guessNumber, finalGuess, trueDate, dayMode, hardMode }) {
  let points;
  if (solved) {
    points = pointsForSolve(guessNumber);
  } else {
    const monthsOffAbs = Math.abs(
      monthsBetween(finalGuess.year, finalGuess.month, trueDate.year, trueDate.month)
    );
    points = consolationPoints(monthsOffAbs);

    if (dayMode && finalGuess.year === trueDate.year && finalGuess.month === trueDate.month) {
      const daysOffAbs = Math.abs(finalGuess.day - trueDate.day);
      points += dayBonus(daysOffAbs);
    }
  }

  return hardMode ? Math.round(points * HARD_MODE_MULTIPLIER) : points;
}

module.exports = {
  GUESSES_PER_ROUND,
  HARD_MODE_MULTIPLIER,
  pointsForSolve,
  monthsBetween,
  consolationPoints,
  dayBonus,
  fieldDirection,
  isExactGuess,
  computeRoundScore,
};
