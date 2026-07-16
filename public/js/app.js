import { api } from "./api.js";
import { renderGate } from "./components/gate.js";
import { renderSetup } from "./components/setup.js";
import { renderBoard } from "./components/board.js";
import { renderResults } from "./components/results.js";

const root = document.getElementById("app");

let gameConfig = { rounds: 8, dayMode: false };
let yearBounds = { minYear: 2010, maxYear: new Date().getFullYear() };

function showScreen(renderFn) {
  root.classList.remove("screen-enter");
  root.innerHTML = "";
  renderFn(root);
  requestAnimationFrame(() => root.classList.add("screen-enter"));
}

function goToGate() {
  showScreen((container) => renderGate(container, { onSuccess: goToSetup }));
}

function goToSetup() {
  showScreen((container) =>
    renderSetup(container, {
      onReady: (config) => {
        gameConfig = config;
        startGame();
      },
    })
  );
}

async function startGame() {
  const { minYear, maxYear } = await api.gameStart(gameConfig.rounds, gameConfig.dayMode);
  yearBounds = { minYear, maxYear };
  goToBoard();
}

function goToBoard() {
  showScreen((container) =>
    renderBoard(container, {
      dayMode: gameConfig.dayMode,
      minYear: yearBounds.minYear,
      maxYear: yearBounds.maxYear,
      onGameOver: goToResults,
    })
  );
}

function goToResults(summary) {
  showScreen((container) =>
    renderResults(container, {
      summary,
      onPlayAgain: () => startGame(),
      onNewAccount: () => {
        api.gameEnd().catch(() => {});
        goToSetup();
      },
    })
  );
}

window.addEventListener("gramle:unauthorized", goToGate);

goToGate();
