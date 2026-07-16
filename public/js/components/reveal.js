const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function renderReveal(container, { trueDate, pointsEarned, solved, isLastRound, onContinue }) {
  const dateStr = `${MONTHS[trueDate.month - 1]} ${trueDate.day}, ${trueDate.year}`;

  const overlay = document.createElement("div");
  overlay.className = "reveal-overlay";
  overlay.innerHTML = `
    <div class="card reveal-card ${solved ? "reveal-solved" : ""}">
      <p class="reveal-date">${dateStr}</p>
      <p class="reveal-points" id="reveal-points">0 pts</p>
      <button type="button" class="btn btn-accent" id="reveal-continue">
        ${isLastRound ? "See results" : "Next photo"}
      </button>
    </div>
  `;
  container.appendChild(overlay);

  const pointsEl = overlay.querySelector("#reveal-points");
  const start = performance.now();
  const duration = 500;

  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    pointsEl.textContent = `${Math.round(t * pointsEarned)} pts`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  overlay.querySelector("#reveal-continue").addEventListener("click", () => {
    overlay.remove();
    onContinue();
  });
}
