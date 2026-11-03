// GitHub account linking, bound to the browser tab that started it.
// See backend/app/routers/github.py for the full flow and why.
import { apiFetch } from "./client";

const NONCE_KEY = "github_oauth_nonce";
const PENDING_PARAM = "github_pending";

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Step 1: remember a nonce in this tab only, then go to GitHub
export async function startGithubLink() {
  const nonce = randomNonce();
  sessionStorage.setItem(NONCE_KEY, nonce);
  const { url } = await apiFetch("/auth/github/start", { method: "POST", body: { nonce } });
  window.location.assign(url);
}

// Reads the pending blob the backend put in the URL fragment and removes it
// from the address bar right away (so it isn't bookmarked or processed twice).
export function takePendingLink() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const pending = params.get(PENDING_PARAM);
  if (!pending) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return pending;
}

// Step 3: prove this is the same user and the same tab that started the link
export async function completeGithubLink(pending) {
  const nonce = sessionStorage.getItem(NONCE_KEY);
  sessionStorage.removeItem(NONCE_KEY);
  if (!nonce) {
    throw new Error("This GitHub link wasn't started in this browser tab. Please connect again.");
  }
  await apiFetch("/auth/github/complete", { method: "POST", body: { pending, nonce } });
}
