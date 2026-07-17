import { api } from "../api.js";

const ROUND_OPTIONS = [5, 8, 10];
const DEFAULT_ROUND_INDEX = 1;

export function renderSetup(container, { onReady }) {
  container.innerHTML = `
    <div class="setup-screen">
      <form class="card setup-card" id="setup-form">
        <div class="field-label" style="margin-top: 0;">Instagram profile</div>
        <input
          type="text"
          id="profile-url"
          class="text-input"
          placeholder="instagram.com/username"
        />

        <div class="toggle-row">
          <span>Guess the day too</span>
          <button type="button" id="day-toggle" class="toggle" aria-pressed="false">
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="toggle-row">
          <span>Hard mode — no hints, 1.5× points</span>
          <button type="button" id="hard-toggle" class="toggle" aria-pressed="false">
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="field-label">Rounds</div>
        <div class="rounds-row" id="rounds-row">
          ${ROUND_OPTIONS.map(
            (n, i) =>
              `<button type="button" class="chip-btn${i === DEFAULT_ROUND_INDEX ? " chip-btn-active" : ""}" data-rounds="${n}">${n}</button>`
          ).join("")}
        </div>

        <button type="submit" class="btn btn-accent">Gather the album</button>
        <p class="setup-error" id="setup-error" hidden></p>
      </form>

      <div class="card progress-card" id="progress-card" hidden>
        <p class="progress-label" id="progress-label">Reading the album…</p>
        <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
        <p class="progress-count" id="progress-count"></p>
      </div>
    </div>
  `;

  let dayMode = false;
  let hardMode = false;
  let rounds = ROUND_OPTIONS[DEFAULT_ROUND_INDEX];
  let polling = false;

  const form = container.querySelector("#setup-form");
  const urlInput = container.querySelector("#profile-url");
  const dayToggle = container.querySelector("#day-toggle");
  const hardToggle = container.querySelector("#hard-toggle");
  const roundsRow = container.querySelector("#rounds-row");
  const errorEl = container.querySelector("#setup-error");
  const progressCard = container.querySelector("#progress-card");
  const progressLabel = container.querySelector("#progress-label");
  const progressFill = container.querySelector("#progress-fill");
  const progressCount = container.querySelector("#progress-count");

  function wireToggle(btn, onFlip) {
    btn.addEventListener("click", () => {
      const on = btn.getAttribute("aria-pressed") !== "true";
      btn.classList.toggle("toggle-on", on);
      btn.setAttribute("aria-pressed", String(on));
      onFlip(on);
    });
  }
  wireToggle(dayToggle, (on) => (dayMode = on));
  wireToggle(hardToggle, (on) => (hardMode = on));

  roundsRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-btn");
    if (!btn) return;
    rounds = Number(btn.dataset.rounds);
    roundsRow.querySelectorAll(".chip-btn").forEach((b) => b.classList.remove("chip-btn-active"));
    btn.classList.add("chip-btn-active");
  });

  function showError(message) {
    progressCard.hidden = true;
    form.hidden = false;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  // The scrape job only indexes post dates now (no image downloads) — the
  // sampled photos are fetched later, when the game starts.
  async function pollStatus() {
    if (!polling) return;
    let status;
    try {
      status = await api.scrapeStatus();
    } catch {
      polling = false;
      showError("Lost connection while reading the album.");
      return;
    }

    if (status.state === "queued") {
      progressLabel.textContent =
        status.queuePosition > 1 ? `Waiting in line (position ${status.queuePosition})…` : "Waiting for the scraper…";
      progressCount.textContent = "";
      progressFill.style.width = "8%";
    } else if (status.state === "running") {
      const n = status.indexed || 0;
      progressLabel.textContent = "Reading the album…";
      progressCount.textContent = `${n} posts found`;
      progressFill.style.width = `${Math.min(95, 10 + n * 2)}%`;
    } else if (status.state === "done") {
      polling = false;
      progressFill.style.width = "100%";
      progressLabel.textContent = "Album ready.";
      progressCount.textContent = `${status.postCount} photo posts`;
      setTimeout(() => onReady({ rounds, dayMode, hardMode }), 400);
      return;
    } else if (status.state === "error") {
      polling = false;
      showError(status.error || "Something went wrong.");
      return;
    }

    setTimeout(pollStatus, 2000);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    try {
      await api.scrape(urlInput.value);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      return;
    }
    form.hidden = true;
    progressCard.hidden = false;
    polling = true;
    pollStatus();
  });
}
