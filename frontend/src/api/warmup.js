// The free hosting tier puts the backend to sleep after a quiet spell, and the
// first request then waits up to a minute. This wakes it as soon as the app
// loads: one GET /health in the background, a short timeout, no UI, never
// throws. (The sign-in page's own /auth/options request keeps its cache fresh.)

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const TIMEOUT_MS = 15000;
let started = null;

// Resolves true once the server answered /health, false otherwise; never rejects
export function warmUpServer({ fetchImpl = globalThis.fetch } = {}) {
  if (started) return started;
  if (typeof fetchImpl !== "function") return Promise.resolve(false);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && setTimeout(() => controller.abort(), TIMEOUT_MS);
  started = fetchImpl(`${API_URL}/health`, { method: "GET", credentials: "omit", signal: controller?.signal })
    .then((response) => response.ok, () => false)
    .finally(() => timer && clearTimeout(timer));
  return started;
}

// For tests
export function resetWarmUp() {
  started = null;
}
