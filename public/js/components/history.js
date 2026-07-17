const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function arrow(direction) {
  if (direction === "correct") return "✓";
  if (direction === "wrong") return "✕"; // hard mode: no direction revealed
  return direction === "later" ? "↑" : "↓";
}

function cellClass(direction) {
  if (direction === "correct") return "cell-correct";
  if (direction === "wrong") return "cell-wrong";
  return direction === "later" ? "cell-early" : "cell-late";
}

export function renderHistory(container, { guesses, dayMode }) {
  container.innerHTML = guesses
    .slice()
    .reverse()
    .map(
      ({ guess, feedback }) => `
      <div class="history-row">
        <span class="history-cell ${cellClass(feedback.month)}">${MONTHS_SHORT[guess.month - 1]} ${arrow(feedback.month)}</span>
        <span class="history-cell ${cellClass(feedback.year)}">${guess.year} ${arrow(feedback.year)}</span>
        ${dayMode ? `<span class="history-cell ${cellClass(feedback.day)}">${guess.day} ${arrow(feedback.day)}</span>` : ""}
      </div>
    `
    )
    .join("");
}
