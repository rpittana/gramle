export function renderResults(container, { summary, onPlayAgain, onNewAccount }) {
  const { totalScore, rounds } = summary;

  container.innerHTML = `
    <div class="results-screen">
      <p class="results-total">${totalScore} pts</p>
      <div class="dot-strip">
        ${rounds
          .map((r) => {
            const cls = r.solved ? "dot-solved" : r.pointsEarned > 0 ? "dot-partial" : "dot-zero";
            return `<span class="dot ${cls}"></span>`;
          })
          .join("")}
      </div>
      <div class="results-actions">
        <button type="button" class="btn btn-accent" id="play-again">Play again</button>
        <button type="button" class="btn btn-outline" id="new-account">New account</button>
      </div>
    </div>
  `;

  container.querySelector("#play-again").addEventListener("click", onPlayAgain);
  container.querySelector("#new-account").addEventListener("click", onNewAccount);
}
