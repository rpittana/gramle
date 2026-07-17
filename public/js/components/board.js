import { api } from "../api.js";
import { renderGuessInput } from "./guessInput.js";
import { renderHistory } from "./history.js";
import { renderReveal } from "./reveal.js";

function ordinalSuffix(n) {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

// Any field guessed correctly at any point in the round stays locked for the
// rest of it — the player shouldn't have to re-enter (or be able to lose) a
// field they've already nailed.
function deriveLocks(guesses) {
  const locked = {};
  for (const { guess, feedback } of guesses) {
    if (feedback.month === "correct") locked.month = guess.month;
    if (feedback.year === "correct") locked.year = guess.year;
    if (feedback.day === "correct") locked.day = guess.day;
  }
  return locked;
}

// onGameOver receives a client-accumulated summary ({ totalScore, rounds })
// built from each round's guess response — there is no server round-trip to
// fetch a summary, so ending a game doesn't touch the session's image
// directory. Only the "New account" action (POST /api/game/end) does that.
export async function renderBoard(container, { onGameOver }) {
  const roundResults = [];
  let score = 0;
  let guessHandle = null;

  container.innerHTML = `
    <div class="board-screen">
      <div class="round-chip" id="round-chip"></div>
      <div class="card photo-card" id="photo-card">
        <div class="photo-frame">
          <img id="photo-img" class="photo-img" alt="Guess the date" />
        </div>
        <p class="revealed-day" id="revealed-day" hidden></p>
      </div>
      <div id="guess-input-slot"></div>
      <div class="history-list" id="history-list"></div>
    </div>
  `;

  const roundChip = container.querySelector("#round-chip");
  const photoImg = container.querySelector("#photo-img");
  const revealedDayEl = container.querySelector("#revealed-day");
  const guessSlot = container.querySelector("#guess-input-slot");
  const historyList = container.querySelector("#history-list");

  function updateChip(round) {
    roundChip.textContent = `Photo ${round.roundIndex + 1} / ${round.totalRounds} · ${score} pts`;
  }

  function renderInput(round, locked) {
    guessSlot.innerHTML = "";
    guessHandle = renderGuessInput(guessSlot, {
      dayMode: round.dayMode,
      minYear: round.minYear,
      maxYear: round.maxYear,
      locked,
      onGuess: (guess) => handleGuess(round, guess),
    });
  }

  async function loadRound() {
    const round = await api.gameRound();
    updateChip(round);
    // Presentational only (RESTYLE.md §0.5): fade the photo in once loaded.
    photoImg.classList.remove("loaded");
    photoImg.onload = () => photoImg.classList.add("loaded");
    photoImg.src = round.photoUrl;

    if (!round.dayMode && round.revealedDay) {
      revealedDayEl.hidden = false;
      revealedDayEl.textContent = `Posted on the ${round.revealedDay}${ordinalSuffix(round.revealedDay)} of ?/?`;
    } else {
      revealedDayEl.hidden = true;
    }

    renderHistory(historyList, { guesses: round.guesses, dayMode: round.dayMode });
    renderInput(round, deriveLocks(round.guesses));
  }

  async function handleGuess(round, guess) {
    let result;
    try {
      result = await api.gameGuess(guess);
    } catch {
      guessHandle.setEnabled(true);
      return;
    }

    if (!result.roundOver) {
      const fresh = await api.gameRound();
      renderHistory(historyList, { guesses: fresh.guesses, dayMode: fresh.dayMode });
      renderInput(fresh, deriveLocks(fresh.guesses));
      return;
    }

    score += result.pointsEarned;
    roundResults.push({ solved: result.solved, pointsEarned: result.pointsEarned });
    updateChip(round);

    renderReveal(container, {
      trueDate: result.trueDate,
      pointsEarned: result.pointsEarned,
      solved: result.solved,
      isLastRound: result.gameOver,
      onContinue: () => {
        if (result.gameOver) {
          onGameOver({ totalScore: score, rounds: roundResults });
        } else {
          loadRound();
        }
      },
    });
  }

  await loadRound();
}
