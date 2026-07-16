async function apiFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("gramle:unauthorized"));
    throw new Error("Not authenticated.");
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  login: (password) => apiFetch("/api/login", { method: "POST", body: { password } }),
  logout: () => apiFetch("/api/logout", { method: "POST" }),
  scrape: (profileUrl) => apiFetch("/api/scrape", { method: "POST", body: { profileUrl } }),
  scrapeStatus: () => apiFetch("/api/scrape/status"),
  gameStart: (rounds, dayMode) =>
    apiFetch("/api/game/start", { method: "POST", body: { rounds, dayMode } }),
  gameRound: () => apiFetch("/api/game/round"),
  gameGuess: (guess) => apiFetch("/api/game/guess", { method: "POST", body: guess }),
  gameEnd: () => apiFetch("/api/game/end", { method: "POST" }),
};
