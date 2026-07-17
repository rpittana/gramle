import { api } from "./api.js";
import { renderGate } from "./components/gate.js";
import { renderSetup } from "./components/setup.js";
import { renderBoard } from "./components/board.js";
import { renderResults } from "./components/results.js";

const root = document.getElementById("app");

let gameConfig = { rounds: 8, dayMode: false, hardMode: false };

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

// Starting a game kicks off the on-demand download of the sampled photos —
// show a small interstitial while polling until the prep job is ready.
async function startGame() {
  showScreen((container) => {
    container.innerHTML = `
      <div class="gate-screen">
        <div class="card progress-card" style="width: 100%;">
          <p class="progress-label" id="prep-label">Developing the photos…</p>
          <div class="progress-bar"><div class="progress-fill" id="prep-fill" style="width: 8%;"></div></div>
          <p class="progress-count" id="prep-count"></p>
        </div>
      </div>
    `;
  });

  const label = root.querySelector("#prep-label");
  const fill = root.querySelector("#prep-fill");
  const count = root.querySelector("#prep-count");

  try {
    await api.gameStart(gameConfig);
  } catch (err) {
    label.textContent = err.message;
    return;
  }

  const poll = async () => {
    let status;
    try {
      status = await api.gameStatus();
    } catch {
      label.textContent = "Lost connection while preparing the game.";
      return;
    }

    if (status.state === "ready") {
      fill.style.width = "100%";
      setTimeout(goToBoard, 300);
      return;
    }
    if (status.state === "error") {
      label.textContent = status.error || "Something went wrong preparing the game.";
      count.textContent = "";
      const back = document.createElement("button");
      back.className = "btn btn-outline";
      back.textContent = "Back";
      back.addEventListener("click", goToSetup);
      label.parentElement.appendChild(back);
      return;
    }

    const done = Math.max(status.downloaded || 0, status.resized || 0);
    if (status.total) {
      count.textContent = `${done} / ${status.total} photos`;
      fill.style.width = `${Math.min(95, 8 + (done / status.total) * 87)}%`;
    }
    setTimeout(poll, 1500);
  };
  poll();
}

function goToBoard() {
  showScreen((container) => renderBoard(container, { onGameOver: goToResults }));
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
