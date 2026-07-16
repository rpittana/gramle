import { api } from "../api.js";

export function renderGate(container, { onSuccess }) {
  container.innerHTML = `
    <div class="gate-screen">
      <form class="card gate-card" id="gate-form">
        <input
          type="password"
          id="gate-password"
          class="text-input"
          placeholder="Password"
          autocomplete="current-password"
        />
        <button type="submit" class="btn btn-accent">Enter</button>
        <p class="gate-error" id="gate-error" hidden></p>
      </form>
    </div>
  `;

  const form = container.querySelector("#gate-form");
  const passwordInput = container.querySelector("#gate-password");
  const errorEl = container.querySelector("#gate-error");
  const submitBtn = form.querySelector("button");

  passwordInput.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      await api.login(passwordInput.value);
      onSuccess();
    } catch (err) {
      if (err.status === 429) {
        const mins = Math.ceil((err.data?.retryAfterSec || 900) / 60);
        errorEl.textContent = `Too many attempts. Try again in ${mins} min.`;
      } else {
        errorEl.textContent = "Incorrect password.";
      }
      errorEl.hidden = false;
      passwordInput.value = "";
      passwordInput.focus();
    } finally {
      submitBtn.disabled = false;
    }
  });
}
