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

// onGameOver receives a client-accumulated summary ({ totalScore, rounds })
// built from each round's guess response — there is no server round-trip to
// fetch a summary, so ending a game doesn't touch the session's image
// directory. Only the "New account" action (POST /api/game/end) does that.
export async function renderBoard(container, { dayMode, minYear, maxYear, onGameOver }) {
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

  async function loadRound() {
    const round = await api.gameRound();
    updateChip(round);
    photoImg.src = round.photoUrl;

    if (!round.dayMode && round.revealedDay) {
      revealedDayEl.hidden = false;
      revealedDayEl.textContent = `Posted on the ${round.revealedDay}${ordinalSuffix(round.revealedDay)} of ?/?`;
    } else {
      revealedDayEl.hidden = true;
    }

    renderHistory(historyList, { guesses: round.guesses, dayMode: round.dayMode });

    guessSlot.innerHTML = "";
    guessHandle = renderGuessInput(guessSlot, {
      dayMode: round.dayMode,
      minYear,
      maxYear,
      onGuess: (guess) => handleGuess(round, guess),
    });
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
      guessHandle.reset();
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
