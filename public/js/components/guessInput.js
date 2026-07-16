const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function renderGuessInput(container, { dayMode, minYear, maxYear, onGuess }) {
  const years = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  container.innerHTML = `
    <div class="guess-input">
      <div class="picker-row">
        <select id="guess-month" class="picker">
          <option value="" disabled selected>Month</option>
          ${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}
        </select>
        <select id="guess-year" class="picker">
          <option value="" disabled selected>Year</option>
          ${years.map((y) => `<option value="${y}">${y}</option>`).join("")}
        </select>
        ${
          dayMode
            ? `<select id="guess-day" class="picker">
                <option value="" disabled selected>Day</option>
                ${Array.from({ length: 31 }, (_, i) => i + 1)
                  .map((d) => `<option value="${d}">${d}</option>`)
                  .join("")}
              </select>`
            : ""
        }
      </div>
      <button type="button" id="guess-btn" class="btn btn-accent" disabled>Guess</button>
    </div>
  `;

  const monthSel = container.querySelector("#guess-month");
  const yearSel = container.querySelector("#guess-year");
  const daySel = dayMode ? container.querySelector("#guess-day") : null;
  const guessBtn = container.querySelector("#guess-btn");

  function checkReady() {
    const ready = monthSel.value && yearSel.value && (!dayMode || daySel.value);
    guessBtn.disabled = !ready;
  }

  monthSel.addEventListener("change", checkReady);
  yearSel.addEventListener("change", checkReady);
  if (daySel) daySel.addEventListener("change", checkReady);

  guessBtn.addEventListener("click", () => {
    const guess = { month: Number(monthSel.value), year: Number(yearSel.value) };
    if (dayMode) guess.day = Number(daySel.value);
    guessBtn.disabled = true;
    onGuess(guess);
  });

  return {
    reset() {
      monthSel.value = "";
      yearSel.value = "";
      if (daySel) daySel.value = "";
      guessBtn.disabled = true;
    },
    setEnabled(enabled) {
      guessBtn.disabled = !enabled;
    },
  };
}
